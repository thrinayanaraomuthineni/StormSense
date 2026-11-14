import type {
  AlertConfig,
  AlertItem,
  AlertLifecycleStatus,
  AlertSeverity,
  AlertType,
  Incident,
  RiskAssessment,
  WeatherObservation,
} from './types';
import { ALERT_SEVERITY_RANK } from './alertSummary';

export interface AlertCandidate {
  dedupeKey: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  explanation: string;
  districtId: string | null;
  districtName: string | null;
  incidentId: string | null;
  incidentTitle: string | null;
  assignedCrewId: string | null;
  assignedCrewName: string | null;
  provenance: AlertItem['provenance'];
  suggestedStatus?: AlertLifecycleStatus;
}

export interface AlertEvaluationResult {
  candidates: AlertCandidate[];
  autoResolveKeys: string[];
}

function summarizeTopRiskDrivers(risk: RiskAssessment): string {
  const drivers = risk.contributions
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((c) => `${c.label} (${c.rawValue}, +${c.points}/${c.maxPoints} pts)`);
  return drivers.length > 0 ? drivers.join('; ') : 'Baseline district grid exposure';
}

export function evaluateAlertRules(params: {
  assessments: RiskAssessment[];
  weatherList: WeatherObservation[];
  incidents: Incident[];
  config: AlertConfig;
  nowMs?: number;
}): AlertEvaluationResult {
  const { assessments, weatherList, incidents, config } = params;
  const nowMs = params.nowMs ?? Date.now();

  const weatherMap = new Map(weatherList.map((w) => [w.districtId, w]));
  const candidates: AlertCandidate[] = [];
  const autoResolveKeys: string[] = [];

  // 1. Evaluate Risk Engine Outputs against configured thresholds
  for (const risk of assessments) {
    const riskDedupeKey = `risk:${risk.districtId}`;

    // Do not generate speculative risk alerts if weather telemetry is completely unavailable
    if (risk.confidence === 'UNAVAILABLE') {
      continue;
    }

    const drivers = summarizeTopRiskDrivers(risk);

    if (risk.score >= config.criticalRiskThreshold) {
      candidates.push({
        dedupeKey: riskDedupeKey,
        type: 'critical_vulnerability',
        severity: 'Critical',
        title: `Critical Outage Risk Alert — ${risk.districtName}`,
        message: `Derived outage risk reached ${risk.score}/100 (Critical threshold ≥ ${config.criticalRiskThreshold}). ${risk.recommendedAction}`,
        explanation: `Rule-Based Heuristic Engine v1.0 scored ${risk.districtName} at ${risk.score}/100, crossing Critical threshold (${config.criticalRiskThreshold}). Drivers: ${drivers}. Application-generated risk alert (not an official IMD bulletin).`,
        districtId: risk.districtId,
        districtName: risk.districtName,
        incidentId: null,
        incidentTitle: null,
        assignedCrewId: null,
        assignedCrewName: null,
        provenance: 'Derived Prediction',
      });
    } else if (risk.score >= config.highRiskThreshold) {
      candidates.push({
        dedupeKey: riskDedupeKey,
        type: 'risk_threshold',
        severity: 'High',
        title: `High Outage Risk Alert — ${risk.districtName}`,
        message: `Derived outage risk reached ${risk.score}/100 (High threshold ≥ ${config.highRiskThreshold}). ${risk.recommendedAction}`,
        explanation: `Rule-Based Heuristic Engine v1.0 scored ${risk.districtName} at ${risk.score}/100, crossing High threshold (${config.highRiskThreshold}). Drivers: ${drivers}. Application-generated risk alert (not an official IMD bulletin).`,
        districtId: risk.districtId,
        districtName: risk.districtName,
        incidentId: null,
        incidentTitle: null,
        assignedCrewId: null,
        assignedCrewName: null,
        provenance: 'Derived Prediction',
      });
    } else if (risk.score >= config.moderateRiskThreshold) {
      candidates.push({
        dedupeKey: riskDedupeKey,
        type: 'risk_threshold',
        severity: 'Moderate',
        title: `Moderate Outage Risk Watch — ${risk.districtName}`,
        message: `Derived outage risk is ${risk.score}/100 (Moderate threshold ≥ ${config.moderateRiskThreshold}). ${risk.recommendedAction}`,
        explanation: `Rule-Based Heuristic Engine v1.0 scored ${risk.districtName} at ${risk.score}/100, crossing Moderate threshold (${config.moderateRiskThreshold}). Drivers: ${drivers}. Application-generated risk alert (not an official IMD bulletin).`,
        districtId: risk.districtId,
        districtName: risk.districtName,
        incidentId: null,
        incidentTitle: null,
        assignedCrewId: null,
        assignedCrewName: null,
        provenance: 'Derived Prediction',
      });
    } else {
      autoResolveKeys.push(riskDedupeKey);
    }

    // 2. Evaluate Live Weather Telemetry against configured wind/rain thresholds
    const w = weatherMap.get(risk.districtId);
    const weatherDedupeKey = `weather:${risk.districtId}`;
    if (w && !w.errorMessage) {
      const windTriggered = w.windGustsKmh >= config.highWindThresholdKmh;
      const rainTriggered = w.rainMm >= config.heavyRainThresholdMm;
      const stormTriggered = w.isThunderstorm;

      if (windTriggered || rainTriggered || stormTriggered) {
        let severity: AlertSeverity = 'Moderate';
        if (
          stormTriggered &&
          (w.windGustsKmh >= config.highWindThresholdKmh * 1.25 ||
            w.rainMm >= config.heavyRainThresholdMm * 1.5)
        ) {
          severity = 'Critical';
        } else if (
          stormTriggered ||
          w.windGustsKmh >= config.highWindThresholdKmh * 1.2 ||
          w.rainMm >= config.heavyRainThresholdMm * 1.5
        ) {
          severity = 'High';
        }

        const triggers: string[] = [];
        if (windTriggered) {
          triggers.push(
            `gusts ${w.windGustsKmh.toFixed(0)} km/h (trigger ≥ ${config.highWindThresholdKmh} km/h)`
          );
        }
        if (rainTriggered) {
          triggers.push(
            `rainfall ${w.rainMm.toFixed(1)} mm/h (trigger ≥ ${config.heavyRainThresholdMm} mm/h)`
          );
        }
        if (stormTriggered) {
          triggers.push(`convective thunderstorm code (${w.weatherLabel})`);
        }

        candidates.push({
          dedupeKey: weatherDedupeKey,
          type: 'weather_deterioration',
          severity,
          title: `Weather Threshold Exceeded — ${risk.districtName}`,
          message: `Open-Meteo telemetry reports ${w.weatherLabel}: ${w.rainMm.toFixed(1)} mm/h rain, ${w.windGustsKmh.toFixed(0)} km/h gusts.`,
          explanation: `Triggered by ${triggers.join(', ')}. Observation confidence: ${w.isStale ? 'Stale Cache' : 'Live API Feed'}. Application-generated threshold alert; distinct from official IMD or government warnings.`,
          districtId: risk.districtId,
          districtName: risk.districtName,
          incidentId: null,
          incidentTitle: null,
          assignedCrewId: null,
          assignedCrewName: null,
          provenance: 'Live API Data',
        });
      } else {
        autoResolveKeys.push(weatherDedupeKey);
      }
    }
  }

  // 3. Evaluate Incident Operational & SLA Conditions
  for (const inc of incidents) {
    const activeKey = `incident:active:${inc.id}`;
    const unassignedKey = `incident:unassigned:${inc.id}`;
    const delayKey = `incident:delay:${inc.id}`;

    if (inc.status === 'Restored' || inc.status === 'Closed') {
      autoResolveKeys.push(activeKey, unassignedKey, delayKey);
      continue;
    }

    const incProvenance: AlertItem['provenance'] =
      inc.source === 'Manually Entered Data'
        ? 'Manually Entered Data'
        : inc.source === 'Externally Verified Feed'
          ? 'Live API Data'
          : 'Simulated Demonstration Data';

    const ageMinutes = Math.max(
      0,
      Math.round((nowMs - new Date(inc.createdAt).getTime()) / 60_000)
    );

    // Active incident lifecycle alert (for Critical/High incidents, or when a crew is assigned)
    if (inc.severity === 'Critical' || inc.severity === 'High' || inc.assignedCrewId) {
      const severity: AlertSeverity =
        inc.severity === 'Critical'
          ? 'Critical'
          : inc.severity === 'High'
            ? 'High'
            : inc.severity === 'Medium'
              ? 'Moderate'
              : 'Informational';

      candidates.push({
        dedupeKey: activeKey,
        type: inc.assignedCrewId ? 'crew_assignment' : 'incident_logged',
        severity,
        title: inc.assignedCrewId
          ? `Incident Crew Dispatched — ${inc.id}`
          : `${inc.severity} Incident Active — ${inc.id}`,
        message: `${inc.title} in ${inc.districtName} (${inc.affectedConsumers.toLocaleString('en-IN')} consumers) · Status: ${inc.status}${inc.assignedCrewName ? ` · Crew: ${inc.assignedCrewName}` : ''}.`,
        explanation: `${inc.faultType} at ${inc.locationName} (${inc.severity} severity). Lifecycle status is ${inc.status}${inc.assignedCrewName ? ` with ${inc.assignedCrewName} assigned` : ', awaiting crew assignment'}.`,
        districtId: inc.districtId,
        districtName: inc.districtName,
        incidentId: inc.id,
        incidentTitle: inc.title,
        assignedCrewId: inc.assignedCrewId,
        assignedCrewName: inc.assignedCrewName ?? null,
        provenance: incProvenance,
        suggestedStatus: inc.assignedCrewId ? 'Assigned' : undefined,
      });
    }

    // Unassigned incident SLA threshold
    if (!inc.assignedCrewId && ageMinutes >= config.unassignedAlertMinutes) {
      const severity: AlertSeverity =
        inc.severity === 'Critical'
          ? 'Critical'
          : inc.severity === 'High'
            ? 'High'
            : 'Moderate';

      candidates.push({
        dedupeKey: unassignedKey,
        type: 'unassigned_incident',
        severity,
        title: `Unassigned Incident SLA — ${inc.id}`,
        message: `${inc.title} in ${inc.districtName} has remained unassigned for ${ageMinutes} min (SLA ${config.unassignedAlertMinutes} min).`,
        explanation: `Incident ${inc.id} at ${inc.locationName} (${inc.severity}) has had no maintenance crew assigned for ${ageMinutes} minutes, exceeding the configured ${config.unassignedAlertMinutes}-minute dispatch threshold.`,
        districtId: inc.districtId,
        districtName: inc.districtName,
        incidentId: inc.id,
        incidentTitle: inc.title,
        assignedCrewId: null,
        assignedCrewName: null,
        provenance: incProvenance,
      });
    } else {
      autoResolveKeys.push(unassignedKey);
    }

    // Restoration SLA delay threshold
    if (ageMinutes >= config.restorationDelayMinutes) {
      const severity: AlertSeverity =
        inc.severity === 'Critical' || inc.severity === 'High' ? 'High' : 'Moderate';

      candidates.push({
        dedupeKey: delayKey,
        type: 'restoration_delay',
        severity,
        title: `Restoration SLA Exceeded — ${inc.id}`,
        message: `${inc.title} in ${inc.districtName} has been open ${ageMinutes} min (SLA ${config.restorationDelayMinutes} min).`,
        explanation: `Incident ${inc.id} at ${inc.locationName} remains in "${inc.status}" state after ${ageMinutes} minutes, breaching the configured ${config.restorationDelayMinutes}-minute restoration SLA window${inc.assignedCrewName ? ` (Assigned crew: ${inc.assignedCrewName})` : ''}.`,
        districtId: inc.districtId,
        districtName: inc.districtName,
        incidentId: inc.id,
        incidentTitle: inc.title,
        assignedCrewId: inc.assignedCrewId,
        assignedCrewName: inc.assignedCrewName ?? null,
        provenance: incProvenance,
        suggestedStatus: inc.assignedCrewId ? 'Assigned' : undefined,
      });
    } else {
      autoResolveKeys.push(delayKey);
    }
  }

  return { candidates, autoResolveKeys };
}

export function shouldEscalateSeverity(
  currentSeverity: AlertSeverity,
  nextSeverity: AlertSeverity
): boolean {
  return ALERT_SEVERITY_RANK[nextSeverity] > ALERT_SEVERITY_RANK[currentSeverity];
}
