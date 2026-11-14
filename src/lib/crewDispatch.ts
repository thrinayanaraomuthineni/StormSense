import type {
  Crew,
  CrewMatchFactor,
  CrewRecommendation,
  FaultType,
  Incident,
  IncidentSeverity,
  RouteEstimate,
} from './types';

const EARTH_RADIUS_KM = 6371;
export const DEFAULT_MOBILIZATION_MINUTES = 8;
export const FALLBACK_ROAD_DETOUR_FACTOR = 1.28;
export const FALLBACK_AVG_SPEED_KMH = 36;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

export function buildFallbackRouteEstimate(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  fallbackReason = 'Road routing service unavailable; using straight-line detour estimate',
  mobilizationMinutes = DEFAULT_MOBILIZATION_MINUTES
): RouteEstimate {
  const straightLineKm = haversineDistanceKm(fromLat, fromLng, toLat, toLng);
  const distanceKm =
    straightLineKm === 0 ? 0 : Math.round(straightLineKm * FALLBACK_ROAD_DETOUR_FACTOR * 10) / 10;
  const travelMinutes =
    distanceKm === 0 ? 1 : Math.max(2, Math.round((distanceKm / FALLBACK_AVG_SPEED_KMH) * 60));
  const estimatedEtaMinutes = travelMinutes + mobilizationMinutes;

  return {
    distanceKm,
    straightLineKm,
    travelMinutes,
    estimatedEtaMinutes,
    routingMode: 'haversine_estimate',
    etaLabel: `Estimated ETA (~${estimatedEtaMinutes} min · straight-line fallback)`,
    routeCoordinates: [
      [fromLat, fromLng],
      [toLat, toLng],
    ],
    fallbackReason,
  };
}

export const FAULT_SKILL_MAP: Record<FaultType, string[]> = {
  'Feeder Trip': ['33kV Feeder', 'HT Restoration', 'Fault Isolation'],
  'Transformer Fault': ['Distribution Transformer', 'Substation', 'HT Restoration'],
  'HT Line Snap': ['HT Restoration', '132kV/33kV Line', 'Tree Clearing'],
  'Substation Breaker': ['Substation', 'Protection Relay', '33kV Feeder'],
  'Vegetation Contact': ['Tree Clearing', '11kV Line', '33kV Feeder'],
  'Lightning Surge': ['Protection Relay', 'Substation', 'HT Restoration'],
};

const SEVERITY_PRIORITY: Record<IncidentSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

export interface AssignmentCompatibilityResult {
  allowed: boolean;
  canForceReassign: boolean;
  reason: string | null;
}

export function canAssignCrewToIncident(
  crew: Crew,
  targetIncident: Incident,
  allIncidents: Incident[] = [],
  forceReassign = false
): AssignmentCompatibilityResult {
  if (targetIncident.status === 'Restored' || targetIncident.status === 'Closed') {
    return {
      allowed: false,
      canForceReassign: false,
      reason: `Incident ${targetIncident.id} is already ${targetIncident.status} and cannot receive a new dispatch.`,
    };
  }

  if (crew.availability === 'Off-Duty' || crew.status === 'Shift Completed') {
    return {
      allowed: false,
      canForceReassign: false,
      reason: `${crew.name} is currently ${crew.availability} (${crew.status}). Change availability before dispatching.`,
    };
  }

  if (crew.activeIncidentId && crew.activeIncidentId !== targetIncident.id) {
    const otherIncident = allIncidents.find((i) => i.id === crew.activeIncidentId);
    const otherIsActive =
      otherIncident !== undefined
        ? otherIncident.status !== 'Restored' && otherIncident.status !== 'Closed'
        : true;

    if (otherIsActive) {
      if (
        otherIncident &&
        SEVERITY_PRIORITY[otherIncident.severity] > SEVERITY_PRIORITY[targetIncident.severity] &&
        otherIncident.severity === 'Critical'
      ) {
        return {
          allowed: false,
          canForceReassign: false,
          reason: `Incompatible simultaneous assignment: ${crew.name} is locked on Critical incident ${otherIncident.id} (${otherIncident.districtName}) and cannot be diverted to ${targetIncident.severity} incident ${targetIncident.id}.`,
        };
      }

      if (
        otherIncident &&
        otherIncident.status === 'Under Maintenance' &&
        SEVERITY_PRIORITY[targetIncident.severity] <= SEVERITY_PRIORITY[otherIncident.severity]
      ) {
        return {
          allowed: false,
          canForceReassign: false,
          reason: `Incompatible simultaneous assignment: ${crew.name} is actively restoring ${otherIncident.id} (${otherIncident.severity} · On Site). Complete or reassign ${otherIncident.id} first.`,
        };
      }

      if (!forceReassign) {
        const desc = otherIncident
          ? `${otherIncident.id} (${otherIncident.severity} · ${otherIncident.status})`
          : crew.activeIncidentId;
        return {
          allowed: false,
          canForceReassign: true,
          reason: `${crew.name} is already assigned to ${desc}. Use "Pull & Reassign" to release the prior incident explicitly.`,
        };
      }
    }
  }

  return {
    allowed: true,
    canForceReassign: false,
    reason: null,
  };
}

export function recommendCrewsForIncident(
  incident: Incident,
  crews: Crew[],
  routeOverrides?: Map<string, RouteEstimate>,
  allIncidents: Incident[] = []
): CrewRecommendation[] {
  const desiredSkills = FAULT_SKILL_MAP[incident.faultType] ?? ['HT Restoration'];
  const avgCompleted =
    crews.length > 0 ? crews.reduce((acc, c) => acc + c.completedJobs, 0) / crews.length : 15;

  return crews
    .map((crew) => {
      const route =
        routeOverrides?.get(crew.id) ??
        buildFallbackRouteEstimate(crew.lat, crew.lng, incident.lat, incident.lng);

      const compatibility = canAssignCrewToIncident(crew, incident, allIncidents, false);
      const isAssignedHere = crew.activeIncidentId === incident.id || incident.assignedCrewId === crew.id;

      const reasons: string[] = [];

      // 1. Availability & Readiness (max 35)
      let availabilityPoints = 0;
      let availabilityDetail = '';
      if (isAssignedHere) {
        availabilityPoints = 32;
        availabilityDetail = `Currently assigned to ${incident.id} (${crew.status})`;
        reasons.push(`Currently assigned (${crew.status})`);
      } else if (crew.availability === 'Available' && !crew.activeIncidentId) {
        availabilityPoints = 35;
        availabilityDetail = 'Immediately available at depot with no active conflict';
        reasons.push('Immediately available at depot');
      } else if (crew.availability === 'Standby' && !crew.activeIncidentId) {
        availabilityPoints = 25;
        availabilityDetail = 'On standby reserve; ready to mobilize';
        reasons.push('On standby reserve');
      } else if (crew.availability === 'Deployed' || crew.activeIncidentId) {
        availabilityPoints = compatibility.canForceReassign ? 10 : 4;
        availabilityDetail = compatibility.reason || `Deployed on ${crew.activeIncidentId}`;
        reasons.push(`Assigned to ${crew.activeIncidentId || 'another task'}`);
      } else {
        availabilityPoints = 0;
        availabilityDetail = `Off-duty (${crew.status})`;
        reasons.push('Off-duty shift');
      }

      // 2. Road Distance & Travel ETA (max 25)
      const etaPenalty = route.estimatedEtaMinutes * 0.14;
      const distancePoints = Math.max(0, Math.min(25, Math.round(25 - etaPenalty)));
      const routeMethodText =
        route.routingMode === 'osrm_road'
          ? `${route.distanceKm} km road route (~${route.estimatedEtaMinutes} min incl. ${DEFAULT_MOBILIZATION_MINUTES}m prep)`
          : `${route.distanceKm} km est. (${route.straightLineKm} km straight-line · ~${route.estimatedEtaMinutes} min ETA)`;
      reasons.push(routeMethodText);

      // 3. Technical Skill Alignment (max 20)
      const matchedSkills = crew.skills.filter((skill) =>
        desiredSkills.some(
          (ds) =>
            skill.toLowerCase().includes(ds.toLowerCase()) ||
            ds.toLowerCase().includes(skill.toLowerCase())
        )
      );
      const skillPoints =
        matchedSkills.length >= 3
          ? 20
          : matchedSkills.length === 2
            ? 15
            : matchedSkills.length === 1
              ? 9
              : 0;
      const skillDetail =
        matchedSkills.length > 0
          ? `Matches ${matchedSkills.length}/${desiredSkills.length} required skills: ${matchedSkills.join(', ')}`
          : `No direct match for ${incident.faultType} (${desiredSkills.join(', ')})`;
      if (matchedSkills.length > 0) {
        reasons.push(`Skill match: ${matchedSkills.join(', ')}`);
      }

      // 4. Severity & Team Capacity Fit (max 10)
      let capacityPoints = 0;
      const capacityNotes: string[] = [];
      if (crew.districtId === incident.districtId) {
        capacityPoints += 5;
        capacityNotes.push(`Stationed in ${incident.districtName}`);
        reasons.push(`Stationed in ${incident.districtName}`);
      }
      if (incident.severity === 'Critical' || incident.severity === 'High') {
        if (crew.members >= 5) {
          capacityPoints += 5;
          capacityNotes.push(`${crew.members}-member heavy crew fit for ${incident.severity} fault`);
          reasons.push(`${crew.members}-member heavy response team`);
        } else if (crew.members >= 4) {
          capacityPoints += 3;
          capacityNotes.push(`${crew.members}-member crew adequate for ${incident.severity} fault`);
        } else {
          capacityPoints += 1;
          capacityNotes.push(`Light ${crew.members}-member crew for ${incident.severity} fault`);
        }
      } else {
        capacityPoints += crew.members >= 3 ? 5 : 3;
        capacityNotes.push(`${crew.members}-member crew fit for ${incident.severity} fault`);
      }

      // 5. Workload & Fatigue Balance (max 10)
      let workloadPoints = 0;
      const hasOtherActiveJob = Boolean(crew.activeIncidentId && crew.activeIncidentId !== incident.id);
      if (hasOtherActiveJob) {
        workloadPoints = 0;
      } else if (crew.completedJobs <= avgCompleted) {
        workloadPoints = 10;
      } else if (crew.completedJobs <= avgCompleted + 6) {
        workloadPoints = 7;
      } else {
        workloadPoints = 4;
      }
      const workloadSummary = isAssignedHere
        ? `Assigned to ${incident.id} · ${crew.completedJobs} completed (fleet avg ${Math.round(avgCompleted)})`
        : hasOtherActiveJob
          ? `Busy on ${crew.activeIncidentId} · ${crew.completedJobs} completed jobs`
          : `0 active jobs · ${crew.completedJobs} completed (fleet avg ${Math.round(avgCompleted)})`;

      const scoreBreakdown: CrewMatchFactor[] = [
        {
          factor: 'availability',
          label: 'Availability & Readiness',
          points: availabilityPoints,
          maxPoints: 35,
          detail: availabilityDetail,
        },
        {
          factor: 'distance_eta',
          label: route.routingMode === 'osrm_road' ? 'Road Distance & ETA' : 'Estimated Distance & ETA',
          points: distancePoints,
          maxPoints: 25,
          detail: routeMethodText,
        },
        {
          factor: 'skills',
          label: 'Technical Skill Fit',
          points: skillPoints,
          maxPoints: 20,
          detail: skillDetail,
        },
        {
          factor: 'severity_capacity',
          label: 'District & Severity Fit',
          points: capacityPoints,
          maxPoints: 10,
          detail: capacityNotes.join('; ') || `${crew.members}-member unit`,
        },
        {
          factor: 'workload',
          label: 'Workload Balance',
          points: workloadPoints,
          maxPoints: 10,
          detail: workloadSummary,
        },
      ];

      const matchScore = Math.max(
        0,
        Math.min(
          100,
          scoreBreakdown.reduce((sum, item) => sum + item.points, 0)
        )
      );

      return {
        crew,
        distanceKm: route.distanceKm,
        straightLineKm: route.straightLineKm,
        travelMinutes: route.travelMinutes,
        estimatedEtaMinutes: route.estimatedEtaMinutes,
        routingMode: route.routingMode,
        etaLabel: route.etaLabel,
        routeCoordinates: route.routeCoordinates,
        fallbackReason: route.fallbackReason,
        matchScore,
        scoreBreakdown,
        matchedSkills,
        isAssignable: isAssignedHere ? true : compatibility.allowed,
        conflictReason: isAssignedHere ? null : compatibility.reason,
        canForceReassign: isAssignedHere ? false : compatibility.canForceReassign,
        workloadSummary,
        reasons,
      };
    })
    .sort((a, b) => {
      if (a.crew.id === incident.assignedCrewId) return -1;
      if (b.crew.id === incident.assignedCrewId) return 1;
      if (a.isAssignable !== b.isAssignable) return a.isAssignable ? -1 : 1;
      return b.matchScore - a.matchScore;
    });
}
