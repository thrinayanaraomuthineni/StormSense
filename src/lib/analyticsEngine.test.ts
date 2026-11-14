import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrewAssignmentsCsv, computeAnalyticsSummary } from './analyticsEngine';
import { assessDistrictRisk } from './riskEngine';
import { TELANGANA_DISTRICTS } from './telanganaDistricts';
import type {
  Crew,
  DispatchHistoryEntry,
  Incident,
  RiskSnapshotRecord,
  WeatherObservation,
} from './types';

function makeWeather(districtsSubset = TELANGANA_DISTRICTS.slice(0, 3)): WeatherObservation[] {
  const now = '2026-11-13T12:00:00.000Z';
  return districtsSubset.map((d, idx) => ({
    districtId: d.id,
    districtName: d.name,
    lat: d.lat,
    lng: d.lng,
    temperatureC: 30,
    relativeHumidity: 60,
    precipitationMm: idx === 0 ? 12 : 0,
    rainMm: idx === 0 ? 12 : 0,
    precipitationProbability: idx === 0 ? 80 : 10,
    windSpeedKmh: 15 + idx * 5,
    windGustsKmh: 28 + idx * 8,
    surfacePressureHpa: 1009,
    weatherCode: idx === 0 ? 63 : 1,
    weatherLabel: idx === 0 ? 'Moderate rain' : 'Mainly clear',
    isThunderstorm: false,
    hourly: [],
    daily: [],
    fetchedAt: now,
    isStale: idx === 2,
    source: 'Open-Meteo Live API',
  }));
}

const SAMPLE_INCIDENTS: Incident[] = [
  {
    id: 'INC-1',
    title: 'Hyderabad Feeder Trip',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    locationName: 'Uppal',
    lat: 17.4,
    lng: 78.5,
    severity: 'High',
    faultType: 'Feeder Trip',
    description: 'Demo',
    source: 'Simulated Demonstration Data',
    status: 'Under Maintenance',
    assignedCrewId: 'CRW-1',
    affectedConsumers: 2000,
    restorationNotes: '',
    createdAt: '2026-11-13T10:00:00.000Z',
    updatedAt: '2026-11-13T10:30:00.000Z',
    resolvedAt: null,
  },
  {
    id: 'INC-2',
    title: 'Warangal DTR Fault',
    districtId: 'warangal',
    districtName: 'Warangal',
    locationName: 'Kazipet',
    lat: 17.98,
    lng: 79.5,
    severity: 'Critical',
    faultType: 'Transformer Fault',
    description: 'Manual fault',
    source: 'Manually Entered Data',
    status: 'Restored',
    assignedCrewId: null,
    affectedConsumers: 1500,
    restorationNotes: 'Restored',
    createdAt: '2026-11-12T08:00:00.000Z',
    updatedAt: '2026-11-12T09:30:00.000Z',
    resolvedAt: '2026-11-12T09:30:00.000Z', // 90 min
  },
  {
    id: 'INC-3',
    title: 'Warangal Spur Alert',
    districtId: 'warangal',
    districtName: 'Warangal',
    locationName: 'Hanamkonda',
    lat: 18.0,
    lng: 79.55,
    severity: 'Low',
    faultType: 'Substation Breaker',
    description: 'Old resolved fault',
    source: 'Simulated Demonstration Data',
    status: 'Closed',
    assignedCrewId: null,
    affectedConsumers: 400,
    restorationNotes: 'Closed',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:30:00.000Z',
    resolvedAt: '2026-10-01T10:30:00.000Z', // 30 min
  },
];

const SAMPLE_CREWS: Crew[] = [
  {
    id: 'CRW-1',
    name: 'Hyd Alpha',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    baseLocation: 'Mint Yard',
    lat: 17.4,
    lng: 78.47,
    members: 5,
    skills: ['HT Restoration'],
    availability: 'Deployed',
    status: 'On Site - Restoring',
    activeIncidentId: 'INC-1',
    completedJobs: 18,
    locationSource: 'Simulated Demonstration Data',
    updatedAt: '2026-11-13T10:15:00.000Z',
  },
  {
    id: 'CRW-2',
    name: 'Warangal Beta',
    districtId: 'warangal',
    districtName: 'Warangal',
    baseLocation: 'Kazipet',
    lat: 17.97,
    lng: 79.51,
    members: 4,
    skills: ['Distribution Transformer'],
    availability: 'Available',
    status: 'Ready at Depot',
    activeIncidentId: null,
    completedJobs: 12,
    locationSource: 'Simulated Demonstration Data',
    updatedAt: '2026-11-13T09:00:00.000Z',
  },
];

const SAMPLE_DISPATCH_HISTORY: DispatchHistoryEntry[] = [
  {
    id: 'DSP-1',
    incidentId: 'INC-1',
    incidentTitle: 'Hyderabad Feeder Trip',
    crewId: 'CRW-1',
    crewName: 'Hyd Alpha',
    action: 'assigned',
    previousCrewId: null,
    previousCrewName: null,
    crewStatus: 'On Site - Restoring',
    incidentStatus: 'Under Maintenance',
    distanceKm: 6.4,
    etaMinutes: 19,
    routingMode: 'osrm_road',
    notes: 'Dispatched',
    performedBy: 'Operations Manager',
    createdAt: '2026-11-13T10:05:00.000Z',
  },
];

const SAMPLE_SNAPSHOTS: RiskSnapshotRecord[] = [
  {
    id: 'SNP-1',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    riskScore: 12,
    riskCategory: 'LOW',
    rainMm: 0,
    windSpeedKmh: 10,
    windGustsKmh: 18,
    activeIncidents: 1,
    recordedAt: '2026-11-13T08:00:00.000Z',
  },
  {
    id: 'SNP-2',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    riskScore: 36,
    riskCategory: 'MODERATE',
    rainMm: 12,
    windSpeedKmh: 15,
    windGustsKmh: 28,
    activeIncidents: 1,
    recordedAt: '2026-11-13T12:00:00.000Z',
  },
];

test('computeAnalyticsSummary accurately computes status counts, restoration stats, crew utilization, and filters', () => {
  const subset = TELANGANA_DISTRICTS.slice(0, 3);
  const weather = makeWeather(subset);
  const assessments = subset.map((d) =>
    assessDistrictRisk(d, weather.find((w) => w.districtId === d.id), d.id === 'hyderabad' ? 1 : 0)
  );

  const nowMs = new Date('2026-11-13T13:00:00.000Z').getTime();

  // All districts & all time
  const allSummary = computeAnalyticsSummary({
    districts: subset,
    assessments,
    weatherObservations: weather,
    incidents: SAMPLE_INCIDENTS,
    crews: SAMPLE_CREWS,
    dispatchHistory: SAMPLE_DISPATCH_HISTORY,
    riskSnapshots: SAMPLE_SNAPSHOTS,
    filters: { districtId: 'ALL', dateWindow: 'ALL', nowMs },
  });

  assert.equal(allSummary.filteredIncidents.length, 3);
  assert.equal(allSummary.statusCounts['Under Maintenance'], 1);
  assert.equal(allSummary.statusCounts.Resolved, 2);
  assert.equal(allSummary.restorationStats.resolvedCount, 2);
  assert.equal(allSummary.restorationStats.meanMinutes, 60); // (90 + 30) / 2
  assert.equal(allSummary.restorationStats.minMinutes, 30);
  assert.equal(allSummary.restorationStats.maxMinutes, 90);
  assert.equal(allSummary.crewUtilization.utilizationPct, 50); // 1 deployed / 2 total
  assert.equal(allSummary.provenanceBreakdown.simulatedIncidents, 2);
  assert.equal(allSummary.provenanceBreakdown.manualOrVerifiedIncidents, 1);
  assert.equal(allSummary.distinctSnapshotTimestamps, 2);

  // Filter by 7 days -> excludes INC-3 from Oct 1
  const sevenDaySummary = computeAnalyticsSummary({
    districts: subset,
    assessments,
    weatherObservations: weather,
    incidents: SAMPLE_INCIDENTS,
    crews: SAMPLE_CREWS,
    dispatchHistory: SAMPLE_DISPATCH_HISTORY,
    riskSnapshots: SAMPLE_SNAPSHOTS,
    filters: { districtId: 'ALL', dateWindow: '7', nowMs },
  });

  assert.equal(sevenDaySummary.filteredIncidents.length, 2);
  assert.equal(sevenDaySummary.restorationStats.resolvedCount, 1);
  assert.equal(sevenDaySummary.restorationStats.meanMinutes, 90);

  // Filter by Warangal only
  const wglSummary = computeAnalyticsSummary({
    districts: subset,
    assessments,
    weatherObservations: weather,
    incidents: SAMPLE_INCIDENTS,
    crews: SAMPLE_CREWS,
    dispatchHistory: SAMPLE_DISPATCH_HISTORY,
    riskSnapshots: SAMPLE_SNAPSHOTS,
    filters: { districtId: 'warangal', dateWindow: 'ALL', nowMs },
  });

  assert.equal(wglSummary.filteredAssessments.length, 1);
  assert.equal(wglSummary.filteredIncidents.length, 2);
  assert.equal(wglSummary.crewUtilization.totalCrews, 1);
  assert.equal(wglSummary.crewUtilization.utilizationPct, 0);
});

test('buildCrewAssignmentsCsv includes both current roster assignments and dispatch history logs', () => {
  const csv = buildCrewAssignmentsCsv({
    crews: SAMPLE_CREWS,
    incidents: SAMPLE_INCIDENTS,
    dispatchHistory: SAMPLE_DISPATCH_HISTORY,
  });
  assert.ok(csv.includes('Current Roster State'));
  assert.ok(csv.includes('Dispatch Audit Log'));
  assert.ok(csv.includes('CRW-1'));
  assert.ok(csv.includes('INC-1'));
  assert.ok(csv.includes('osrm_road'));
});
