import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  Info,
  MapPin,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { AnimatedNumber } from '../components/graphics/AnimatedNumber';
import { formatIstDateTime } from '../components/ui/DataProvenanceTag';
import { useStormSense } from '../context/StormSenseContext';
import type { AlertItem, AlertLifecycleStatus, AlertSeverity } from '../lib/types';

const SEVERITY_BADGE_STYLE: Record<AlertSeverity, string> = {
  Critical: 'text-[#F29B9B] bg-[#E36D6D]/20 border-[#E36D6D]/50',
  High: 'text-[#F0A478] bg-[#E58854]/18 border-[#E58854]/45',
  Moderate: 'text-[#F2C16E] bg-[#E5A94C]/18 border-[#E5A94C]/45',
  Informational: 'text-[#70A9CF] bg-[#70A9CF]/18 border-[#70A9CF]/45',
};

const STATUS_BADGE_STYLE: Record<AlertLifecycleStatus, string> = {
  New: 'text-[#F29B9B] bg-[#E36D6D]/20 border-[#E36D6D]/50',
  Acknowledged: 'text-[#55B7B0] bg-[#55B7B0]/18 border-[#55B7B0]/45',
  Assigned: 'text-[#70A9CF] bg-[#70A9CF]/18 border-[#70A9CF]/45',
  Resolved: 'text-[#8BE0C4] bg-[#5AC49E]/18 border-[#5AC49E]/45',
};

const SEVERITIES: AlertSeverity[] = ['Critical', 'High', 'Moderate', 'Informational'];
const LIFECYCLE_STATUSES: AlertLifecycleStatus[] = ['New', 'Acknowledged', 'Assigned', 'Resolved'];

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === 'Critical') {
    return <ShieldAlert className="w-3.5 h-3.5 text-[#E36D6D] shrink-0" aria-hidden="true" />;
  }
  if (severity === 'High' || severity === 'Moderate') {
    return (
      <AlertTriangle
        className={`w-3.5 h-3.5 shrink-0 ${severity === 'High' ? 'text-[#E58854]' : 'text-[#E5A94C]'}`}
        aria-hidden="true"
      />
    );
  }
  return <Info className="w-3.5 h-3.5 text-[#70A9CF] shrink-0" aria-hidden="true" />;
}

export function AlertsPage() {
  const {
    alerts,
    alertSummary,
    alertConfig,
    districts,
    currentUser,
    markAlertRead,
    updateAlertStatus,
    markAllAlertsRead,
    clearReadAlerts,
    setActivePage,
    setSelectedDistrictId,
  } = useStormSense();

  const [severityFilter, setSeverityFilter] = useState<'ALL' | AlertSeverity>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AlertLifecycleStatus>('ALL');
  const [districtFilter, setDistrictFilter] = useState<string>('ALL');
  const [readFilter, setReadFilter] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isReadOnly = currentUser?.role === 'Read-only Evaluator';
  const canClear =
    currentUser?.role === 'Administrator' || currentUser?.role === 'Operations Manager';

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (severityFilter !== 'ALL' && a.severity !== severityFilter) return false;
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (districtFilter !== 'ALL' && a.districtId !== districtFilter) return false;
      if (readFilter === 'UNREAD' && a.isRead) return false;
      if (readFilter === 'READ' && !a.isRead) return false;
      return true;
    });
  }, [alerts, severityFilter, statusFilter, districtFilter, readFilter]);

  const handleLifecycleChange = async (alert: AlertItem, nextStatus: AlertLifecycleStatus) => {
    setActionError(null);
    setBusyAlertId(alert.id);
    try {
      await updateAlertStatus(alert.id, nextStatus);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update alert lifecycle');
    } finally {
      setBusyAlertId(null);
    }
  };

  const handleToggleRead = async (alert: AlertItem) => {
    setActionError(null);
    setBusyAlertId(alert.id);
    try {
      await markAlertRead(alert.id, !alert.isRead);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update read state');
    } finally {
      setBusyAlertId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setActionError(null);
    try {
      await markAllAlertsRead();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to acknowledge all alerts');
    }
  };

  const handleClearResolved = async () => {
    setActionError(null);
    try {
      await clearReadAlerts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to clear resolved alerts');
    }
  };

  const handleInspectDistrict = (districtId: string) => {
    setSelectedDistrictId(districtId);
    setActivePage('risk');
  };

  return (
    <div className="space-y-5">
      <div className="p-4 ss-card flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold text-[#E5EDF3] flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
            <span>
              Automated Alert Management ({alertSummary.unread} Unread · {alertSummary.active} Active)
            </span>
          </h2>
          <p className="text-xs text-[#8FA3B3]">
            Application-generated alerts deduplicated by condition and prioritized by severity (Critical → High → Moderate → Informational). Distinct from official IMD/government bulletins.
          </p>
          {alertConfig && (
            <div className="text-[11px] font-mono text-[#AABBC9]">
              Active Thresholds: Risk Mod ≥ {alertConfig.moderateRiskThreshold} / High ≥{' '}
              {alertConfig.highRiskThreshold} / Crit ≥ {alertConfig.criticalRiskThreshold} · Gusts ≥{' '}
              {alertConfig.highWindThresholdKmh} km/h · Rain ≥ {alertConfig.heavyRainThresholdMm} mm/h ·
              Unassigned SLA {alertConfig.unassignedAlertMinutes}m
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActivePage('settings')}
            className="px-3 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs text-[#E5EDF3] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
            <span>Configure Thresholds</span>
          </button>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={alertSummary.unread === 0}
            className="px-3 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-45 text-xs font-semibold text-[#17222B] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Acknowledge All</span>
          </button>
          {canClear && (
            <button
              type="button"
              onClick={handleClearResolved}
              disabled={alertSummary.byStatus.Resolved === 0}
              className="px-3 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#E36D6D]/70 hover:bg-[#E36D6D]/18 disabled:opacity-45 text-xs text-[#AABBC9] hover:text-[#F29B9B] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear Resolved</span>
            </button>
          )}
        </div>
      </div>

      <section aria-label="Alert Severity and Lifecycle Summary" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 ss-card">
          <div className="text-[11px] text-[#8FA3B3]">Unread Alerts</div>
          <div className="font-mono text-xl font-bold text-[#E5EDF3] mt-0.5">
            <AnimatedNumber value={alertSummary.unread} />
          </div>
        </div>
        <div className="p-3 ss-card">
          <div className="text-[11px] text-[#F29B9B]">Critical</div>
          <div className="font-mono text-xl font-bold text-[#E36D6D] mt-0.5">
            <AnimatedNumber value={alertSummary.bySeverity.Critical} />
          </div>
        </div>
        <div className="p-3 ss-card">
          <div className="text-[11px] text-[#F0A478]">High</div>
          <div className="font-mono text-xl font-bold text-[#E58854] mt-0.5">
            <AnimatedNumber value={alertSummary.bySeverity.High} />
          </div>
        </div>
        <div className="p-3 ss-card">
          <div className="text-[11px] text-[#F2C16E]">Moderate</div>
          <div className="font-mono text-xl font-bold text-[#E5A94C] mt-0.5">
            <AnimatedNumber value={alertSummary.bySeverity.Moderate} />
          </div>
        </div>
        <div className="p-3 ss-card">
          <div className="text-[11px] text-[#70A9CF]">Informational</div>
          <div className="font-mono text-xl font-bold text-[#70A9CF] mt-0.5">
            <AnimatedNumber value={alertSummary.bySeverity.Informational} />
          </div>
        </div>
        <div className="p-3 ss-card">
          <div className="text-[11px] text-[#8BE0C4]">Resolved</div>
          <div className="font-mono text-xl font-bold text-[#5AC49E] mt-0.5">
            <AnimatedNumber value={alertSummary.byStatus.Resolved} />
          </div>
        </div>
      </section>

      {actionError && (
        <div role="alert" className="px-4 py-2 rounded bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-xs text-[#F6C5C5]">
          {actionError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <select
          aria-label="Filter alerts by severity"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as 'ALL' | AlertSeverity)}
          className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
        >
          <option value="ALL">All Severities ({alerts.length})</option>
          {SEVERITIES.map((sev) => (
            <option key={sev} value={sev}>
              {sev} ({alertSummary.bySeverity[sev]})
            </option>
          ))}
        </select>

        <select
          aria-label="Filter alerts by lifecycle status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'ALL' | AlertLifecycleStatus)}
          className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
        >
          <option value="ALL">All Lifecycle States</option>
          {LIFECYCLE_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st} ({alertSummary.byStatus[st]})
            </option>
          ))}
        </select>

        <select
          aria-label="Filter alerts by district"
          value={districtFilter}
          onChange={(e) => setDistrictFilter(e.target.value)}
          className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
        >
          <option value="ALL">All Districts</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 p-1 rounded-md bg-[#344655] border border-[#60788A]">
          {(['ALL', 'UNREAD', 'READ'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setReadFilter(tab)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                readFilter === tab ? 'bg-[#70A9CF] text-[#17222B] font-semibold' : 'text-[#AABBC9] hover:text-[#E5EDF3]'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab === 'UNREAD' ? 'Unread' : 'Read'}
            </button>
          ))}
        </div>
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="p-10 ss-card text-center space-y-2.5">
          <p className="text-sm text-[#AABBC9]">No alerts match the selected filters.</p>
          {(severityFilter !== 'ALL' ||
            statusFilter !== 'ALL' ||
            districtFilter !== 'ALL' ||
            readFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSeverityFilter('ALL');
                setStatusFilter('ALL');
                setDistrictFilter('ALL');
                setReadFilter('ALL');
              }}
              className="px-3 py-1.5 rounded bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs text-[#E5EDF3] transition-colors"
            >
              Reset Alert Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredAlerts.map((alert) => {
            const isBusy = busyAlertId === alert.id;
            const isResolved = alert.status === 'Resolved';
            return (
              <article
                key={alert.id}
                className={`p-4 ss-card transition-all duration-150 space-y-2.5 ${
                  isResolved
                    ? 'opacity-70'
                    : alert.isRead
                      ? ''
                      : 'border-[#70A9CF]/80'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono text-[11px] font-medium ${SEVERITY_BADGE_STYLE[alert.severity]}`}
                      >
                        <SeverityIcon severity={alert.severity} />
                        <span>{alert.severity}</span>
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded border font-mono text-[11px] ${STATUS_BADGE_STYLE[alert.status]}`}
                      >
                        {alert.status}
                      </span>

                      {alert.districtName && (
                        <button
                          type="button"
                          onClick={() => alert.districtId && handleInspectDistrict(alert.districtId)}
                          className="inline-flex items-center gap-1 text-[#E5EDF3] hover:text-[#55B7B0] font-medium transition-colors"
                        >
                          <MapPin className="w-3 h-3 text-[#55B7B0]" aria-hidden="true" />
                          <span>{alert.districtName}</span>
                        </button>
                      )}

                      {alert.incidentId && (
                        <button
                          type="button"
                          onClick={() => setActivePage('incidents')}
                          className="font-mono text-[11px] text-[#70A9CF] hover:underline font-medium"
                        >
                          {alert.incidentId}
                        </button>
                      )}

                      {alert.assignedCrewName && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#70A9CF] font-medium">
                          <UserCheck className="w-3 h-3 text-[#55B7B0]" aria-hidden="true" />
                          <span>{alert.assignedCrewName}</span>
                        </span>
                      )}

                      <span aria-hidden="true" className="text-[#60788A]">·</span>
                      <span className="text-[11px] text-[#8FA3B3]">
                        {alert.provenance} (App Alert · Not Official IMD Warning)
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-[#E5EDF3]">{alert.title}</h3>
                    <p className="text-xs text-[#AABBC9] leading-relaxed">{alert.message}</p>

                    {alert.explanation && alert.explanation !== alert.message && (
                      <div className="p-2.5 rounded bg-[#344655]/90 border border-[#52697A] text-[11px] text-[#AABBC9] leading-relaxed">
                        <span className="text-[#55B7B0] font-semibold">Trigger Explanation: </span>
                        {alert.explanation}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] font-mono text-[#8FA3B3] tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        <span>Triggered: {formatIstDateTime(alert.createdAt)}</span>
                      </span>
                      {alert.updatedAt && alert.updatedAt !== alert.createdAt && (
                        <span>Updated: {formatIstDateTime(alert.updatedAt)}</span>
                      )}
                      {alert.acknowledgedAt && (
                        <span>Ack: {formatIstDateTime(alert.acknowledgedAt)}</span>
                      )}
                      {alert.resolvedAt && (
                        <span className="text-[#8BE0C4]">
                          Resolved: {formatIstDateTime(alert.resolvedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap sm:flex-col items-stretch gap-1.5 shrink-0">
                    {!isResolved && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleToggleRead(alert)}
                        className="px-3 py-1.5 rounded bg-[#344655] border border-[#60788A] hover:border-[#70A9CF] disabled:opacity-50 text-xs text-[#E5EDF3] whitespace-nowrap transition-colors"
                      >
                        {alert.isRead ? 'Mark Unread' : 'Acknowledge'}
                      </button>
                    )}

                    {!isReadOnly && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleLifecycleChange(alert, isResolved ? 'Acknowledged' : 'Resolved')
                        }
                        className={`px-3 py-1.5 rounded border text-xs whitespace-nowrap transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                          isResolved
                            ? 'bg-[#344655] border-[#60788A] hover:border-[#70A9CF] text-[#E5EDF3]'
                            : 'bg-[#5AC49E]/18 border-[#5AC49E]/45 hover:bg-[#5AC49E]/28 text-[#8BE0C4] font-medium'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isResolved ? 'Reopen' : 'Resolve'}</span>
                      </button>
                    )}

                    {alert.incidentId && !isResolved && (
                      <button
                        type="button"
                        onClick={() => setActivePage('dispatch')}
                        className="px-3 py-1.5 rounded bg-[#70A9CF]/18 border border-[#70A9CF]/45 hover:border-[#70A9CF] text-xs text-[#E5EDF3] font-medium whitespace-nowrap transition-colors"
                      >
                        {alert.assignedCrewId ? 'View Crew' : 'Dispatch Crew'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
