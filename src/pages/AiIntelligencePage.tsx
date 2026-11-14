import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Database,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStormSense } from '../context/StormSenseContext';
import { formatIstDateTime } from '../components/ui/DataProvenanceTag';
import type {
  AiConversationTurnSummary,
  AiDataReference,
  AiGroundedChart,
  AiRecommendedAction,
  AiReferenceSourceType,
  AiStructuredResponse,
} from '../lib/types';

const AI_HISTORY_STORAGE_KEY = 'stormsense_ai_turns_v1';

interface ConversationTurn {
  id: string;
  query: string;
  result?: { response: AiStructuredResponse; model: string };
  error?: string;
  askedAt: string;
}

interface PendingDispatchConfirmation {
  incidentId: string;
  crewId: string;
  targetLabel: string;
  rationale: string;
}

const SOURCE_STYLE: Record<AiReferenceSourceType, string> = {
  'Live API Data': 'text-[#55B7B0] bg-[#55B7B0]/18 border-[#55B7B0]/45',
  'Derived Prediction': 'text-[#70A9CF] bg-[#70A9CF]/18 border-[#70A9CF]/45',
  'Simulated Demonstration Data': 'text-[#F2C16E] bg-[#E5A94C]/18 border-[#E5A94C]/45',
  'Historical Snapshot': 'text-[#AABBC9] bg-[#3B5061] border-[#60788A]',
  'Alert Engine': 'text-[#F0A478] bg-[#E58854]/18 border-[#E58854]/45',
  'Dispatch Engine': 'text-[#8BE0C4] bg-[#5AC49E]/18 border-[#5AC49E]/45',
};

const PRIORITY_STYLE: Record<AiRecommendedAction['priority'], string> = {
  Immediate: 'text-[#F29B9B] bg-[#E36D6D]/20 border-[#E36D6D]/50',
  'Short-Term': 'text-[#F2C16E] bg-[#E5A94C]/18 border-[#E5A94C]/45',
  Monitoring: 'text-[#55B7B0] bg-[#55B7B0]/18 border-[#55B7B0]/45',
};

function GroundedBriefingChart({ chart }: { chart: AiGroundedChart }) {
  if (!chart || !chart.data || chart.data.length === 0) return null;

  return (
    <div className="rounded-md bg-[#344655]/90 border border-[#52697A] p-4 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-[#E5EDF3]">{chart.title}</div>
          <div className="text-[11px] text-[#8FA3B3]">{chart.subtitle}</div>
        </div>
        <span className="text-[11px] font-mono text-[#55B7B0] font-medium whitespace-nowrap shrink-0">
          Verified Data Series
        </span>
      </div>

      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart.chartType === 'line' ? (
            <LineChart data={chart.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
              <XAxis dataKey={chart.xKey} tick={{ fill: '#AABBC9', fontSize: 11 }} stroke="#60788A" />
              <YAxis tick={{ fill: '#AABBC9', fontSize: 11 }} stroke="#60788A" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#344655',
                  borderColor: '#60788A',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#E5EDF3',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#AABBC9' }} />
              {chart.series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={chart.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
              <XAxis dataKey={chart.xKey} tick={{ fill: '#AABBC9', fontSize: 11 }} stroke="#60788A" interval={0} />
              <YAxis tick={{ fill: '#AABBC9', fontSize: 11 }} stroke="#60788A" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#344655',
                  borderColor: '#60788A',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#E5EDF3',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#AABBC9' }} />
              {chart.series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DataReferenceRow({ item }: { item: AiDataReference }) {
  return (
    <div className="rounded bg-[#344655] border border-[#52697A] px-3 py-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${SOURCE_STYLE[item.sourceType]}`}
        >
          {item.sourceType}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#8FA3B3]">
          {item.districtName && <span className="text-[#E5EDF3] font-medium">{item.districtName}</span>}
          {item.incidentId && <span className="text-[#F2C16E] font-medium">{item.incidentId}</span>}
          {item.timestamp && <span>{formatIstDateTime(item.timestamp)}</span>}
        </div>
      </div>
      <div className="text-xs text-[#AABBC9] flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[#8FA3B3]">{item.label}</span>
        <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">{item.value}</span>
      </div>
    </div>
  );
}

export function AiIntelligencePage() {
  const {
    askGemini,
    weather,
    incidents,
    crews,
    alertSummary,
    riskSnapshots,
    currentUser,
    assignCrewToIncident,
    openDispatchForIncident,
    setActivePage,
    setSelectedDistrictId,
  } = useStormSense();

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<ConversationTurn[]>(() => {
    try {
      const saved = localStorage.getItem(AI_HISTORY_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as ConversationTurn[]) : [];
    } catch {
      return [];
    }
  });

  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingDispatchConfirmation | null>(null);
  const [confirmingDispatch, setConfirmingDispatch] = useState(false);
  const [confirmationFeedback, setConfirmationFeedback] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(AI_HISTORY_STORAGE_KEY, JSON.stringify(turns.slice(0, 15)));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }, [turns]);

  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'Restored' && i.status !== 'Closed'),
    [incidents]
  );

  const topUnassignedIncident = useMemo(
    () =>
      openIncidents.find((i) => !i.assignedCrewId && i.severity === 'Critical') ??
      openIncidents.find((i) => !i.assignedCrewId) ??
      openIncidents[0],
    [openIncidents]
  );

  const suggestedQuestions = useMemo(
    () => [
      'Which districts currently have the highest outage risk?',
      'Why is Warangal receiving its current risk score?',
      'Which incidents need immediate attention?',
      topUnassignedIncident
        ? `Which available crew is best suited for incident ${topUnassignedIncident.id}?`
        : 'Which available crew is best suited for open incidents?',
      'Summarize the current statewide operational situation.',
      'Compare the current weather with the previous recorded snapshot.',
    ],
    [topUnassignedIncident]
  );

  const canExecuteDispatch =
    currentUser?.role === 'Administrator' ||
    currentUser?.role === 'Operations Manager' ||
    currentUser?.role === 'Field Operator';

  const submitQuery = async (text: string, retryTurnId?: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || loading) return;
    setLoading(true);
    setConfirmationFeedback(null);

    const id = retryTurnId ?? `turn-${Date.now()}`;
    const askedAt = new Date().toISOString();

    const historyContext: AiConversationTurnSummary[] = turns
      .filter((t) => t.id !== id && t.result)
      .slice(0, 5)
      .map((t) => ({
        query: t.query,
        summary: t.result!.response.summary,
      }));

    try {
      const result = await askGemini(trimmed, historyContext);
      setTurns((prev) => {
        const filtered = retryTurnId ? prev.filter((t) => t.id !== retryTurnId) : prev;
        return [{ id, query: trimmed, result, askedAt }, ...filtered].slice(0, 15);
      });
      if (!retryTurnId) {
        setQuery('');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gemini Operational Intelligence request failed.';
      setTurns((prev) => {
        const filtered = retryTurnId ? prev.filter((t) => t.id !== retryTurnId) : prev;
        return [{ id, query: trimmed, error: message, askedAt }, ...filtered].slice(0, 15);
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuery(query);
  };

  const handleActionTrigger = (act: AiRecommendedAction) => {
    setConfirmationError(null);
    setConfirmationFeedback(null);

    if (act.actionType === 'review_dispatch' && act.incidentId && act.crewId) {
      setPendingConfirmation({
        incidentId: act.incidentId,
        crewId: act.crewId,
        targetLabel: act.target,
        rationale: act.action,
      });
      return;
    }

    if (act.incidentId) {
      if (act.actionType === 'review_dispatch') {
        openDispatchForIncident(act.incidentId);
      } else {
        setActivePage('incidents');
      }
      return;
    }

    if (act.actionType === 'review_alerts') {
      setActivePage('alerts');
      return;
    }

    if (act.districtId || act.actionType === 'review_district_risk') {
      if (act.districtId) setSelectedDistrictId(act.districtId);
      setActivePage('risk');
    }
  };

  const handleConfirmDispatch = async () => {
    if (!pendingConfirmation) return;
    setConfirmingDispatch(true);
    setConfirmationError(null);
    try {
      await assignCrewToIncident(pendingConfirmation.incidentId, pendingConfirmation.crewId);
      setConfirmationFeedback(
        `Operator confirmed dispatch: ${pendingConfirmation.crewId} assigned to ${pendingConfirmation.incidentId}.`
      );
      setPendingConfirmation(null);
    } catch (err) {
      setConfirmationError(
        err instanceof Error ? err.message : 'Unable to execute crew assignment.'
      );
    } finally {
      setConfirmingDispatch(false);
    }
  };

  const readyCrewsCount = crews.filter(
    (c) => c.availability === 'Available' || c.availability === 'Standby'
  ).length;

  return (
    <div className="space-y-5">
      <section
        aria-label="Operational Grounding Scope"
        className="ss-card p-5 space-y-4"
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
                Gemini Operational Intelligence Center
              </h2>
            </div>
            <p className="text-xs text-[#8FA3B3]">
              Advisory operational briefing connected directly to Telangana Open-Meteo telemetry,
              risk factor breakdowns, forecasts, incidents, crew dispatch scoring, alerts, and
              historical snapshots.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#AABBC9] shrink-0">
            <ShieldCheck className="w-4 h-4 text-[#5AC49E]" aria-hidden="true" />
            <span>Advisory Only · Operator Confirmation Required for Actions</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-md bg-[#344655]/90 border border-[#52697A] px-3 py-2">
            <div className="text-[#8FA3B3]">Weather Feed</div>
            <div className="font-mono tabular-nums text-[#E5EDF3] font-medium mt-0.5 truncate">
              {weather.status === 'live' ? 'Live' : weather.status === 'stale' ? 'Stale' : 'Error'} ·{' '}
              {formatIstDateTime(weather.lastUpdated)}
            </div>
          </div>
          <div className="rounded-md bg-[#344655]/90 border border-[#52697A] px-3 py-2">
            <div className="text-[#8FA3B3]">Active Incidents</div>
            <div className="font-mono tabular-nums text-[#E5EDF3] font-medium mt-0.5">
              {openIncidents.length} open ·{' '}
              {openIncidents.filter((i) => !i.assignedCrewId).length} unassigned
            </div>
          </div>
          <div className="rounded-md bg-[#344655]/90 border border-[#52697A] px-3 py-2">
            <div className="text-[#8FA3B3]">Crew Readiness</div>
            <div className="font-mono tabular-nums text-[#E5EDF3] font-medium mt-0.5">
              {readyCrewsCount} ready / {crews.length} total
            </div>
          </div>
          <div className="rounded-md bg-[#344655]/90 border border-[#52697A] px-3 py-2">
            <div className="text-[#8FA3B3]">Alerts &amp; Snapshots</div>
            <div className="font-mono tabular-nums text-[#E5EDF3] font-medium mt-0.5">
              {alertSummary.unread} unread · {riskSnapshots.length} snapshots
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-medium text-[#8FA3B3]">
            Suggested Operational Queries
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {suggestedQuestions.map((p) => (
              <button
                key={p}
                type="button"
                disabled={loading}
                onClick={() => submitQuery(p)}
                className="text-left px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] hover:border-[#70A9CF] hover:bg-[#3B5061] text-xs text-[#E5EDF3] transition-colors disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about district outage risk, factor scores, weather forecasts, snapshot deltas, incidents, or crew recommendations..."
            aria-label="Ask operational question"
            className="flex-1 px-3.5 py-2.5 rounded-md bg-[#344655] border border-[#60788A] text-sm text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
          />
          <button
            type="submit"
            disabled={loading || query.trim().length < 3}
            className="px-4 py-2.5 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-50 text-xs font-semibold text-[#17222B] flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{loading ? 'Querying Data...' : 'Analyze Operations'}</span>
          </button>
        </form>

        {confirmationFeedback && (
          <div
            role="status"
            className="rounded-md bg-[#5AC49E]/16 border border-[#5AC49E]/45 px-3.5 py-2.5 text-xs text-[#9EE8CD] flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-[#5AC49E] shrink-0" aria-hidden="true" />
            <span>{confirmationFeedback}</span>
          </div>
        )}
      </section>

      {pendingConfirmation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-confirm-title"
          className="rounded-lg bg-[#3B5061] border border-[#E5A94C]/60 p-5 space-y-4 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-[11px] font-mono text-[#F2C16E] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Operator Confirmation Required</span>
              </div>
              <h3 id="ai-confirm-title" className="text-sm font-semibold text-[#E5EDF3]">
                Confirm Recommended Dispatch: {pendingConfirmation.crewId} &rarr;{' '}
                {pendingConfirmation.incidentId}
              </h3>
            </div>
          </div>

          <div className="rounded-md bg-[#344655] border border-[#52697A] p-3 text-xs text-[#AABBC9] space-y-1">
            <div>
              <span className="text-[#8FA3B3]">Target:</span>{' '}
              <span className="text-[#E5EDF3] font-medium">{pendingConfirmation.targetLabel}</span>
            </div>
            <div>
              <span className="text-[#8FA3B3]">AI Recommendation Rationale:</span>{' '}
              <span>{pendingConfirmation.rationale}</span>
            </div>
            <div className="text-[11px] text-[#F2C16E] pt-1">
              Note: Gemini recommendations never auto-execute. Confirming will assign the crew in
              the StormSense Incident &amp; Dispatch database.
            </div>
          </div>

          {confirmationError && (
            <div role="alert" className="text-xs text-[#F6C5C5] bg-[#E36D6D]/16 border border-[#E36D6D]/45 rounded px-3 py-2">
              {confirmationError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={confirmingDispatch || !canExecuteDispatch}
              onClick={handleConfirmDispatch}
              className="px-3.5 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-50 text-xs font-semibold text-[#17222B] flex items-center gap-1.5"
            >
              <Truck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{confirmingDispatch ? 'Dispatching...' : 'Confirm Crew Dispatch'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const incId = pendingConfirmation.incidentId;
                setPendingConfirmation(null);
                openDispatchForIncident(incId);
              }}
              className="px-3 py-2 rounded-md bg-[#344655] hover:bg-[#43596A] text-xs font-medium text-[#70A9CF] border border-[#60788A] flex items-center gap-1.5"
            >
              <span>Inspect in Smart Crew Dispatch</span>
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => {
                setPendingConfirmation(null);
                setConfirmationError(null);
              }}
              className="px-3 py-2 rounded-md bg-[#344655] hover:bg-[#43596A] text-xs font-medium text-[#AABBC9] border border-[#60788A]"
            >
              Cancel
            </button>

            {!canExecuteDispatch && (
              <span className="text-[11px] text-[#F2C16E]">
                Current role ({currentUser?.role}) is read-only; switch to an Operator or Manager
                account to confirm dispatch.
              </span>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div
          className="p-5 ss-card space-y-3"
          aria-label="Running grounded operational analysis"
        >
          <div className="flex items-center gap-2 text-xs text-[#55B7B0] font-mono">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>
              Assembling live Open-Meteo feeds, risk breakdowns, historical snapshots &amp; crew
              routing...
            </span>
          </div>
          <div className="h-4 w-64 rounded ss-skeleton" />
          <div className="h-14 w-full rounded ss-skeleton" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-28 rounded ss-skeleton" />
            <div className="h-28 rounded ss-skeleton" />
          </div>
        </div>
      )}

      {turns.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-[#8FA3B3]">
          <span className="font-mono tabular-nums">
            Operational Analysis History ({turns.length} {turns.length === 1 ? 'query' : 'queries'})
          </span>
          <button
            type="button"
            onClick={() => setTurns([])}
            className="px-2.5 py-1 rounded bg-[#3B5061] hover:bg-[#4B6376] border border-[#60788A] text-[#AABBC9] hover:text-[#E5EDF3] flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            <span>Clear History</span>
          </button>
        </div>
      )}

      {turns.length === 0 && !loading ? (
        <div className="p-10 ss-card text-center space-y-2">
          <p className="text-sm text-[#E5EDF3] font-medium">
            Select a suggested operational question or enter a natural-language query above.
          </p>
          <p className="text-xs text-[#8FA3B3] max-w-xl mx-auto">
            Every briefing cites exact district names, scores, weather timestamps, and incident
            references from active application services, and separates live telemetry from
            simulated demonstration records.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {turns.map((turn) => (
            <article
              key={turn.id}
              className="p-5 ss-card space-y-4 ss-page-enter"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#52697A]">
                <div className="text-sm font-semibold text-[#E5EDF3]">{turn.query}</div>
                <div className="flex items-center gap-3 text-[11px] font-mono text-[#8FA3B3]">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{formatIstDateTime(turn.askedAt)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => submitQuery(turn.query, turn.id)}
                    className="px-2 py-1 rounded bg-[#344655] hover:bg-[#3B5061] border border-[#60788A] text-[#AABBC9] hover:text-[#E5EDF3] flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                    <span>Re-run</span>
                  </button>
                </div>
              </div>

              {turn.error ? (
                <div
                  role="alert"
                  className="p-4 rounded-md bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-xs text-[#F6C5C5] flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#E36D6D] shrink-0" aria-hidden="true" />
                    <span>{turn.error}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => submitQuery(turn.query, turn.id)}
                      className="px-3 py-1.5 rounded bg-[#3B5061] hover:bg-[#4B6376] border border-[#E36D6D]/50 text-[#F29B9B] font-medium"
                    >
                      Retry Analysis
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuery(turn.query)}
                      className="px-3 py-1.5 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3]"
                    >
                      Edit Query
                    </button>
                  </div>
                </div>
              ) : turn.result ? (
                <div className="space-y-4">
                  <div className="text-sm text-[#E5EDF3] leading-relaxed">
                    {turn.result.response.summary}
                  </div>

                  {turn.result.response.groundedChart && (
                    <GroundedBriefingChart chart={turn.result.response.groundedChart} />
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="p-4 rounded-md bg-[#344655]/85 border border-[#52697A] space-y-2.5">
                      <div className="text-xs font-semibold text-[#55B7B0] flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Key Operational Findings</span>
                      </div>
                      <ul className="space-y-2 text-xs text-[#AABBC9] list-disc list-inside leading-relaxed">
                        {turn.result.response.keyFindings.map((f, idx) => (
                          <li key={idx}>{f}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-4 rounded-md bg-[#344655]/85 border border-[#52697A] space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#55B7B0]">
                          Recommended Actions
                        </span>
                        <span className="text-[10px] font-mono text-[#F2C16E] font-medium">
                          Confirmation Required
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {turn.result.response.recommendedActions.map((act, idx) => {
                          const canReviewDispatch =
                            act.actionType === 'review_dispatch' &&
                            Boolean(act.incidentId) &&
                            Boolean(act.crewId);
                          const hasInspectTarget =
                            Boolean(act.incidentId) ||
                            Boolean(act.districtId) ||
                            act.actionType === 'review_alerts' ||
                            act.actionType === 'review_district_risk';

                          return (
                            <div
                              key={idx}
                              className="rounded bg-[#3B5061]/85 border border-[#60788A] p-3 space-y-2 text-xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-[#E5EDF3]">{act.target}</span>
                                <span
                                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                    PRIORITY_STYLE[act.priority] ?? PRIORITY_STYLE.Monitoring
                                  }`}
                                >
                                  {act.priority}
                                </span>
                              </div>
                              <p className="text-[#AABBC9] leading-relaxed">{act.action}</p>

                              {(canReviewDispatch || hasInspectTarget) && (
                                <div className="pt-1 flex flex-wrap items-center gap-2">
                                  {canReviewDispatch ? (
                                    <button
                                      type="button"
                                      onClick={() => handleActionTrigger(act)}
                                      className="px-2.5 py-1 rounded bg-[#70A9CF]/20 hover:bg-[#70A9CF]/30 border border-[#70A9CF]/50 text-[#E5EDF3] text-[11px] font-medium flex items-center gap-1 transition-colors"
                                    >
                                      <Truck className="w-3 h-3" aria-hidden="true" />
                                      <span>Review &amp; Confirm Dispatch</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleActionTrigger(act)}
                                      className="px-2.5 py-1 rounded bg-[#344655] hover:bg-[#283744] border border-[#60788A] text-[#E5EDF3] text-[11px] font-medium flex items-center gap-1 transition-colors"
                                    >
                                      <span>Inspect in Module</span>
                                      <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {turn.result.response.dataReferences &&
                    turn.result.response.dataReferences.length > 0 && (
                      <div className="p-4 rounded-md bg-[#344655]/85 border border-[#52697A] space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#E5EDF3]">
                            Referenced Application Data &amp; Provenance
                          </span>
                          <span className="text-[11px] font-mono text-[#8FA3B3]">
                            {turn.result.response.dataReferences.length} cited records
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {turn.result.response.dataReferences.map((refItem, idx) => (
                            <DataReferenceRow key={idx} item={refItem} />
                          ))}
                        </div>
                      </div>
                    )}

                  {turn.result.response.unavailableOrSimulatedNotes &&
                    turn.result.response.unavailableOrSimulatedNotes.length > 0 && (
                      <div className="text-[11px] text-[#F2C16E] bg-[#E5A94C]/16 border border-[#E5A94C]/45 rounded-md px-3.5 py-2.5 space-y-1">
                        <div className="font-mono text-[#F2C16E] font-semibold">
                          Data Provenance &amp; Availability Disclosures
                        </div>
                        <ul className="list-disc list-inside space-y-0.5">
                          {turn.result.response.unavailableOrSimulatedNotes.map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  <div className="pt-2 border-t border-[#52697A] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8FA3B3]">
                    <div>
                      <span className="text-[#E5EDF3] font-medium">Snapshot Timestamp:</span>{' '}
                      <span className="font-mono tabular-nums">
                        {formatIstDateTime(turn.result.response.dataTimestamp)}
                      </span>
                      <span className="mx-2 text-[#60788A]">·</span>
                      <span className="font-mono">Model: {turn.result.model}</span>
                    </div>
                    <div>{turn.result.response.confidenceNote}</div>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
