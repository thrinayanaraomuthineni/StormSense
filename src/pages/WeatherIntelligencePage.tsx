import React from 'react';
import { CloudRain, Droplets, Gauge, Thermometer, Wind } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnimatedNumber } from '../components/graphics/AnimatedNumber';
import { RainfallVisualizer, WindFlowCanvas } from '../components/graphics/AtmosphericTelemetryGraphic';
import { TelanganaWeatherRadar } from '../components/graphics/TelanganaWeatherRadar';
import { useStormSense } from '../context/StormSenseContext';
import {
  LoadingGridSkeleton,
  ProvenanceText,
  formatIstDateTime,
} from '../components/ui/DataProvenanceTag';

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#344655',
  border: '1px solid #60788A',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#E5EDF3',
};

export function WeatherIntelligencePage() {
  const {
    districts,
    assessments,
    incidents,
    weather,
    selectedDistrictId,
    setSelectedDistrictId,
    isLoading,
    refreshWeather,
    isRefreshingWeather,
  } = useStormSense();

  if (isLoading && weather.observations.length === 0) {
    return <LoadingGridSkeleton />;
  }

  const selectedObs =
    weather.observations.find((o) => o.districtId === selectedDistrictId) || weather.observations[0];

  if (!selectedObs) {
    return (
      <div className="p-8 rounded-lg ss-card text-center space-y-3">
        <h2 className="font-display text-lg font-semibold text-[#E5EDF3]">
          Open-Meteo Weather Telemetry Unavailable
        </h2>
        <p className="text-sm text-[#AABBC9] max-w-lg mx-auto">
          {weather.errorMessage || 'Unable to retrieve live weather telemetry for Telangana districts.'}
        </p>
        <button
          type="button"
          onClick={refreshWeather}
          disabled={isRefreshingWeather}
          className="px-4 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] text-xs font-semibold text-[#17222B]"
        >
          Retry Live Weather Sync
        </button>
      </div>
    );
  }

  const hourlyData = selectedObs.hourly.map((h) => ({
    hour: h.time.slice(11, 16),
    tempC: h.temperatureC,
    rainMm: h.rainMm,
    precipProb: h.precipitationProbability,
    windKmh: h.windSpeedKmh,
    gustsKmh: h.windGustsKmh,
  }));

  const comparisonData = weather.observations.map((o) => ({
    district: o.districtName.length > 10 ? o.districtName.slice(0, 9) + '…' : o.districtName,
    windGusts: o.windGustsKmh,
    rainMm: o.rainMm,
    precipProb: o.precipitationProbability,
  }));

  return (
    <div className="space-y-6">
      {/* District Selector Bar */}
      <div className="p-4 rounded-lg ss-card flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
              District Meteorological Station: {selectedObs.districtName}
            </h2>
            {selectedObs.isStale && (
              <span className="text-xs font-medium text-[#F2C16E]">· Stale Cached Data</span>
            )}
          </div>
          <ProvenanceText source="Live API Data (Open-Meteo Forecast)" timestamp={selectedObs.fetchedAt} />
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="weather-district-select" className="text-xs text-[#AABBC9]">
            Monitored District:
          </label>
          <select
            id="weather-district-select"
            value={selectedObs.districtId}
            onChange={(e) => setSelectedDistrictId(e.target.value)}
            className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
          >
            {weather.observations.map((o) => (
              <option key={o.districtId} value={o.districtId}>
                {o.districtName} ({o.lat.toFixed(2)}°N, {o.lng.toFixed(2)}°E)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Current Observation KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-lg ss-card space-y-1">
          <div className="text-xs text-[#AABBC9] flex items-center gap-1.5">
            <Thermometer className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
            <span>Temperature</span>
          </div>
          <div className="text-xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={selectedObs.temperatureC} decimals={1} suffix="°C" />
          </div>
          <div className="text-[11px] text-[#8FA3B3]">{selectedObs.weatherLabel}</div>
        </div>

        <div className="p-4 rounded-lg ss-card space-y-1">
          <div className="text-xs text-[#AABBC9] flex items-center gap-1.5">
            <Droplets className="w-3.5 h-3.5 text-[#70A9CF]" aria-hidden="true" />
            <span>Humidity</span>
          </div>
          <div className="text-xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={selectedObs.relativeHumidity} suffix="%" />
          </div>
          <div className="text-[11px] text-[#8FA3B3]">Relative humidity</div>
        </div>

        <div className="p-4 rounded-lg ss-card space-y-1">
          <div className="text-xs text-[#AABBC9] flex items-center gap-1.5">
            <CloudRain className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
            <span>Rainfall</span>
          </div>
          <div className="text-xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={selectedObs.rainMm} decimals={1} suffix=" mm" />
          </div>
          <div className="text-[11px] text-[#8FA3B3]">
            {selectedObs.precipitationProbability}% precip prob
          </div>
        </div>

        <div className="p-4 rounded-lg ss-card space-y-1">
          <div className="text-xs text-[#AABBC9] flex items-center gap-1.5">
            <Wind className="w-3.5 h-3.5 text-[#E5A94C]" aria-hidden="true" />
            <span>Wind Speed</span>
          </div>
          <div className="text-xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={selectedObs.windSpeedKmh} decimals={1} />{' '}
            <span className="text-xs font-normal text-[#8FA3B3]">km/h</span>
          </div>
          <div className="text-[11px] text-[#8FA3B3]">10m sustained</div>
        </div>

        <div className="p-4 rounded-lg ss-card space-y-1">
          <div className="text-xs text-[#AABBC9] flex items-center gap-1.5">
            <Wind className="w-3.5 h-3.5 text-[#E58854]" aria-hidden="true" />
            <span>Wind Gusts</span>
          </div>
          <div className="text-xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={selectedObs.windGustsKmh} decimals={1} />{' '}
            <span className="text-xs font-normal text-[#8FA3B3]">km/h</span>
          </div>
          <div className="text-[11px] text-[#8FA3B3]">Peak squall gust</div>
        </div>

        <div className="p-4 rounded-lg ss-card space-y-1">
          <div className="text-xs text-[#AABBC9] flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-[#70A9CF]" aria-hidden="true" />
            <span>Pressure</span>
          </div>
          <div className="text-xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={selectedObs.surfacePressureHpa} />{' '}
            <span className="text-xs font-normal text-[#8FA3B3]">hPa</span>
          </div>
          <div className="text-[11px] text-[#8FA3B3]">Surface atmospheric</div>
        </div>
      </div>

      {/* Interactive Meteorological Radar + Live Wind & Precipitation Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-5 p-5 rounded-lg ss-card flex flex-col items-center justify-between space-y-3">
          <div className="w-full">
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              Telangana Meteorological Radar Sweep
            </h3>
            <p className="text-xs text-[#8FA3B3]">
              Click any station node to switch live telemetry focus or scrub forecast horizon
            </p>
          </div>
          <TelanganaWeatherRadar
            districts={districts}
            weather={weather.observations}
            assessments={assessments}
            incidents={incidents}
            selectedDistrictId={selectedObs.districtId}
            onSelectDistrict={(id) => setSelectedDistrictId(id)}
            size={236}
          />
        </section>

        <section className="lg:col-span-7 p-5 rounded-lg ss-card flex flex-col justify-between space-y-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              Live Atmospheric Motion &amp; Precipitation Telemetry ({selectedObs.districtName})
            </h3>
            <ProvenanceText source="Live Open-Meteo Telemetry" timestamp={selectedObs.fetchedAt} />
          </div>

          <div className="space-y-3">
            <WindFlowCanvas
              windSpeedKmh={selectedObs.windSpeedKmh}
              windGustsKmh={selectedObs.windGustsKmh}
              height={92}
            />
            <RainfallVisualizer
              rainMm={selectedObs.rainMm}
              precipProb={selectedObs.precipitationProbability}
            />
          </div>

          <div className="text-[11px] text-[#8FA3B3]">
            Particle flow speed and precipitation streaks scale directly from current Open-Meteo observations.
          </div>
        </section>
      </div>

      {/* 24h Hourly Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="p-5 rounded-lg ss-card space-y-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              24-Hour Wind &amp; Peak Gust Forecast ({selectedObs.districtName})
            </h3>
            <ProvenanceText source="Live API Data" timestamp={selectedObs.fetchedAt} />
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="hour" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <YAxis stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} unit=" km/h" />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#AABBC9' }} />
                <Area
                  type="monotone"
                  dataKey="gustsKmh"
                  name="Wind Gusts (km/h)"
                  stroke="#E58854"
                  fill="#E58854"
                  fillOpacity={0.2}
                  animationDuration={450}
                />
                <Area
                  type="monotone"
                  dataKey="windKmh"
                  name="Sustained Wind (km/h)"
                  stroke="#55B7B0"
                  fill="#55B7B0"
                  fillOpacity={0.22}
                  animationDuration={450}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="p-5 rounded-lg ss-card space-y-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              24-Hour Rainfall &amp; Precipitation Probability ({selectedObs.districtName})
            </h3>
            <ProvenanceText source="Live API Data" timestamp={selectedObs.fetchedAt} />
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="hour" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <YAxis yAxisId="left" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} unit="%" />
                <YAxis yAxisId="right" orientation="right" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} unit="mm" />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#AABBC9' }} />
                <Bar yAxisId="left" dataKey="precipProb" name="Precip Prob (%)" fill="#70A9CF" radius={[3, 3, 0, 0]} animationDuration={450} />
                <Bar yAxisId="right" dataKey="rainMm" name="Rain (mm)" fill="#55B7B0" radius={[3, 3, 0, 0]} animationDuration={450} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 7-Day Daily Forecast + Inter-District Comparison */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-5 p-5 rounded-lg ss-card space-y-3">
          <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
            7-Day Daily Outlook ({selectedObs.districtName})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[#60788A] text-[#8FA3B3]">
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 px-2 font-medium">Condition</th>
                  <th className="py-2 px-2 font-medium text-right">Temp</th>
                  <th className="py-2 px-2 font-medium text-right">Rain</th>
                  <th className="py-2 pl-2 font-medium text-right">Max Gust</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#52697A]/70">
                {selectedObs.daily.map((d) => (
                  <tr key={d.date} className="hover:bg-[#3B5061]/70 transition-colors">
                    <td className="py-2 pr-2 font-mono tabular-nums text-[#AABBC9]">{d.date}</td>
                    <td className="py-2 px-2 text-[#E5EDF3]">{d.weatherLabel}</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-[#AABBC9]">
                      {d.tempMinC.toFixed(0)}–{d.tempMaxC.toFixed(0)}°C
                    </td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums font-medium text-[#55B7B0]">
                      {d.precipitationSumMm.toFixed(1)} mm
                    </td>
                    <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-[#F2C16E]">
                      {d.windGustsMaxKmh.toFixed(0)} km/h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-7 p-5 rounded-lg ss-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              All-Telangana Wind Gust &amp; Precipitation Comparison
            </h3>
            <span className="text-[11px] text-[#8FA3B3]">
              Updated {formatIstDateTime(selectedObs.fetchedAt)}
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="district" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
                <YAxis stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#AABBC9' }} />
                <Bar dataKey="windGusts" name="Wind Gusts (km/h)" fill="#70A9CF" radius={[3, 3, 0, 0]} animationDuration={450} />
                <Bar dataKey="rainMm" name="Rain (mm)" fill="#55B7B0" radius={[3, 3, 0, 0]} animationDuration={450} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}
