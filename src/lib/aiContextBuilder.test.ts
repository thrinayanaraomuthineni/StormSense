import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundedChart, buildGroundedOperationalContext, inferChartFocusFromQuery } from './aiContextBuilder';
import { assessDistrictRisk } from './riskEngine';
import { TELANGANA_DISTRICTS } from './telanganaDistricts';
import type { AlertItem, Crew, Incident, RiskSnapshotRecord, WeatherObservation } from './types';

function makeSampleWeather(): WeatherObservation[] {
  const now = '2026-11-13T12:00:00.000Z';
  return TELANGANA_DISTRICTS.slice(0, 4).map((d, idx) => ({
    districtId: d.id,
    districtName: d.name,
    lat: d.lat,
    lng: d.lng,
    temperatureC: 29 + idx,
    relativeHumidity: 62,
    precipitationMm: idx === 1 ? 14 : 0,
    rainMm: idx === 1 ? 14 : 0,
    precipitationProbability: idx === 1 ? 85 : 10,
    windSpeedKmh: 14 + idx * 5,
    windGustsKmh: 24 + idx * 8,
    surfacePressureHpa: 1008,
    weatherCode: idx === 1 ? 63 : 1,
    weatherLabel: idx === 1 ? 'Moderate rain' : 'Mainly clear',
    isThunderstorm: false,
    hourly: [
      {
        time: '2026-11-13T13:00',
        temperatureC: 29,
        precipitationProbability: 40,
        rainMm: 2.5,
        windSpeedKmh: 20,
        windGustsKmh: 38,
        weatherCode: 61,
        weatherLabel: 'Light rain',
      },
      {
        time: '2026-11-13T14:00',
        temperatureC: 28,
        precipitationProbability: 50,
        rainMm: 4.0,
        windSpeedKmh: 24,
        windGustsKmh: 45,
        weatherCode: 61,
        weatherLabel: 'Light rain',
      },
      {
        time: '2026-11-13T15:00',
        temperatureC: 27,
        precipitationProbability: 60,
        rainMm: 5.0,
        windSpeedKmh: 28,
        windGustsKmh: 52,
        weatherCode: 63,
        weatherLabel: 'Moderate rain',
      },
      {
        time: '2026-11-13T16:00',
        temperatureC: 27,
        precipitationProbability: 45,
        rainMm: 1.5,
        windSpeedKmh: 18,
        windGustsKmh: 34,
        weatherCode: 3,
        weatherLabel: 'Overcast',
      },
    ],
    daily: [
      {
        date: '2026-11-13',
        tempMaxC: 31,
        tempMinC: 21,
        precipitationSumMm: 12,
        precipitationProbabilityMax: 75,
        windSpeedMaxKmh: 28,
        windGustsMaxKmh: 52,
        weatherCode: 63,
        weatherLabel: 'Moderate rain',
      },
    ],
    fetchedAt: now,
    isStale: false,
    source: 'Open-Meteo Live API',
  }));
}

const SAMPLE_INCIDENTS: Incident[] = [
  {
    id: 'INC-TEST-102',
    title: '33kV Tallada Spur Tree Contact',
    districtId: 'warangal',
    districtName: 'Warangal',
    locationName: 'Kazipet East',
    lat: 17.98,
    lng: 79.55,
    severity: 'Critical',
    faultType: 'Vegetation Contact',
    description: 'Tree branch fault',
    source: 'Simulated Demonstration Data',
    status: 'Reported',
    assignedCrewId: null,
    affectedConsumers: 4100,
    restorationNotes: '',
    createdAt: '2026-11-13T11:15:00.000Z',
    updatedAt: '2026-11-13T11:15:00.000Z',
    resolvedAt: null,
  },
];

const SAMPLE_CREWS: Crew[] = [
  {
    id: 'CRW-WGL-01',
    name: 'Warangal HT Unit',
    districtId: 'warangal',
    districtName: 'Warangal',
    baseLocation: 'Kazipet Yard',
    lat: 17.97,
    lng: 79.51,
    members: 5,
    skills: ['Tree Clearing', '33kV Feeder', 'HT Restoration'],
    availability: 'Available',
    status: 'Ready at Depot',
    activeIncidentId: null,
    completedJobs: 12,
    locationSource: 'Simulated Demonstration Data',
    updatedAt: '2026-11-13T11:00:00.000Z',
  },
];

const SAMPLE_ALERTS: AlertItem[] = [
  {
    id: 'ALT-1',
    dedupeKey: 'incident:unassigned:INC-TEST-102',
    type: 'unassigned_incident',
    severity: 'Critical',
    status: 'New',
    title: 'Unassigned Critical Incident in Warangal',
    message: 'INC-TEST-102 unassigned',
    explanation: 'Critical incident open without crew assignment.',
    districtId: 'warangal',
    districtName: 'Warangal',
    incidentId: 'INC-TEST-102',
    incidentTitle: '33kV Tallada Spur Tree Contact',
    assignedCrewId: null,
    assignedCrewName: null,
    provenance: 'Derived Prediction',
    isOfficialWarning: false,
    isRead: false,
    createdAt: '2026-11-13T11:50:00.000Z',
    updatedAt: '2026-11-13T11:50:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
  },
];

test('buildGroundedOperationalContext connects weather, risk, forecasts, snapshots, crews, alerts, and recommendations accurately', () => {
  const weatherObs = makeSampleWeather();
  const assessments = TELANGANA_DISTRICTS.slice(0, 4).map((d) =>
    assessDistrictRisk(
      d,
      weatherObs.find((w) => w.districtId === d.id),
      d.id === 'warangal' ? 1 : 0
    )
  );
  const priorSnapshots: RiskSnapshotRecord[] = [
    {
      id: 'SNP-1',
      districtId: 'warangal',
      districtName: 'Warangal',
      riskScore: 8,
      riskCategory: 'LOW',
      rainMm: 0,
      windSpeedKmh: 10,
      windGustsKmh: 18,
      recordedAt: '2026-11-13T08:00:00.000Z',
    },
  ];

  const ctx = buildGroundedOperationalContext({
    weatherStatus: 'live',
    weatherUpdatedAt: '2026-11-13T12:00:00.000Z',
    weatherObservations: weatherObs,
    riskAssessments: assessments,
    incidents: SAMPLE_INCIDENTS,
    crews: SAMPLE_CREWS,
    activeRoutes: [],
    alerts: SAMPLE_ALERTS,
    riskSnapshots: priorSnapshots,
    dispatchHistory: [],
  });

  assert.equal(ctx.districts.length, 4);
  const wgl = ctx.districts.find((d) => d.id === 'warangal')!;
  assert.ok(wgl.contributions.length === 8);
  assert.notEqual(wgl.currentWeather, 'UNAVAILABLE');
  assert.notEqual(wgl.next24hForecast, 'UNAVAILABLE');
  assert.notEqual(wgl.previousSnapshotComparison, 'NO_PRIOR_SNAPSHOT');
  if (wgl.previousSnapshotComparison !== 'NO_PRIOR_SNAPSHOT') {
    assert.equal(wgl.previousSnapshotComparison.previousRiskScore, 8);
    assert.equal(wgl.previousSnapshotComparison.rainDeltaMm, 14);
  }

  assert.equal(ctx.alertsOverview.summary.unread, 1);
  assert.equal(ctx.openIncidentRecommendations.length, 1);
  assert.equal(ctx.openIncidentRecommendations[0].topRecommendations[0].crewId, 'CRW-WGL-01');
});

test('inferChartFocusFromQuery and buildGroundedChart construct exact data charts without fabricated numbers', () => {
  const weatherObs = makeSampleWeather();
  const assessments = TELANGANA_DISTRICTS.slice(0, 4).map((d) =>
    assessDistrictRisk(
      d,
      weatherObs.find((w) => w.districtId === d.id),
      d.id === 'warangal' ? 1 : 0
    )
  );
  const ctx = buildGroundedOperationalContext({
    weatherStatus: 'live',
    weatherUpdatedAt: '2026-11-13T12:00:00.000Z',
    weatherObservations: weatherObs,
    riskAssessments: assessments,
    incidents: SAMPLE_INCIDENTS,
    crews: SAMPLE_CREWS,
    activeRoutes: [],
    alerts: SAMPLE_ALERTS,
    riskSnapshots: [
      {
        id: 'SNP-1',
        districtId: 'warangal',
        districtName: 'Warangal',
        riskScore: 8,
        riskCategory: 'LOW',
        rainMm: 0,
        windSpeedKmh: 10,
        windGustsKmh: 18,
        recordedAt: '2026-11-13T08:00:00.000Z',
      },
    ],
  });

  assert.equal(inferChartFocusFromQuery('Why is Warangal receiving its current risk score?'), 'district_factors');
  assert.equal(inferChartFocusFromQuery('Compare current weather with previous recorded snapshot'), 'snapshot_comparison');
  assert.equal(inferChartFocusFromQuery('Which available crew is best suited for this incident?'), 'incident_crew_readiness');

  const factorChart = buildGroundedChart('Why is Warangal receiving its current risk score?', ctx);
  assert.ok(factorChart);
  assert.ok(factorChart.title.includes('Warangal'));
  assert.equal(factorChart.data.length, 8);

  const crewChart = buildGroundedChart('Which available crew is best suited for INC-TEST-102?', ctx);
  assert.ok(crewChart);
  assert.equal(crewChart.data[0].crew, 'CRW-WGL-01');
});
