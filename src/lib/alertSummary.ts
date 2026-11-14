import type {
  AlertItem,
  AlertLifecycleStatus,
  AlertSeverity,
  AlertSummaryStats,
} from './types';

export const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = {
  Critical: 4,
  High: 3,
  Moderate: 2,
  Informational: 1,
};

export const ALERT_STATUS_RANK: Record<AlertLifecycleStatus, number> = {
  New: 4,
  Acknowledged: 3,
  Assigned: 2,
  Resolved: 1,
};

export function normalizeAlertSeverity(raw: string | undefined | null): AlertSeverity {
  const val = (raw || '').trim().toLowerCase();
  if (val === 'critical') return 'Critical';
  if (val === 'high') return 'High';
  if (val === 'moderate' || val === 'warning' || val === 'medium') return 'Moderate';
  return 'Informational';
}

export function normalizeAlertStatus(
  raw: string | undefined | null,
  isRead = false
): AlertLifecycleStatus {
  const val = (raw || '').trim().toLowerCase();
  if (val === 'resolved') return 'Resolved';
  if (val === 'assigned') return 'Assigned';
  if (val === 'acknowledged') return 'Acknowledged';
  if (val === 'new') return 'New';
  return isRead ? 'Acknowledged' : 'New';
}

export function sortAlertsByPriority(alerts: AlertItem[]): AlertItem[] {
  return [...alerts].sort((a, b) => {
    const aResolved = a.status === 'Resolved' ? 0 : 1;
    const bResolved = b.status === 'Resolved' ? 0 : 1;
    if (aResolved !== bResolved) return bResolved - aResolved;

    const sevDiff = ALERT_SEVERITY_RANK[b.severity] - ALERT_SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;

    const statusDiff = ALERT_STATUS_RANK[b.status] - ALERT_STATUS_RANK[a.status];
    if (statusDiff !== 0) return statusDiff;

    return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
  });
}

export function computeAlertSummary(alerts: AlertItem[]): AlertSummaryStats {
  const bySeverity: Record<AlertSeverity, number> = {
    Critical: 0,
    High: 0,
    Moderate: 0,
    Informational: 0,
  };
  const byStatus: Record<AlertLifecycleStatus, number> = {
    New: 0,
    Acknowledged: 0,
    Assigned: 0,
    Resolved: 0,
  };

  let unread = 0;
  let active = 0;

  for (const alert of alerts) {
    bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;
    byStatus[alert.status] = (byStatus[alert.status] ?? 0) + 1;
    if (!alert.isRead) unread += 1;
    if (alert.status !== 'Resolved') active += 1;
  }

  return {
    total: alerts.length,
    unread,
    active,
    bySeverity,
    byStatus,
  };
}
