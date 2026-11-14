import crypto from 'node:crypto';
import {
  evaluateAlertRules,
  shouldEscalateSeverity,
  type AlertCandidate,
} from '../src/lib/alertEvaluator';
import { normalizeAlertSeverity, normalizeAlertStatus } from '../src/lib/alertSummary';
import type {
  AlertConfig,
  AlertLifecycleStatus,
  Incident,
  RiskAssessment,
  WeatherObservation,
} from '../src/lib/types';
import { db, getAlertConfig, getIncidents } from './db';

const MANUAL_RESOLVE_COOLDOWN_MS = 15 * 60_000;

interface ActiveAlertRow {
  id: string;
  dedupeKey: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  explanation: string;
  assignedCrewId: string | null;
  assignedCrewName: string | null;
  isRead: number;
  acknowledgedAt: string | null;
}

function generateAlertId(): string {
  return `ALT-${Date.now()}-${crypto.randomInt(1000, 9999)}`;
}

function upsertCandidate(candidate: AlertCandidate, nowIso: string, reopenIfResolved = false) {
  const active = db
    .prepare(
      `SELECT id, dedupeKey, type, severity, status, title, message, explanation,
              assignedCrewId, assignedCrewName, isRead, acknowledgedAt
       FROM alerts
       WHERE dedupeKey = ? AND status != 'Resolved'
       LIMIT 1`
    )
    .get(candidate.dedupeKey) as ActiveAlertRow | undefined;

  if (active) {
    const currentSeverity = normalizeAlertSeverity(active.severity);
    const currentStatus = normalizeAlertStatus(active.status, Boolean(active.isRead));
    const escalated = shouldEscalateSeverity(currentSeverity, candidate.severity);

    let nextStatus: AlertLifecycleStatus = currentStatus;
    let nextIsRead = Boolean(active.isRead);
    let nextAcknowledgedAt = active.acknowledgedAt;

    if (candidate.suggestedStatus === 'Assigned') {
      nextStatus = 'Assigned';
      if (!active.assignedCrewId && candidate.assignedCrewId) {
        // Newly assigned crew updates lifecycle to Assigned
        nextIsRead = true;
        if (!nextAcknowledgedAt) nextAcknowledgedAt = nowIso;
      }
    } else if (escalated && currentStatus === 'Acknowledged') {
      // Escalation brings the alert back to operator attention
      nextStatus = 'New';
      nextIsRead = false;
    }

    const changed =
      active.type !== candidate.type ||
      currentSeverity !== candidate.severity ||
      currentStatus !== nextStatus ||
      active.title !== candidate.title ||
      active.message !== candidate.message ||
      active.explanation !== candidate.explanation ||
      active.assignedCrewId !== candidate.assignedCrewId ||
      active.assignedCrewName !== candidate.assignedCrewName;

    if (!changed) return;

    db.prepare(
      `UPDATE alerts
       SET type = ?, severity = ?, status = ?, title = ?, message = ?, explanation = ?,
           districtId = ?, districtName = ?, incidentId = ?, incidentTitle = ?,
           assignedCrewId = ?, assignedCrewName = ?, provenance = ?,
           isRead = ?, updatedAt = ?, acknowledgedAt = ?
       WHERE id = ?`
    ).run(
      candidate.type,
      candidate.severity,
      nextStatus,
      candidate.title,
      candidate.message,
      candidate.explanation,
      candidate.districtId,
      candidate.districtName,
      candidate.incidentId,
      candidate.incidentTitle,
      candidate.assignedCrewId,
      candidate.assignedCrewName,
      candidate.provenance,
      nextIsRead ? 1 : 0,
      nowIso,
      nextAcknowledgedAt,
      active.id
    );
    return;
  }

  // Cooldown guard: prevent bounce duplicates if recently resolved unless severity escalated or reopen requested
  if (!reopenIfResolved) {
    const recentResolved = db
      .prepare(
        `SELECT severity, resolvedAt FROM alerts
         WHERE dedupeKey = ? AND status = 'Resolved'
         ORDER BY COALESCE(resolvedAt, updatedAt, createdAt) DESC
         LIMIT 1`
      )
      .get(candidate.dedupeKey) as { severity: string; resolvedAt: string | null } | undefined;

    if (recentResolved?.resolvedAt) {
      const elapsed = Date.now() - new Date(recentResolved.resolvedAt).getTime();
      const prevSeverity = normalizeAlertSeverity(recentResolved.severity);
      if (
        elapsed < MANUAL_RESOLVE_COOLDOWN_MS &&
        !shouldEscalateSeverity(prevSeverity, candidate.severity)
      ) {
        return;
      }
    }
  }

  const initialStatus: AlertLifecycleStatus = candidate.suggestedStatus ?? 'New';
  const initialRead = initialStatus === 'Resolved' ? 1 : 0;

  db.prepare(
    `INSERT INTO alerts (
      id, dedupeKey, type, severity, status, title, message, explanation,
      districtId, districtName, incidentId, incidentTitle,
      assignedCrewId, assignedCrewName, provenance, isRead,
      createdAt, updatedAt, acknowledgedAt, resolvedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateAlertId(),
    candidate.dedupeKey,
    candidate.type,
    candidate.severity,
    initialStatus,
    candidate.title,
    candidate.message,
    candidate.explanation,
    candidate.districtId,
    candidate.districtName,
    candidate.incidentId,
    candidate.incidentTitle,
    candidate.assignedCrewId,
    candidate.assignedCrewName,
    candidate.provenance,
    initialRead,
    nowIso,
    nowIso,
    initialStatus === 'Assigned' ? nowIso : null,
    null
  );
}

function autoResolveByKey(dedupeKey: string, nowIso: string, reason?: string) {
  const openRows = db
    .prepare(
      `SELECT id, explanation FROM alerts WHERE dedupeKey = ? AND status != 'Resolved'`
    )
    .all(dedupeKey) as Array<{ id: string; explanation: string }>;

  if (openRows.length === 0) return;

  const stmt = db.prepare(
    `UPDATE alerts
     SET status = 'Resolved', isRead = 1, updatedAt = ?, resolvedAt = ?,
         acknowledgedAt = COALESCE(acknowledgedAt, ?),
         explanation = ?
     WHERE id = ?`
  );

  for (const row of openRows) {
    const nextExplanation = reason
      ? `${row.explanation} [Auto-resolved: ${reason}]`
      : row.explanation;
    stmt.run(nowIso, nowIso, nowIso, nextExplanation, row.id);
  }
}

export function evaluateAutomatedAlerts(
  assessments: RiskAssessment[],
  weatherList: WeatherObservation[]
) {
  const config: AlertConfig = getAlertConfig();
  const incidents = getIncidents();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { candidates, autoResolveKeys } = evaluateAlertRules({
    assessments,
    weatherList,
    incidents,
    config,
    nowMs,
  });

  const validIncidentIds = new Set(incidents.map((i) => i.id));
  const orphanIncidentAlerts = db
    .prepare(
      `SELECT id, incidentId, explanation FROM alerts WHERE incidentId IS NOT NULL AND status != 'Resolved'`
    )
    .all() as Array<{ id: string; incidentId: string; explanation: string }>;

  const tx = db.transaction(() => {
    for (const orphan of orphanIncidentAlerts) {
      if (!validIncidentIds.has(orphan.incidentId)) {
        db.prepare(
          `UPDATE alerts
           SET status = 'Resolved', isRead = 1, updatedAt = ?, resolvedAt = ?,
               acknowledgedAt = COALESCE(acknowledgedAt, ?), explanation = ?
           WHERE id = ?`
        ).run(
          nowIso,
          nowIso,
          nowIso,
          `${orphan.explanation} [Auto-resolved: Incident ${orphan.incidentId} removed from registry]`,
          orphan.id
        );
      }
    }

    for (const key of autoResolveKeys) {
      let reason = 'Condition returned within configured threshold';
      if (key.startsWith('incident:unassigned:')) {
        reason = 'Maintenance crew assigned or incident closed';
      } else if (key.startsWith('incident:active:') || key.startsWith('incident:delay:')) {
        reason = 'Incident restored or closed';
      }
      autoResolveByKey(key, nowIso, reason);
    }

    for (const candidate of candidates) {
      upsertCandidate(candidate, nowIso, false);
    }
  });
  tx();
}

export function syncIncidentAlertsOnMutation(
  incident: Incident,
  action: 'created' | 'updated' | 'assigned' | 'deleted'
) {
  const nowIso = new Date().toISOString();
  const config = getAlertConfig();

  const tx = db.transaction(() => {
    if (action === 'deleted' || incident.status === 'Restored' || incident.status === 'Closed') {
      const reason =
        action === 'deleted'
          ? `Incident ${incident.id} removed from registry`
          : `Incident ${incident.id} marked ${incident.status}`;
      const openIncidentAlerts = db
        .prepare(`SELECT id, explanation FROM alerts WHERE incidentId = ? AND status != 'Resolved'`)
        .all(incident.id) as Array<{ id: string; explanation: string }>;

      const resolveStmt = db.prepare(
        `UPDATE alerts
         SET status = 'Resolved', isRead = 1, updatedAt = ?, resolvedAt = ?,
             acknowledgedAt = COALESCE(acknowledgedAt, ?), explanation = ?
         WHERE id = ?`
      );
      for (const row of openIncidentAlerts) {
        resolveStmt.run(nowIso, nowIso, nowIso, `${row.explanation} [${reason}]`, row.id);
      }
      return;
    }

    const { candidates, autoResolveKeys } = evaluateAlertRules({
      assessments: [],
      weatherList: [],
      incidents: [incident],
      config,
      nowMs: Date.now(),
    });

    for (const key of autoResolveKeys) {
      autoResolveByKey(
        key,
        nowIso,
        incident.assignedCrewId
          ? `Crew ${incident.assignedCrewName ?? incident.assignedCrewId} assigned`
          : 'Within configured SLA'
      );
    }

    for (const candidate of candidates) {
      // Allow re-opening / updating immediately when an incident is explicitly mutated or assigned
      upsertCandidate(candidate, nowIso, action === 'assigned' || action === 'updated');
    }
  });
  tx();
}

export function updateAlertLifecycleStatus(
  id: string,
  status: AlertLifecycleStatus
): boolean {
  const existing = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as
    | { id: string; dedupeKey: string | null; acknowledgedAt: string | null; resolvedAt: string | null }
    | undefined;
  if (!existing) return false;

  const nowIso = new Date().toISOString();

  // If reopening a resolved alert, ensure no other active alert holds the same dedupeKey
  if (status !== 'Resolved' && existing.dedupeKey) {
    const conflictingActive = db
      .prepare(
        `SELECT id FROM alerts WHERE dedupeKey = ? AND status != 'Resolved' AND id != ? LIMIT 1`
      )
      .get(existing.dedupeKey, existing.id);
    if (conflictingActive) {
      return false;
    }
  }

  const isRead = status === 'New' ? 0 : 1;
  const acknowledgedAt =
    status === 'New' ? null : existing.acknowledgedAt || nowIso;
  const resolvedAt = status === 'Resolved' ? existing.resolvedAt || nowIso : null;

  db.prepare(
    `UPDATE alerts
     SET status = ?, isRead = ?, updatedAt = ?, acknowledgedAt = ?, resolvedAt = ?
     WHERE id = ?`
  ).run(status, isRead, nowIso, acknowledgedAt, resolvedAt, id);

  return true;
}

export function updateAlertReadState(id: string, isRead: boolean): boolean {
  const existing = db
    .prepare('SELECT id, status, acknowledgedAt FROM alerts WHERE id = ?')
    .get(id) as { id: string; status: string; acknowledgedAt: string | null } | undefined;
  if (!existing) return false;

  const nowIso = new Date().toISOString();
  const currentStatus = normalizeAlertStatus(existing.status, !isRead);
  let nextStatus: AlertLifecycleStatus = currentStatus;
  let nextAck = existing.acknowledgedAt;

  if (isRead && currentStatus === 'New') {
    nextStatus = 'Acknowledged';
    nextAck = nextAck || nowIso;
  } else if (!isRead && currentStatus === 'Acknowledged') {
    nextStatus = 'New';
    nextAck = null;
  }

  db.prepare(
    `UPDATE alerts
     SET isRead = ?, status = ?, acknowledgedAt = ?, updatedAt = ?
     WHERE id = ?`
  ).run(isRead ? 1 : 0, nextStatus, nextAck, nowIso, id);

  return true;
}

export function markAllAlertsAcknowledged() {
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE alerts
     SET isRead = 1,
         status = CASE WHEN status = 'New' THEN 'Acknowledged' ELSE status END,
         acknowledgedAt = COALESCE(acknowledgedAt, ?),
         updatedAt = CASE WHEN isRead = 0 OR status = 'New' THEN ? ELSE updatedAt END`
  ).run(nowIso, nowIso);
}

export function clearResolvedAlerts() {
  db.prepare(`DELETE FROM alerts WHERE status = 'Resolved'`).run();
}
