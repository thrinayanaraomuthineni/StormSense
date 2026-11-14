import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackRouteEstimate,
  canAssignCrewToIncident,
  haversineDistanceKm,
  recommendCrewsForIncident,
} from './crewDispatch';
import type { Crew, Incident, RouteEstimate } from './types';

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'INC-1001',
    title: '33kV Feeder Trip near Uppal',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    locationName: 'Uppal Substation',
    lat: 17.4058,
    lng: 78.5591,
    severity: 'Critical',
    faultType: 'HT Line Snap',
    description: 'Conductor snapped during squall',
    source: 'Simulated Demonstration Data',
    status: 'Reported',
    assignedCrewId: null,
    affectedConsumers: 4200,
    restorationNotes: '',
    createdAt: '2026-11-13T10:00:00.000Z',
    updatedAt: '2026-11-13T10:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeCrew(overrides: Partial<Crew> = {}): Crew {
  return {
    id: 'CREW-HYD',
    name: 'Hyderabad HT Alpha',
    districtId: 'hyderabad',
    districtName: 'Hyderabad',
    baseLocation: 'Habsiguda Yard',
    lat: 17.416,
    lng: 78.544,
    members: 5,
    skills: ['HT Restoration', '132kV/33kV Line', 'Tree Clearing'],
    availability: 'Available',
    status: 'Ready at Depot',
    activeIncidentId: null,
    completedJobs: 19,
    locationSource: 'Simulated Demonstration Data',
    updatedAt: '2026-11-13T09:00:00.000Z',
    ...overrides,
  };
}

test('haversineDistanceKm computes accurate Hyderabad-Warangal distance (~130-145 km)', () => {
  const km = haversineDistanceKm(17.385, 78.4867, 17.9689, 79.5941);
  assert.ok(km > 125 && km < 150, `Expected ~134 km, got ${km}`);
});

test('buildFallbackRouteEstimate explicitly marks straight-line fallback ETA', () => {
  const est = buildFallbackRouteEstimate(17.416, 78.544, 17.4058, 78.5591);
  assert.equal(est.routingMode, 'haversine_estimate');
  assert.match(est.etaLabel, /straight-line fallback/i);
  assert.ok(est.distanceKm >= est.straightLineKm);
  assert.ok(est.estimatedEtaMinutes > est.travelMinutes);
  assert.equal(est.routeCoordinates.length, 2);
});

test('recommendCrewsForIncident prioritizes available, nearby, skill-matched crews with transparent score sum', () => {
  const incident = makeIncident();
  const crews: Crew[] = [
    makeCrew({
      id: 'CREW-FAR',
      name: 'Adilabad Mobile Unit',
      districtId: 'adilabad',
      districtName: 'Adilabad',
      baseLocation: 'Adilabad Depot',
      lat: 19.6641,
      lng: 78.532,
      members: 4,
      skills: ['11kV Line'],
      availability: 'Deployed',
      status: 'On Site - Restoring',
      activeIncidentId: 'INC-999',
      completedJobs: 12,
    }),
    makeCrew(),
  ];

  const ranked = recommendCrewsForIncident(incident, crews);
  assert.equal(ranked[0].crew.id, 'CREW-HYD');
  assert.ok(ranked[0].matchScore > ranked[1].matchScore);
  assert.ok(ranked[0].straightLineKm < 5);
  assert.equal(ranked[0].isAssignable, true);
  assert.equal(ranked[1].isAssignable, false);

  for (const rec of ranked) {
    const sum = rec.scoreBreakdown.reduce((acc, f) => acc + f.points, 0);
    assert.equal(rec.matchScore, sum, `Score breakdown sum (${sum}) must match matchScore (${rec.matchScore})`);
  }
});

test('recommendCrewsForIncident incorporates OSRM road route overrides when available', () => {
  const incident = makeIncident();
  const crew = makeCrew();
  const roadRoute: RouteEstimate = {
    distanceKm: 6.4,
    straightLineKm: 2.0,
    travelMinutes: 14,
    estimatedEtaMinutes: 22,
    routingMode: 'osrm_road',
    etaLabel: 'Road route (~22 min incl. 8m prep)',
    routeCoordinates: [
      [17.416, 78.544],
      [17.41, 78.55],
      [17.4058, 78.5591],
    ],
  };

  const ranked = recommendCrewsForIncident(incident, [crew], new Map([[crew.id, roadRoute]]));
  assert.equal(ranked[0].routingMode, 'osrm_road');
  assert.equal(ranked[0].distanceKm, 6.4);
  assert.equal(ranked[0].estimatedEtaMinutes, 22);
  assert.equal(ranked[0].routeCoordinates.length, 3);
  assert.match(ranked[0].etaLabel, /Road route/i);
});

test('canAssignCrewToIncident blocks Off-Duty and incompatible simultaneous incidents', () => {
  const targetMedium = makeIncident({ id: 'INC-MED', severity: 'Medium', status: 'Reported' });
  const activeCritical = makeIncident({ id: 'INC-CRIT', severity: 'Critical', status: 'Assigned' });
  const activeLow = makeIncident({ id: 'INC-LOW', severity: 'Low', status: 'Assigned' });
  const restored = makeIncident({ id: 'INC-DONE', status: 'Restored' });

  const offDutyCrew = makeCrew({ availability: 'Off-Duty', status: 'Shift Completed' });
  assert.equal(canAssignCrewToIncident(offDutyCrew, targetMedium, [targetMedium]).allowed, false);
  assert.equal(canAssignCrewToIncident(offDutyCrew, targetMedium, [targetMedium]).canForceReassign, false);

  const lockedOnCritical = makeCrew({
    availability: 'Deployed',
    status: 'En Route',
    activeIncidentId: 'INC-CRIT',
  });
  const criticalConflict = canAssignCrewToIncident(
    lockedOnCritical,
    targetMedium,
    [targetMedium, activeCritical],
    true
  );
  assert.equal(criticalConflict.allowed, false);
  assert.equal(criticalConflict.canForceReassign, false);
  assert.match(criticalConflict.reason ?? '', /Critical incident INC-CRIT/i);

  const busyOnLow = makeCrew({
    availability: 'Deployed',
    status: 'En Route',
    activeIncidentId: 'INC-LOW',
  });
  const withoutForce = canAssignCrewToIncident(busyOnLow, targetMedium, [targetMedium, activeLow], false);
  assert.equal(withoutForce.allowed, false);
  assert.equal(withoutForce.canForceReassign, true);

  const withForce = canAssignCrewToIncident(busyOnLow, targetMedium, [targetMedium, activeLow], true);
  assert.equal(withForce.allowed, true);

  const availCrew = makeCrew();
  assert.equal(canAssignCrewToIncident(availCrew, restored, [restored]).allowed, false);
});
