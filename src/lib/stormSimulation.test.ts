import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDistrictRisk } from './riskEngine';
import {
  STORM_PRESETS,
  buildSimulationCsvReport,
  buildSimulationJsonReport,
  buildSimulationTimeline,
  computeStormImpactForDistricts,
  createBaselineParams,
  createParamsFromPreset,
} from './stormSimulation';
import { TELANGANA_DISTRICTS } from './telanganaDistricts';
import type { Crew, Incident, WeatherObservation } from './types';

function makeCalmWeather(): WeatherObservation[] {
  const now = new Date().toISOString();
  return TELANGANA_DISTRICTS.map((d) => ({
    districtId: d.id,
    districtName: d.name,
    lat: d.lat,
    lng: d.lng,
    temperatureC: 31,
    relativeHumidity: 48,
    precipitationMm: 0,
    rainMm: 0,
    precipitationProbability: 10,
    windSpeedKmh: 9,
    windGustsKmh: 16,
    surfacePressureHpa: 1009,
    weatherCode: 1,
    weatherLabel: 'Mainly clear',
    isThunderstorm: false,
    hourly: [],
    daily: [],
    fetchedAt: now,
    isStale: false,
    source: 'Open-Meteo Live API',
  }));
}

const SAMPLE_INCIDENTS: Incident[] = [
  {
    id: 'INC-TEST-1',
    title: 'Test Feeder Breaker',
    districtId: 'khammam',
    districtName: 'Khammam',
    locationName: 'Tallada Yard',
    lat: 17.24,
    lng: 80.15,
    severity: 'High',
    faultType: 'Feeder Trip',
    description: 'Test incident',
    source: 'Simulated Demonstration Data',
    status: 'Reported',
    assignedCrewId: null,
    affectedConsumers: 1200,
    restorationNotes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
  },
];

const SAMPLE_CREWS: Crew[] = [
  {
    id: 'CRW-TEST-1',
    name: 'Khammam Rapid Unit',
    districtId: 'khammam',
    districtName: 'Khammam',
    baseLocation: 'Khammam Depot',
    lat: 17.24,
    lng: 80.16,
    members: 5,
    skills: ['HT Restoration'],
    availability: 'Available',
    status: 'Ready at Depot',
    activeIncidentId: null,
    completedJobs: 10,
    locationSource: 'Simulated Demonstration Data',
    updatedAt: new Date().toISOString(),
  },
];

test('all four predefined storm presets produce higher risk scores than calm baseline without mutating inputs', () => {
  const calmWeather = makeCalmWeather();
  const baseline = TELANGANA_DISTRICTS.map((d) =>
    assessDistrictRisk(d, calmWeather.find((w) => w.districtId === d.id), d.id === 'khammam' ? 1 : 0)
  );
  const baselineSnapshot = JSON.stringify(baseline);

  for (const preset of STORM_PRESETS) {
    const params = createParamsFromPreset(preset.id, 'khammam');
    const impacts = computeStormImpactForDistricts({
      params,
      districts: TELANGANA_DISTRICTS,
      baselineAssessments: baseline,
      weatherObservations: calmWeather,
      incidents: SAMPLE_INCIDENTS,
      crews: SAMPLE_CREWS,
    });

    const target = impacts.find((i) => i.district.id === 'khammam');
    assert.ok(target, `Target district impact missing for preset ${preset.id}`);
    assert.ok(
      target.simulatedAssessment.score > target.baselineAssessment.score,
      `Expected ${preset.id} simulated score (${target.simulatedAssessment.score}) > baseline (${target.baselineAssessment.score})`
    );
    assert.equal(target.deltaScore, target.simulatedAssessment.score - target.baselineAssessment.score);
    assert.ok(target.simulatedAssessment.preventiveActions.length > 0);
    assert.ok(
      target.simulatedAssessment.dataQualityFlags.some((f) => f.includes('HYPOTHETICAL SIMULATED SCENARIO'))
    );
    const rainContrib = target.simulatedAssessment.contributions.find((c) => c.factor === 'rainfall');
    assert.equal(rainContrib?.dataStatus, 'Simulated');
  }

  assert.equal(JSON.stringify(baseline), baselineSnapshot);
});

test('spatial attenuation decreases impact with distance from target district and exposes infrastructure estimates', () => {
  const calmWeather = makeCalmWeather();
  const baseline = TELANGANA_DISTRICTS.map((d) =>
    assessDistrictRisk(d, calmWeather.find((w) => w.districtId === d.id), 0)
  );
  const params = createParamsFromPreset('combined_extreme', 'hyderabad');
  const impacts = computeStormImpactForDistricts({
    params,
    districts: TELANGANA_DISTRICTS,
    baselineAssessments: baseline,
    weatherObservations: calmWeather,
    incidents: SAMPLE_INCIDENTS,
    crews: SAMPLE_CREWS,
  });

  const hyd = impacts.find((i) => i.district.id === 'hyderabad')!;
  const rangareddy = impacts.find((i) => i.district.id === 'rangareddy')!;
  const adilabad = impacts.find((i) => i.district.id === 'adilabad')!;

  assert.equal(hyd.attenuationFactor, 1);
  assert.ok(rangareddy.attenuationFactor > adilabad.attenuationFactor);
  assert.ok(hyd.deltaScore > adilabad.deltaScore);
  assert.ok(hyd.vulnerableInfrastructure.exposedSubstationsEst > 0);
  assert.ok(hyd.vulnerableInfrastructure.exposedSubstationsEst <= hyd.vulnerableInfrastructure.substationCount);
});

test('createBaselineParams matches current live weather conditions', () => {
  const calm = makeCalmWeather()[0];
  const baseParams = createBaselineParams(calm.districtId, calm);
  assert.equal(baseParams.rainfallMm, 0);
  assert.equal(baseParams.windSpeedKmh, 9);
  assert.equal(baseParams.windGustsKmh, 16);
  assert.equal(baseParams.stormSeverity, 'Moderate');
  assert.equal(baseParams.isThunderstorm, false);
});

test('buildSimulationTimeline produces 13 steps peaking over target district at T+3.0h', () => {
  const calmWeather = makeCalmWeather();
  const baseline = TELANGANA_DISTRICTS.map((d) =>
    assessDistrictRisk(d, calmWeather.find((w) => w.districtId === d.id), 0)
  );
  const params = createParamsFromPreset('severe_thunderstorm', 'warangal');
  const timeline = buildSimulationTimeline({
    params,
    districts: TELANGANA_DISTRICTS,
    baselineAssessments: baseline,
    weatherObservations: calmWeather,
    incidents: SAMPLE_INCIDENTS,
    crews: SAMPLE_CREWS,
  });

  assert.equal(timeline.length, 13);
  assert.equal(timeline[0].label, 'T+0.0h');
  assert.equal(timeline[6].label, 'T+3.0h');
  assert.equal(timeline[12].label, 'T+6.0h');

  const warangal = TELANGANA_DISTRICTS.find((d) => d.id === 'warangal')!;
  assert.equal(timeline[6].stormCenterLat, warangal.lat);
  assert.equal(timeline[6].stormCenterLng, warangal.lng);
  assert.ok(timeline[6].targetSimulatedScore >= timeline[0].targetSimulatedScore);
  assert.ok(timeline[6].targetSimulatedScore >= timeline[12].targetSimulatedScore);
  assert.ok(timeline[6].elevatedDistrictCount >= 1);
});

test('CSV and JSON simulation reports include explicit hypothetical scenario disclaimers', () => {
  const calmWeather = makeCalmWeather();
  const baseline = TELANGANA_DISTRICTS.map((d) =>
    assessDistrictRisk(d, calmWeather.find((w) => w.districtId === d.id), 0)
  );
  const params = createParamsFromPreset('heavy_rainfall', 'nizamabad');
  const impacts = computeStormImpactForDistricts({
    params,
    districts: TELANGANA_DISTRICTS,
    baselineAssessments: baseline,
    weatherObservations: calmWeather,
    incidents: [],
    crews: [],
  });
  const timeline = buildSimulationTimeline({
    params,
    districts: TELANGANA_DISTRICTS,
    baselineAssessments: baseline,
    weatherObservations: calmWeather,
    incidents: [],
    crews: [],
  });

  const csv = buildSimulationCsvReport({
    scenarioName: 'Monsoon Feeder Test',
    params,
    impacts,
  });
  assert.ok(csv.includes('HYPOTHETICAL SIMULATED SCENARIO REPORT'));
  assert.ok(csv.includes('Nizamabad'));

  const json = JSON.parse(
    buildSimulationJsonReport({
      scenarioName: 'Monsoon Feeder Test',
      params,
      impacts,
      timeline,
    })
  );
  assert.ok(String(json.disclaimer).includes('HYPOTHETICAL SIMULATED SCENARIO'));
  assert.equal(json.districtComparisons.length, TELANGANA_DISTRICTS.length);
  assert.equal(json.timelineSummary.length, 13);
});
