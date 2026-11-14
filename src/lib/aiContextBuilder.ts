import { computeAlertSummary } from './alertSummary';
import { recommendCrewsForIncident } from './crewDispatch';
import { TELANGANA_DISTRICTS } from './telanganaDistricts';
import type {
  ActiveDispatchRoute,
  AiChartFocus,
  AiGroundedChart,
  AlertItem,
  Crew,
  DispatchHistoryEntry,
  Incident,
  RiskAssessment,
  RiskSnapshotRecord,
  RouteEstimate,
  WeatherObservation,
} from './types';

export interface SnapshotComparisonEntry {
  districtId: string;
  districtName: string;
  currentRecordedAt: string;
  currentRiskScore: number;
  currentRainMm: number;
  currentWindKmh: number;
  currentGustsKmh: number;
  previousRecordedAt: string;
  previousRiskScore: number;
  previousRainMm: number;
  previousWindKmh: number;
  previousGustsKmh: number;
  riskScoreDelta: number;
  rainDeltaMm: number;
  windDeltaKmh: number;
  gustsDeltaKmh: number;
}

export interface IncidentRecommendationSummary {
  incidentId: string;
  incidentTitle: string;
  districtId: string;
  districtName: string;
  severity: Incident['severity'];
  faultType: Incident['faultType'];
  status: Incident['status'];
  source: Incident['source'];
  assignedCrewId: string | null;
  assignedCrewName: string | null;
  topRecommendations: Array<{
    crewId: string;
    crewName: string;
    availability: Crew['availability'];
    status: Crew['status'];
    matchScore: number;
    distanceKm: number;
    estimatedEtaMinutes: number;
    routingMode: 'osrm_road' | 'haversine_estimate';
    etaLabel: string;
    isAssignable: boolean;
    conflictReason: string | null;
    matchedSkills: string[];
    reasons: string[];
  }>;
}

export interface GroundedOperationalContext {
  generatedAt: string;
  weatherFeed: {
    status: 'live' | 'stale' | 'error';
    lastUpdated: string | null;
    errorMessage: string | null;
    observedDistrictCount: number;
    unavailableDistricts: string[];
  };
  districts: Array<{
    id: string;
    name: string;
    discom: string;
    circle: string;
    substationCount: number;
    vulnerabilityIndex: number;
    vulnerabilityNotes: string;
    riskScore: number;
    riskCategory: RiskAssessment['category'];
    confidence: RiskAssessment['confidence'];
    confidenceReason: string;
    dataQualityScore: number;
    dataQualityFlags: string[];
    recommendedAction: string;
    contributions: Array<{
      factor: string;
      label: string;
      rawValue: string;
      points: number;
      maxPoints: number;
      weightPct: number;
      dataStatus: string;
      rationale: string;
    }>;
    currentWeather:
      | {
          temperatureC: number;
          humidityPct: number;
          rainMm: number;
          precipitationProbabilityPct: number;
          windSpeedKmh: number;
          windGustsKmh: number;
          surfacePressureHpa: number;
          weatherLabel: string;
          isThunderstorm: boolean;
          fetchedAt: string;
          isStale: boolean;
          source: string;
        }
      | 'UNAVAILABLE';
    past24hHistory: WeatherObservation['recentHistory'] | 'UNAVAILABLE';
    next24hForecast:
      | {
          totalRainMm: number;
          peakRainMmPerHr: number;
          maxWindKmh: number;
          maxGustsKmh: number;
          maxPrecipProbPct: number;
          peakRiskHourTime: string | null;
          hourlyPreview: Array<{
            time: string;
            rainMm: number;
            windKmh: number;
            gustsKmh: number;
            precipProbPct: number;
            weatherLabel: string;
          }>;
        }
      | 'UNAVAILABLE';
    next3DayForecast: Array<{
      date: string;
      tempMaxC: number;
      tempMinC: number;
      precipitationSumMm: number;
      precipitationProbabilityMax: number;
      windGustsMaxKmh: number;
      weatherLabel: string;
    }>;
    previousSnapshotComparison: SnapshotComparisonEntry | 'NO_PRIOR_SNAPSHOT';
  }>;
  incidents: Array<{
    id: string;
    title: string;
    districtId: string;
    districtName: string;
    locationName: string;
    severity: Incident['severity'];
    faultType: Incident['faultType'];
    status: Incident['status'];
    source: Incident['source'];
    assignedCrewId: string | null;
    assignedCrewName: string | null;
    affectedConsumers: number;
    restorationNotes: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
  }>;
  crewFleet: {
    summary: {
      total: number;
      available: number;
      standby: number;
      deployed: number;
      offDuty: number;
    };
    crews: Array<{
      id: string;
      name: string;
      districtId: string;
      districtName: string;
      baseLocation: string;
      members: number;
      skills: string[];
      availability: Crew['availability'];
      status: Crew['status'];
      activeIncidentId: string | null;
      completedJobs: number;
      locationSource: string;
      updatedAt: string;
    }>;
    activeRoutes: ActiveDispatchRoute[];
  };
  openIncidentRecommendations: IncidentRecommendationSummary[];
  alertsOverview: {
    summary: ReturnType<typeof computeAlertSummary>;
    activeAndUnreadAlerts: Array<{
      id: string;
      severity: AlertItem['severity'];
      status: AlertItem['status'];
      isRead: boolean;
      title: string;
      explanation: string;
      districtName: string | null;
      incidentId: string | null;
      assignedCrewName: string | null;
      provenance: AlertItem['provenance'];
      createdAt: string;
      updatedAt: string;
    }>;
  };
  snapshotArchive: {
    totalRecords: number;
    latestSnapshotAt: string | null;
    previousDistinctSnapshotAt: string | null;
  };
  recentDispatchHistory: DispatchHistoryEntry[];
}

export function buildGroundedOperationalContext(input: {
  weatherStatus: 'live' | 'stale' | 'error';
  weatherUpdatedAt: string | null;
  weatherErrorMessage?: string | null;
  weatherObservations: WeatherObservation[];
  riskAssessments: RiskAssessment[];
  incidents: Incident[];
  crews: Crew[];
  activeRoutes: ActiveDispatchRoute[];
  alerts: AlertItem[];
  riskSnapshots: RiskSnapshotRecord[];
  dispatchHistory?: DispatchHistoryEntry[];
  routeOverridesByIncident?: Record<string, Map<string, RouteEstimate>>;
}): GroundedOperationalContext {
  const weatherMap = new Map(input.weatherObservations.map((w) => [w.districtId, w]));
  const districtMetaMap = new Map(TELANGANA_DISTRICTS.map((d) => [d.id, d]));

  // Group snapshots per district sorted newest -> oldest
  const snapshotsByDistrict = new Map<string, RiskSnapshotRecord[]>();
  const distinctTimestampsSet = new Set<string>();
  for (const snap of input.riskSnapshots) {
    distinctTimestampsSet.add(snap.recordedAt);
    const arr = snapshotsByDistrict.get(snap.districtId) ?? [];
    arr.push(snap);
    snapshotsByDistrict.set(snap.districtId, arr);
  }
  for (const [, arr] of snapshotsByDistrict) {
    arr.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  }
  const sortedDistinctTimestamps = Array.from(distinctTimestampsSet).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  const unavailableDistricts: string[] = [];

  const districts = input.riskAssessments.map((r) => {
    const w = weatherMap.get(r.districtId);
    const meta = districtMetaMap.get(r.districtId);
    if (!w) {
      unavailableDistricts.push(r.districtName);
    }

    const districtSnaps = snapshotsByDistrict.get(r.districtId) ?? [];
    const latestSnap = districtSnaps[0];
    // Compare current live assessment/weather against the previous distinct snapshot.
    // If latestSnap is essentially identical to current state (< 3 min old), compare against districtSnaps[1];
    // otherwise compare current live state against latestSnap (if available) or districtSnaps[1].
    let priorSnap: RiskSnapshotRecord | undefined = undefined;
    if (latestSnap) {
      const ageMs = Date.now() - new Date(latestSnap.recordedAt).getTime();
      priorSnap = ageMs < 5 * 60_000 ? districtSnaps[1] : latestSnap;
    }

    const previousSnapshotComparison: SnapshotComparisonEntry | 'NO_PRIOR_SNAPSHOT' =
      priorSnap && w
        ? {
            districtId: r.districtId,
            districtName: r.districtName,
            currentRecordedAt: w.fetchedAt,
            currentRiskScore: r.score,
            currentRainMm: w.rainMm,
            currentWindKmh: w.windSpeedKmh,
            currentGustsKmh: w.windGustsKmh,
            previousRecordedAt: priorSnap.recordedAt,
            previousRiskScore: priorSnap.riskScore,
            previousRainMm: priorSnap.rainMm,
            previousWindKmh: priorSnap.windSpeedKmh,
            previousGustsKmh: priorSnap.windGustsKmh,
            riskScoreDelta: r.score - priorSnap.riskScore,
            rainDeltaMm: Number((w.rainMm - priorSnap.rainMm).toFixed(1)),
            windDeltaKmh: Number((w.windSpeedKmh - priorSnap.windSpeedKmh).toFixed(1)),
            gustsDeltaKmh: Number((w.windGustsKmh - priorSnap.windGustsKmh).toFixed(1)),
          }
        : 'NO_PRIOR_SNAPSHOT';

    const next24h = w?.hourly?.slice(0, 24) ?? [];
    const peakHour = next24h.reduce(
      (best, cur) => (cur.windGustsKmh + cur.rainMm * 2 > best.score ? { time: cur.time, score: cur.windGustsKmh + cur.rainMm * 2 } : best),
      { time: null as string | null, score: -1 }
    );

    return {
      id: r.districtId,
      name: r.districtName,
      discom: meta?.discom ?? 'TGSPDCL',
      circle: meta?.circle ?? r.districtName,
      substationCount: meta?.substationCount ?? 0,
      vulnerabilityIndex: r.vulnerabilityIndex,
      vulnerabilityNotes: r.vulnerabilityNotes,
      riskScore: r.score,
      riskCategory: r.category,
      confidence: r.confidence,
      confidenceReason: r.confidenceReason,
      dataQualityScore: r.dataQualityScore,
      dataQualityFlags: r.dataQualityFlags,
      recommendedAction: r.recommendedAction,
      contributions: r.contributions.map((c) => ({
        factor: c.factor,
        label: c.label,
        rawValue: c.rawValue,
        points: c.points,
        maxPoints: c.maxPoints,
        weightPct: c.weightPct,
        dataStatus: c.dataStatus,
        rationale: c.rationale,
      })),
      currentWeather: w
        ? {
            temperatureC: w.temperatureC,
            humidityPct: w.relativeHumidity,
            rainMm: w.rainMm,
            precipitationProbabilityPct: w.precipitationProbability,
            windSpeedKmh: w.windSpeedKmh,
            windGustsKmh: w.windGustsKmh,
            surfacePressureHpa: w.surfacePressureHpa,
            weatherLabel: w.weatherLabel,
            isThunderstorm: w.isThunderstorm,
            fetchedAt: w.fetchedAt,
            isStale: w.isStale,
            source: w.source,
          }
        : ('UNAVAILABLE' as const),
      past24hHistory: w?.recentHistory ?? ('UNAVAILABLE' as const),
      next24hForecast:
        next24h.length > 0
          ? {
              totalRainMm: Number(next24h.reduce((s, h) => s + h.rainMm, 0).toFixed(1)),
              peakRainMmPerHr: Number(Math.max(...next24h.map((h) => h.rainMm), 0).toFixed(1)),
              maxWindKmh: Number(Math.max(...next24h.map((h) => h.windSpeedKmh), 0).toFixed(1)),
              maxGustsKmh: Number(Math.max(...next24h.map((h) => h.windGustsKmh), 0).toFixed(1)),
              maxPrecipProbPct: Math.round(
                Math.max(...next24h.map((h) => h.precipitationProbability), 0)
              ),
              peakRiskHourTime: peakHour.time,
              hourlyPreview: next24h.filter((_, idx) => idx % 3 === 0).slice(0, 8).map((h) => ({
                time: h.time,
                rainMm: h.rainMm,
                windKmh: h.windSpeedKmh,
                gustsKmh: h.windGustsKmh,
                precipProbPct: h.precipitationProbability,
                weatherLabel: h.weatherLabel,
              })),
            }
          : ('UNAVAILABLE' as const),
      next3DayForecast: (w?.daily ?? []).slice(0, 3).map((d) => ({
        date: d.date,
        tempMaxC: d.tempMaxC,
        tempMinC: d.tempMinC,
        precipitationSumMm: d.precipitationSumMm,
        precipitationProbabilityMax: d.precipitationProbabilityMax,
        windGustsMaxKmh: d.windGustsMaxKmh,
        weatherLabel: d.weatherLabel,
      })),
      previousSnapshotComparison,
    };
  });

  const openIncidents = input.incidents.filter(
    (inc) => inc.status !== 'Restored' && inc.status !== 'Closed'
  );

  const openIncidentRecommendations: IncidentRecommendationSummary[] = openIncidents.map((inc) => {
    const recs = recommendCrewsForIncident(
      inc,
      input.crews,
      input.routeOverridesByIncident?.[inc.id],
      input.incidents
    );
    return {
      incidentId: inc.id,
      incidentTitle: inc.title,
      districtId: inc.districtId,
      districtName: inc.districtName,
      severity: inc.severity,
      faultType: inc.faultType,
      status: inc.status,
      source: inc.source,
      assignedCrewId: inc.assignedCrewId,
      assignedCrewName: inc.assignedCrewName ?? null,
      topRecommendations: recs.slice(0, 3).map((rec) => ({
        crewId: rec.crew.id,
        crewName: rec.crew.name,
        availability: rec.crew.availability,
        status: rec.crew.status,
        matchScore: rec.matchScore,
        distanceKm: rec.distanceKm,
        estimatedEtaMinutes: rec.estimatedEtaMinutes,
        routingMode: rec.routingMode,
        etaLabel: rec.etaLabel,
        isAssignable: rec.isAssignable,
        conflictReason: rec.conflictReason,
        matchedSkills: rec.matchedSkills,
        reasons: rec.reasons,
      })),
    };
  });

  const alertSummary = computeAlertSummary(input.alerts);
  const activeAndUnreadAlerts = input.alerts
    .filter((a) => a.status !== 'Resolved' || !a.isRead)
    .slice(0, 15)
    .map((a) => ({
      id: a.id,
      severity: a.severity,
      status: a.status,
      isRead: a.isRead,
      title: a.title,
      explanation: a.explanation,
      districtName: a.districtName,
      incidentId: a.incidentId,
      assignedCrewName: a.assignedCrewName,
      provenance: a.provenance,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));

  return {
    generatedAt: new Date().toISOString(),
    weatherFeed: {
      status: input.weatherStatus,
      lastUpdated: input.weatherUpdatedAt,
      errorMessage: input.weatherErrorMessage ?? null,
      observedDistrictCount: input.weatherObservations.length,
      unavailableDistricts,
    },
    districts,
    incidents: input.incidents.map((i) => ({
      id: i.id,
      title: i.title,
      districtId: i.districtId,
      districtName: i.districtName,
      locationName: i.locationName,
      severity: i.severity,
      faultType: i.faultType,
      status: i.status,
      source: i.source,
      assignedCrewId: i.assignedCrewId,
      assignedCrewName: i.assignedCrewName ?? null,
      affectedConsumers: i.affectedConsumers,
      restorationNotes: i.restorationNotes,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      resolvedAt: i.resolvedAt,
    })),
    crewFleet: {
      summary: {
        total: input.crews.length,
        available: input.crews.filter((c) => c.availability === 'Available').length,
        standby: input.crews.filter((c) => c.availability === 'Standby').length,
        deployed: input.crews.filter((c) => c.availability === 'Deployed').length,
        offDuty: input.crews.filter((c) => c.availability === 'Off-Duty').length,
      },
      crews: input.crews.map((c) => ({
        id: c.id,
        name: c.name,
        districtId: c.districtId,
        districtName: c.districtName,
        baseLocation: c.baseLocation,
        members: c.members,
        skills: c.skills,
        availability: c.availability,
        status: c.status,
        activeIncidentId: c.activeIncidentId,
        completedJobs: c.completedJobs,
        locationSource: c.locationSource,
        updatedAt: c.updatedAt,
      })),
      activeRoutes: input.activeRoutes,
    },
    openIncidentRecommendations,
    alertsOverview: {
      summary: alertSummary,
      activeAndUnreadAlerts,
    },
    snapshotArchive: {
      totalRecords: input.riskSnapshots.length,
      latestSnapshotAt: sortedDistinctTimestamps[0] ?? null,
      previousDistinctSnapshotAt: sortedDistinctTimestamps[1] ?? null,
    },
    recentDispatchHistory: (input.dispatchHistory ?? []).slice(0, 12),
  };
}

function findMentionedDistrict(
  query: string,
  districts: GroundedOperationalContext['districts']
) {
  const lower = query.toLowerCase();
  return districts.find(
    (d) => lower.includes(d.name.toLowerCase()) || lower.includes(d.id.toLowerCase())
  );
}

function findMentionedIncident(
  query: string,
  recs: IncidentRecommendationSummary[]
): IncidentRecommendationSummary | undefined {
  const upper = query.toUpperCase();
  const byId = recs.find((r) => upper.includes(r.incidentId.toUpperCase()));
  if (byId) return byId;
  const lower = query.toLowerCase();
  const byDistrict = recs.find((r) => lower.includes(r.districtName.toLowerCase()));
  if (byDistrict) return byDistrict;
  // Prefer unassigned Critical/High incident first
  return (
    recs.find((r) => !r.assignedCrewId && r.severity === 'Critical') ??
    recs.find((r) => !r.assignedCrewId) ??
    recs[0]
  );
}

export function inferChartFocusFromQuery(query: string): AiChartFocus {
  const q = query.toLowerCase();
  if (q.includes('snapshot') || q.includes('previous') || q.includes('compare')) {
    return 'snapshot_comparison';
  }
  if (q.includes('crew') || q.includes('dispatch') || q.includes('suited') || q.includes('incident')) {
    return 'incident_crew_readiness';
  }
  if (q.includes('forecast') || q.includes('next 24') || q.includes('24 hour')) {
    return 'forecast_24h';
  }
  if (
    q.includes('why is') ||
    q.includes('receiving its') ||
    q.includes('breakdown') ||
    q.includes('score')
  ) {
    return 'district_factors';
  }
  return 'top_risk_districts';
}

export function buildGroundedChart(
  query: string,
  ctx: GroundedOperationalContext,
  requestedFocus?: AiChartFocus
): AiGroundedChart | null {
  const focus =
    requestedFocus && requestedFocus !== 'none'
      ? requestedFocus
      : inferChartFocusFromQuery(query);

  if (focus === 'none') return null;

  if (focus === 'district_factors') {
    const target =
      findMentionedDistrict(query, ctx.districts) ??
      [...ctx.districts].sort((a, b) => b.riskScore - a.riskScore)[0];
    if (!target) return null;

    const shortLabel: Record<string, string> = {
      rainfall: 'Rain',
      wind: 'Wind',
      gusts: 'Gusts',
      thunderstorm: 'Thunder',
      precipitation_prob: 'Precip %',
      historical_weather: '24h Hist',
      recorded_incidents: 'Incidents',
      grid_vulnerability: 'Grid Vuln',
    };

    return {
      chartType: 'grouped_bar',
      title: `${target.name} Risk Factor Attribution (${target.riskScore}/100 · ${target.riskCategory})`,
      subtitle: 'Actual weighted points contributed vs factor weight ceiling',
      xKey: 'factor',
      series: [
        { key: 'points', label: 'Current Score (pts)', color: '#55B7B0' },
        { key: 'maxPoints', label: 'Factor Max (pts)', color: '#8FA3B3' },
      ],
      data: target.contributions.map((c) => ({
        factor: shortLabel[c.factor] ?? c.label,
        points: c.points,
        maxPoints: c.maxPoints,
      })),
    };
  }

  if (focus === 'snapshot_comparison') {
    const withPrior = ctx.districts
      .filter((d) => d.previousSnapshotComparison !== 'NO_PRIOR_SNAPSHOT')
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 6);

    if (withPrior.length > 0) {
      return {
        chartType: 'grouped_bar',
        title: 'Current Risk vs Previous Recorded Snapshot',
        subtitle: `Snapshot comparison across top monitored districts (${ctx.snapshotArchive.previousDistinctSnapshotAt ?? 'prior record'})`,
        xKey: 'district',
        series: [
          { key: 'previousScore', label: 'Previous Snapshot', color: '#8FA3B3' },
          { key: 'currentScore', label: 'Current Score', color: '#70A9CF' },
        ],
        data: withPrior.map((d) => {
          const cmp = d.previousSnapshotComparison as SnapshotComparisonEntry;
          return {
            district: d.name.replace('Bhadradri ', 'B. '),
            previousScore: cmp.previousRiskScore,
            currentScore: cmp.currentRiskScore,
          };
        }),
      };
    }
  }

  if (focus === 'incident_crew_readiness') {
    const targetInc = findMentionedIncident(query, ctx.openIncidentRecommendations);
    if (targetInc && targetInc.topRecommendations.length > 0) {
      return {
        chartType: 'grouped_bar',
        title: `Crew Match & ETA for ${targetInc.incidentId} (${targetInc.districtName})`,
        subtitle: 'Server-computed dispatch suitability score (0–100) and estimated travel time',
        xKey: 'crew',
        series: [
          { key: 'matchScore', label: 'Match Score', color: '#55B7B0' },
          { key: 'etaMinutes', label: 'Est. ETA (min)', color: '#E5A94C' },
        ],
        data: targetInc.topRecommendations.map((r) => ({
          crew: r.crewId,
          matchScore: r.matchScore,
          etaMinutes: r.estimatedEtaMinutes,
        })),
      };
    }
  }

  if (focus === 'forecast_24h') {
    const target =
      findMentionedDistrict(query, ctx.districts) ??
      [...ctx.districts].sort((a, b) => b.riskScore - a.riskScore)[0];
    if (target && target.next24hForecast !== 'UNAVAILABLE') {
      return {
        chartType: 'line',
        title: `${target.name} Next-24h Open-Meteo Forecast`,
        subtitle: 'Projected wind gusts (km/h) and rainfall (mm/h) at 3-hour intervals',
        xKey: 'hour',
        series: [
          { key: 'gustsKmh', label: 'Wind Gusts (km/h)', color: '#E5A94C' },
          { key: 'rainMm', label: 'Rain (mm/h)', color: '#70A9CF' },
        ],
        data: target.next24hForecast.hourlyPreview.map((h) => ({
          hour: h.time.slice(11, 16),
          gustsKmh: Number(h.gustsKmh.toFixed(1)),
          rainMm: Number(h.rainMm.toFixed(1)),
        })),
      };
    }
  }

  // Default: Top 6 districts by derived outage risk score + current wind gusts
  const topDistricts = [...ctx.districts]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 6);

  if (topDistricts.length === 0) return null;

  return {
    chartType: 'grouped_bar',
    title: 'Highest-Risk Telangana Districts (Current Snapshot)',
    subtitle: 'Derived Outage Risk Index (0–100) alongside live peak wind gusts (km/h)',
    xKey: 'district',
    series: [
      { key: 'riskScore', label: 'Risk Score', color: '#70A9CF' },
      { key: 'gustsKmh', label: 'Wind Gusts (km/h)', color: '#55B7B0' },
    ],
    data: topDistricts.map((d) => ({
      district: d.name.replace('Bhadradri ', 'B. '),
      riskScore: d.riskScore,
      gustsKmh:
        d.currentWeather !== 'UNAVAILABLE' ? Math.round(d.currentWeather.windGustsKmh) : 0,
    })),
  };
}
