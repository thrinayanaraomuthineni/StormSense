import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildGroundedChart,
  buildGroundedOperationalContext,
} from '../src/lib/aiContextBuilder';
import type {
  ActiveDispatchRoute,
  AiActionType,
  AiChartFocus,
  AiConversationTurnSummary,
  AiDataReference,
  AiRecommendedAction,
  AiReferenceSourceType,
  AiStructuredResponse,
  AlertItem,
  Crew,
  DispatchHistoryEntry,
  Incident,
  RiskAssessment,
  RiskSnapshotRecord,
  RouteEstimate,
  WeatherObservation,
} from '../src/lib/types';

export interface OperationalSnapshotContext {
  query: string;
  history?: AiConversationTurnSummary[];
  weatherStatus: 'live' | 'stale' | 'error';
  weatherUpdatedAt: string | null;
  weatherErrorMessage?: string | null;
  weatherObservations: WeatherObservation[];
  riskAssessments: RiskAssessment[];
  incidents: Incident[];
  crews: Crew[];
  activeRoutes: ActiveDispatchRoute[];
  alerts: AlertItem[];
  riskSnapshots: RiskSnapshotRecord[];
  dispatchHistory?: DispatchHistoryEntry[];
  routeOverridesByIncident?: Record<string, Map<string, RouteEstimate>>;
}

const VALID_PRIORITIES = new Set(['Immediate', 'Short-Term', 'Monitoring']);
const VALID_SOURCE_TYPES = new Set<AiReferenceSourceType>([
  'Live API Data',
  'Derived Prediction',
  'Simulated Demonstration Data',
  'Historical Snapshot',
  'Alert Engine',
  'Dispatch Engine',
]);
const VALID_ACTION_TYPES = new Set<AiActionType>([
  'review_dispatch',
  'review_incident',
  'review_district_risk',
  'review_alerts',
  'advisory_only',
]);
const VALID_CHART_FOCUSES = new Set<AiChartFocus>([
  'top_risk_districts',
  'district_factors',
  'snapshot_comparison',
  'incident_crew_readiness',
  'forecast_24h',
  'none',
]);

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isNonRetryable =
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('400') ||
        msg.includes('403') ||
        msg.includes('404');

      if (isNonRetryable || attempt === maxRetries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
  throw lastError;
}

function formatGeminiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return new Error(
      'Gemini API key was rejected or lacks permission. Please verify GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return new Error(
      'Gemini API quota limit reached (429). Please retry in a few moments or check quota in Settings > Secrets.'
    );
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return new Error('Configured Gemini model endpoint returned 404 Not Found.');
  }
  return new Error(raw || 'Gemini Operational Intelligence request failed.');
}

export async function analyzeOperationsWithGemini(
  ctx: OperationalSnapshotContext
): Promise<{ response: AiStructuredResponse; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in Settings > Secrets. Configure a valid key to query Gemini Operational Intelligence.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const groundedContext = buildGroundedOperationalContext({
    weatherStatus: ctx.weatherStatus,
    weatherUpdatedAt: ctx.weatherUpdatedAt,
    weatherErrorMessage: ctx.weatherErrorMessage,
    weatherObservations: ctx.weatherObservations,
    riskAssessments: ctx.riskAssessments,
    incidents: ctx.incidents,
    crews: ctx.crews,
    activeRoutes: ctx.activeRoutes,
    alerts: ctx.alerts,
    riskSnapshots: ctx.riskSnapshots,
    dispatchHistory: ctx.dispatchHistory,
    routeOverridesByIncident: ctx.routeOverridesByIncident,
  });

  const historyBlock =
    ctx.history && ctx.history.length > 0
      ? `RECENT_CONVERSATION_TURNS (use only to resolve pronouns like "this incident" or "that district"; NEVER use as a factual substitute for OPERATIONAL_SNAPSHOT):\n${JSON.stringify(
          ctx.history.slice(0, 6)
        )}\n\n`
      : '';

  const systemInstruction = [
    'You are the StormSense Operational Intelligence Analyst for the Department of Energy, Government of Telangana.',
    'STRICT GROUNDING & SAFETY RULES:',
    '1. Answer ONLY from the JSON OPERATIONAL_SNAPSHOT provided below. Never invent districts, scores, weather readings, forecasts, snapshots, alerts, incidents, or crews.',
    '2. Include exact district names, numeric values, ISO timestamps, alert counts, and incident/crew IDs (e.g., INC-2026-102, CRW-KHM-01) from the snapshot.',
    '3. For risk explanations (e.g., "Why is Warangal receiving its current risk score?"), break down every contributing factor in contributions[] including zero-point weather factors vs active incident/vulnerability drivers.',
    '4. For crew dispatch questions, rely ONLY on openIncidentRecommendations[] (matchScore, distanceKm, estimatedEtaMinutes, routingMode, isAssignable, conflictReason, matchedSkills) and crewFleet[].',
    '5. For historical/snapshot comparison questions, compare currentWeather and riskScore against previousSnapshotComparison[] and snapshotArchive. If NO_PRIOR_SNAPSHOT is present, state explicitly that no earlier distinct snapshot is recorded yet.',
    '6. SAFETY: You are ADVISORY ONLY. Never claim you have assigned a crew, updated an incident, or executed any control action. Set requiresConfirmation: true on any actionType of review_dispatch or review_incident, and provide exact incidentId, crewId, and/or districtId when applicable.',
    '7. Populate dataReferences[] with structured citations separating Live API Data, Derived Prediction, Simulated Demonstration Data, Historical Snapshot, Alert Engine, and Dispatch Engine.',
    '8. Populate unavailableOrSimulatedNotes[] clearly identifying simulated crews/incidents, straight-line ETA fallbacks, stale weather, or unavailable fields.',
    '9. Select chartFocus from: top_risk_districts, district_factors, snapshot_comparison, incident_crew_readiness, forecast_24h, or none.',
  ].join('\n');

  const model = 'gemini-4-hydrogen';

  try {
    const result = await callGeminiWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: `${historyBlock}OPERATIONAL_SNAPSHOT:\n${JSON.stringify(
          groundedContext
        )}\n\nOPERATOR_QUERY: ${ctx.query}`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description:
                  'Concise, factual executive briefing directly answering the operator query with exact names, numbers, and timestamps.',
              },
              keyFindings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  'Quantitative findings citing district names, risk scores, weather metrics, forecast peaks, alerts, or incident/crew IDs.',
              },
              dataReferences: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sourceType: {
                      type: Type.STRING,
                      enum: [
                        'Live API Data',
                        'Derived Prediction',
                        'Simulated Demonstration Data',
                        'Historical Snapshot',
                        'Alert Engine',
                        'Dispatch Engine',
                      ],
                    },
                    label: { type: Type.STRING },
                    value: { type: Type.STRING },
                    timestamp: { type: Type.STRING },
                    districtName: { type: Type.STRING },
                    incidentId: { type: Type.STRING },
                  },
                  required: ['sourceType', 'label', 'value'],
                },
              },
              recommendedActions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    priority: {
                      type: Type.STRING,
                      enum: ['Immediate', 'Short-Term', 'Monitoring'],
                    },
                    target: { type: Type.STRING },
                    action: { type: Type.STRING },
                    actionType: {
                      type: Type.STRING,
                      enum: [
                        'review_dispatch',
                        'review_incident',
                        'review_district_risk',
                        'review_alerts',
                        'advisory_only',
                      ],
                    },
                    incidentId: { type: Type.STRING },
                    crewId: { type: Type.STRING },
                    districtId: { type: Type.STRING },
                    requiresConfirmation: { type: Type.BOOLEAN },
                  },
                  required: ['priority', 'target', 'action', 'actionType', 'requiresConfirmation'],
                },
              },
              unavailableOrSimulatedNotes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  'Explicit disclosures of simulated demonstration data, unavailable telemetry, stale caches, or missing prior snapshots.',
              },
              dataTimestamp: {
                type: Type.STRING,
                description: 'Exact ISO timestamp of the weather/state snapshot used.',
              },
              dataWarnings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              confidenceNote: {
                type: Type.STRING,
                description: 'Concise statement on data quality and heuristic vs live observation scope.',
              },
              chartFocus: {
                type: Type.STRING,
                enum: [
                  'top_risk_districts',
                  'district_factors',
                  'snapshot_comparison',
                  'incident_crew_readiness',
                  'forecast_24h',
                  'none',
                ],
              },
            },
            required: [
              'summary',
              'keyFindings',
              'dataReferences',
              'recommendedActions',
              'unavailableOrSimulatedNotes',
              'dataTimestamp',
              'dataWarnings',
              'confidenceNote',
              'chartFocus',
            ],
          },
        },
      })
    );

    const rawParsed = JSON.parse((result.text ?? '{}').trim()) as Partial<AiStructuredResponse>;

    const validIncidentIds = new Set(ctx.incidents.map((i) => i.id));
    const validCrewIds = new Set(ctx.crews.map((c) => c.id));
    const validDistrictIds = new Set(ctx.riskAssessments.map((r) => r.districtId));

    const cleanActions: AiRecommendedAction[] = Array.isArray(rawParsed.recommendedActions)
      ? rawParsed.recommendedActions.map((act) => {
          const priority = VALID_PRIORITIES.has(act.priority)
            ? act.priority
            : 'Monitoring';
          const actionType: AiActionType =
            act.actionType && VALID_ACTION_TYPES.has(act.actionType)
              ? act.actionType
              : 'advisory_only';
          const incidentId =
            act.incidentId && validIncidentIds.has(act.incidentId) ? act.incidentId : undefined;
          const crewId = act.crewId && validCrewIds.has(act.crewId) ? act.crewId : undefined;
          const districtId =
            act.districtId && validDistrictIds.has(act.districtId) ? act.districtId : undefined;
          return {
            priority,
            target: String(act.target ?? 'Operations Control'),
            action: String(act.action ?? ''),
            actionType,
            incidentId,
            crewId,
            districtId,
            requiresConfirmation:
              actionType === 'review_dispatch' || actionType === 'review_incident'
                ? true
                : Boolean(act.requiresConfirmation),
          };
        })
      : [];

    const cleanReferences: AiDataReference[] = Array.isArray(rawParsed.dataReferences)
      ? rawParsed.dataReferences.map((ref) => ({
          sourceType: VALID_SOURCE_TYPES.has(ref.sourceType)
            ? ref.sourceType
            : 'Derived Prediction',
          label: String(ref.label ?? 'Operational Metric'),
          value: String(ref.value ?? ''),
          timestamp: ref.timestamp ? String(ref.timestamp) : undefined,
          districtName: ref.districtName ? String(ref.districtName) : undefined,
          incidentId: ref.incidentId ? String(ref.incidentId) : undefined,
        }))
      : [];

    const chartFocus: AiChartFocus =
      rawParsed.chartFocus && VALID_CHART_FOCUSES.has(rawParsed.chartFocus)
        ? rawParsed.chartFocus
        : 'top_risk_districts';

    const groundedChart = buildGroundedChart(ctx.query, groundedContext, chartFocus);

    const unavailableNotes = Array.isArray(rawParsed.unavailableOrSimulatedNotes)
      ? rawParsed.unavailableOrSimulatedNotes.map(String).filter(Boolean)
      : [];
    const dataWarnings = Array.isArray(rawParsed.dataWarnings)
      ? rawParsed.dataWarnings.map(String).filter(Boolean)
      : [];

    const response: AiStructuredResponse = {
      summary: String(rawParsed.summary ?? 'No operational summary returned.'),
      keyFindings: Array.isArray(rawParsed.keyFindings)
        ? rawParsed.keyFindings.map(String).filter(Boolean)
        : [],
      dataReferences: cleanReferences,
      recommendedActions: cleanActions,
      unavailableOrSimulatedNotes: unavailableNotes.length > 0 ? unavailableNotes : dataWarnings,
      dataTimestamp:
        rawParsed.dataTimestamp && !Number.isNaN(Date.parse(rawParsed.dataTimestamp))
          ? rawParsed.dataTimestamp
          : groundedContext.weatherFeed.lastUpdated ?? groundedContext.generatedAt,
      dataWarnings,
      confidenceNote: String(
        rawParsed.confidenceNote ??
          'Heuristic rule-based risk indices paired with live Open-Meteo feeds and simulated incident/crew demonstration data.'
      ),
      chartFocus,
      groundedChart,
    };

    return { response, model };
  } catch (err) {
    throw formatGeminiError(err);
  }
}
