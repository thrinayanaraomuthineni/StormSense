import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { computeAlertSummary } from './src/lib/alertSummary';
import {
  buildCrewAssignmentsCsv,
  computeAnalyticsSummary,
  type AnalyticsDateWindow,
} from './src/lib/analyticsEngine';
import {
  canAssignCrewToIncident,
  recommendCrewsForIncident,
} from './src/lib/crewDispatch';
import {
  assessDistrictRisk,
  DEFAULT_RISK_WEIGHTS,
  type IncidentContextSummary,
} from './src/lib/riskEngine';
import { DISTRICT_MAP, TELANGANA_DISTRICTS } from './src/lib/telanganaDistricts';
import type {
  AlertLifecycleStatus,
  CrewAvailability,
  CrewStatus,
  FaultType,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  RiskScoringWeights,
  RiskSnapshotRecord,
  UserRole,
} from './src/lib/types';
import {
  clearResolvedAlerts,
  evaluateAutomatedAlerts,
  markAllAlertsAcknowledged,
  syncIncidentAlertsOnMutation,
  updateAlertLifecycleStatus,
  updateAlertReadState,
} from './server/alertEngine';
import {
  db,
  deleteSimulationScenario,
  getAlertConfig,
  getAlerts,
  getCrews,
  getDispatchHistory,
  getIncidents,
  getRiskSnapshots,
  getRiskWeights,
  getSavedSimulations,
  getUsers,
  recordDispatchHistory,
  saveRiskSnapshots,
  saveRiskWeights,
  saveSimulationScenario,
} from './server/db';
import {
  computeStormImpactForDistricts,
  SEVERITY_ORDER,
} from './src/lib/stormSimulation';
import { analyzeOperationsWithGemini } from './server/geminiService';
import {
  computeActiveDispatchRoutes,
  computeDispatchRoutesForCrews,
  fetchRoadRouteEstimate,
} from './server/routingService';
import { getWeatherState } from './server/weatherService';

const PORT = Number(process.env.PORT || 3000);

const VALID_SEVERITIES: IncidentSeverity[] = ['Low', 'Medium', 'High', 'Critical'];
const VALID_STATUSES: IncidentStatus[] = [
  'Detected',
  'Reported',
  'Assigned',
  'Crew En Route',
  'Under Maintenance',
  'Restored',
  'Closed',
];
const VALID_FAULTS: FaultType[] = [
  'Feeder Trip',
  'Transformer Fault',
  'HT Line Snap',
  'Substation Breaker',
  'Vegetation Contact',
  'Lightning Surge',
];
const VALID_SOURCES: IncidentSource[] = [
  'Simulated Demonstration Data',
  'Manually Entered Data',
  'Externally Verified Feed',
];
const VALID_AVAILABILITY: CrewAvailability[] = ['Available', 'Standby', 'Deployed', 'Off-Duty'];
const VALID_CREW_STATUS: CrewStatus[] = [
  'Ready at Depot',
  'En Route',
  'On Site - Restoring',
  'Standby Reserve',
  'Shift Completed',
];

function getRequestRole(req: Request): UserRole {
  const header = req.header('x-user-role');
  if (
    header === 'Administrator' ||
    header === 'Operations Manager' ||
    header === 'Field Operator' ||
    header === 'Read-only Evaluator'
  ) {
    return header;
  }
  return 'Operations Manager';
}

function requireMutatePermission(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getRequestRole(req);
    if (!allowedRoles.includes(role)) {
      res.status(403).json({
        error: `Role "${role}" is not authorized for this action. Required: ${allowedRoles.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

function computeAllAssessments(weatherObservations: Awaited<ReturnType<typeof getWeatherState>>['observations']) {
  const weatherMap = new Map(weatherObservations.map((w) => [w.districtId, w]));
  const incidents = getIncidents();
  const weights = getRiskWeights();
  const contextByDistrict = new Map<string, IncidentContextSummary>();

  for (const inc of incidents) {
    const cur = contextByDistrict.get(inc.districtId) ?? {
      activeCount: 0,
      totalCount: 0,
      simulatedCount: 0,
      manualCount: 0,
    };
    cur.totalCount += 1;
    if (inc.status !== 'Restored' && inc.status !== 'Closed') {
      cur.activeCount += 1;
      if (inc.source === 'Simulated Demonstration Data') {
        cur.simulatedCount += 1;
      } else {
        cur.manualCount += 1;
      }
    }
    contextByDistrict.set(inc.districtId, cur);
  }

  return TELANGANA_DISTRICTS.map((district) => {
    const ctx = contextByDistrict.get(district.id) ?? {
      activeCount: 0,
      totalCount: 0,
      simulatedCount: 0,
      manualCount: 0,
    };
    return assessDistrictRisk(district, weatherMap.get(district.id), ctx.activeCount, {
      weights,
      incidentContext: ctx,
    });
  });
}

function saveAllDistrictSnapshots(
  assessments: ReturnType<typeof computeAllAssessments>,
  weatherObservations: Awaited<ReturnType<typeof getWeatherState>>['observations']
) {
  const weatherMap = new Map(weatherObservations.map((w) => [w.districtId, w]));
  const now = new Date().toISOString();
  const stamp = Date.now();
  const records: RiskSnapshotRecord[] = assessments.map((a) => {
    const w = weatherMap.get(a.districtId);
    return {
      id: `SNP-${a.districtId}-${stamp}`,
      districtId: a.districtId,
      districtName: a.districtName,
      riskScore: a.score,
      riskCategory: a.category,
      rainMm: w?.rainMm ?? 0,
      windSpeedKmh: w?.windSpeedKmh ?? 0,
      windGustsKmh: w?.windGustsKmh ?? 0,
      past24hRainMm: w?.recentHistory?.past24hRainMm ?? 0,
      activeIncidents: a.incidentContext.activeCount,
      confidence: a.confidence,
      recordedAt: now,
    };
  });
  saveRiskSnapshots(records);
}

function recordSnapshotsIfNeeded(
  assessments: ReturnType<typeof computeAllAssessments>,
  weatherObservations: Awaited<ReturnType<typeof getWeatherState>>['observations']
) {
  const latest = db
    .prepare('SELECT recordedAt FROM risk_snapshots ORDER BY recordedAt DESC LIMIT 1')
    .get() as { recordedAt: string } | undefined;

  if (latest && Date.now() - new Date(latest.recordedAt).getTime() < 5 * 60_000) {
    return;
  }
  saveAllDistrictSnapshots(assessments, weatherObservations);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'StormSense Backend', timestamp: new Date().toISOString() });
  });

  app.get('/api/users', (_req, res) => {
    res.json({ users: getUsers() });
  });

  app.get('/api/state', async (req, res) => {
    try {
      const force = req.query.refresh === '1';
      const weather = await getWeatherState(force);
      const assessments = computeAllAssessments(weather.observations);

      evaluateAutomatedAlerts(assessments, weather.observations);
      if (weather.observations.length > 0) {
        recordSnapshotsIfNeeded(assessments, weather.observations);
      }

      const alerts = getAlerts();
      const incidents = getIncidents();
      const crews = getCrews();
      const activeRoutes = await computeActiveDispatchRoutes(incidents, crews);
      res.json({
        districts: TELANGANA_DISTRICTS,
        weather,
        assessments,
        incidents,
        crews,
        activeRoutes,
        dispatchHistory: getDispatchHistory(100),
        alerts,
        alertSummary: computeAlertSummary(alerts),
        alertConfig: getAlertConfig(),
        riskWeights: getRiskWeights(),
        riskSnapshots: getRiskSnapshots(320),
        savedSimulations: getSavedSimulations(30),
        serverTimestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to assemble operational state',
      });
    }
  });

  app.post('/api/weather/refresh', async (_req, res) => {
    try {
      const weather = await getWeatherState(true);
      const assessments = computeAllAssessments(weather.observations);
      evaluateAutomatedAlerts(assessments, weather.observations);
      if (weather.observations.length > 0) {
        saveAllDistrictSnapshots(assessments, weather.observations);
      }
      const alerts = getAlerts();
      res.json({
        weather,
        assessments,
        alerts,
        alertSummary: computeAlertSummary(alerts),
        riskWeights: getRiskWeights(),
        riskSnapshots: getRiskSnapshots(320),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Weather refresh failed',
      });
    }
  });

  // Incident CRUD
  app.get('/api/incidents', (_req, res) => {
    res.json({ incidents: getIncidents() });
  });

  app.post(
    '/api/incidents',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    (req, res) => {
      const body = req.body ?? {};
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const districtId = typeof body.districtId === 'string' ? body.districtId : '';
      const locationName = typeof body.locationName === 'string' ? body.locationName.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const severity = body.severity as IncidentSeverity;
      const faultType = body.faultType as FaultType;
      const source = (body.source as IncidentSource) || 'Manually Entered Data';
      const affectedConsumers = Number(body.affectedConsumers ?? 0);

      const district = DISTRICT_MAP.get(districtId);
      if (!title || title.length < 4) {
        res.status(400).json({ error: 'Incident title must be at least 4 characters.' });
        return;
      }
      if (!district) {
        res.status(400).json({ error: 'Valid Telangana districtId is required.' });
        return;
      }
      if (!locationName) {
        res.status(400).json({ error: 'Location / feeder name is required.' });
        return;
      }
      if (!VALID_SEVERITIES.includes(severity)) {
        res.status(400).json({ error: 'Invalid incident severity.' });
        return;
      }
      if (!VALID_FAULTS.includes(faultType)) {
        res.status(400).json({ error: 'Invalid fault type.' });
        return;
      }
      if (!VALID_SOURCES.includes(source)) {
        res.status(400).json({ error: 'Invalid incident source classification.' });
        return;
      }
      if (!Number.isFinite(affectedConsumers) || affectedConsumers < 0) {
        res.status(400).json({ error: 'Estimated affected consumers must be 0 or greater.' });
        return;
      }

      const lat =
        typeof body.lat === 'number' && Number.isFinite(body.lat)
          ? body.lat
          : Number((district.lat + (Math.random() - 0.5) * 0.08).toFixed(4));
      const lng =
        typeof body.lng === 'number' && Number.isFinite(body.lng)
          ? body.lng
          : Number((district.lng + (Math.random() - 0.5) * 0.08).toFixed(4));

      const now = new Date().toISOString();
      const id = `INC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const status: IncidentStatus = body.status && VALID_STATUSES.includes(body.status) ? body.status : 'Reported';

      db.prepare(
        `INSERT INTO incidents (
          id, title, districtId, districtName, locationName, lat, lng, severity, faultType,
          description, source, status, assignedCrewId, affectedConsumers, restorationNotes,
          createdAt, updatedAt, resolvedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        title,
        district.id,
        district.name,
        locationName,
        lat,
        lng,
        severity,
        faultType,
        description || 'Logged via StormSense Incident Operations.',
        source,
        status,
        null,
        Math.round(affectedConsumers),
        typeof body.restorationNotes === 'string' ? body.restorationNotes.trim() : '',
        now,
        now,
        null
      );

      const created = getIncidents().find((i) => i.id === id);
      if (created) {
        syncIncidentAlertsOnMutation(created, 'created');
      }
      res.status(201).json({ incident: created });
    }
  );

  app.patch(
    '/api/incidents/:id',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    (req, res) => {
      const existing = getIncidents().find((i) => i.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Incident not found.' });
        return;
      }

      const body = req.body ?? {};
      const title = typeof body.title === 'string' ? body.title.trim() : existing.title;
      const severity = (body.severity ?? existing.severity) as IncidentSeverity;
      const status = (body.status ?? existing.status) as IncidentStatus;
      const faultType = (body.faultType ?? existing.faultType) as FaultType;
      const locationName =
        typeof body.locationName === 'string' ? body.locationName.trim() : existing.locationName;
      const description =
        typeof body.description === 'string' ? body.description.trim() : existing.description;
      const restorationNotes =
        typeof body.restorationNotes === 'string' ? body.restorationNotes.trim() : existing.restorationNotes;
      const affectedConsumers =
        body.affectedConsumers !== undefined ? Number(body.affectedConsumers) : existing.affectedConsumers;

      if (!title || title.length < 4) {
        res.status(400).json({ error: 'Title must be at least 4 characters.' });
        return;
      }
      if (!VALID_SEVERITIES.includes(severity)) {
        res.status(400).json({ error: 'Invalid severity value.' });
        return;
      }
      if (!VALID_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Invalid status value.' });
        return;
      }
      if (!VALID_FAULTS.includes(faultType)) {
        res.status(400).json({ error: 'Invalid fault type.' });
        return;
      }
      if (!Number.isFinite(affectedConsumers) || affectedConsumers < 0) {
        res.status(400).json({ error: 'Affected consumers must be a non-negative number.' });
        return;
      }

      const now = new Date().toISOString();
      const isTerminal = status === 'Restored' || status === 'Closed';
      const resolvedAt = isTerminal ? existing.resolvedAt ?? now : null;

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE incidents
           SET title = ?, locationName = ?, severity = ?, faultType = ?, description = ?,
               status = ?, affectedConsumers = ?, restorationNotes = ?, updatedAt = ?, resolvedAt = ?
           WHERE id = ?`
        ).run(
          title,
          locationName,
          severity,
          faultType,
          description,
          status,
          Math.round(affectedConsumers),
          restorationNotes,
          now,
          resolvedAt,
          existing.id
        );

        // Sync crew status when incident moves to En Route, Maintenance, or Restored/Closed
        if (existing.assignedCrewId) {
          const linkedCrew = getCrews().find((c) => c.id === existing.assignedCrewId);
          if (status === 'Restored' || status === 'Closed') {
            db.prepare(
              `UPDATE crews
               SET availability = 'Available', status = 'Ready at Depot', activeIncidentId = NULL,
                   completedJobs = completedJobs + 1, updatedAt = ?
               WHERE id = ? AND activeIncidentId = ?`
            ).run(now, existing.assignedCrewId, existing.id);
            if (linkedCrew) {
              recordDispatchHistory({
                incidentId: existing.id,
                incidentTitle: title,
                crewId: linkedCrew.id,
                crewName: linkedCrew.name,
                action: 'work_completed',
                previousCrewId: null,
                previousCrewName: null,
                crewStatus: 'Ready at Depot',
                incidentStatus: status,
                notes: restorationNotes || `Incident marked ${status} from Incident Management.`,
                performedBy: getRequestRole(req),
                createdAt: now,
              });
            }
          } else if (status === 'Crew En Route') {
            db.prepare(
              `UPDATE crews SET status = 'En Route', availability = 'Deployed', updatedAt = ? WHERE id = ?`
            ).run(now, existing.assignedCrewId);
            if (linkedCrew && existing.status !== status) {
              recordDispatchHistory({
                incidentId: existing.id,
                incidentTitle: title,
                crewId: linkedCrew.id,
                crewName: linkedCrew.name,
                action: 'status_updated',
                previousCrewId: null,
                previousCrewName: null,
                crewStatus: 'En Route',
                incidentStatus: status,
                notes: 'Incident status synced crew dispatch to En Route.',
                performedBy: getRequestRole(req),
                createdAt: now,
              });
            }
          } else if (status === 'Under Maintenance') {
            db.prepare(
              `UPDATE crews SET status = 'On Site - Restoring', availability = 'Deployed', updatedAt = ? WHERE id = ?`
            ).run(now, existing.assignedCrewId);
            if (linkedCrew && existing.status !== status) {
              recordDispatchHistory({
                incidentId: existing.id,
                incidentTitle: title,
                crewId: linkedCrew.id,
                crewName: linkedCrew.name,
                action: 'status_updated',
                previousCrewId: null,
                previousCrewName: null,
                crewStatus: 'On Site - Restoring',
                incidentStatus: status,
                notes: 'Incident status synced crew dispatch to On Site - Restoring.',
                performedBy: getRequestRole(req),
                createdAt: now,
              });
            }
          }
        }
      });
      tx();

      const updated = getIncidents().find((i) => i.id === existing.id);
      if (updated) {
        syncIncidentAlertsOnMutation(updated, 'updated');
      }
      res.json({ incident: updated });
    }
  );

  app.delete(
    '/api/incidents/:id',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    (req, res) => {
      const existing = getIncidents().find((i) => i.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Incident not found.' });
        return;
      }
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        if (existing.assignedCrewId) {
          db.prepare(
            `UPDATE crews SET availability = 'Available', status = 'Ready at Depot', activeIncidentId = NULL, updatedAt = ? WHERE id = ?`
          ).run(now, existing.assignedCrewId);
        }
        db.prepare('DELETE FROM incidents WHERE id = ?').run(existing.id);
      });
      tx();
      syncIncidentAlertsOnMutation(existing, 'deleted');
      res.json({ deletedId: existing.id });
    }
  );

  app.get('/api/incidents/:id/recommendations', async (req, res) => {
    const allIncidents = getIncidents();
    const incident = allIncidents.find((i) => i.id === req.params.id);
    if (!incident) {
      res.status(404).json({ error: 'Incident not found.' });
      return;
    }
    const crews = getCrews();
    const routeMap = await computeDispatchRoutesForCrews(crews, incident);
    const recommendations = recommendCrewsForIncident(incident, crews, routeMap, allIncidents);
    res.json({ recommendations });
  });

  app.post(
    '/api/incidents/:id/assign',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    async (req, res) => {
      const allIncidents = getIncidents();
      const incident = allIncidents.find((i) => i.id === req.params.id);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found.' });
        return;
      }
      const crewId = typeof req.body?.crewId === 'string' ? req.body.crewId : '';
      const forceReassign = Boolean(req.body?.forceReassign);
      const crews = getCrews();
      const crew = crews.find((c) => c.id === crewId);
      if (!crew) {
        res.status(404).json({ error: 'Selected maintenance crew not found.' });
        return;
      }

      const compatibility = canAssignCrewToIncident(crew, incident, allIncidents, forceReassign);
      if (!compatibility.allowed) {
        res.status(409).json({
          error: compatibility.reason || 'Crew cannot be assigned to this incident.',
          canForceReassign: compatibility.canForceReassign,
        });
        return;
      }

      const routeEstimate = await fetchRoadRouteEstimate(
        crew.lat,
        crew.lng,
        incident.lat,
        incident.lng
      );

      const now = new Date().toISOString();
      const previousCrewId = incident.assignedCrewId;
      const previousCrew = previousCrewId ? crews.find((c) => c.id === previousCrewId) ?? null : null;
      const releasedOtherIncidentId =
        crew.activeIncidentId && crew.activeIncidentId !== incident.id ? crew.activeIncidentId : null;

      const nextStatus: IncidentStatus =
        incident.status === 'Detected' || incident.status === 'Reported' ? 'Assigned' : incident.status;

      const tx = db.transaction(() => {
        if (previousCrewId && previousCrewId !== crew.id) {
          db.prepare(
            `UPDATE crews SET availability = 'Available', status = 'Ready at Depot', activeIncidentId = NULL, updatedAt = ? WHERE id = ?`
          ).run(now, previousCrewId);
        }

        if (releasedOtherIncidentId) {
          db.prepare(
            `UPDATE incidents SET assignedCrewId = NULL, status = 'Reported', updatedAt = ? WHERE id = ?`
          ).run(now, releasedOtherIncidentId);
        }

        db.prepare(
          `UPDATE incidents SET assignedCrewId = ?, status = ?, updatedAt = ? WHERE id = ?`
        ).run(crew.id, nextStatus, now, incident.id);

        db.prepare(
          `UPDATE crews SET availability = 'Deployed', status = 'En Route', activeIncidentId = ?, updatedAt = ? WHERE id = ?`
        ).run(incident.id, now, crew.id);

        const isReassign = Boolean(previousCrewId && previousCrewId !== crew.id) || Boolean(releasedOtherIncidentId);
        const noteParts: string[] = [];
        if (previousCrew && previousCrew.id !== crew.id) {
          noteParts.push(`Replaced ${previousCrew.name} on ${incident.id}`);
        }
        if (releasedOtherIncidentId) {
          noteParts.push(`Pulled from prior incident ${releasedOtherIncidentId}`);
        }
        if (noteParts.length === 0) {
          noteParts.push(`Dispatched from ${crew.baseLocation}`);
        }

        recordDispatchHistory({
          incidentId: incident.id,
          incidentTitle: incident.title,
          crewId: crew.id,
          crewName: crew.name,
          action: isReassign ? 'reassigned' : 'assigned',
          previousCrewId: previousCrew?.id ?? null,
          previousCrewName: previousCrew?.name ?? null,
          crewStatus: 'En Route',
          incidentStatus: nextStatus,
          distanceKm: routeEstimate.distanceKm,
          etaMinutes: routeEstimate.estimatedEtaMinutes,
          routingMode: routeEstimate.routingMode,
          notes: `${noteParts.join('; ')} (${routeEstimate.etaLabel})`,
          performedBy: getRequestRole(req),
          createdAt: now,
        });
      });
      tx();

      const freshIncidents = getIncidents();
      const updatedIncident = freshIncidents.find((i) => i.id === incident.id);
      if (updatedIncident) {
        syncIncidentAlertsOnMutation(updatedIncident, 'assigned');
      }
      if (releasedOtherIncidentId) {
        const releasedInc = freshIncidents.find((i) => i.id === releasedOtherIncidentId);
        if (releasedInc) {
          syncIncidentAlertsOnMutation(releasedInc, 'updated');
        }
      }

      res.json({
        incident: updatedIncident,
        crews: getCrews(),
        dispatchHistory: getDispatchHistory(100),
      });
    }
  );

  // Crew CRUD
  app.get('/api/crews', (_req, res) => {
    res.json({ crews: getCrews() });
  });

  app.post(
    '/api/crews',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    (req, res) => {
      const body = req.body ?? {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const districtId = typeof body.districtId === 'string' ? body.districtId : '';
      const baseLocation = typeof body.baseLocation === 'string' ? body.baseLocation.trim() : '';
      const members = Number(body.members ?? 4);
      const skills = Array.isArray(body.skills)
        ? body.skills.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [];
      const availability = (body.availability as CrewAvailability) || 'Available';

      const district = DISTRICT_MAP.get(districtId);
      if (!name || name.length < 3) {
        res.status(400).json({ error: 'Crew name must be at least 3 characters.' });
        return;
      }
      if (!district) {
        res.status(400).json({ error: 'Valid Telangana districtId is required.' });
        return;
      }
      if (!baseLocation) {
        res.status(400).json({ error: 'Base depot location is required.' });
        return;
      }
      if (!Number.isFinite(members) || members < 1 || members > 25) {
        res.status(400).json({ error: 'Crew member count must be between 1 and 25.' });
        return;
      }
      if (!VALID_AVAILABILITY.includes(availability)) {
        res.status(400).json({ error: 'Invalid crew availability.' });
        return;
      }

      const id = `CRW-${district.id.slice(0, 3).toUpperCase()}-${Math.floor(10 + Math.random() * 89)}`;
      const now = new Date().toISOString();
      const lat =
        typeof body.lat === 'number' && Number.isFinite(body.lat)
          ? body.lat
          : Number((district.lat + (Math.random() - 0.5) * 0.05).toFixed(4));
      const lng =
        typeof body.lng === 'number' && Number.isFinite(body.lng)
          ? body.lng
          : Number((district.lng + (Math.random() - 0.5) * 0.05).toFixed(4));

      const status: CrewStatus =
        availability === 'Standby'
          ? 'Standby Reserve'
          : availability === 'Off-Duty'
            ? 'Shift Completed'
            : 'Ready at Depot';

      db.prepare(
        `INSERT INTO crews (
          id, name, districtId, districtName, baseLocation, lat, lng, members, skills,
          availability, status, activeIncidentId, completedJobs, locationSource, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        name,
        district.id,
        district.name,
        baseLocation,
        lat,
        lng,
        Math.round(members),
        JSON.stringify(skills.length > 0 ? skills : ['HT Restoration']),
        availability,
        status,
        null,
        0,
        'Simulated Demonstration Data',
        now
      );

      res.status(201).json({ crew: getCrews().find((c) => c.id === id) });
    }
  );

  app.patch(
    '/api/crews/:id',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    (req, res) => {
      const existing = getCrews().find((c) => c.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Crew not found.' });
        return;
      }
      const body = req.body ?? {};
      const name = typeof body.name === 'string' ? body.name.trim() : existing.name;
      const baseLocation =
        typeof body.baseLocation === 'string' ? body.baseLocation.trim() : existing.baseLocation;
      const members = body.members !== undefined ? Number(body.members) : existing.members;
      const skills = Array.isArray(body.skills)
        ? body.skills.map((s: unknown) => String(s).trim()).filter(Boolean)
        : existing.skills;
      let availability = (body.availability ?? existing.availability) as CrewAvailability;
      let status = (body.status ?? existing.status) as CrewStatus;

      if (!name || name.length < 3) {
        res.status(400).json({ error: 'Crew name must be at least 3 characters.' });
        return;
      }
      if (!VALID_AVAILABILITY.includes(availability)) {
        res.status(400).json({ error: 'Invalid crew availability.' });
        return;
      }
      if (!VALID_CREW_STATUS.includes(status)) {
        res.status(400).json({ error: 'Invalid crew status.' });
        return;
      }

      if (existing.activeIncidentId && (availability === 'Off-Duty' || status === 'Shift Completed')) {
        res.status(409).json({
          error: `Cannot mark ${existing.name} as ${availability}/${status} while assigned to active incident ${existing.activeIncidentId}. Mark work completed or reassign the incident first.`,
        });
        return;
      }

      // Keep availability & status coherent when operator updates availability alone
      if (body.availability !== undefined && body.status === undefined && !existing.activeIncidentId) {
        if (availability === 'Available') status = 'Ready at Depot';
        else if (availability === 'Standby') status = 'Standby Reserve';
        else if (availability === 'Off-Duty') status = 'Shift Completed';
      }
      if (existing.activeIncidentId && (status === 'En Route' || status === 'On Site - Restoring')) {
        availability = 'Deployed';
      }

      const now = new Date().toISOString();
      let syncedIncidentId: string | null = null;

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE crews SET name = ?, baseLocation = ?, members = ?, skills = ?, availability = ?, status = ?, updatedAt = ? WHERE id = ?`
        ).run(name, baseLocation, Math.round(members), JSON.stringify(skills), availability, status, now, existing.id);

        if (existing.activeIncidentId) {
          const linkedInc = getIncidents().find((i) => i.id === existing.activeIncidentId);
          if (linkedInc && linkedInc.status !== 'Restored' && linkedInc.status !== 'Closed') {
            let nextIncidentStatus: IncidentStatus = linkedInc.status;
            if (status === 'En Route') nextIncidentStatus = 'Crew En Route';
            else if (status === 'On Site - Restoring') nextIncidentStatus = 'Under Maintenance';
            else if (status === 'Ready at Depot' && (linkedInc.status === 'Crew En Route' || linkedInc.status === 'Under Maintenance')) {
              nextIncidentStatus = 'Assigned';
            }

            if (nextIncidentStatus !== linkedInc.status) {
              db.prepare(`UPDATE incidents SET status = ?, updatedAt = ? WHERE id = ?`).run(
                nextIncidentStatus,
                now,
                linkedInc.id
              );
              syncedIncidentId = linkedInc.id;
            }

            if (status !== existing.status || availability !== existing.availability) {
              recordDispatchHistory({
                incidentId: linkedInc.id,
                incidentTitle: linkedInc.title,
                crewId: existing.id,
                crewName: name,
                action: status !== existing.status ? 'status_updated' : 'availability_changed',
                previousCrewId: null,
                previousCrewName: null,
                crewStatus: status,
                incidentStatus: nextIncidentStatus,
                notes: `Crew status updated (${existing.status} → ${status}; availability: ${availability}).`,
                performedBy: getRequestRole(req),
                createdAt: now,
              });
            }
          }
        } else if (status !== existing.status || availability !== existing.availability) {
          recordDispatchHistory({
            incidentId: 'ROSTER',
            incidentTitle: 'Fleet Readiness Roster Update',
            crewId: existing.id,
            crewName: name,
            action: availability !== existing.availability ? 'availability_changed' : 'status_updated',
            previousCrewId: null,
            previousCrewName: null,
            crewStatus: status,
            incidentStatus: 'Reported',
            notes: `Availability: ${existing.availability} → ${availability} · Status: ${status}`,
            performedBy: getRequestRole(req),
            createdAt: now,
          });
        }
      });
      tx();

      if (syncedIncidentId) {
        const syncedInc = getIncidents().find((i) => i.id === syncedIncidentId);
        if (syncedInc) {
          syncIncidentAlertsOnMutation(syncedInc, 'updated');
        }
      }

      res.json({
        crew: getCrews().find((c) => c.id === existing.id),
        dispatchHistory: getDispatchHistory(100),
      });
    }
  );

  app.post(
    '/api/crews/:id/complete',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    (req, res) => {
      const existing = getCrews().find((c) => c.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Crew not found.' });
        return;
      }
      if (!existing.activeIncidentId) {
        res.status(400).json({ error: `${existing.name} has no active incident assignment to complete.` });
        return;
      }
      const linkedInc = getIncidents().find((i) => i.id === existing.activeIncidentId);
      if (!linkedInc) {
        res.status(404).json({ error: `Linked incident ${existing.activeIncidentId} was not found.` });
        return;
      }

      const now = new Date().toISOString();
      const notes =
        typeof req.body?.notes === 'string' && req.body.notes.trim().length > 0
          ? req.body.notes.trim()
          : `Work completed and supply restored by ${existing.name}.`;

      const nextNotes = linkedInc.restorationNotes
        ? `${linkedInc.restorationNotes} | ${notes}`
        : notes;

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE crews
           SET availability = 'Available', status = 'Ready at Depot', activeIncidentId = NULL,
               completedJobs = completedJobs + 1, updatedAt = ?
           WHERE id = ?`
        ).run(now, existing.id);

        db.prepare(
          `UPDATE incidents
           SET status = 'Restored', restorationNotes = ?, updatedAt = ?, resolvedAt = ?
           WHERE id = ?`
        ).run(nextNotes, now, now, linkedInc.id);

        recordDispatchHistory({
          incidentId: linkedInc.id,
          incidentTitle: linkedInc.title,
          crewId: existing.id,
          crewName: existing.name,
          action: 'work_completed',
          previousCrewId: null,
          previousCrewName: null,
          crewStatus: 'Ready at Depot',
          incidentStatus: 'Restored',
          notes,
          performedBy: getRequestRole(req),
          createdAt: now,
        });
      });
      tx();

      const updatedIncident = getIncidents().find((i) => i.id === linkedInc.id);
      if (updatedIncident) {
        syncIncidentAlertsOnMutation(updatedIncident, 'updated');
      }

      res.json({
        crew: getCrews().find((c) => c.id === existing.id),
        incident: updatedIncident,
        dispatchHistory: getDispatchHistory(100),
      });
    }
  );

  app.get('/api/dispatch/history', (_req, res) => {
    res.json({ history: getDispatchHistory(100) });
  });

  app.delete(
    '/api/crews/:id',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    (req, res) => {
      const existing = getCrews().find((c) => c.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Crew not found.' });
        return;
      }
      if (existing.activeIncidentId) {
        res.status(409).json({
          error: `Cannot remove ${existing.name} while assigned to active incident ${existing.activeIncidentId}. Reassign or resolve the incident first.`,
        });
        return;
      }
      db.prepare('DELETE FROM crews WHERE id = ?').run(existing.id);
      res.json({ deletedId: existing.id });
    }
  );

  // Alerts
  app.get('/api/alerts', (_req, res) => {
    const alerts = getAlerts();
    res.json({ alerts, summary: computeAlertSummary(alerts) });
  });

  app.patch('/api/alerts/:id/read', (req, res) => {
    const isRead = req.body?.isRead !== false;
    const found = updateAlertReadState(req.params.id, isRead);
    if (!found) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }
    const alerts = getAlerts();
    res.json({ alerts, summary: computeAlertSummary(alerts) });
  });

  app.patch(
    '/api/alerts/:id/status',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    (req, res) => {
      const nextStatus = req.body?.status as AlertLifecycleStatus;
      const validStatuses: AlertLifecycleStatus[] = ['New', 'Acknowledged', 'Assigned', 'Resolved'];
      if (!validStatuses.includes(nextStatus)) {
        res.status(400).json({ error: 'Invalid alert lifecycle status.' });
        return;
      }
      const ok = updateAlertLifecycleStatus(req.params.id, nextStatus);
      if (!ok) {
        res.status(409).json({
          error: 'Alert not found or an active alert for this condition already exists.',
        });
        return;
      }
      const alerts = getAlerts();
      res.json({ alerts, summary: computeAlertSummary(alerts) });
    }
  );

  app.post('/api/alerts/mark-all-read', (_req, res) => {
    markAllAlertsAcknowledged();
    const alerts = getAlerts();
    res.json({ alerts, summary: computeAlertSummary(alerts) });
  });

  app.delete(
    '/api/alerts/clear-read',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    (_req, res) => {
      clearResolvedAlerts();
      const alerts = getAlerts();
      res.json({ alerts, summary: computeAlertSummary(alerts) });
    }
  );

  // Alert & Integration Config
  app.get('/api/settings', (_req, res) => {
    res.json({ alertConfig: getAlertConfig() });
  });

  app.put(
    '/api/settings',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    async (req, res) => {
      const body = req.body ?? {};
      const current = getAlertConfig();
      const moderateRiskThreshold =
        body.moderateRiskThreshold !== undefined
          ? Number(body.moderateRiskThreshold)
          : current.moderateRiskThreshold;
      const highRiskThreshold = Number(body.highRiskThreshold);
      const criticalRiskThreshold = Number(body.criticalRiskThreshold);
      const highWindThresholdKmh = Number(body.highWindThresholdKmh);
      const heavyRainThresholdMm = Number(body.heavyRainThresholdMm);
      const unassignedAlertMinutes = Number(body.unassignedAlertMinutes);
      const restorationDelayMinutes = Number(body.restorationDelayMinutes);

      if (
        !Number.isFinite(moderateRiskThreshold) ||
        !Number.isFinite(highRiskThreshold) ||
        !Number.isFinite(criticalRiskThreshold) ||
        moderateRiskThreshold < 10 ||
        highRiskThreshold <= moderateRiskThreshold ||
        criticalRiskThreshold <= highRiskThreshold ||
        criticalRiskThreshold > 100
      ) {
        res.status(400).json({
          error:
            'Invalid risk thresholds: ensure 10 <= Moderate < High < Critical <= 100.',
        });
        return;
      }

      if (
        !Number.isFinite(highWindThresholdKmh) ||
        highWindThresholdKmh < 10 ||
        !Number.isFinite(heavyRainThresholdMm) ||
        heavyRainThresholdMm < 1 ||
        !Number.isFinite(unassignedAlertMinutes) ||
        unassignedAlertMinutes < 1 ||
        !Number.isFinite(restorationDelayMinutes) ||
        restorationDelayMinutes < 5
      ) {
        res.status(400).json({
          error: 'Wind, rainfall, and SLA thresholds must be positive numeric values.',
        });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE alert_config
         SET moderateRiskThreshold = ?, highRiskThreshold = ?, criticalRiskThreshold = ?, highWindThresholdKmh = ?,
             heavyRainThresholdMm = ?, unassignedAlertMinutes = ?, restorationDelayMinutes = ?,
             smsEnabled = ?, whatsappEnabled = ?, emailEnabled = ?, updatedAt = ?
         WHERE id = 'default'`
      ).run(
        Math.round(moderateRiskThreshold),
        Math.round(highRiskThreshold),
        Math.round(criticalRiskThreshold),
        Math.round(highWindThresholdKmh),
        Math.round(heavyRainThresholdMm),
        Math.round(unassignedAlertMinutes),
        Math.round(restorationDelayMinutes),
        body.smsEnabled ? 1 : 0,
        body.whatsappEnabled ? 1 : 0,
        body.emailEnabled ? 1 : 0,
        now
      );

      // Immediately re-evaluate alerts against the new thresholds
      try {
        const weather = await getWeatherState(false);
        const assessments = computeAllAssessments(weather.observations);
        evaluateAutomatedAlerts(assessments, weather.observations);
      } catch {
        // Weather fetch error is non-fatal for saving settings
      }

      const alerts = getAlerts();
      res.json({
        alertConfig: getAlertConfig(),
        alerts,
        alertSummary: computeAlertSummary(alerts),
      });
    }
  );

  // Configurable Risk Scoring Weights & Snapshots
  app.get('/api/risk/weights', (_req, res) => {
    res.json({ riskWeights: getRiskWeights() });
  });

  app.put(
    '/api/risk/weights',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    async (req, res) => {
      const body = (req.body ?? {}) as Partial<RiskScoringWeights>;
      const keys: Array<keyof Omit<RiskScoringWeights, 'updatedAt'>> = [
        'rainfall',
        'wind',
        'gusts',
        'thunderstorm',
        'precipitationProb',
        'historicalWeather',
        'recordedIncidents',
        'gridVulnerability',
      ];
      const current = getRiskWeights();
      const next = {
        rainfall: body.rainfall !== undefined ? Number(body.rainfall) : current.rainfall,
        wind: body.wind !== undefined ? Number(body.wind) : current.wind,
        gusts: body.gusts !== undefined ? Number(body.gusts) : current.gusts,
        thunderstorm:
          body.thunderstorm !== undefined ? Number(body.thunderstorm) : current.thunderstorm,
        precipitationProb:
          body.precipitationProb !== undefined
            ? Number(body.precipitationProb)
            : current.precipitationProb,
        historicalWeather:
          body.historicalWeather !== undefined
            ? Number(body.historicalWeather)
            : current.historicalWeather,
        recordedIncidents:
          body.recordedIncidents !== undefined
            ? Number(body.recordedIncidents)
            : current.recordedIncidents,
        gridVulnerability:
          body.gridVulnerability !== undefined
            ? Number(body.gridVulnerability)
            : current.gridVulnerability,
      };

      for (const k of keys) {
        if (!Number.isFinite(next[k]) || next[k] < 0 || next[k] > 100) {
          res.status(400).json({
            error: `Weight for "${k}" must be between 0 and 100.`,
          });
          return;
        }
      }

      const sum = keys.reduce((acc, k) => acc + next[k], 0);
      if (sum <= 0) {
        res.status(400).json({
          error: 'At least one risk factor weight must be greater than 0.',
        });
        return;
      }

      const saved = saveRiskWeights(next);
      const weather = await getWeatherState(false);
      const assessments = computeAllAssessments(weather.observations);
      evaluateAutomatedAlerts(assessments, weather.observations);
      const alerts = getAlerts();

      res.json({
        riskWeights: saved,
        assessments,
        alerts,
        alertSummary: computeAlertSummary(alerts),
      });
    }
  );

  app.post(
    '/api/risk/weights/reset',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    async (_req, res) => {
      const saved = saveRiskWeights(DEFAULT_RISK_WEIGHTS);
      const weather = await getWeatherState(false);
      const assessments = computeAllAssessments(weather.observations);
      evaluateAutomatedAlerts(assessments, weather.observations);
      const alerts = getAlerts();
      res.json({
        riskWeights: saved,
        assessments,
        alerts,
        alertSummary: computeAlertSummary(alerts),
      });
    }
  );

  app.post(
    '/api/risk/snapshots',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    async (_req, res) => {
      try {
        const weather = await getWeatherState(false);
        const assessments = computeAllAssessments(weather.observations);
        saveAllDistrictSnapshots(assessments, weather.observations);
        res.status(201).json({ riskSnapshots: getRiskSnapshots(320) });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to capture risk snapshot',
        });
      }
    }
  );

  // Storm Simulation Lab Persistence (strictly isolated from live operational tables)
  app.get('/api/simulations', (_req, res) => {
    res.json({ savedSimulations: getSavedSimulations(30) });
  });

  app.post(
    '/api/simulations',
    requireMutatePermission(['Administrator', 'Operations Manager', 'Field Operator']),
    async (req, res) => {
      const body = req.body ?? {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const rawParams = body.params ?? {};

      if (!name || name.length < 3 || name.length > 100) {
        res.status(400).json({ error: 'Scenario name must be between 3 and 100 characters.' });
        return;
      }

      const targetDistrictId =
        typeof rawParams.targetDistrictId === 'string' ? rawParams.targetDistrictId : '';
      const district = DISTRICT_MAP.get(targetDistrictId);
      if (!district) {
        res.status(400).json({ error: 'Valid Telangana targetDistrictId is required.' });
        return;
      }

      const rainfallMm = Number(rawParams.rainfallMm ?? 0);
      const windSpeedKmh = Number(rawParams.windSpeedKmh ?? 0);
      const windGustsKmh = Number(rawParams.windGustsKmh ?? 0);
      const precipitationProbability = Number(rawParams.precipitationProbability ?? 0);
      const stormTrackBearingDeg = Number(rawParams.stormTrackBearingDeg ?? 315);
      const impactRadiusKm = Number(rawParams.impactRadiusKm ?? 90);
      const stormSeverity = SEVERITY_ORDER.includes(rawParams.stormSeverity)
        ? rawParams.stormSeverity
        : 'Strong';
      const presetId =
        rawParams.presetId === 'heavy_rainfall' ||
        rawParams.presetId === 'high_wind' ||
        rawParams.presetId === 'severe_thunderstorm' ||
        rawParams.presetId === 'combined_extreme'
          ? rawParams.presetId
          : 'custom';

      if (
        !Number.isFinite(rainfallMm) ||
        rainfallMm < 0 ||
        rainfallMm > 150 ||
        !Number.isFinite(windSpeedKmh) ||
        windSpeedKmh < 0 ||
        windSpeedKmh > 180 ||
        !Number.isFinite(windGustsKmh) ||
        windGustsKmh < 0 ||
        windGustsKmh > 220 ||
        !Number.isFinite(precipitationProbability) ||
        precipitationProbability < 0 ||
        precipitationProbability > 100 ||
        !Number.isFinite(impactRadiusKm) ||
        impactRadiusKm < 30 ||
        impactRadiusKm > 250
      ) {
        res.status(400).json({ error: 'Simulation parameters are out of valid physical bounds.' });
        return;
      }

      const cleanParams = {
        targetDistrictId: district.id,
        presetId,
        rainfallMm: Math.round(rainfallMm * 10) / 10,
        windSpeedKmh: Math.round(windSpeedKmh * 10) / 10,
        windGustsKmh: Math.round(Math.max(windGustsKmh, windSpeedKmh) * 10) / 10,
        stormSeverity,
        precipitationProbability: Math.round(precipitationProbability),
        isThunderstorm: Boolean(rawParams.isThunderstorm),
        stormTrackBearingDeg: ((Math.round(stormTrackBearingDeg) % 360) + 360) % 360,
        impactRadiusKm: Math.round(impactRadiusKm),
      } as const;

      try {
        const weather = await getWeatherState(false);
        const baselineAssessments = computeAllAssessments(weather.observations);
        const impacts = computeStormImpactForDistricts({
          params: { ...cleanParams },
          districts: TELANGANA_DISTRICTS,
          baselineAssessments,
          weatherObservations: weather.observations,
          weights: getRiskWeights(),
          incidents: getIncidents(),
          crews: getCrews(),
        });

        const targetImpact = impacts.find((i) => i.district.id === district.id) ?? impacts[0];
        const elevatedCount = impacts.filter((i) => i.deltaScore >= 3).length;
        const summaryNote =
          typeof body.summaryNote === 'string' && body.summaryNote.trim().length > 0
            ? body.summaryNote.trim().slice(0, 240)
            : `Hypothetical ${cleanParams.stormSeverity} scenario over ${district.name}: Rain ${cleanParams.rainfallMm} mm/h, Gusts ${cleanParams.windGustsKmh} km/h.`;

        const saved = saveSimulationScenario({
          name,
          createdBy: getRequestRole(req),
          params: { ...cleanParams },
          targetDistrictName: district.name,
          baselineScore: targetImpact.baselineAssessment.score,
          simulatedScore: targetImpact.simulatedAssessment.score,
          deltaScore: targetImpact.deltaScore,
          elevatedDistrictCount: elevatedCount,
          peakCategory: targetImpact.simulatedAssessment.category,
          summaryNote,
        });

        res.status(201).json({
          scenario: saved,
          savedSimulations: getSavedSimulations(30),
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to save simulation scenario',
        });
      }
    }
  );

  app.delete(
    '/api/simulations/:id',
    requireMutatePermission(['Administrator', 'Operations Manager']),
    (req, res) => {
      const deleted = deleteSimulationScenario(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Saved simulation scenario not found.' });
        return;
      }
      res.json({ deletedId: req.params.id, savedSimulations: getSavedSimulations(30) });
    }
  );

  // Gemini AI Operational Intelligence
  app.post('/api/ai/analyze', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query || query.length < 3) {
      res.status(400).json({ error: 'Please enter a specific operational question (at least 3 characters).' });
      return;
    }

    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const history = rawHistory
      .filter(
        (h: unknown): h is { query: string; summary: string } =>
          Boolean(
            h &&
              typeof (h as { query?: unknown }).query === 'string' &&
              typeof (h as { summary?: unknown }).summary === 'string'
          )
      )
      .slice(0, 6)
      .map((h: { query: string; summary: string }) => ({
        query: h.query.slice(0, 300),
        summary: h.summary.slice(0, 500),
      }));

    try {
      const weather = await getWeatherState(false);
      const assessments = computeAllAssessments(weather.observations);
      const incidents = getIncidents();
      const crews = getCrews();
      const activeRoutes = await computeActiveDispatchRoutes(incidents, crews);
      const alerts = getAlerts();
      const riskSnapshots = getRiskSnapshots(320);
      const dispatchHistory = getDispatchHistory(25);

      const openIncidents = incidents.filter(
        (i) => i.status !== 'Restored' && i.status !== 'Closed'
      );
      const routeOverridesByIncident: Record<
        string,
        Awaited<ReturnType<typeof computeDispatchRoutesForCrews>>
      > = {};

      await Promise.all(
        openIncidents.slice(0, 4).map(async (inc) => {
          routeOverridesByIncident[inc.id] = await computeDispatchRoutesForCrews(crews, inc);
        })
      );

      const result = await analyzeOperationsWithGemini({
        query,
        history,
        weatherStatus: weather.status,
        weatherUpdatedAt: weather.lastUpdated,
        weatherErrorMessage: weather.errorMessage,
        weatherObservations: weather.observations,
        riskAssessments: assessments,
        incidents,
        crews,
        activeRoutes,
        alerts,
        riskSnapshots,
        dispatchHistory,
        routeOverridesByIncident,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini AI analysis failed';
      res.status(502).json({ error: msg });
    }
  });

  // CSV Export (supports district & date filters parity with Reports & Analytics)
  app.get('/api/analytics/export.csv', async (req, res) => {
    const rawType = String(req.query.type || 'risk');
    const type: 'risk' | 'incidents' | 'crews' =
      rawType === 'incidents' || rawType === 'crews' ? rawType : 'risk';

    const districtId =
      typeof req.query.districtId === 'string' && req.query.districtId.trim()
        ? req.query.districtId.trim()
        : 'ALL';
    const rawWindow = String(req.query.dateWindow || 'ALL');
    const dateWindow: AnalyticsDateWindow =
      rawWindow === '1' ||
      rawWindow === '7' ||
      rawWindow === '30' ||
      rawWindow === 'CUSTOM'
        ? rawWindow
        : 'ALL';
    const customStartDate =
      typeof req.query.startDate === 'string' ? req.query.startDate.trim() : undefined;
    const customEndDate =
      typeof req.query.endDate === 'string' ? req.query.endDate.trim() : undefined;

    const weather = await getWeatherState(false);
    const assessments = computeAllAssessments(weather.observations);
    const incidents = getIncidents();
    const crews = getCrews();
    const dispatchHistory = getDispatchHistory(250);
    const riskSnapshots = getRiskSnapshots(320);

    const summary = computeAnalyticsSummary({
      districts: TELANGANA_DISTRICTS,
      assessments,
      weatherObservations: weather.observations,
      incidents,
      crews,
      dispatchHistory,
      riskSnapshots,
      filters: {
        districtId,
        dateWindow,
        customStartDate,
        customEndDate,
      },
    });

    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const fileSuffix =
      districtId !== 'ALL' ? `-${districtId.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';

    if (type === 'crews') {
      const csv = buildCrewAssignmentsCsv({
        crews: summary.filteredCrews,
        incidents,
        dispatchHistory: summary.filteredDispatchHistory,
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="stormsense-crew-assignments${fileSuffix}.csv"`
      );
      res.send(csv);
      return;
    }

    if (type === 'incidents') {
      const headers = [
        'Incident ID',
        'Title',
        'District',
        'Location',
        'Severity',
        'Fault Type',
        'Status',
        'Source',
        'Assigned Crew',
        'Affected Consumers',
        'Created At',
        'Resolved At',
        'Restoration Duration (min)',
      ];
      const rows = summary.filteredIncidents.map((i) => {
        let durationMinutes: string | number = '';
        if (i.resolvedAt) {
          const created = new Date(i.createdAt).getTime();
          const resolved = new Date(i.resolvedAt).getTime();
          if (Number.isFinite(created) && Number.isFinite(resolved) && resolved >= created) {
            durationMinutes = Math.max(1, Math.round((resolved - created) / 60_000));
          }
        }
        return [
          i.id,
          i.title,
          i.districtName,
          i.locationName,
          i.severity,
          i.faultType,
          i.status,
          i.source,
          i.assignedCrewName || 'Unassigned',
          i.affectedConsumers,
          i.createdAt,
          i.resolvedAt || '',
          durationMinutes,
        ]
          .map(esc)
          .join(',');
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="stormsense-incidents${fileSuffix}.csv"`
      );
      res.send([headers.join(','), ...rows].join('\n'));
      return;
    }

    const weatherMap = new Map(weather.observations.map((w) => [w.districtId, w]));
    const headers = [
      'District',
      'DISCOM',
      'Risk Score',
      'Risk Category',
      'Confidence',
      'Temperature (C)',
      'Rain (mm)',
      'Wind Speed (km/h)',
      'Wind Gusts (km/h)',
      'Precip Prob (%)',
      'Condition',
      'Weather Timestamp',
    ];
    const rows = summary.filteredAssessments.map((a) => {
      const d = DISTRICT_MAP.get(a.districtId);
      const w = weatherMap.get(a.districtId);
      return [
        a.districtName,
        d?.discom ?? '',
        a.score,
        a.category,
        a.confidence,
        w?.temperatureC ?? 'N/A',
        w?.rainMm ?? 'N/A',
        w?.windSpeedKmh ?? 'N/A',
        w?.windGustsKmh ?? 'N/A',
        w?.precipitationProbability ?? 'N/A',
        w?.weatherLabel ?? 'Unavailable',
        w?.fetchedAt ?? 'Unavailable',
      ]
        .map(esc)
        .join(',');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="stormsense-district-risk${fileSuffix}.csv"`
    );
    res.send([headers.join(','), ...rows].join('\n'));
  });

  // Periodic background weather refresh every 15 minutes
  setInterval(() => {
    getWeatherState(true)
      .then((weather) => {
        if (weather.observations.length > 0) {
          const assessments = computeAllAssessments(weather.observations);
          evaluateAutomatedAlerts(assessments, weather.observations);
          recordSnapshotsIfNeeded(assessments, weather.observations);
        }
      })
      .catch(() => {
        // Handled cleanly inside weatherService
      });
  }, 15 * 60_000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StormSense server listening on http://localhost:${PORT}`);
  });
}

startServer();
