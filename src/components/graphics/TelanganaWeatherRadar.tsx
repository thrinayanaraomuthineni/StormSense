import React, { useMemo, useState } from 'react';
import type { Incident, RiskAssessment, TelanganaDistrict, WeatherObservation } from '../../lib/types';

// Telangana state bounding box for accurate relative district plotting
const LAT_MIN = 16.2;
const LAT_MAX = 20.1;
const LNG_MIN = 77.4;
const LNG_MAX = 81.2;

function projectPoint(lat: number, lng: number, size: number, pad = 30) {
  const usable = size - pad * 2;
  const x = pad + ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * usable;
  const y = pad + (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * usable;
  return { x, y };
}

const RISK_FILL: Record<string, string> = {
  LOW: '#5AC49E',
  MODERATE: '#E5A94C',
  HIGH: '#E58854',
  CRITICAL: '#E36D6D',
};

type RadarTimeOffset = 0 | 6 | 12 | 24;
const TIME_OFFSETS: Array<{ offset: RadarTimeOffset; label: string }> = [
  { offset: 0, label: 'Now' },
  { offset: 6, label: '+6h' },
  { offset: 12, label: '+12h' },
  { offset: 24, label: '+24h' },
];

export function TelanganaWeatherRadar({
  districts,
  weather,
  assessments,
  incidents,
  selectedDistrictId,
  onSelectDistrict,
  size = 320,
  showTimeControls = true,
}: {
  districts: TelanganaDistrict[];
  weather: WeatherObservation[];
  assessments: RiskAssessment[];
  incidents: Incident[];
  selectedDistrictId?: string;
  onSelectDistrict?: (districtId: string) => void;
  size?: number;
  showTimeControls?: boolean;
}) {
  const [timeOffset, setTimeOffset] = useState<RadarTimeOffset>(0);
  const center = size / 2;
  const weatherMap = new Map(weather.map((w) => [w.districtId, w]));
  const riskMap = new Map(assessments.map((a) => [a.districtId, a]));

  const hasHourlySeries = useMemo(
    () => weather.some((w) => Array.isArray(w.hourly) && w.hourly.length > 0),
    [weather]
  );

  const openIncidents = incidents.filter(
    (i) => i.status !== 'Restored' && i.status !== 'Closed'
  );

  const hubLinks: Array<[string, string]> = [
    ['hyderabad', 'warangal'],
    ['hyderabad', 'nizamabad'],
    ['hyderabad', 'nalgonda'],
    ['hyderabad', 'mahabubnagar'],
    ['warangal', 'karimnagar'],
    ['warangal', 'khammam'],
    ['karimnagar', 'adilabad'],
    ['khammam', 'kothagudem'],
  ];

  const coordMap = new Map(
    districts.map((d) => [d.id, projectPoint(d.lat, d.lng, size)])
  );

  const getObservationForStep = (w: WeatherObservation | undefined) => {
    if (!w) return null;
    if (timeOffset === 0 || !w.hourly || w.hourly.length === 0) {
      return {
        temperatureC: w.temperatureC,
        rainMm: w.rainMm,
        windSpeedKmh: w.windSpeedKmh,
        windGustsKmh: w.windGustsKmh,
        precipProb: w.precipitationProbability,
        timeLabel: 'Observed Now',
      };
    }
    const idx = Math.min(w.hourly.length - 1, timeOffset);
    const h = w.hourly[idx];
    return {
      temperatureC: h.temperatureC,
      rainMm: h.rainMm,
      windSpeedKmh: h.windSpeedKmh,
      windGustsKmh: h.windGustsKmh,
      precipProb: h.precipitationProbability,
      timeLabel: `Forecast ${h.time.slice(11, 16)}`,
    };
  };

  return (
    <div className="relative flex flex-col items-center gap-2.5">
      <div
        className="relative rounded-full overflow-hidden border border-[#60788A] bg-gradient-to-br from-[#283744] via-[#2F4150] to-[#344655] shadow-[0_14px_34px_rgba(12,20,28,0.45),inset_0_0_28px_rgba(112,169,207,0.12)]"
        style={{ width: size, height: size }}
      >
        {/* Rotating Radar Sweep Cone */}
        <div
          className="absolute inset-0 ss-radar-sweep pointer-events-none"
          style={{
            background:
              'conic-gradient(from 0deg at 50% 50%, rgba(85, 183, 176, 0.34) 0deg, rgba(112, 169, 207, 0.14) 36deg, rgba(40, 55, 68, 0) 76deg, rgba(40, 55, 68, 0) 360deg)',
          }}
          aria-hidden="true"
        />

        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Telangana meteorological and grid risk radar sweep across 16 monitored districts"
          className="relative z-10"
        >
          {/* Polar range rings */}
          {[0.24, 0.48, 0.72, 0.93].map((r) => (
            <circle
              key={r}
              cx={center}
              cy={center}
              r={(size / 2) * r}
              fill="none"
              stroke="#60788A"
              strokeOpacity={r === 0.93 ? 0.65 : 0.42}
              strokeWidth="1"
              strokeDasharray={r === 0.93 ? undefined : '3 4'}
            />
          ))}

          {/* Synoptic pressure contours inside radar field */}
          <path
            d={`M ${size * 0.1} ${size * 0.36} Q ${size * 0.48} ${size * 0.22}, ${size * 0.9} ${size * 0.34}`}
            fill="none"
            stroke="#70A9CF"
            strokeOpacity="0.28"
            strokeWidth="1"
            className="ss-isobar-flow"
          />
          <path
            d={`M ${size * 0.12} ${size * 0.66} Q ${size * 0.52} ${size * 0.52}, ${size * 0.88} ${size * 0.68}`}
            fill="none"
            stroke="#55B7B0"
            strokeOpacity="0.24"
            strokeWidth="1"
            className="ss-isobar-flow"
          />

          {/* Crosshairs */}
          <line x1={center} y1={10} x2={center} y2={size - 10} stroke="#52697A" strokeWidth="1" strokeOpacity="0.55" />
          <line x1={10} y1={center} x2={size - 10} y2={center} stroke="#52697A" strokeWidth="1" strokeOpacity="0.55" />

          {/* Regional transmission corridors */}
          {hubLinks.map(([a, b]) => {
            const p1 = coordMap.get(a);
            const p2 = coordMap.get(b);
            if (!p1 || !p2) return null;
            return (
              <line
                key={`${a}-${b}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#70A9CF"
                strokeOpacity="0.34"
                strokeWidth="1.15"
              />
            );
          })}

          {/* Pulsing rainfall & wind intensity cells + directional wind vectors */}
          {districts.map((d, idx) => {
            const pt = coordMap.get(d.id);
            const stepWx = getObservationForStep(weatherMap.get(d.id));
            if (!pt || !stepWx) return null;
            const intensity =
              stepWx.rainMm * 2.3 +
              Math.max(0, stepWx.windGustsKmh - 18) * 0.42 +
              (stepWx.precipProb > 50 ? (stepWx.precipProb - 45) * 0.14 : 0);
            const radius = Math.min(30, 10 + intensity * 0.7);
            const hasRain = stepWx.rainMm > 0 || stepWx.precipProb >= 55;
            // Deterministic meteorological wind angle derived from district longitude/latitude + step
            const angleRad = (((d.lat * 19 + d.lng * 13 + timeOffset * 8) % 360) * Math.PI) / 180;
            const vecLen = Math.min(18, 7 + stepWx.windSpeedKmh * 0.28);
            const vx = pt.x + Math.cos(angleRad) * vecLen;
            const vy = pt.y + Math.sin(angleRad) * vecLen;

            return (
              <g key={`wx-${d.id}`}>
                {intensity > 1.4 && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={radius}
                    fill={hasRain ? 'rgba(85, 183, 176, 0.20)' : 'rgba(112, 169, 207, 0.16)'}
                    stroke={hasRain ? 'rgba(85, 183, 176, 0.55)' : 'rgba(112, 169, 207, 0.42)'}
                    strokeWidth="1"
                    className="ss-weather-pulse"
                    style={{ animationDelay: `${(idx % 6) * 0.45}s` }}
                  />
                )}
                {/* Wind direction vector barb */}
                {stepWx.windSpeedKmh >= 6 && (
                  <line
                    x1={pt.x}
                    y1={pt.y}
                    x2={vx}
                    y2={vy}
                    stroke="#70A9CF"
                    strokeOpacity="0.65"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                )}
              </g>
            );
          })}

          {/* Active incident rings */}
          {openIncidents.map((inc) => {
            const pt = projectPoint(inc.lat, inc.lng, size);
            return (
              <circle
                key={inc.id}
                cx={pt.x}
                cy={pt.y}
                r={8}
                fill="none"
                stroke="#E36D6D"
                strokeWidth="1.4"
                opacity="0.88"
              />
            );
          })}

          {/* District telemetry nodes */}
          {districts.map((d) => {
            const pt = coordMap.get(d.id);
            if (!pt) return null;
            const risk = riskMap.get(d.id);
            const stepWx = getObservationForStep(weatherMap.get(d.id));
            const color = RISK_FILL[risk?.category ?? 'LOW'] || '#55B7B0';
            const isSelected = d.id === selectedDistrictId;

            return (
              <g
                key={d.id}
                onClick={onSelectDistrict ? () => onSelectDistrict(d.id) : undefined}
                className={onSelectDistrict ? 'cursor-pointer' : undefined}
              >
                <title>
                  {`${d.name}: Risk ${risk?.score ?? '—'}/100 (${risk?.category ?? 'N/A'}) · ${
                    stepWx
                      ? `${stepWx.timeLabel}: ${stepWx.temperatureC.toFixed(1)}°C, Rain ${stepWx.rainMm}mm, Wind ${stepWx.windSpeedKmh}km/h (Gust ${stepWx.windGustsKmh})`
                      : 'Weather N/A'
                  }`}
                </title>
                {isSelected && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={10}
                    fill="none"
                    stroke="#E5EDF3"
                    strokeWidth="1.6"
                    strokeOpacity="0.9"
                  />
                )}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected ? 5.2 : 4}
                  fill={color}
                  stroke="#283744"
                  strokeWidth="1.5"
                />
                {(isSelected ||
                  d.id === 'hyderabad' ||
                  d.id === 'warangal' ||
                  d.id === 'adilabad' ||
                  d.id === 'khammam') && (
                  <text
                    x={pt.x + 7}
                    y={pt.y + 3}
                    fill={isSelected ? '#E5EDF3' : '#AABBC9'}
                    fontSize="9.5"
                    fontWeight={isSelected ? '700' : '600'}
                  >
                    {d.name.split(' ')[0]}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Cardinal Labels */}
        <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[#8FA3B3]">
          20.1°N
        </span>
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[#8FA3B3]">
          16.2°N
        </span>
      </div>

      {/* Real-Data Forecast Horizon Controls (Open-Meteo current vs hourly forecast) */}
      {showTimeControls && hasHourlySeries && (
        <div className="flex flex-col items-center gap-1">
          <div
            className="inline-flex items-center gap-1 p-0.5 rounded-md bg-[#344655] border border-[#60788A]"
            role="group"
            aria-label="Radar forecast horizon"
          >
            {TIME_OFFSETS.map((item) => {
              const active = timeOffset === item.offset;
              return (
                <button
                  key={item.offset}
                  type="button"
                  onClick={() => setTimeOffset(item.offset)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono tabular-nums transition-colors ${
                    active
                      ? 'bg-[#43596A] text-[#E5EDF3] font-semibold border border-[#70A9CF]/60 shadow-xs'
                      : 'text-[#8FA3B3] hover:text-[#E5EDF3]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] font-mono text-[#8FA3B3]">
            {timeOffset === 0 ? 'Live Open-Meteo Observation' : `Open-Meteo Hourly Forecast (+${timeOffset}h)`}
          </span>
        </div>
      )}
    </div>
  );
}
