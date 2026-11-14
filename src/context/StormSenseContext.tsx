import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { computeAlertSummary } from '../lib/alertSummary';
import type {
  ActiveDispatchRoute,
  AiConversationTurnSummary,
  AiStructuredResponse,
  AlertConfig,
  AlertItem,
  AlertLifecycleStatus,
  AlertSummaryStats,
  Crew,
  CrewRecommendation,
  DispatchHistoryEntry,
  Incident,
  RiskAssessment,
  RiskScoringWeights,
  RiskSnapshotRecord,
  SavedSimulationScenario,
  StormSimulationParams,
  TelanganaDistrict,
  UserAccount,
  WeatherObservation,
} from '../lib/types';

export type PageId =
  | 'command'
  | 'weather'
  | 'risk'
  | 'simulation'
  | 'map'
  | 'incidents'
  | 'dispatch'
  | 'ai'
  | 'alerts'
  | 'analytics'
  | 'settings';

interface WeatherEnvelope {
  observations: WeatherObservation[];
  status: 'live' | 'stale' | 'error';
  lastUpdated: string | null;
  errorMessage: string | null;
}

interface StormSenseContextValue {
  users: UserAccount[];
  currentUser: UserAccount | null;
  loginAs: (user: UserAccount) => void;
  logout: () => void;

  activePage: PageId;
  setActivePage: (page: PageId) => void;
  selectedDistrictId: string;
  setSelectedDistrictId: (districtId: string) => void;

  districts: TelanganaDistrict[];
  weather: WeatherEnvelope;
  assessments: RiskAssessment[];
  incidents: Incident[];
  crews: Crew[];
  activeRoutes: ActiveDispatchRoute[];
  dispatchHistory: DispatchHistoryEntry[];
  dispatchTargetIncidentId: string | null;
  setDispatchTargetIncidentId: (incidentId: string | null) => void;
  openDispatchForIncident: (incidentId: string) => void;
  alerts: AlertItem[];
  alertSummary: AlertSummaryStats;
  alertConfig: AlertConfig | null;
  riskWeights: RiskScoringWeights | null;
  riskSnapshots: RiskSnapshotRecord[];
  savedSimulations: SavedSimulationScenario[];

  isLoading: boolean;
  isRefreshingWeather: boolean;
  globalError: string | null;
  serverTimestamp: string | null;

  reloadState: () => Promise<void>;
  refreshWeather: () => Promise<void>;

  createIncident: (payload: Record<string, unknown>) => Promise<Incident>;
  updateIncident: (id: string, payload: Record<string, unknown>) => Promise<Incident>;
  deleteIncident: (id: string) => Promise<void>;
  assignCrewToIncident: (
    incidentId: string,
    crewId: string,
    options?: { forceReassign?: boolean }
  ) => Promise<void>;
  getCrewRecommendations: (incidentId: string) => Promise<CrewRecommendation[]>;

  createCrew: (payload: Record<string, unknown>) => Promise<Crew>;
  updateCrew: (id: string, payload: Record<string, unknown>) => Promise<Crew>;
  completeCrewWork: (crewId: string, notes?: string) => Promise<void>;
  deleteCrew: (id: string) => Promise<void>;

  markAlertRead: (id: string, isRead?: boolean) => Promise<void>;
  updateAlertStatus: (id: string, status: AlertLifecycleStatus) => Promise<void>;
  markAllAlertsRead: () => Promise<void>;
  clearReadAlerts: () => Promise<void>;

  updateSettings: (payload: Partial<AlertConfig>) => Promise<AlertConfig>;
  updateRiskWeights: (payload: Partial<RiskScoringWeights>) => Promise<RiskScoringWeights>;
  resetRiskWeights: () => Promise<RiskScoringWeights>;
  captureRiskSnapshot: () => Promise<void>;
  saveSimulationScenario: (payload: {
    name: string;
    params: StormSimulationParams;
    summaryNote?: string;
  }) => Promise<SavedSimulationScenario>;
  deleteSimulationScenario: (id: string) => Promise<void>;
  askGemini: (
    query: string,
    history?: AiConversationTurnSummary[]
  ) => Promise<{ response: AiStructuredResponse; model: string }>;
}

const StormSenseContext = createContext<StormSenseContextValue | null>(null);

const SESSION_STORAGE_KEY = 'stormsense_user_session_v1';

export function StormSenseProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as UserAccount) : null;
    } catch {
      return null;
    }
  });

  const [activePage, setActivePage] = useState<PageId>('command');
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>('hyderabad');

  const [districts, setDistricts] = useState<TelanganaDistrict[]>([]);
  const [weather, setWeather] = useState<WeatherEnvelope>({
    observations: [],
    status: 'live',
    lastUpdated: null,
    errorMessage: null,
  });
  const [assessments, setAssessments] = useState<RiskAssessment[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<ActiveDispatchRoute[]>([]);
  const [dispatchHistory, setDispatchHistory] = useState<DispatchHistoryEntry[]>([]);
  const [dispatchTargetIncidentId, setDispatchTargetIncidentId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertConfig, setAlertConfig] = useState<AlertConfig | null>(null);
  const [riskWeights, setRiskWeights] = useState<RiskScoringWeights | null>(null);
  const [riskSnapshots, setRiskSnapshots] = useState<RiskSnapshotRecord[]>([]);
  const [savedSimulations, setSavedSimulations] = useState<SavedSimulationScenario[]>([]);
  const [serverTimestamp, setServerTimestamp] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const apiFetch = useCallback(
    async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (currentUser) {
        headers.set('x-user-role', currentUser.role);
      }
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      }
      return data as T;
    },
    [currentUser]
  );

  const reloadState = useCallback(async () => {
    setGlobalError(null);
    try {
      const data = await apiFetch<{
        districts: TelanganaDistrict[];
        weather: WeatherEnvelope;
        assessments: RiskAssessment[];
        incidents: Incident[];
        crews: Crew[];
        activeRoutes?: ActiveDispatchRoute[];
        dispatchHistory?: DispatchHistoryEntry[];
        alerts: AlertItem[];
        alertConfig: AlertConfig;
        riskWeights?: RiskScoringWeights;
        riskSnapshots: RiskSnapshotRecord[];
        savedSimulations?: SavedSimulationScenario[];
        serverTimestamp: string;
      }>('/api/state');
      setDistricts(data.districts);
      setWeather(data.weather);
      setAssessments(data.assessments);
      setIncidents(data.incidents);
      setCrews(data.crews);
      setActiveRoutes(data.activeRoutes ?? []);
      setDispatchHistory(data.dispatchHistory ?? []);
      setAlerts(data.alerts);
      setAlertConfig(data.alertConfig);
      if (data.riskWeights) {
        setRiskWeights(data.riskWeights);
      }
      setRiskSnapshots(data.riskSnapshots);
      setSavedSimulations(data.savedSimulations ?? []);
      setServerTimestamp(data.serverTimestamp);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Unable to load operational state');
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data: { users: UserAccount[] }) => {
        setUsers(data.users || []);
        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1' && !currentUser && data.users?.length > 0) {
          const opsUser = data.users.find((u) => u.role === 'Operations Manager') || data.users[0];
          setCurrentUser(opsUser);
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(opsUser));
        }
      })
      .catch(() => {
        // Ignored; reloadState reports backend connectivity errors
      });
  }, []);

  useEffect(() => {
    reloadState();
    const interval = setInterval(() => {
      reloadState();
    }, 5 * 60_000);
    return () => clearInterval(interval);
  }, [reloadState]);

  const loginAs = useCallback((user: UserAccount) => {
    setCurrentUser(user);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    setActivePage('command');
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const refreshWeather = useCallback(async () => {
    setIsRefreshingWeather(true);
    setGlobalError(null);
    try {
      const data = await apiFetch<{
        weather: WeatherEnvelope;
        assessments: RiskAssessment[];
        alerts: AlertItem[];
        riskWeights?: RiskScoringWeights;
        riskSnapshots: RiskSnapshotRecord[];
      }>('/api/weather/refresh', { method: 'POST' });
      setWeather(data.weather);
      setAssessments(data.assessments);
      setAlerts(data.alerts);
      if (data.riskWeights) {
        setRiskWeights(data.riskWeights);
      }
      setRiskSnapshots(data.riskSnapshots);
      setServerTimestamp(new Date().toISOString());
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Weather refresh failed');
    } finally {
      setIsRefreshingWeather(false);
    }
  }, [apiFetch]);

  const createIncident = useCallback(
    async (payload: Record<string, unknown>) => {
      const data = await apiFetch<{ incident: Incident }>('/api/incidents', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadState();
      return data.incident;
    },
    [apiFetch, reloadState]
  );

  const updateIncident = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const data = await apiFetch<{ incident: Incident }>(`/api/incidents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await reloadState();
      return data.incident;
    },
    [apiFetch, reloadState]
  );

  const deleteIncident = useCallback(
    async (id: string) => {
      await apiFetch(`/api/incidents/${id}`, { method: 'DELETE' });
      await reloadState();
    },
    [apiFetch, reloadState]
  );

  const assignCrewToIncident = useCallback(
    async (incidentId: string, crewId: string, options?: { forceReassign?: boolean }) => {
      await apiFetch(`/api/incidents/${incidentId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ crewId, forceReassign: Boolean(options?.forceReassign) }),
      });
      await reloadState();
    },
    [apiFetch, reloadState]
  );

  const openDispatchForIncident = useCallback((incidentId: string) => {
    setDispatchTargetIncidentId(incidentId);
    setActivePage('dispatch');
  }, []);

  const getCrewRecommendations = useCallback(
    async (incidentId: string) => {
      const data = await apiFetch<{ recommendations: CrewRecommendation[] }>(
        `/api/incidents/${incidentId}/recommendations`
      );
      return data.recommendations;
    },
    [apiFetch]
  );

  const createCrew = useCallback(
    async (payload: Record<string, unknown>) => {
      const data = await apiFetch<{ crew: Crew }>('/api/crews', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadState();
      return data.crew;
    },
    [apiFetch, reloadState]
  );

  const updateCrew = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const data = await apiFetch<{ crew: Crew }>(`/api/crews/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await reloadState();
      return data.crew;
    },
    [apiFetch, reloadState]
  );

  const completeCrewWork = useCallback(
    async (crewId: string, notes?: string) => {
      await apiFetch(`/api/crews/${crewId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ notes }),
      });
      await reloadState();
    },
    [apiFetch, reloadState]
  );

  const deleteCrew = useCallback(
    async (id: string) => {
      await apiFetch(`/api/crews/${id}`, { method: 'DELETE' });
      await reloadState();
    },
    [apiFetch, reloadState]
  );

  const markAlertRead = useCallback(
    async (id: string, isRead = true) => {
      const data = await apiFetch<{ alerts: AlertItem[] }>(`/api/alerts/${id}/read`, {
        method: 'PATCH',
        body: JSON.stringify({ isRead }),
      });
      setAlerts(data.alerts);
    },
    [apiFetch]
  );

  const updateAlertStatus = useCallback(
    async (id: string, status: AlertLifecycleStatus) => {
      const data = await apiFetch<{ alerts: AlertItem[] }>(`/api/alerts/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setAlerts(data.alerts);
    },
    [apiFetch]
  );

  const markAllAlertsRead = useCallback(async () => {
    const data = await apiFetch<{ alerts: AlertItem[] }>('/api/alerts/mark-all-read', {
      method: 'POST',
    });
    setAlerts(data.alerts);
  }, [apiFetch]);

  const clearReadAlerts = useCallback(async () => {
    const data = await apiFetch<{ alerts: AlertItem[] }>('/api/alerts/clear-read', {
      method: 'DELETE',
    });
    setAlerts(data.alerts);
  }, [apiFetch]);

  const updateSettings = useCallback(
    async (payload: Partial<AlertConfig>) => {
      const data = await apiFetch<{ alertConfig: AlertConfig; alerts?: AlertItem[] }>(
        '/api/settings',
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      );
      setAlertConfig(data.alertConfig);
      if (data.alerts) {
        setAlerts(data.alerts);
      }
      await reloadState();
      return data.alertConfig;
    },
    [apiFetch, reloadState]
  );

  const updateRiskWeights = useCallback(
    async (payload: Partial<RiskScoringWeights>) => {
      const data = await apiFetch<{
        riskWeights: RiskScoringWeights;
        assessments: RiskAssessment[];
        alerts: AlertItem[];
      }>('/api/risk/weights', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setRiskWeights(data.riskWeights);
      setAssessments(data.assessments);
      setAlerts(data.alerts);
      return data.riskWeights;
    },
    [apiFetch]
  );

  const resetRiskWeights = useCallback(async () => {
    const data = await apiFetch<{
      riskWeights: RiskScoringWeights;
      assessments: RiskAssessment[];
      alerts: AlertItem[];
    }>('/api/risk/weights/reset', { method: 'POST' });
    setRiskWeights(data.riskWeights);
    setAssessments(data.assessments);
    setAlerts(data.alerts);
    return data.riskWeights;
  }, [apiFetch]);

  const captureRiskSnapshot = useCallback(async () => {
    const data = await apiFetch<{ riskSnapshots: RiskSnapshotRecord[] }>('/api/risk/snapshots', {
      method: 'POST',
    });
    setRiskSnapshots(data.riskSnapshots);
  }, [apiFetch]);

  const saveSimulationScenario = useCallback(
    async (payload: { name: string; params: StormSimulationParams; summaryNote?: string }) => {
      const data = await apiFetch<{
        scenario: SavedSimulationScenario;
        savedSimulations: SavedSimulationScenario[];
      }>('/api/simulations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSavedSimulations(data.savedSimulations);
      return data.scenario;
    },
    [apiFetch]
  );

  const deleteSimulationScenario = useCallback(
    async (id: string) => {
      const data = await apiFetch<{ savedSimulations: SavedSimulationScenario[] }>(
        `/api/simulations/${id}`,
        { method: 'DELETE' }
      );
      setSavedSimulations(data.savedSimulations);
    },
    [apiFetch]
  );

  const askGemini = useCallback(
    async (query: string, history?: AiConversationTurnSummary[]) => {
      return apiFetch<{ response: AiStructuredResponse; model: string }>('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ query, history }),
      });
    },
    [apiFetch]
  );

  const alertSummary = useMemo(() => computeAlertSummary(alerts), [alerts]);

  return (
    <StormSenseContext.Provider
      value={{
        users,
        currentUser,
        loginAs,
        logout,
        activePage,
        setActivePage,
        selectedDistrictId,
        setSelectedDistrictId,
        districts,
        weather,
        assessments,
        incidents,
        crews,
        activeRoutes,
        dispatchHistory,
        dispatchTargetIncidentId,
        setDispatchTargetIncidentId,
        openDispatchForIncident,
        alerts,
        alertSummary,
        alertConfig,
        riskWeights,
        riskSnapshots,
        savedSimulations,
        isLoading,
        isRefreshingWeather,
        globalError,
        serverTimestamp,
        reloadState,
        refreshWeather,
        createIncident,
        updateIncident,
        deleteIncident,
        assignCrewToIncident,
        getCrewRecommendations,
        createCrew,
        updateCrew,
        completeCrewWork,
        deleteCrew,
        markAlertRead,
        updateAlertStatus,
        markAllAlertsRead,
        clearReadAlerts,
        updateSettings,
        updateRiskWeights,
        resetRiskWeights,
        captureRiskSnapshot,
        saveSimulationScenario,
        deleteSimulationScenario,
        askGemini,
      }}
    >
      {children}
    </StormSenseContext.Provider>
  );
}

export function useStormSense() {
  const ctx = useContext(StormSenseContext);
  if (!ctx) throw new Error('useStormSense must be used inside StormSenseProvider');
  return ctx;
}
