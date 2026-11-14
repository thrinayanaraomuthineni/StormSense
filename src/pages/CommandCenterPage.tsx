import React from 'react';
import {
  Activity,
  ArrowUpRight,
  CloudRain,
  ShieldAlert,
  Truck,
  Wind,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  RiskIndicator,
  SeverityIndicator,
  formatIstDateTime,
} from '../components/ui/DataProvenanceTag';

const CATEGORY_COLORS: Record<string, string> = {
  LOW: '#5AC49E',
  MODERATE: '#E5A94C',
  HIGH: '#E58854',
  CRITICAL: '#E36D6D',
};

export function CommandCenterPage() {
  const {
    districts,
    assessments,
    weather,
    incidents,
    crews,
    alertSummary,
    isLoading,
    selectedDistrictId,
    setSelectedDistrictId,
    setActivePage,
  } = useStormSense();

  if (isLoading && assessments.length === 0) {
    return <LoadingGridSkeleton />;
  }

  const sortedByRisk = [...assessments].sort((a, b) => b.score - a.score);
  const highCriticalDistricts = sortedByRisk.filter((a) => a.score >= 61);
  const openIncidents = incidents.filter((i) => i.status !== 'Restored' && i.status !== 'Closed');
  const availableCrews = crews.filter((c) => c.availability === 'Available' || c.availability === 'Standby');
  const affectedConsumers = openIncidents.reduce((sum, i) => sum + i.affectedConsumers, 0);
  const unreadAlerts = alertSummary.unread;
  const criticalHighAlerts = alertSummary.bySeverity.Critical + alertSummary.bySeverity.High;

  const weatherMap = new Map(weather.observations.map((w) => [w.districtId, w]));
  const focusObs =
    weatherMap.get(selectedDistrictId) ||
    weatherMap.get(sortedByRisk[0]?.districtId ?? '') ||
    weather.observations[0];

  const topChartData = sortedByRisk.slice(0, 8).map((a) => ({
    name: a.districtName.length > 11 ? a.districtName.slice(0, 10) + '…' : a.districtName,
    fullName: a.districtName,
    score: a.score,
    category: a.category,
  }));

  const handleDistrictDrilldown = (districtId: string) => {
    setSelectedDistrictId(districtId);
    setActivePage('risk');
  };

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <section aria-label="Operational Summary KPIs" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg ss-card hover:border-[#70A9CF]/70 transition-colors space-y-2">
          <div className="flex items-center justify-between text-xs text-[#AABBC9]">
            <span>High / Critical Districts</span>
            <Activity className="w-4 h-4 text-[#E58854]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={highCriticalDistricts.length} />{' '}
            <span className="text-sm font-normal text-[#8FA3B3]">/ {assessments.length}</span>
          </div>
          <ProvenanceText source="Derived Prediction" timestamp={weather.lastUpdated} />
        </div>

        <div className="p-4 rounded-lg ss-card hover:border-[#70A9CF]/70 transition-colors space-y-2">
          <div className="flex items-center justify-between text-xs text-[#AABBC9]">
            <span>Active Outage Incidents</span>
            <ShieldAlert className="w-4 h-4 text-[#E36D6D]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={openIncidents.length} />{' '}
            <span className="text-xs font-normal text-[#8FA3B3]">
              (<AnimatedNumber value={affectedConsumers} /> consumers)
            </span>
          </div>
          <ProvenanceText source="Simulated & Manual Records" />
        </div>

        <div className="p-4 rounded-lg ss-card hover:border-[#70A9CF]/70 transition-colors space-y-2">
          <div className="flex items-center justify-between text-xs text-[#AABBC9]">
            <span>Crews Ready / Standby</span>
            <Truck className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={availableCrews.length} />{' '}
            <span className="text-sm font-normal text-[#8FA3B3]">/ {crews.length} units</span>
          </div>
          <ProvenanceText source="Simulated Demonstration Data" />
        </div>

        <div className="p-4 rounded-lg ss-card hover:border-[#70A9CF]/70 transition-colors space-y-2">
          <div className="flex items-center justify-between text-xs text-[#AABBC9]">
            <span>Unread Grid Alerts</span>
            <CloudRain className="w-4 h-4 text-[#70A9CF]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-[#E5EDF3]">
            <AnimatedNumber value={unreadAlerts} />{' '}
            <span className="text-sm font-normal text-[#8FA3B3]">
              ({alertSummary.active} active · {criticalHighAlerts} high/crit)
            </span>
          </div>
          <ProvenanceText source="App Threshold Engine" timestamp={weather.lastUpdated} />
        </div>
      </section>

      {/* Main Split: Top Risk Districts + Telangana Doppler Radar */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-7 p-5 rounded-lg ss-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
                Highest Weather-Driven Outage Risk Districts
              </h2>
              <ProvenanceText source="Live Open-Meteo + Rule-Based Engine v1.0" timestamp={weather.lastUpdated} />
            </div>
            <button
              type="button"
              onClick={() => setActivePage('risk')}
              className="text-xs font-medium text-[#70A9CF] hover:text-[#E5EDF3] flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
            >
              <span>Inspect Scoring Factors</span>
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#60788A] text-[#8FA3B3]">
                  <th className="py-2 pr-3 font-medium">District</th>
                  <th className="py-2 px-3 font-medium">Weather</th>
                  <th className="py-2 px-3 font-medium text-right">Rain</th>
                  <th className="py-2 px-3 font-medium text-right">Gusts</th>
                  <th className="py-2 px-3 font-medium text-right">Risk</th>
                  <th className="py-2 pl-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#52697A]/70">
                {sortedByRisk.slice(0, 7).map((risk) => {
                  const w = weatherMap.get(risk.districtId);
                  return (
                    <tr key={risk.districtId} className="hover:bg-[#3B5061]/70 transition-colors">
                      <td className="py-2.5 pr-3 font-semibold text-[#E5EDF3]">{risk.districtName}</td>
                      <td className="py-2.5 px-3 text-[#AABBC9]">{w?.weatherLabel ?? 'Unavailable'}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#AABBC9]">
                        {w ? `${w.rainMm.toFixed(1)} mm` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#AABBC9]">
                        {w ? `${w.windGustsKmh.toFixed(0)} km/h` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <RiskIndicator category={risk.category} score={risk.score} />
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDistrictDrilldown(risk.districtId)}
                          className="text-[#70A9CF] hover:text-[#55B7B0] font-semibold whitespace-nowrap transition-colors"
                        >
                          Explain
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-5 p-5 rounded-lg ss-card flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
                Telangana Live Grid &amp; Weather Radar
              </h2>
              <ProvenanceText source="Live Coordinates + Derived Risk" timestamp={weather.lastUpdated} />
            </div>
            <button
              type="button"
              onClick={() => setActivePage('map')}
              className="px-2.5 py-1.5 rounded bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs font-medium text-[#E5EDF3] whitespace-nowrap shrink-0 transition-colors"
            >
              Open GIS Map
            </button>
          </div>

          <div className="flex justify-center py-1">
            <TelanganaWeatherRadar
              districts={districts}
              weather={weather.observations}
              assessments={assessments}
              incidents={incidents}
              selectedDistrictId={focusObs?.districtId}
              onSelectDistrict={(id) => setSelectedDistrictId(id)}
              size={246}
            />
          </div>

          {focusObs && (
            <div className="grid grid-cols-1 gap-2.5">
              <WindFlowCanvas
                windSpeedKmh={focusObs.windSpeedKmh}
                windGustsKmh={focusObs.windGustsKmh}
                height={68}
              />
              <RainfallVisualizer
                rainMm={focusObs.rainMm}
                precipProb={focusObs.precipitationProbability}
              />
            </div>
          )}
        </section>
      </div>

      {/* Bottom Split: Active Incident Queue + Risk Chart & Extremes */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-7 p-5 rounded-lg ss-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
                Active Incident Queue
              </h2>
              <ProvenanceText source="Simulated & Manual Incident Records" />
            </div>
            <button
              type="button"
              onClick={() => setActivePage('incidents')}
              className="px-3 py-1.5 rounded bg-[#70A9CF] hover:bg-[#5E97BD] text-xs font-semibold text-[#17222B] whitespace-nowrap shrink-0 transition-colors"
            >
              Manage Incidents
            </button>
          </div>

          {openIncidents.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#8FA3B3] border border-dashed border-[#60788A] bg-[#344655] rounded-lg">
              No active outage incidents recorded. Log a new incident in Incident Management when required.
            </div>
          ) : (
            <div className="divide-y divide-[#52697A]/70">
              {openIncidents.slice(0, 5).map((inc) => (
                <div key={inc.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#55B7B0]">{inc.id}</span>
                      <SeverityIndicator severity={inc.severity} />
                      <span className="text-xs text-[#AABBC9]">{inc.status}</span>
                    </div>
                    <div className="text-sm font-medium text-[#E5EDF3] truncate">{inc.title}</div>
                    <div className="text-xs text-[#8FA3B3]">
                      {inc.districtName} · {inc.locationName} ·{' '}
                      <span className="font-mono tabular-nums text-[#E5EDF3]">
                        {inc.affectedConsumers.toLocaleString('en-IN')}
                      </span>{' '}
                      consumers · <span className="text-[#8FA3B3]">{inc.source}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-[#AABBC9]">
                      {inc.assignedCrewName ? inc.assignedCrewName : 'Unassigned'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActivePage('dispatch')}
                      className="px-2.5 py-1.5 rounded bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs font-medium text-[#70A9CF] whitespace-nowrap transition-colors"
                    >
                      {inc.assignedCrewId ? 'Reassign' : 'Dispatch Crew'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="xl:col-span-5 p-5 rounded-lg ss-card space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
                Top-8 District Risk Comparison
              </h2>
              <ProvenanceText source="Derived Prediction" timestamp={weather.lastUpdated} />
            </div>
            <button
              type="button"
              onClick={() => setActivePage('weather')}
              className="text-xs text-[#70A9CF] hover:text-[#E5EDF3] font-medium whitespace-nowrap flex items-center gap-1 transition-colors"
            >
              <Wind className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Weather View</span>
            </button>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topChartData} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={92} stroke="#60788A" tick={{ fill: '#E5EDF3', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#344655',
                    border: '1px solid #60788A',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#E5EDF3',
                  }}
                  formatter={(value: unknown) => [`${value} / 100`, 'Outage Risk']}
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} animationDuration={450}>
                  {topChartData.map((entry) => (
                    <Cell key={entry.fullName} fill={CATEGORY_COLORS[entry.category] || '#55B7B0'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="text-[11px] text-[#8FA3B3] pt-2 border-t border-[#52697A]">
            Updated {formatIstDateTime(weather.lastUpdated)} · Application alerts are distinct from official IMD warnings.
          </div>
        </section>
      </div>
    </div>
  );
}
