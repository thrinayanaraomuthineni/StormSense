import test from 'node:test';
import assert from 'node:assert/strict';
import { TELANGANA_DISTRICTS } from './telanganaDistricts';
import {
  DEFAULT_RISK_WEIGHTS,
  MODEL_TYPE_LABEL,
  assessDistrictRisk,
  classifyRiskScore,
  computeRiskBreakdown,
  normalizeRiskWeights,
} from './riskEngine';
import type { WeatherObservation } from './types';

test('classifyRiskScore maps 0-100 bands accurately', () => {
  assert.equal(classifyRiskScore(0), 'LOW');
  assert.equal(classifyRiskScore(30), 'LOW');
  assert.equal(classifyRiskScore(31), 'MODERATE');
  assert.equal(classifyRiskScore(60), 'MODERATE');
  assert.equal(classifyRiskScore(61), 'HIGH');
  assert.equal(classifyRiskScore(80), 'HIGH');
  assert.equal(classifyRiskScore(81), 'CRITICAL');
  assert.equal(classifyRiskScore(100), 'CRITICAL');
});

test('normalizeRiskWeights always totals 100.0 points for arbitrary positive weight inputs', () => {
  const defaultNorm = normalizeRiskWeights(DEFAULT_RISK_WEIGHTS);
  const defaultSum = Object.values(defaultNorm).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(defaultSum * 10) / 10, 100);

  const customNorm = normalizeRiskWeights({
    rainfall: 50,
    wind: 25,
    gusts: 25,
    thunderstorm: 10,
    precipitationProb: 10,
    historicalWeather: 5,
    recordedIncidents: 15,
    gridVulnerability: 10,
  });
  const customSum = Object.values(customNorm).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(customSum * 10) / 10, 100);
  assert.ok(customNorm.rainfall > customNorm.wind);

  const zeroFallback = normalizeRiskWeights({
    rainfall: 0,
    wind: 0,
    gusts: 0,
    thunderstorm: 0,
    precipitationProb: 0,
    historicalWeather: 0,
    recordedIncidents: 0,
    gridVulnerability: 0,
  });
  assert.deepEqual(zeroFallback, DEFAULT_RISK_WEIGHTS);
});

test('risk score scales dynamically across calm, moderate, and severe storm scenarios', () => {
  const hyderabad = TELANGANA_DISTRICTS.find((d) => d.id === 'hyderabad')!;
  const calm = computeRiskBreakdown({
    district: hyderabad,
    rainfallMm: 0,
    precipitationProbability: 5,
    windSpeedKmh: 6,
    windGustsKmh: 12,
    isThunderstorm: false,
    historicalOutageCount: 0,
    isStale: false,
    weatherAvailable: true,
  });

  const severe = computeRiskBreakdown({
    district: hyderabad,
    rainfallMm: 22,
    precipitationProbability: 95,
    windSpeedKmh: 48,
    windGustsKmh: 72,
    isThunderstorm: true,
    historicalOutageCount: 3,
    recentHistory: {
      past24hRainMm: 36,
      past24hMaxWindKmh: 42,
      past24hMaxGustsKmh: 68,
      past24hThunderHours: 3,
      observationHoursCount: 24,
      periodStart: '2026-11-12T10:00',
      periodEnd: '2026-11-13T09:00',
      source: 'Open-Meteo Historical Hourly API',
    },
    isStale: false,
    weatherAvailable: true,
  });

  assert.equal(calm.category, 'LOW');
  assert.equal(severe.category, 'CRITICAL');
  assert.ok(severe.score > calm.score + 55);
  assert.ok(severe.score <= 100);
  assert.equal(severe.confidence, 'HIGH');
  assert.equal(severe.dataQualityScore, 100);
  assert.ok(severe.preventiveActions.some((a) => a.factor === 'gusts' || a.factor === 'rainfall'));
});

test('factor contributions sum matches exactScore and respects custom normalized weights', () => {
  const kothagudem = TELANGANA_DISTRICTS.find((d) => d.id === 'kothagudem')!;
  const res = computeRiskBreakdown({
    district: kothagudem,
    rainfallMm: 12.5,
    precipitationProbability: 70,
    windSpeedKmh: 28,
    windGustsKmh: 45,
    isThunderstorm: false,
    historicalOutageCount: 2,
    isStale: true,
    weatherAvailable: true,
    weights: {
      rainfall: 40,
      wind: 10,
      gusts: 10,
      thunderstorm: 10,
      precipitationProb: 5,
      historicalWeather: 5,
      recordedIncidents: 10,
      gridVulnerability: 10,
    },
    incidentContext: {
      activeCount: 2,
      totalCount: 2,
      simulatedCount: 1,
      manualCount: 1,
    },
  });

  const sum = Math.round(res.contributions.reduce((acc, c) => acc + c.points, 0) * 10) / 10;
  const maxSum = Math.round(res.contributions.reduce((acc, c) => acc + c.maxPoints, 0) * 10) / 10;
  assert.equal(maxSum, 100);
  assert.equal(res.exactScore, sum);
  assert.equal(res.score, Math.round(sum));
  assert.equal(res.confidence, 'DEGRADED');
  assert.ok(res.dataQualityFlags.some((f) => f.includes('stale cached data')));
  assert.ok(res.dataQualityFlags.some((f) => f.includes('Simulated Demonstration')));
});

test('assessDistrictRisk marks UNAVAILABLE when weather observation is missing', () => {
  const warangal = TELANGANA_DISTRICTS.find((d) => d.id === 'warangal')!;
  const assessment = assessDistrictRisk(warangal, undefined, 1);
  assert.equal(assessment.confidence, 'UNAVAILABLE');
  assert.equal(assessment.modelType, MODEL_TYPE_LABEL);
  assert.ok(assessment.dataQualityScore < 30);
  assert.ok(assessment.scoreExplanation.includes('unavailable'));
});

test('assessDistrictRisk incorporates 24h historical weather and projects hourly & daily arrays', () => {
  const warangal = TELANGANA_DISTRICTS.find((d) => d.id === 'warangal')!;
  const mockWeather: WeatherObservation = {
    districtId: 'warangal',
    districtName: 'Warangal',
    lat: warangal.lat,
    lng: warangal.lng,
    temperatureC: 29,
    relativeHumidity: 82,
    precipitationMm: 6,
    rainMm: 6,
    precipitationProbability: 80,
    windSpeedKmh: 25,
    windGustsKmh: 42,
    surfacePressureHpa: 1004,
    weatherCode: 95,
    weatherLabel: 'Thunderstorm',
    isThunderstorm: true,
    recentHistory: {
      past24hRainMm: 28,
      past24hMaxWindKmh: 34,
      past24hMaxGustsKmh: 52,
      past24hThunderHours: 2,
      observationHoursCount: 24,
      periodStart: '2026-11-12T11:00',
      periodEnd: '2026-11-13T10:00',
      source: 'Open-Meteo Historical Hourly API',
    },
    hourly: [
      {
        time: '2026-11-13T12:00',
        temperatureC: 29,
        precipitationProbability: 80,
        rainMm: 8,
        windSpeedKmh: 30,
        windGustsKmh: 50,
        weatherCode: 95,
        weatherLabel: 'Thunderstorm',
      },
    ],
    daily: [
      {
        date: '2026-11-13',
        tempMaxC: 32,
        tempMinC: 23,
        precipitationSumMm: 24,
        precipitationProbabilityMax: 85,
        windSpeedMaxKmh: 32,
        windGustsMaxKmh: 55,
        weatherCode: 95,
        weatherLabel: 'Thunderstorm',
      },
    ],
    fetchedAt: '2026-11-13T11:00:00.000Z',
    isStale: false,
    source: 'Open-Meteo Live API',
  };

  const assessment = assessDistrictRisk(warangal, mockWeather, 1);
  assert.equal(assessment.hourlyTrend.length, 1);
  assert.equal(assessment.dailyForecast.length, 1);
  assert.equal(assessment.contributions.length, 8);
  assert.equal(assessment.confidence, 'HIGH');
  assert.equal(assessment.dataQualityScore, 100);
  const histFactor = assessment.contributions.find((c) => c.factor === 'historical_weather');
  assert.ok(histFactor && histFactor.points > 0);
  assert.ok(assessment.score >= 31 && assessment.score <= 60);
  assert.equal(assessment.category, 'MODERATE');
});
