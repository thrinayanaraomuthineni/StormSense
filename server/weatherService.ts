import { TELANGANA_DISTRICTS, getWeatherLabelFromWmo } from '../src/lib/telanganaDistricts';
import type { DailyWeatherPoint, HourlyWeatherPoint, WeatherObservation } from '../src/lib/types';
import { loadWeatherCache, saveWeatherCache } from './db';

const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes fresh window

interface OpenMeteoLocationPayload {
  latitude: number;
  longitude: number;
  current?: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    precipitation: number;
    rain: number;
    weather_code: number;
    surface_pressure: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    rain: number[];
    weather_code: number[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
    wind_gusts_10m_max: number[];
  };
}

export interface WeatherServiceResult {
  observations: WeatherObservation[];
  status: 'live' | 'stale' | 'error';
  lastUpdated: string | null;
  errorMessage: string | null;
}

let memoryCache: WeatherObservation[] = loadWeatherCache();
let lastAttemptFailedMessage: string | null = null;

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (res.ok) return res;
      lastError = new Error(`Open-Meteo HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Open-Meteo fetch failed');
}

function parseOpenMeteoResponse(
  payloads: OpenMeteoLocationPayload[],
  fetchedAt: string
): WeatherObservation[] {
  return TELANGANA_DISTRICTS.map((district, idx) => {
    const p = payloads[idx];
    if (!p || !p.current) {
      throw new Error(`Missing current weather payload for district ${district.name}`);
    }
    const wmo = getWeatherLabelFromWmo(p.current.weather_code ?? 0);

    const hourlyTimes = p.hourly?.time ?? [];
    // Find starting index near current time so 24h forecast starts from current hour,
    // while preceding hourly entries from past_days=1 form real historical weather observations.
    const nowHourPrefix = p.current.time ? p.current.time.slice(0, 13) : '';
    let startIdx = hourlyTimes.findIndex((t) => t.startsWith(nowHourPrefix));
    if (startIdx < 0) startIdx = 0;

    const historyStart = Math.max(0, startIdx - 24);
    let recentHistory: WeatherObservation['recentHistory'] = undefined;
    if (startIdx > historyStart) {
      let pastRain = 0;
      let pastMaxWind = 0;
      let pastMaxGusts = 0;
      let pastThunderHours = 0;
      for (let i = historyStart; i < startIdx; i++) {
        pastRain += p.hourly?.rain?.[i] ?? 0;
        const wSpd = p.hourly?.wind_speed_10m?.[i] ?? 0;
        const wGst = p.hourly?.wind_gusts_10m?.[i] ?? 0;
        if (wSpd > pastMaxWind) pastMaxWind = wSpd;
        if (wGst > pastMaxGusts) pastMaxGusts = wGst;
        if ((p.hourly?.weather_code?.[i] ?? 0) >= 95) {
          pastThunderHours += 1;
        }
      }
      recentHistory = {
        past24hRainMm: Math.round(pastRain * 10) / 10,
        past24hMaxWindKmh: Math.round(pastMaxWind * 10) / 10,
        past24hMaxGustsKmh: Math.round(pastMaxGusts * 10) / 10,
        past24hThunderHours: pastThunderHours,
        observationHoursCount: startIdx - historyStart,
        periodStart: hourlyTimes[historyStart],
        periodEnd: hourlyTimes[startIdx - 1],
        source: 'Open-Meteo Historical Hourly API',
      };
    }

    const hourly: HourlyWeatherPoint[] = hourlyTimes.slice(startIdx, startIdx + 24).map((time, hOffset) => {
      const i = startIdx + hOffset;
      const code = p.hourly?.weather_code?.[i] ?? 0;
      return {
        time,
        temperatureC: p.hourly?.temperature_2m?.[i] ?? p.current!.temperature_2m,
        precipitationProbability: p.hourly?.precipitation_probability?.[i] ?? 0,
        rainMm: p.hourly?.rain?.[i] ?? 0,
        windSpeedKmh: p.hourly?.wind_speed_10m?.[i] ?? 0,
        windGustsKmh: p.hourly?.wind_gusts_10m?.[i] ?? 0,
        weatherCode: code,
        weatherLabel: getWeatherLabelFromWmo(code).label,
      };
    });

    const dailyTimes = p.daily?.time ?? [];
    const todayDate = p.current.time ? p.current.time.slice(0, 10) : '';
    let dailyStartIdx = todayDate ? dailyTimes.findIndex((d) => d >= todayDate) : 0;
    if (dailyStartIdx < 0) dailyStartIdx = 0;

    const daily: DailyWeatherPoint[] = dailyTimes
      .slice(dailyStartIdx, dailyStartIdx + 7)
      .map((date, dOffset) => {
        const i = dailyStartIdx + dOffset;
        const code = p.daily?.weather_code?.[i] ?? 0;
        return {
          date,
          tempMaxC: p.daily?.temperature_2m_max?.[i] ?? p.current!.temperature_2m,
          tempMinC: p.daily?.temperature_2m_min?.[i] ?? p.current!.temperature_2m,
          precipitationSumMm: p.daily?.precipitation_sum?.[i] ?? 0,
          precipitationProbabilityMax: p.daily?.precipitation_probability_max?.[i] ?? 0,
          windSpeedMaxKmh: p.daily?.wind_speed_10m_max?.[i] ?? 0,
          windGustsMaxKmh: p.daily?.wind_gusts_10m_max?.[i] ?? 0,
          weatherCode: code,
          weatherLabel: getWeatherLabelFromWmo(code).label,
        };
      });

    const currentPrecipProb = hourly[0]?.precipitationProbability ?? daily[0]?.precipitationProbabilityMax ?? 0;

    return {
      districtId: district.id,
      districtName: district.name,
      lat: district.lat,
      lng: district.lng,
      temperatureC: p.current.temperature_2m,
      relativeHumidity: p.current.relative_humidity_2m,
      precipitationMm: p.current.precipitation,
      rainMm: p.current.rain,
      precipitationProbability: currentPrecipProb,
      windSpeedKmh: p.current.wind_speed_10m,
      windGustsKmh: p.current.wind_gusts_10m,
      surfacePressureHpa: p.current.surface_pressure,
      weatherCode: p.current.weather_code,
      weatherLabel: wmo.label,
      isThunderstorm: wmo.isThunderstorm,
      hourly,
      daily,
      recentHistory,
      fetchedAt,
      isStale: false,
      source: 'Open-Meteo Live API',
    };
  });
}

export async function refreshLiveWeather(): Promise<WeatherServiceResult> {
  const lats = TELANGANA_DISTRICTS.map((d) => d.lat).join(',');
  const lngs = TELANGANA_DISTRICTS.map((d) => d.lng).join(',');

  const params = new URLSearchParams({
    latitude: lats,
    longitude: lngs,
    current:
      'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,surface_pressure,wind_speed_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,rain,weather_code,wind_speed_10m,wind_gusts_10m',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max',
    timezone: 'Asia/Kolkata',
    past_days: '1',
    forecast_days: '7',
  });

  const url = `${OPEN_METEO_ENDPOINT}?${params.toString()}`;

  try {
    const res = await fetchWithRetry(url);
    const json = (await res.json()) as OpenMeteoLocationPayload | OpenMeteoLocationPayload[];
    const payloads = Array.isArray(json) ? json : [json];
    const fetchedAt = new Date().toISOString();
    const observations = parseOpenMeteoResponse(payloads, fetchedAt);

    memoryCache = observations;
    lastAttemptFailedMessage = null;
    saveWeatherCache(observations);

    return {
      observations,
      status: 'live',
      lastUpdated: fetchedAt,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reach Open-Meteo API';
    lastAttemptFailedMessage = message;

    if (memoryCache.length > 0) {
      const staleObs = memoryCache.map((obs) => ({
        ...obs,
        isStale: true,
        errorMessage: `Live weather refresh failed (${message}); displaying cached observation.`,
      }));
      return {
        observations: staleObs,
        status: 'stale',
        lastUpdated: memoryCache[0]?.fetchedAt ?? null,
        errorMessage: `Live Open-Meteo refresh failed (${message}). Serving cached telemetry with stale indicator.`,
      };
    }

    return {
      observations: [],
      status: 'error',
      lastUpdated: null,
      errorMessage: `Open-Meteo API unavailable (${message}) and no cached weather records exist.`,
    };
  }
}

export async function getWeatherState(forceRefresh = false): Promise<WeatherServiceResult> {
  if (forceRefresh || memoryCache.length === 0 || !memoryCache[0]?.recentHistory) {
    return refreshLiveWeather();
  }

  const latestFetch = memoryCache[0]?.fetchedAt ? new Date(memoryCache[0].fetchedAt).getTime() : 0;
  const ageMs = Date.now() - latestFetch;

  if (ageMs > CACHE_TTL_MS) {
    return refreshLiveWeather();
  }

  if (lastAttemptFailedMessage) {
    return {
      observations: memoryCache.map((obs) => ({ ...obs, isStale: true })),
      status: 'stale',
      lastUpdated: memoryCache[0]?.fetchedAt ?? null,
      errorMessage: lastAttemptFailedMessage,
    };
  }

  return {
    observations: memoryCache,
    status: 'live',
    lastUpdated: memoryCache[0]?.fetchedAt ?? null,
    errorMessage: null,
  };
}
