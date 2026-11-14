import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  CloudRain,
  Download,
  FilterX,
  Info,
  ShieldAlert,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnimatedNumber } from '../components/graphics/AnimatedNumber';
import { ProvenanceText } from '../components/ui/DataProvenanceTag';
import { useStormSense } from '../context/StormSenseContext';
import {
  computeAnalyticsSummary,
  type AnalyticsDateWindow,
} from '../lib/analyticsEngine';
import type { RiskCategory } from '../lib/types';

const RISK_CATEGORY_COLORS: Record<RiskCategory, string> = {
  LOW: '#5AC49E',
  MODERATE: '#E5A94C',
  HIGH: '#E58854',
  CRITICAL: '#E36D6D',
};

const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  LOW: 'Low (0–30)',
  MODERATE: 'Moderate (31–60)',
  HIGH: 'High (61–80)',
  CRITICAL: 'Critical (81–100)',
};

const SEVERITY_COLORS: Record<string, string> = {
  Low: '#5AC49E',
  Medium: '#E5A94C',
  High: '#E58854',
  Critical: '#E36D6D',
};

const STATUS_BAR_COLORS: Record<string, string> = {
  Reported: '#55B7B0',
  Detected: '#8FA3B3',
  Assigned: '#70A9CF',
  'En Route': '#E5A94C',
  'Under Maint.': '#E58854',
  Resolved: '#5AC49E',
};

const TOOLTIP_STYLE = {
  backgroundColor: '#344655',
  border: '1px solid #60788A',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#E5EDF3',
};

function formatIstTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function AnalyticsPage() {
  const {
    districts,
    assessments,
    weather,
    incidents,
    crews,
    dispatchHistory,
    riskSnapshots,
    captureRiskSnapshot,
    currentUser,
  } = useStormSense();

  const [districtFilter, setDistrictFilter] = useState<string>('ALL');
  const [dateWindow, setDateWindow] = useState<AnalyticsDateWindow>('ALL');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [incidentChartMode, setIncidentChartMode] = useState<'severity' | 'district'>('severity');
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);
  const [snapshotFeedback, setSnapshotFeedback] = useState<string | null>(null);

  const summary = useMemo(
    () =>
      computeAnalyticsSummary({
        districts,
        assessments,
        weatherObservations: weather.observations,
        incidents,
        crews,
        dispatchHistory,
        riskSnapshots,
        filters: {
          districtId: districtFilter,
          dateWindow,
          customStartDate: dateWindow === 'CUSTOM' ? customStartDate : undefined,
          customEndDate: dateWindow === 'CUSTOM' ? customEndDate : undefined,
        },
      }),
    [
      districts,
      assessments,
      weather.observations,
      incidents,
      crews,
      dispatchHistory,
      riskSnapshots,
      districtFilter,
      dateWindow,
      customStartDate,
      customEndDate,
    ]
  );

  const buildCsvUrl = (type: 'risk' | 'incidents' | 'crews') => {
    const params = new URLSearchParams({ type });
    if (districtFilter !== 'ALL') params.set('districtId', districtFilter);
    if (dateWindow !== 'ALL') params.set('dateWindow', dateWindow);
    if (dateWindow === 'CUSTOM' && customStartDate) params.set('startDate', customStartDate);
    if (dateWindow === 'CUSTOM' && customEndDate) params.set('endDate', customEndDate);
    return `/api/analytics/export.csv?${params.toString()}`;
  };

  const hasActiveFilters =
    districtFilter !== 'ALL' ||
    dateWindow !== 'ALL' ||
    Boolean(customStartDate) ||
    Boolean(customEndDate);

  const handleResetFilters = () => {
    setDistrictFilter('ALL');
    setDateWindow('ALL');
    setCustomStartDate('');
    setCustomEndDate('');
  };

  const canCaptureSnapshot = currentUser?.role !== 'Read-only Evaluator';

  const handleCaptureSnapshot = async () => {
    if (!canCaptureSnapshot || isCapturingSnapshot) return;
    setIsCapturingSnapshot(true);
    setSnapshotFeedback(null);
    try {
      await captureRiskSnapshot();
      setSnapshotFeedback('Captured live telemetry & risk snapshot to SQLite history.');
    } catch (err) {
      setSnapshotFeedback(
        err instanceof Error ? err.message : 'Unable to capture historical snapshot.'
      );
    } finally {
      setIsCapturingSnapshot(false);
    }
  };

  const highOrCriticalDistricts = summary.districtRiskComparison.filter(
    (d) => d.riskCategory === 'HIGH' || d.riskCategory === 'CRITICAL'
  ).length;
  const peakDistrict = summary.districtRiskComparison[0] ?? null;
  const openIncidentsCount = summary.filteredIncidents.length - summary.statusCounts.Resolved;
  const totalAffectedConsumers = summary.filteredIncidents
    .filter((i) => i.status !== 'Restored' && i.status !== 'Closed')
    .reduce((sum, i) => sum + i.affectedConsumers, 0);

  return (
    <div className="space-y-5">
      <div className="p-4 ss-card flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
              Reports &amp; Operational Analytics
            </h2>
            <span className="text-[11px] font-mono text-[#55B7B0]">
              SQLite + Live Telemetry
            </span>
          </div>
          <ProvenanceText
            source="Aggregated directly from SQLite incident/crew/snapshot tables & Open-Meteo weather observations"
            timestamp={weather.lastUpdated}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCaptureSnapshot}
            disabled={!canCaptureSnapshot || isCapturingSnapshot}
            title={
              canCaptureSnapshot
                ? 'Save current district weather and risk scores into historical snapshots'
                : 'Read-only Evaluator cannot write new database snapshots'
            }
            className="px-3 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#5AC49E] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium text-[#8BE0C4] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isCapturingSnapshot ? 'Capturing…' : 'Capture Snapshot'}</span>
          </button>

          <a
            href={buildCsvUrl('risk')}
            download={`stormsense-district-risk${districtFilter !== 'ALL' ? `-${districtFilter}` : ''}.csv`}
            className="px-3 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#55B7B0] text-xs font-medium text-[#E5EDF3] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
            <span>District Risk CSV</span>
          </a>

          <a
            href={buildCsvUrl('incidents')}
            download={`stormsense-incidents${districtFilter !== 'ALL' ? `-${districtFilter}` : ''}.csv`}
            className="px-3 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs font-medium text-[#E5EDF3] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Incidents CSV</span>
          </a>

          <a
            href={buildCsvUrl('crews')}
            download={`stormsense-crew-assignments${districtFilter !== 'ALL' ? `-${districtFilter}` : ''}.csv`}
            className="px-3 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] text-xs font-semibold text-[#17222B] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Crew Assignments CSV</span>
          </a>
        </div>
      </div>

      {snapshotFeedback && (
        <div className="px-4 py-2.5 rounded-lg bg-[#5AC49E]/16 border border-[#5AC49E]/45 text-xs text-[#9EE8CD] flex items-center justify-between gap-2">
          <span>{snapshotFeedback}</span>
          <button
            type="button"
            onClick={() => setSnapshotFeedback(null)}
            className="text-[11px] text-[#8FA3B3] hover:text-[#E5EDF3]"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="p-4 ss-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Filter analytics by district"
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
            >
              <option value="ALL">All 16 Districts</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter analytics by date range"
              value={dateWindow}
              onChange={(e) => setDateWindow(e.target.value as AnalyticsDateWindow)}
              className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
            >
              <option value="ALL">All Recorded Time</option>
              <option value="1">Last 24 Hours</option>
              <option value="7">Last 7 Days</option>
              <option value="30">Last 30 Days</option>
              <option value="CUSTOM">Custom Date Range</option>
            </select>

            {dateWindow === 'CUSTOM' && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  aria-label="Filter start date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                />
                <span className="text-xs text-[#8FA3B3]">to</span>
                <input
                  type="date"
                  aria-label="Filter end date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs text-[#AABBC9] hover:text-[#E5EDF3] flex items-center gap-1.5 transition-colors"
              >
                <FilterX className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>

          <div className="text-xs text-[#8FA3B3] font-mono tabular-nums">
            Scope:{' '}
            <span className="text-[#E5EDF3] font-medium">
              {districtFilter === 'ALL'
                ? '16 Districts'
                : districts.find((d) => d.id === districtFilter)?.name ?? districtFilter}
            </span>{' '}
            · Matching Incidents:{' '}
            <span className="text-[#E5EDF3] font-semibold">{summary.filteredIncidents.length}</span>
          </div>
        </div>

        <div className="pt-2.5 border-t border-[#52697A] flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#AABBC9]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#5AC49E] shrink-0" />
            <span>
              Weather Coverage:{' '}
              <span className="font-mono tabular-nums text-[#E5EDF3] font-semibold">
                {summary.provenanceBreakdown.liveWeatherDistricts}
              </span>{' '}
              Live
              {summary.provenanceBreakdown.staleWeatherDistricts > 0 && (
                <span className="text-[#F2C16E] font-mono tabular-nums">
                  {' '}
                  · {summary.provenanceBreakdown.staleWeatherDistricts} Stale
                </span>
              )}
              {summary.provenanceBreakdown.missingWeatherDistricts > 0 && (
                <span className="text-[#F29B9B] font-mono tabular-nums">
                  {' '}
                  · {summary.provenanceBreakdown.missingWeatherDistricts} Missing Data
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#E5A94C] shrink-0" />
            <span>
              Incident Provenance:{' '}
              <span className="font-mono tabular-nums text-[#E5EDF3] font-semibold">
                {summary.provenanceBreakdown.manualOrVerifiedIncidents}
              </span>{' '}
              Manual/Verified ·{' '}
              <span className="font-mono tabular-nums text-[#F2C16E] font-medium">
                {summary.provenanceBreakdown.simulatedIncidents} Simulated Demo
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#55B7B0] shrink-0" />
            <span>
              Crew Units:{' '}
              <span className="font-mono tabular-nums text-[#F2C16E] font-medium">
                {summary.provenanceBreakdown.simulatedCrews} Simulated Roster
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#70A9CF] shrink-0" />
            <span>
              Preserved Snapshots:{' '}
              <span className="font-mono tabular-nums text-[#E5EDF3] font-semibold">
                {summary.distinctSnapshotTimestamps} timestamps ({summary.filteredSnapshots.length}{' '}
                records)
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 ss-card space-y-2">
          <div className="flex items-center justify-between text-xs text-[#8FA3B3]">
            <span>Recorded Incidents (Filtered)</span>
            <ShieldAlert className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-display font-bold text-[#E5EDF3] font-mono tabular-nums">
            <AnimatedNumber value={summary.filteredIncidents.length} />
          </div>
          <div className="text-[11px] text-[#AABBC9] font-mono tabular-nums flex flex-wrap gap-x-3">
            <span className="text-[#F2C16E] font-medium">{openIncidentsCount} Active</span>
            <span className="text-[#8BE0C4] font-medium">{summary.statusCounts.Resolved} Resolved</span>
            <span className="text-[#8FA3B3]">
              {totalAffectedConsumers.toLocaleString('en-IN')} consumers impacted
            </span>
          </div>
        </div>

        <div className="p-4 ss-card space-y-2">
          <div className="flex items-center justify-between text-xs text-[#8FA3B3]">
            <span>Mean Restoration Time</span>
            <Clock className="w-4 h-4 text-[#5AC49E]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-display font-bold text-[#E5EDF3] font-mono tabular-nums">
            {summary.restorationStats.meanMinutes !== null ? (
              <>
                <AnimatedNumber value={summary.restorationStats.meanMinutes} />{' '}
                <span className="text-sm font-normal text-[#8FA3B3]">min</span>
              </>
            ) : (
              <span className="text-sm font-medium text-[#8FA3B3]">No resolved records</span>
            )}
          </div>
          <div className="text-[11px] text-[#8FA3B3] font-mono tabular-nums">
            {summary.restorationStats.resolvedCount > 0 ? (
              <>
                Median {summary.restorationStats.medianMinutes}m · Range{' '}
                {summary.restorationStats.minMinutes}–{summary.restorationStats.maxMinutes}m (n=
                {summary.restorationStats.resolvedCount})
              </>
            ) : (
              'Requires resolvedAt timestamps in filter'
            )}
          </div>
        </div>

        <div className="p-4 ss-card space-y-2">
          <div className="flex items-center justify-between text-xs text-[#8FA3B3]">
            <span>Crew Utilization Rate</span>
            <Users className="w-4 h-4 text-[#70A9CF]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-display font-bold text-[#E5EDF3] font-mono tabular-nums">
            <AnimatedNumber value={summary.crewUtilization.utilizationPct} />%
          </div>
          <div className="text-[11px] text-[#8FA3B3] font-mono tabular-nums">
            {summary.crewUtilization.deployed}/{summary.crewUtilization.totalCrews} crews deployed ·{' '}
            {summary.crewUtilization.deployedMembers}/{summary.crewUtilization.totalMembers} staff ·{' '}
            {summary.crewUtilization.dispatchActionsInWindow}{' '}
            {summary.crewUtilization.dispatchActionsInWindow === 1 ? 'dispatch' : 'dispatches'}
          </div>
        </div>

        <div className="p-4 ss-card space-y-2">
          <div className="flex items-center justify-between text-xs text-[#8FA3B3]">
            <span>High / Critical Risk Districts</span>
            <Activity className="w-4 h-4 text-[#E58854]" aria-hidden="true" />
          </div>
          <div className="text-2xl font-display font-bold text-[#E5EDF3] font-mono tabular-nums">
            <AnimatedNumber value={highOrCriticalDistricts} />{' '}
            <span className="text-sm font-normal text-[#8FA3B3]">
              / {summary.districtRiskComparison.length}
            </span>
          </div>
          <div className="text-[11px] text-[#8FA3B3] font-mono tabular-nums truncate">
            {peakDistrict
              ? `Peak: ${peakDistrict.districtName} (${peakDistrict.riskScore}/100 · ${peakDistrict.riskCategory})`
              : 'No districts selected'}
          </div>
        </div>
      </div>

      <section className="p-5 ss-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              District-Wise Outage Risk Comparison
            </h3>
            <p className="text-[11px] text-[#8FA3B3]">
              Weighted risk score (0–100) sorted highest to lowest with live weather &amp; infrastructure context
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#AABBC9]">
            {(['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as RiskCategory[]).map((cat) => (
              <span key={cat} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: RISK_CATEGORY_COLORS[cat] }}
                />
                {RISK_CATEGORY_LABELS[cat]}
              </span>
            ))}
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.districtRiskComparison} margin={{ bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
              <XAxis
                dataKey="shortName"
                stroke="#60788A"
                tick={{ fill: '#AABBC9', fontSize: 10 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={52}
              />
              <YAxis domain={[0, 100]} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: unknown, _name: unknown, props: { payload?: (typeof summary.districtRiskComparison)[number] }) => {
                  const p = props?.payload;
                  if (!p) return [String(value), 'Risk Score'];
                  return [
                    `${p.riskScore}/100 (${p.riskCategory} · ${p.confidence} conf) — Rain ${p.rainMm}mm, Gusts ${p.gustsKmh}km/h`,
                    p.districtName,
                  ];
                }}
              />
              <Bar dataKey="riskScore" name="Risk Score" radius={[4, 4, 0, 0]} animationDuration={400}>
                {summary.districtRiskComparison.map((entry) => (
                  <Cell
                    key={entry.districtId}
                    fill={RISK_CATEGORY_COLORS[entry.riskCategory]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="p-5 ss-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
                Recorded Incidents by Severity &amp; District
              </h3>
              <p className="text-[11px] text-[#8FA3B3]">
                Includes Simulated Demo &amp; Manual/Verified records matching current filters
              </p>
            </div>
            <div className="inline-flex rounded-md bg-[#344655] border border-[#60788A] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setIncidentChartMode('severity')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  incidentChartMode === 'severity'
                    ? 'bg-[#70A9CF] text-[#17222B] font-semibold'
                    : 'text-[#AABBC9] hover:text-[#E5EDF3]'
                }`}
              >
                By Severity
              </button>
              <button
                type="button"
                onClick={() => setIncidentChartMode('district')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  incidentChartMode === 'district'
                    ? 'bg-[#70A9CF] text-[#17222B] font-semibold'
                    : 'text-[#AABBC9] hover:text-[#E5EDF3]'
                }`}
              >
                By District
              </button>
            </div>
          </div>

          {summary.filteredIncidents.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-[#8FA3B3] bg-[#344655]/85 rounded-md border border-dashed border-[#60788A]">
              No recorded incidents match the selected district and date filters.
            </div>
          ) : incidentChartMode === 'severity' ? (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.severityDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                  <XAxis dataKey="severity" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                  <YAxis allowDecimals={false} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" name="Incidents" radius={[4, 4, 0, 0]} animationDuration={400}>
                    {summary.severityDistribution.map((s) => (
                      <Cell key={s.severity} fill={SEVERITY_COLORS[s.severity]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.incidentsByDistrictSeverity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                  <XAxis
                    dataKey="shortName"
                    stroke="#60788A"
                    tick={{ fill: '#AABBC9', fontSize: 10 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={45}
                  />
                  <YAxis allowDecimals={false} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#AABBC9' }} />
                  <Bar dataKey="Critical" stackId="sev" fill="#E36D6D" />
                  <Bar dataKey="High" stackId="sev" fill="#E58854" />
                  <Bar dataKey="Medium" stackId="sev" fill="#E5A94C" />
                  <Bar dataKey="Low" stackId="sev" fill="#5AC49E" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="p-5 ss-card space-y-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              Incident Lifecycle Status Tracking
            </h3>
            <p className="text-[11px] text-[#8FA3B3]">
              Reported, Detected, Assigned, Crew En Route, Under Maintenance, and Resolved (Restored/Closed)
            </p>
          </div>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.statusChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="status" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 10 }} interval={0} />
                <YAxis allowDecimals={false} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" name="Incidents" radius={[4, 4, 0, 0]} animationDuration={400}>
                  {summary.statusChartData.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={STATUS_BAR_COLORS[entry.status] || '#55B7B0'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1">
            {summary.statusChartData.map((item) => (
              <div
                key={item.status}
                className="px-2 py-1.5 rounded bg-[#344655]/90 border border-[#52697A] text-center"
              >
                <div className="text-[10px] text-[#8FA3B3] truncate">{item.status}</div>
                <div className="text-sm font-mono font-semibold text-[#E5EDF3] tabular-nums">
                  {item.count}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="p-5 ss-card space-y-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              Recorded Incident Logging &amp; Resolution Volume
            </h3>
            <p className="text-[11px] text-[#8FA3B3]">
              Grouped strictly by actual incident creation date in SQLite (no synthetic fill)
            </p>
          </div>

          {summary.incidentTrendBuckets.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-[#8FA3B3] bg-[#344655]/85 rounded-md border border-dashed border-[#60788A]">
              No incident records available in the selected filter window.
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.incidentTrendBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                  <XAxis dataKey="label" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 10 }} />
                  <YAxis allowDecimals={false} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#AABBC9' }} />
                  <Bar dataKey="totalLogged" name="Logged" fill="#70A9CF" radius={[3, 3, 0, 0]} />
                  <Bar
                    dataKey="criticalOrHighCount"
                    name="High/Critical"
                    fill="#E58854"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="resolvedCount"
                    name="Resolved"
                    fill="#5AC49E"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="p-5 ss-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
                Restoration Time Statistics (Actual Timestamps)
              </h3>
              <p className="text-[11px] text-[#8FA3B3]">
                Computed strictly from recorded createdAt and resolvedAt timestamps
              </p>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-[#8BE0C4] font-medium">
              {summary.restorationStats.resolvedCount} timestamped records
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Mean', val: summary.restorationStats.meanMinutes },
              { label: 'Median', val: summary.restorationStats.medianMinutes },
              { label: 'Fastest', val: summary.restorationStats.minMinutes },
              { label: 'Longest', val: summary.restorationStats.maxMinutes },
            ].map((stat) => (
              <div
                key={stat.label}
                className="p-2.5 rounded-md bg-[#344655]/90 border border-[#52697A]"
              >
                <div className="text-[10px] text-[#8FA3B3]">
                  {stat.label}
                </div>
                <div className="text-sm font-mono font-semibold text-[#E5EDF3] tabular-nums mt-0.5">
                  {stat.val !== null ? `${stat.val} min` : 'N/A'}
                </div>
              </div>
            ))}
          </div>

          {summary.restorationStats.records.length === 0 ? (
            <div className="p-4 rounded-md bg-[#344655]/85 border border-dashed border-[#60788A] text-xs text-[#8FA3B3] flex items-center gap-2">
              <Info className="w-4 h-4 text-[#8FA3B3] shrink-0" aria-hidden="true" />
              <span>
                No resolved incidents with valid restoration timestamps match this filter. Resolve or
                complete work on an active incident to record real restoration duration.
              </span>
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-md border border-[#52697A] bg-[#344655]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#283744] text-[10px] text-[#8FA3B3] sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-medium">Incident</th>
                    <th className="px-3 py-2 font-medium">District</th>
                    <th className="px-3 py-2 font-medium">Resolved</th>
                    <th className="px-3 py-2 text-right font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#52697A]/70">
                  {summary.restorationStats.records.map((rec) => (
                    <tr key={rec.incidentId} className="hover:bg-[#3B5061]/70">
                      <td className="px-3 py-1.5 font-mono text-[#E5EDF3] font-medium">{rec.incidentId}</td>
                      <td className="px-3 py-1.5 text-[#AABBC9]">{rec.districtName}</td>
                      <td className="px-3 py-1.5 text-[#8FA3B3] font-mono tabular-nums">
                        {formatIstTimestamp(rec.resolvedAt)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-[#8BE0C4] tabular-nums">
                        {rec.durationMinutes} min
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="p-5 ss-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
                Crew Utilization &amp; Availability
              </h3>
              <p className="text-[11px] text-[#8FA3B3]">
                Completed baseline jobs vs. dispatch actions logged within the active date window
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#F2C16E]">
              Simulated Crew Roster
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="p-2 rounded bg-[#5AC49E]/16 border border-[#5AC49E]/45">
              <div className="text-[10px] text-[#8BE0C4] font-medium">Available</div>
              <div className="text-sm font-mono font-bold text-[#E5EDF3] tabular-nums">
                {summary.crewUtilization.available}
              </div>
            </div>
            <div className="p-2 rounded bg-[#55B7B0]/16 border border-[#55B7B0]/45">
              <div className="text-[10px] text-[#55B7B0] font-medium">Standby</div>
              <div className="text-sm font-mono font-bold text-[#E5EDF3] tabular-nums">
                {summary.crewUtilization.standby}
              </div>
            </div>
            <div className="p-2 rounded bg-[#E5A94C]/16 border border-[#E5A94C]/45">
              <div className="text-[10px] text-[#F2C16E] font-medium">Deployed</div>
              <div className="text-sm font-mono font-bold text-[#E5EDF3] tabular-nums">
                {summary.crewUtilization.deployed}
              </div>
            </div>
            <div className="p-2 rounded bg-[#344655] border border-[#52697A]">
              <div className="text-[10px] text-[#8FA3B3] font-medium">Off-Duty</div>
              <div className="text-sm font-mono font-bold text-[#E5EDF3] tabular-nums">
                {summary.crewUtilization.offDuty}
              </div>
            </div>
          </div>

          {summary.crewUtilization.perCrew.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-xs text-[#8FA3B3] bg-[#344655]/85 rounded-md border border-dashed border-[#60788A]">
              No crews stationed in the selected district.
            </div>
          ) : (
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.crewUtilization.perCrew} margin={{ bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                  <XAxis
                    dataKey="shortName"
                    stroke="#60788A"
                    tick={{ fill: '#AABBC9', fontSize: 10 }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={46}
                  />
                  <YAxis allowDecimals={false} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#AABBC9' }} />
                  <Bar
                    dataKey="completedJobs"
                    name="Completed Jobs"
                    fill="#70A9CF"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="dispatchActionsCount"
                    name="Dispatches (Window)"
                    fill="#55B7B0"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="p-5 ss-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
                Crew Assignment &amp; Roster Status
              </h3>
              <p className="text-[11px] text-[#8FA3B3]">
                Real-time synchronization with Smart Crew Dispatch &amp; Incident assignments
              </p>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-[#AABBC9]">
              {summary.crewUtilization.totalCrews} crews ({summary.crewUtilization.totalMembers}{' '}
              members)
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border border-[#52697A] bg-[#344655]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#283744] text-[10px] text-[#8FA3B3] sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Crew</th>
                  <th className="px-3 py-2 font-medium">District</th>
                  <th className="px-3 py-2 font-medium">Availability</th>
                  <th className="px-3 py-2 font-medium">Active Incident</th>
                  <th className="px-3 py-2 text-right font-medium">Jobs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#52697A]/70">
                {summary.crewUtilization.perCrew.map((crew) => (
                  <tr key={crew.id} className="hover:bg-[#3B5061]/70">
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#E5EDF3]">{crew.name}</div>
                      <div className="text-[10px] text-[#8FA3B3]">{crew.status}</div>
                    </td>
                    <td className="px-3 py-2 text-[#AABBC9]">{crew.districtName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                          crew.availability === 'Available'
                            ? 'bg-[#5AC49E]/18 border-[#5AC49E]/45 text-[#8BE0C4]'
                            : crew.availability === 'Deployed'
                              ? 'bg-[#E5A94C]/18 border-[#E5A94C]/45 text-[#F2C16E]'
                              : crew.availability === 'Standby'
                                ? 'bg-[#55B7B0]/18 border-[#55B7B0]/45 text-[#55B7B0]'
                                : 'bg-[#3B5061] border-[#60788A] text-[#8FA3B3]'
                        }`}
                      >
                        {crew.availability}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#70A9CF]">
                      {crew.activeIncidentId || <span className="text-[#8FA3B3]">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#E5EDF3] font-medium">
                      {crew.completedJobs}
                    </td>
                  </tr>
                ))}
                {summary.crewUtilization.perCrew.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[#8FA3B3]">
                      No crew records match the selected district filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="p-5 ss-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3] flex items-center gap-1.5">
                <CloudRain className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
                <span>Weather Conditions Alongside Recorded Incidents</span>
              </h3>
              <p className="text-[11px] text-[#8FA3B3]">
                Current Open-Meteo gusts/rain plotted alongside filtered district incident counts
              </p>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={summary.weatherVsIncidents} margin={{ bottom: 14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis
                  dataKey="shortName"
                  stroke="#60788A"
                  tick={{ fill: '#AABBC9', fontSize: 10 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis yAxisId="weather" stroke="#55B7B0" tick={{ fill: '#55B7B0', fontSize: 11 }} />
                <YAxis
                  yAxisId="inc"
                  orientation="right"
                  allowDecimals={false}
                  stroke="#E58854"
                  tick={{ fill: '#E58854', fontSize: 11 }}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: '11px', color: '#AABBC9' }} />
                <Bar
                  yAxisId="weather"
                  dataKey="gustsKmh"
                  name="Wind Gusts (km/h)"
                  fill="#55B7B0"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  yAxisId="weather"
                  dataKey="rainMm"
                  name="Rain (mm)"
                  fill="#70A9CF"
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="inc"
                  type="monotone"
                  dataKey="incidentCount"
                  name="Recorded Incidents"
                  stroke="#E58854"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#E58854' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {summary.provenanceBreakdown.missingWeatherDistricts > 0 && (
            <div className="text-[11px] text-[#F2C16E] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {summary.provenanceBreakdown.missingWeatherDistricts} district(s) missing live
                Open-Meteo observations; plotted weather metrics default to 0 where unavailable.
              </span>
            </div>
          )}
        </section>

        <section className="p-5 ss-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3] flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#5AC49E]" aria-hidden="true" />
                <span>Preserved Historical Snapshot Trend</span>
              </h3>
              <p className="text-[11px] text-[#8FA3B3]">
                Multi-point trend from SQLite risk_snapshots (mean risk, peak gusts, active incidents)
              </p>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-[#AABBC9]">
              {summary.distinctSnapshotTimestamps} timestamps
            </span>
          </div>

          {summary.distinctSnapshotTimestamps >= 2 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary.snapshotTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                  <XAxis dataKey="label" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 10 }} />
                  <YAxis stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#AABBC9' }} />
                  <Line
                    type="monotone"
                    dataKey="avgRiskScore"
                    name="Avg Risk Score"
                    stroke="#70A9CF"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="maxWindGustsKmh"
                    name="Peak Gusts (km/h)"
                    stroke="#55B7B0"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="recordedActiveIncidents"
                    name="Active Incidents"
                    stroke="#E58854"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 p-5 rounded-md bg-[#344655]/85 border border-dashed border-[#60788A] flex flex-col items-center justify-center text-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-[#55B7B0]" aria-hidden="true" />
              <div className="space-y-1 max-w-md">
                <div className="text-xs font-medium text-[#E5EDF3]">
                  {summary.distinctSnapshotTimestamps === 1
                    ? '1 historical snapshot timestamp recorded in this filter'
                    : 'No historical snapshots recorded in this filter yet'}
                </div>
                <p className="text-[11px] text-[#8FA3B3]">
                  StormSense never fabricates historical trend curves. At least 2 distinct snapshot
                  timestamps are required to plot a real multi-point trend.
                </p>
              </div>
              {canCaptureSnapshot && (
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  disabled={isCapturingSnapshot}
                  className="px-3 py-1.5 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-50 text-xs font-semibold text-[#17222B] flex items-center gap-1.5 transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {isCapturingSnapshot ? 'Capturing Snapshot…' : 'Capture Live Snapshot Now'}
                  </span>
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
