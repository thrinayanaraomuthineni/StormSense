import type {
  Crew,
  DispatchHistoryEntry,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  RiskAssessment,
  RiskSnapshotRecord,
  TelanganaDistrict,
  WeatherObservation,
} from './types';

export type AnalyticsDateWindow = 'ALL' | '1' | '7' | '30' | 'CUSTOM';

export interface AnalyticsFilterOptions {
  districtId: string; // 'ALL' or district.id
  dateWindow: AnalyticsDateWindow;
  customStartDate?: string; // YYYY-MM-DD
  customEndDate?: string; // YYYY-MM-DD
  nowMs?: number;
}

export interface IncidentStatusCounts {
  Reported: number;
  Detected: number;
  Assigned: number;
  'Crew En Route': number;
  'Under Maintenance': number;
  Resolved: number; // Restored + Closed
}

export interface RestorationStats {
  resolvedCount: number;
  meanMinutes: number | null;
  medianMinutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  records: Array<{
    incidentId: string;
    title: string;
    districtName: string;
    severity: IncidentSeverity;
    createdAt: string;
    resolvedAt: string;
    durationMinutes: number;
  }>;
}

export interface CrewUtilizationSummary {
  totalCrews: number;
  available: number;
  standby: number;
  deployed: number;
  offDuty: number;
  utilizationPct: number;
  totalMembers: number;
  deployedMembers: number;
  totalCompletedJobs: number;
  dispatchActionsInWindow: number;
  perCrew: Array<{
    id: string;
    name: string;
    shortName: string;
    districtName: string;
    availability: Crew['availability'];
    status: Crew['status'];
    members: number;
    completedJobs: number;
    activeIncidentId: string | null;
    dispatchActionsCount: number;
  }>;
}

export interface SnapshotTrendPoint {
  recordedAt: string;
  label: string;
  avgRiskScore: number;
  maxWindGustsKmh: number;
  avgRainMm: number;
  recordedActiveIncidents: number;
  districtSamples: number;
}

export interface WeatherVsIncidentPoint {
  districtId: string;
  districtName: string;
  shortName: string;
  riskScore: number;
  rainMm: number;
  windKmh: number;
  gustsKmh: number;
  incidentCount: number;
  openIncidentCount: number;
  affectedConsumers: number;
  weatherAvailable: boolean;
}

export interface IncidentTrendBucket {
  dateKey: string;
  label: string;
  totalLogged: number;
  resolvedCount: number;
  criticalOrHighCount: number;
}

export interface AnalyticsSummary {
  filteredAssessments: RiskAssessment[];
  filteredIncidents: Incident[];
  filteredCrews: Crew[];
  filteredDispatchHistory: DispatchHistoryEntry[];
  filteredSnapshots: RiskSnapshotRecord[];
  districtRiskComparison: Array<{
    districtId: string;
    districtName: string;
    shortName: string;
    discom: string;
    riskScore: number;
    riskCategory: RiskAssessment['category'];
    confidence: RiskAssessment['confidence'];
    rainMm: number;
    windKmh: number;
    gustsKmh: number;
    substationCount: number;
  }>;
  severityDistribution: Array<{
    severity: IncidentSeverity;
    count: number;
  }>;
  incidentsByDistrictSeverity: Array<{
    districtName: string;
    shortName: string;
    Low: number;
    Medium: number;
    High: number;
    Critical: number;
    total: number;
    affectedConsumers: number;
  }>;
  statusCounts: IncidentStatusCounts;
  statusChartData: Array<{
    status: string;
    count: number;
  }>;
  restorationStats: RestorationStats;
  incidentTrendBuckets: IncidentTrendBucket[];
  crewUtilization: CrewUtilizationSummary;
  weatherVsIncidents: WeatherVsIncidentPoint[];
  snapshotTrend: SnapshotTrendPoint[];
  distinctSnapshotTimestamps: number;
  provenanceBreakdown: {
    liveWeatherDistricts: number;
    staleWeatherDistricts: number;
    missingWeatherDistricts: number;
    simulatedIncidents: number;
    manualOrVerifiedIncidents: number;
    simulatedCrews: number;
  };
}

export function resolveDateBounds(filters: AnalyticsFilterOptions): {
  startMs: number | null;
  endMs: number | null;
} {
  const now = filters.nowMs ?? Date.now();
  if (filters.dateWindow === '1' || filters.dateWindow === '7' || filters.dateWindow === '30') {
    const days = Number(filters.dateWindow);
    return {
      startMs: now - days * 24 * 3600_000,
      endMs: null,
    };
  }
  if (filters.dateWindow === 'CUSTOM') {
    const startMs = filters.customStartDate
      ? new Date(`${filters.customStartDate}T00:00:00`).getTime()
      : null;
    const endMs = filters.customEndDate
      ? new Date(`${filters.customEndDate}T23:59:59.999`).getTime()
      : null;
    return {
      startMs: startMs !== null && Number.isFinite(startMs) ? startMs : null,
      endMs: endMs !== null && Number.isFinite(endMs) ? endMs : null,
    };
  }
  return { startMs: null, endMs: null };
}

function isWithinBounds(isoTimestamp: string, startMs: number | null, endMs: number | null): boolean {
  const ts = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ts)) return false;
  if (startMs !== null && ts < startMs) return false;
  if (endMs !== null && ts > endMs) return false;
  return true;
}

export function computeAnalyticsSummary(input: {
  districts: TelanganaDistrict[];
  assessments: RiskAssessment[];
  weatherObservations: WeatherObservation[];
  incidents: Incident[];
  crews: Crew[];
  dispatchHistory: DispatchHistoryEntry[];
  riskSnapshots: RiskSnapshotRecord[];
  filters: AnalyticsFilterOptions;
}): AnalyticsSummary {
  const {
    districts,
    assessments,
    weatherObservations,
    incidents,
    crews,
    dispatchHistory,
    riskSnapshots,
    filters,
  } = input;

  const { startMs, endMs } = resolveDateBounds(filters);
  const weatherMap = new Map(weatherObservations.map((w) => [w.districtId, w]));
  const districtMap = new Map(districts.map((d) => [d.id, d]));

  const filteredAssessments = assessments.filter(
    (a) => filters.districtId === 'ALL' || a.districtId === filters.districtId
  );

  const filteredIncidents = incidents.filter((inc) => {
    if (filters.districtId !== 'ALL' && inc.districtId !== filters.districtId) return false;
    return isWithinBounds(inc.createdAt, startMs, endMs);
  });

  const filteredCrews = crews.filter(
    (c) => filters.districtId === 'ALL' || c.districtId === filters.districtId
  );

  const incidentDistrictById = new Map(incidents.map((i) => [i.id, i.districtId]));
  const crewDistrictById = new Map(crews.map((c) => [c.id, c.districtId]));

  const filteredDispatchHistory = dispatchHistory.filter((entry) => {
    if (filters.districtId !== 'ALL') {
      const incDistrict = incidentDistrictById.get(entry.incidentId);
      const crewDistrict = crewDistrictById.get(entry.crewId);
      if (incDistrict !== filters.districtId && crewDistrict !== filters.districtId) {
        return false;
      }
    }
    return isWithinBounds(entry.createdAt, startMs, endMs);
  });

  const filteredSnapshots = riskSnapshots.filter((snap) => {
    if (filters.districtId !== 'ALL' && snap.districtId !== filters.districtId) return false;
    return isWithinBounds(snap.recordedAt, startMs, endMs);
  });

  // 1. District-wise risk comparison
  const districtRiskComparison = [...filteredAssessments]
    .sort((a, b) => b.score - a.score)
    .map((a) => {
      const w = weatherMap.get(a.districtId);
      const meta = districtMap.get(a.districtId);
      return {
        districtId: a.districtId,
        districtName: a.districtName,
        shortName: a.districtName.replace('Bhadradri ', 'B. ').slice(0, 12),
        discom: meta?.discom ?? 'TGSPDCL',
        riskScore: a.score,
        riskCategory: a.category,
        confidence: a.confidence,
        rainMm: w?.rainMm ?? 0,
        windKmh: w?.windSpeedKmh ?? 0,
        gustsKmh: w?.windGustsKmh ?? 0,
        substationCount: meta?.substationCount ?? 0,
      };
    });

  // 2. Severity distribution & district-severity matrix
  const severities: IncidentSeverity[] = ['Low', 'Medium', 'High', 'Critical'];
  const severityDistribution = severities.map((severity) => ({
    severity,
    count: filteredIncidents.filter((i) => i.severity === severity).length,
  }));

  const byDistMap = new Map<
    string,
    {
      districtName: string;
      Low: number;
      Medium: number;
      High: number;
      Critical: number;
      total: number;
      affectedConsumers: number;
    }
  >();

  for (const inc of filteredIncidents) {
    const cur = byDistMap.get(inc.districtId) ?? {
      districtName: inc.districtName,
      Low: 0,
      Medium: 0,
      High: 0,
      Critical: 0,
      total: 0,
      affectedConsumers: 0,
    };
    cur[inc.severity] += 1;
    cur.total += 1;
    cur.affectedConsumers += inc.affectedConsumers;
    byDistMap.set(inc.districtId, cur);
  }

  const incidentsByDistrictSeverity = Array.from(byDistMap.values())
    .sort((a, b) => b.total - a.total)
    .map((d) => ({
      ...d,
      shortName: d.districtName.replace('Bhadradri ', 'B. ').slice(0, 12),
    }));

  // 3. Incident status tracking
  const statusCounts: IncidentStatusCounts = {
    Reported: 0,
    Detected: 0,
    Assigned: 0,
    'Crew En Route': 0,
    'Under Maintenance': 0,
    Resolved: 0,
  };
  for (const inc of filteredIncidents) {
    const st: IncidentStatus = inc.status;
    if (st === 'Restored' || st === 'Closed') {
      statusCounts.Resolved += 1;
    } else if (st in statusCounts) {
      statusCounts[st as keyof Omit<IncidentStatusCounts, 'Resolved'>] += 1;
    }
  }
  const statusChartData = [
    { status: 'Reported', count: statusCounts.Reported },
    { status: 'Detected', count: statusCounts.Detected },
    { status: 'Assigned', count: statusCounts.Assigned },
    { status: 'En Route', count: statusCounts['Crew En Route'] },
    { status: 'Under Maint.', count: statusCounts['Under Maintenance'] },
    { status: 'Resolved', count: statusCounts.Resolved },
  ];

  // 4. Restoration time statistics from actual timestamps
  const resolvedRecords = filteredIncidents
    .filter((i) => {
      if (!i.resolvedAt) return false;
      const created = new Date(i.createdAt).getTime();
      const resolved = new Date(i.resolvedAt).getTime();
      return Number.isFinite(created) && Number.isFinite(resolved) && resolved >= created;
    })
    .map((i) => {
      const durationMinutes = Math.max(
        1,
        Math.round((new Date(i.resolvedAt!).getTime() - new Date(i.createdAt).getTime()) / 60_000)
      );
      return {
        incidentId: i.id,
        title: i.title,
        districtName: i.districtName,
        severity: i.severity,
        createdAt: i.createdAt,
        resolvedAt: i.resolvedAt!,
        durationMinutes,
      };
    });

  const sortedDurations = resolvedRecords
    .map((r) => r.durationMinutes)
    .sort((a, b) => a - b);

  const restorationStats: RestorationStats = {
    resolvedCount: resolvedRecords.length,
    meanMinutes:
      sortedDurations.length > 0
        ? Math.round(sortedDurations.reduce((s, d) => s + d, 0) / sortedDurations.length)
        : null,
    medianMinutes:
      sortedDurations.length > 0
        ? sortedDurations.length % 2 === 1
          ? sortedDurations[Math.floor(sortedDurations.length / 2)]
          : Math.round(
              (sortedDurations[sortedDurations.length / 2 - 1] +
                sortedDurations[sortedDurations.length / 2]) /
                2
            )
        : null,
    minMinutes: sortedDurations.length > 0 ? sortedDurations[0] : null,
    maxMinutes:
      sortedDurations.length > 0 ? sortedDurations[sortedDurations.length - 1] : null,
    records: resolvedRecords,
  };

  // Incident logging vs resolution daily buckets (actual recorded dates only)
  const bucketMap = new Map<string, IncidentTrendBucket>();
  for (const inc of filteredIncidents) {
    const dKey = inc.createdAt.slice(0, 10);
    const cur = bucketMap.get(dKey) ?? {
      dateKey: dKey,
      label: dKey,
      totalLogged: 0,
      resolvedCount: 0,
      criticalOrHighCount: 0,
    };
    cur.totalLogged += 1;
    if (inc.status === 'Restored' || inc.status === 'Closed' || inc.resolvedAt) {
      cur.resolvedCount += 1;
    }
    if (inc.severity === 'Critical' || inc.severity === 'High') {
      cur.criticalOrHighCount += 1;
    }
    bucketMap.set(dKey, cur);
  }
  const incidentTrendBuckets = Array.from(bucketMap.values()).sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey)
  );

  // 5. Crew utilization & availability
  const actionsByCrew = new Map<string, number>();
  for (const h of filteredDispatchHistory) {
    actionsByCrew.set(h.crewId, (actionsByCrew.get(h.crewId) ?? 0) + 1);
  }

  const available = filteredCrews.filter((c) => c.availability === 'Available').length;
  const standby = filteredCrews.filter((c) => c.availability === 'Standby').length;
  const deployed = filteredCrews.filter((c) => c.availability === 'Deployed').length;
  const offDuty = filteredCrews.filter((c) => c.availability === 'Off-Duty').length;

  const crewUtilization: CrewUtilizationSummary = {
    totalCrews: filteredCrews.length,
    available,
    standby,
    deployed,
    offDuty,
    utilizationPct:
      filteredCrews.length > 0 ? Math.round((deployed / filteredCrews.length) * 100) : 0,
    totalMembers: filteredCrews.reduce((s, c) => s + c.members, 0),
    deployedMembers: filteredCrews
      .filter((c) => c.availability === 'Deployed')
      .reduce((s, c) => s + c.members, 0),
    totalCompletedJobs: filteredCrews.reduce((s, c) => s + c.completedJobs, 0),
    dispatchActionsInWindow: filteredDispatchHistory.length,
    perCrew: filteredCrews.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name,
      districtName: c.districtName,
      availability: c.availability,
      status: c.status,
      members: c.members,
      completedJobs: c.completedJobs,
      activeIncidentId: c.activeIncidentId,
      dispatchActionsCount: actionsByCrew.get(c.id) ?? 0,
    })),
  };

  // 6. Weather vs recorded incidents comparison (per filtered district)
  const incByDistrict = new Map<string, { total: number; open: number; consumers: number }>();
  for (const inc of filteredIncidents) {
    const cur = incByDistrict.get(inc.districtId) ?? { total: 0, open: 0, consumers: 0 };
    cur.total += 1;
    if (inc.status !== 'Restored' && inc.status !== 'Closed') {
      cur.open += 1;
      cur.consumers += inc.affectedConsumers;
    }
    incByDistrict.set(inc.districtId, cur);
  }

  const weatherVsIncidents: WeatherVsIncidentPoint[] = filteredAssessments.map((a) => {
    const w = weatherMap.get(a.districtId);
    const incStats = incByDistrict.get(a.districtId) ?? { total: 0, open: 0, consumers: 0 };
    return {
      districtId: a.districtId,
      districtName: a.districtName,
      shortName: a.districtName.replace('Bhadradri ', 'B. ').slice(0, 11),
      riskScore: a.score,
      rainMm: w?.rainMm ?? 0,
      windKmh: w?.windSpeedKmh ?? 0,
      gustsKmh: w?.windGustsKmh ?? 0,
      incidentCount: incStats.total,
      openIncidentCount: incStats.open,
      affectedConsumers: incStats.consumers,
      weatherAvailable: Boolean(w),
    };
  });

  // Historical snapshot trend grouped by exact recordedAt timestamp
  const snapByTime = new Map<string, RiskSnapshotRecord[]>();
  for (const snap of filteredSnapshots) {
    const arr = snapByTime.get(snap.recordedAt) ?? [];
    arr.push(snap);
    snapByTime.set(snap.recordedAt, arr);
  }

  const snapshotTrend: SnapshotTrendPoint[] = Array.from(snapByTime.entries())
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .slice(-14)
    .map(([recordedAt, items]) => {
      const avgRiskScore = Math.round(
        items.reduce((s, x) => s + x.riskScore, 0) / items.length
      );
      const maxWindGustsKmh = Number(
        Math.max(...items.map((x) => x.windGustsKmh), 0).toFixed(1)
      );
      const avgRainMm = Number(
        (items.reduce((s, x) => s + x.rainMm, 0) / items.length).toFixed(1)
      );
      const recordedActiveIncidents = items.reduce(
        (s, x) => s + (x.activeIncidents ?? 0),
        0
      );
      const label = new Date(recordedAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      });
      return {
        recordedAt,
        label,
        avgRiskScore,
        maxWindGustsKmh,
        avgRainMm,
        recordedActiveIncidents,
        districtSamples: items.length,
      };
    });

  const relevantDistricts = districts.filter(
    (d) => filters.districtId === 'ALL' || d.id === filters.districtId
  );
  let liveWeatherDistricts = 0;
  let staleWeatherDistricts = 0;
  let missingWeatherDistricts = 0;
  for (const d of relevantDistricts) {
    const w = weatherMap.get(d.id);
    if (!w) missingWeatherDistricts += 1;
    else if (w.isStale) staleWeatherDistricts += 1;
    else liveWeatherDistricts += 1;
  }

  return {
    filteredAssessments,
    filteredIncidents,
    filteredCrews,
    filteredDispatchHistory,
    filteredSnapshots,
    districtRiskComparison,
    severityDistribution,
    incidentsByDistrictSeverity,
    statusCounts,
    statusChartData,
    restorationStats,
    incidentTrendBuckets,
    crewUtilization,
    weatherVsIncidents,
    snapshotTrend,
    distinctSnapshotTimestamps: snapByTime.size,
    provenanceBreakdown: {
      liveWeatherDistricts,
      staleWeatherDistricts,
      missingWeatherDistricts,
      simulatedIncidents: filteredIncidents.filter(
        (i) => i.source === 'Simulated Demonstration Data'
      ).length,
      manualOrVerifiedIncidents: filteredIncidents.filter(
        (i) => i.source !== 'Simulated Demonstration Data'
      ).length,
      simulatedCrews: filteredCrews.length,
    },
  };
}

function csvEsc(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildCrewAssignmentsCsv(input: {
  crews: Crew[];
  incidents: Incident[];
  dispatchHistory: DispatchHistoryEntry[];
}): string {
  const incidentMap = new Map(input.incidents.map((i) => [i.id, i]));
  const headers = [
    'Record Type',
    'Crew ID',
    'Crew Name',
    'District',
    'Availability',
    'Crew Status',
    'Members',
    'Completed Jobs',
    'Assigned / Target Incident ID',
    'Incident Title',
    'Dispatch Action',
    'Distance (km)',
    'ETA (min)',
    'Routing Mode',
    'Performed By',
    'Provenance',
    'Timestamp',
  ];

  const crewRows = input.crews.map((c) => {
    const linked = c.activeIncidentId ? incidentMap.get(c.activeIncidentId) : undefined;
    return [
      'Current Roster State',
      c.id,
      c.name,
      c.districtName,
      c.availability,
      c.status,
      c.members,
      c.completedJobs,
      c.activeIncidentId || 'Unassigned',
      linked?.title || '',
      c.activeIncidentId ? 'Active Assignment' : 'Standby / Ready',
      '',
      '',
      '',
      '',
      c.locationSource,
      c.updatedAt,
    ]
      .map(csvEsc)
      .join(',');
  });

  const historyRows = input.dispatchHistory.map((h) => [
    'Dispatch Audit Log',
    h.crewId,
    h.crewName,
    incidentMap.get(h.incidentId)?.districtName ?? '',
    '',
    h.crewStatus,
    '',
    '',
    h.incidentId,
    h.incidentTitle,
    h.action,
    h.distanceKm ?? '',
    h.etaMinutes ?? '',
    h.routingMode ?? '',
    h.performedBy,
    'SQLite Dispatch History',
    h.createdAt,
  ]
    .map(csvEsc)
    .join(','));

  return [headers.join(','), ...crewRows, ...historyRows].join('\n');
}
