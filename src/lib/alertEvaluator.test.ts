import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlertRules, shouldEscalateSeverity } from './alertEvaluator';
import {
  computeAlertSummary,
  normalizeAlertSeverity,
  normalizeAlertStatus,
  sortAlertsByPriority,
} from './alertSummary';
import type {
  AlertConfig,
  AlertItem,
  Incident,
  RiskAssessment,
  WeatherObservation,
} from './types';

const baseConfig: AlertConfig = {
  moderateRiskThreshold: 31,
  highRiskThreshold: 61,
  criticalRiskThreshold: 81,
  highWindThresholdKmh: 40,
  heavyRainThresholdMm: 10,
  unassignedAlertMinutes: 30,
  restorationDelayMinutes: 120,
  smsEnabled: false,
  whatsappEnabled: false,
  emailEnabled: false,
  smsWebhookStatus: 'Not Configured',
  whatsappWebhookStatus: 'Not Configured',
  emailSmtpStatus: 'Not Configured',
  updatedAt: '2026-11-13T10:00:00.000Z',
};

function makeRisk(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    score: 20,
    exactScore: 20,
    category: 'LOW',
    contributions: [
      {
        factor: 'rainfall',
        label: 'Rainfall Intensity',
        rawValue: '2.0 mm/h',
        points: 5,
        maxPoints: 20,
        weightPct: 20,
        intensityPct: 25,
        dataStatus: 'Live',
        rationale: 'Light rain',
      },
    ],
    scoreExplanation: 'Hyderabad scored 20/100 (LOW) using live Open-Meteo telemetry.',
    vulnerabilityIndex: 0.65,
    vulnerabilityNotes: 'Urban feeder exposure',
    recommendedAction: 'Monitor feeders',
    preventiveActions: [
      {
        factor: 'overall',
        priority: 'Routine',
        title: 'Routine SCADA Monitoring',
        action: 'Monitor feeders',
        driverValue: 'LOW Risk Band',
      },
    ],
    confidence: 'HIGH',
    confidenceReason: 'Live Open-Meteo telemetry',
    dataQualityScore: 100,
    dataQualityFlags: ['Live Open-Meteo weather telemetry active'],
    incidentContext: {
      activeCount: 0,
      totalCount: 0,
      simulatedCount: 0,
      manualCount: 0,
    },
    modelType: 'Rule-Based Predictive Prototype (Heuristic Index — Non-ML, Not a Failure Probability)',
    calculatedAt: '2026-11-13T10:00:00.000Z',
    hourlyTrend: [],
    dailyForecast: [],
    ...overrides,
  };
}

function makeWeather(overrides: Partial<WeatherObservation> = {}): WeatherObservation {
  return {
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    lat: 17.385,
    lng: 78.4867,
    temperatureC: 28,
    relativeHumidity: 70,
    precipitationMm: 0,
    rainMm: 0,
    precipitationProbability: 10,
    windSpeedKmh: 12,
    windGustsKmh: 20,
    surfacePressureHpa: 1010,
    weatherCode: 2,
    weatherLabel: 'Partly Cloudy',
    isThunderstorm: false,
    hourly: [],
    daily: [],
    fetchedAt: '2026-11-13T10:00:00.000Z',
    isStale: false,
    source: 'Open-Meteo Live API',
    ...overrides,
  };
}

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'INC-TEST-1',
    title: 'Feeder Trip at Banjara Hills',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    locationName: 'Banjara Hills SS',
    lat: 17.41,
    lng: 78.44,
    severity: 'High',
    faultType: 'Feeder Trip',
    description: 'Tripped 11kV feeder',
    source: 'Manually Entered Data',
    status: 'Reported',
    assignedCrewId: null,
    assignedCrewName: null,
    affectedConsumers: 1800,
    restorationNotes: '',
    createdAt: '2026-11-13T09:00:00.000Z',
    updatedAt: '2026-11-13T09:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    id: 'ALT-1',
    dedupeKey: 'risk:hyderabad',
    type: 'risk_threshold',
    severity: 'Moderate',
    status: 'New',
    title: 'Sample Alert',
    message: 'Sample message',
    explanation: 'Sample explanation',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    incidentId: null,
    incidentTitle: null,
    assignedCrewId: null,
    assignedCrewName: null,
    provenance: 'Derived Prediction',
    isOfficialWarning: false,
    isRead: false,
    createdAt: '2026-11-13T10:00:00.000Z',
    updatedAt: '2026-11-13T10:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

test('normalizeAlertSeverity and normalizeAlertStatus handle legacy and current values', () => {
  assert.equal(normalizeAlertSeverity('critical'), 'Critical');
  assert.equal(normalizeAlertSeverity('HIGH'), 'High');
  assert.equal(normalizeAlertSeverity('warning'), 'Moderate');
  assert.equal(normalizeAlertSeverity('medium'), 'Moderate');
  assert.equal(normalizeAlertSeverity('info'), 'Informational');

  assert.equal(normalizeAlertStatus(undefined, false), 'New');
  assert.equal(normalizeAlertStatus(undefined, true), 'Acknowledged');
  assert.equal(normalizeAlertStatus('assigned', false), 'Assigned');
  assert.equal(normalizeAlertStatus('resolved', true), 'Resolved');
});

test('sortAlertsByPriority orders active before resolved and Critical > High > Moderate > Informational', () => {
  const alerts: AlertItem[] = [
    makeAlert({ id: '1', severity: 'Critical', status: 'Resolved' }),
    makeAlert({ id: '2', severity: 'Informational', status: 'New' }),
    makeAlert({ id: '3', severity: 'High', status: 'Assigned' }),
    makeAlert({ id: '4', severity: 'High', status: 'New' }),
    makeAlert({ id: '5', severity: 'Critical', status: 'Acknowledged' }),
    makeAlert({ id: '6', severity: 'Moderate', status: 'New' }),
  ];

  const sorted = sortAlertsByPriority(alerts);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['5', '4', '3', '6', '2', '1']
  );
});

test('computeAlertSummary calculates synchronized unread, active, severity, and status counts', () => {
  const summary = computeAlertSummary([
    makeAlert({ id: '1', severity: 'Critical', status: 'New', isRead: false }),
    makeAlert({ id: '2', severity: 'High', status: 'Acknowledged', isRead: true }),
    makeAlert({ id: '3', severity: 'Moderate', status: 'Assigned', isRead: true }),
    makeAlert({ id: '4', severity: 'Informational', status: 'Resolved', isRead: true }),
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.unread, 1);
  assert.equal(summary.active, 3);
  assert.deepEqual(summary.bySeverity, {
    Critical: 1,
    High: 1,
    Moderate: 1,
    Informational: 1,
  });
  assert.deepEqual(summary.byStatus, {
    New: 1,
    Acknowledged: 1,
    Assigned: 1,
    Resolved: 1,
  });
});

test('evaluateAlertRules produces Moderate/High/Critical risk alerts and skips UNAVAILABLE telemetry', () => {
  const res = evaluateAlertRules({
    assessments: [
      makeRisk({ districtId: 'hyderabad', districtName: 'Hyderabad', score: 85 }),
      makeRisk({ districtId: 'warangal', districtName: 'Warangal', score: 65 }),
      makeRisk({ districtId: 'nizamabad', districtName: 'Nizamabad', score: 35 }),
      makeRisk({ districtId: 'karimnagar', districtName: 'Karimnagar', score: 18 }),
      makeRisk({
        districtId: 'khammam',
        districtName: 'Khammam',
        score: 90,
        confidence: 'UNAVAILABLE',
      }),
    ],
    weatherList: [],
    incidents: [],
    config: baseConfig,
  });

  const hyd = res.candidates.find((c) => c.dedupeKey === 'risk:hyderabad');
  const wgl = res.candidates.find((c) => c.dedupeKey === 'risk:warangal');
  const nzb = res.candidates.find((c) => c.dedupeKey === 'risk:nizamabad');
  const khm = res.candidates.find((c) => c.dedupeKey === 'risk:khammam');

  assert.equal(hyd?.severity, 'Critical');
  assert.equal(wgl?.severity, 'High');
  assert.equal(nzb?.severity, 'Moderate');
  assert.equal(khm, undefined);
  assert.ok(res.autoResolveKeys.includes('risk:karimnagar'));
});

test('evaluateAlertRules evaluates weather thresholds and auto-resolves clear conditions', () => {
  const res = evaluateAlertRules({
    assessments: [
      makeRisk({ districtId: 'hyderabad', districtName: 'Hyderabad', score: 25 }),
      makeRisk({ districtId: 'warangal', districtName: 'Warangal', score: 20 }),
    ],
    weatherList: [
      makeWeather({
        districtId: 'hyderabad',
        districtName: 'Hyderabad',
        windGustsKmh: 56,
        rainMm: 16,
        isThunderstorm: true,
        weatherLabel: 'Thunderstorm',
      }),
      makeWeather({
        districtId: 'warangal',
        districtName: 'Warangal',
        windGustsKmh: 15,
        rainMm: 0,
        isThunderstorm: false,
      }),
    ],
    incidents: [],
    config: baseConfig,
  });

  const hydWeather = res.candidates.find((c) => c.dedupeKey === 'weather:hyderabad');
  assert.equal(hydWeather?.severity, 'Critical');
  assert.ok(hydWeather?.explanation.includes('distinct from official IMD'));
  assert.ok(res.autoResolveKeys.includes('weather:warangal'));
});

test('evaluateAlertRules maintains stable dedupeKeys across time and transitions on crew assign / restore', () => {
  const inc = makeIncident({
    id: 'INC-42',
    createdAt: '2026-11-13T08:00:00.000Z',
    severity: 'Critical',
  });

  // At +45 min: active + unassigned SLA triggered
  const t1 = evaluateAlertRules({
    assessments: [],
    weatherList: [],
    incidents: [inc],
    config: baseConfig,
    nowMs: new Date('2026-11-13T08:45:00.000Z').getTime(),
  });

  // At +90 min: same dedupeKeys even though ageMinutes changed
  const t2 = evaluateAlertRules({
    assessments: [],
    weatherList: [],
    incidents: [inc],
    config: baseConfig,
    nowMs: new Date('2026-11-13T09:30:00.000Z').getTime(),
  });

  assert.deepEqual(
    t1.candidates.map((c) => c.dedupeKey).sort(),
    ['incident:active:INC-42', 'incident:unassigned:INC-42']
  );
  assert.deepEqual(
    t2.candidates.map((c) => c.dedupeKey).sort(),
    ['incident:active:INC-42', 'incident:unassigned:INC-42']
  );

  // Assign a crew at +150 min (breaches restorationDelayMinutes=120)
  const assigned = evaluateAlertRules({
    assessments: [],
    weatherList: [],
    incidents: [
      {
        ...inc,
        status: 'Assigned',
        assignedCrewId: 'CREW-1',
        assignedCrewName: 'Hyderabad Rapid Line Team A',
      },
    ],
    config: baseConfig,
    nowMs: new Date('2026-11-13T10:30:00.000Z').getTime(),
  });

  const activeAssigned = assigned.candidates.find((c) => c.dedupeKey === 'incident:active:INC-42');
  const delayAssigned = assigned.candidates.find((c) => c.dedupeKey === 'incident:delay:INC-42');
  assert.equal(activeAssigned?.suggestedStatus, 'Assigned');
  assert.equal(activeAssigned?.assignedCrewName, 'Hyderabad Rapid Line Team A');
  assert.equal(delayAssigned?.suggestedStatus, 'Assigned');
  assert.ok(assigned.autoResolveKeys.includes('incident:unassigned:INC-42'));

  // Restored incident resolves all linked incident alert keys
  const restored = evaluateAlertRules({
    assessments: [],
    weatherList: [],
    incidents: [{ ...inc, status: 'Restored', resolvedAt: '2026-11-13T10:45:00.000Z' }],
    config: baseConfig,
  });

  assert.equal(restored.candidates.length, 0);
  assert.ok(restored.autoResolveKeys.includes('incident:active:INC-42'));
  assert.ok(restored.autoResolveKeys.includes('incident:unassigned:INC-42'));
  assert.ok(restored.autoResolveKeys.includes('incident:delay:INC-42'));
});

test('shouldEscalateSeverity detects only upward severity changes', () => {
  assert.equal(shouldEscalateSeverity('Moderate', 'High'), true);
  assert.equal(shouldEscalateSeverity('High', 'Critical'), true);
  assert.equal(shouldEscalateSeverity('Critical', 'High'), false);
  assert.equal(shouldEscalateSeverity('High', 'High'), false);
});
