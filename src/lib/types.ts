export type UserRole =
  | 'Administrator'
  | 'Operations Manager'
  | 'Field Operator'
  | 'Read-only Evaluator';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  discom: 'TGSPDCL' | 'TGNPDCL' | 'TGTRANSCO';
}

export type DataProvenance =
  | 'Live API Data'
  | 'Derived Prediction'
  | 'Simulated Demonstration Data'
  | 'Manually Entered Data';

export type RiskCategory = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type DataConfidence = 'HIGH' | 'DEGRADED' | 'UNAVAILABLE';

export interface TelanganaDistrict {
  id: string;
  name: string;
  discom: 'TGSPDCL' | 'TGNPDCL';
  circle: string;
  lat: number;
  lng: number;
  substationCount: number;
  vulnerabilityIndex: number; // 0.0 to 1.0 baseline grid exposure
  vulnerabilityNotes: string;
  boundaryPolygon: [number, number][]; // Approximate administrative zone polygon [lat, lng]
}

export interface HourlyWeatherPoint {
  time: string;
  temperatureC: number;
  precipitationProbability: number;
  rainMm: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  weatherCode: number;
  weatherLabel: string;
}

export interface DailyWeatherPoint {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationSumMm: number;
  precipitationProbabilityMax: number;
  windSpeedMaxKmh: number;
  windGustsMaxKmh: number;
  weatherCode: number;
  weatherLabel: string;
}

export interface HistoricalWeatherSummary {
  past24hRainMm: number;
  past24hMaxWindKmh: number;
  past24hMaxGustsKmh: number;
  past24hThunderHours: number;
  observationHoursCount: number;
  periodStart: string;
  periodEnd: string;
  source: 'Open-Meteo Historical Hourly API';
}

export interface WeatherObservation {
  districtId: string;
  districtName: string;
  lat: number;
  lng: number;
  temperatureC: number;
  relativeHumidity: number;
  precipitationMm: number;
  rainMm: number;
  precipitationProbability: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  surfacePressureHpa: number;
  weatherCode: number;
  weatherLabel: string;
  isThunderstorm: boolean;
  hourly: HourlyWeatherPoint[];
  daily: DailyWeatherPoint[];
  recentHistory?: HistoricalWeatherSummary;
  fetchedAt: string;
  isStale: boolean;
  errorMessage?: string;
  source: 'Open-Meteo Live API';
}

export type RiskFactorKey =
  | 'rainfall'
  | 'wind'
  | 'gusts'
  | 'thunderstorm'
  | 'precipitation_prob'
  | 'historical_weather'
  | 'recorded_incidents'
  | 'grid_vulnerability';

export interface RiskScoringWeights {
  rainfall: number;
  wind: number;
  gusts: number;
  thunderstorm: number;
  precipitationProb: number;
  historicalWeather: number;
  recordedIncidents: number;
  gridVulnerability: number;
  updatedAt?: string;
}

export interface RiskFactorContribution {
  factor: RiskFactorKey;
  label: string;
  rawValue: string;
  points: number;
  maxPoints: number;
  weightPct: number;
  intensityPct: number;
  dataStatus: 'Live' | 'Stale' | 'Simulated' | 'Static' | 'Unavailable';
  rationale: string;
}

export interface PreventiveRecommendation {
  factor: RiskFactorKey | 'overall';
  priority: 'Immediate' | 'Preparedness' | 'Routine';
  title: string;
  action: string;
  driverValue: string;
}

export interface HourlyRiskPoint {
  time: string;
  score: number;
  category: RiskCategory;
  rainMm: number;
  windGustsKmh: number;
  precipitationProbability: number;
}

export interface DailyRiskPoint {
  date: string;
  score: number;
  category: RiskCategory;
  precipitationSumMm: number;
  windGustsMaxKmh: number;
}

export interface RiskAssessment {
  districtId: string;
  districtName: string;
  score: number;
  exactScore: number;
  category: RiskCategory;
  contributions: RiskFactorContribution[];
  scoreExplanation: string;
  vulnerabilityIndex: number;
  vulnerabilityNotes: string;
  recommendedAction: string;
  preventiveActions: PreventiveRecommendation[];
  confidence: DataConfidence;
  confidenceReason: string;
  dataQualityScore: number;
  dataQualityFlags: string[];
  incidentContext: {
    activeCount: number;
    totalCount: number;
    simulatedCount: number;
    manualCount: number;
  };
  modelType: string;
  calculatedAt: string;
  hourlyTrend: HourlyRiskPoint[];
  dailyForecast: DailyRiskPoint[];
}

export type IncidentSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export type IncidentStatus =
  | 'Detected'
  | 'Reported'
  | 'Assigned'
  | 'Crew En Route'
  | 'Under Maintenance'
  | 'Restored'
  | 'Closed';

export type IncidentSource =
  | 'Simulated Demonstration Data'
  | 'Manually Entered Data'
  | 'Externally Verified Feed';

export type FaultType =
  | 'Feeder Trip'
  | 'Transformer Fault'
  | 'HT Line Snap'
  | 'Substation Breaker'
  | 'Vegetation Contact'
  | 'Lightning Surge';

export interface Incident {
  id: string;
  title: string;
  districtId: string;
  districtName: string;
  locationName: string;
  lat: number;
  lng: number;
  severity: IncidentSeverity;
  faultType: FaultType;
  description: string;
  source: IncidentSource;
  status: IncidentStatus;
  assignedCrewId: string | null;
  assignedCrewName?: string | null;
  affectedConsumers: number;
  restorationNotes: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type CrewAvailability = 'Available' | 'Standby' | 'Deployed' | 'Off-Duty';

export type CrewStatus =
  | 'Ready at Depot'
  | 'En Route'
  | 'On Site - Restoring'
  | 'Standby Reserve'
  | 'Shift Completed';

export interface Crew {
  id: string;
  name: string;
  districtId: string;
  districtName: string;
  baseLocation: string;
  lat: number;
  lng: number;
  members: number;
  skills: string[];
  availability: CrewAvailability;
  status: CrewStatus;
  activeIncidentId: string | null;
  completedJobs: number;
  locationSource: 'Simulated Demonstration Data';
  updatedAt: string;
}

export type RoutingMode = 'osrm_road' | 'haversine_estimate';

export interface RouteEstimate {
  distanceKm: number;
  straightLineKm: number;
  travelMinutes: number;
  estimatedEtaMinutes: number;
  routingMode: RoutingMode;
  etaLabel: string;
  routeCoordinates: [number, number][];
  fallbackReason?: string;
}

export interface CrewMatchFactor {
  factor: 'availability' | 'distance_eta' | 'skills' | 'severity_capacity' | 'workload';
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface CrewRecommendation {
  crew: Crew;
  distanceKm: number;
  straightLineKm: number;
  travelMinutes: number;
  estimatedEtaMinutes: number;
  routingMode: RoutingMode;
  etaLabel: string;
  routeCoordinates: [number, number][];
  fallbackReason?: string;
  matchScore: number;
  scoreBreakdown: CrewMatchFactor[];
  matchedSkills: string[];
  isAssignable: boolean;
  conflictReason: string | null;
  canForceReassign: boolean;
  workloadSummary: string;
  reasons: string[];
}

export type DispatchHistoryAction =
  | 'assigned'
  | 'reassigned'
  | 'status_updated'
  | 'availability_changed'
  | 'work_completed';

export interface DispatchHistoryEntry {
  id: string;
  incidentId: string;
  incidentTitle: string;
  crewId: string;
  crewName: string;
  action: DispatchHistoryAction;
  previousCrewId: string | null;
  previousCrewName: string | null;
  crewStatus: CrewStatus;
  incidentStatus: IncidentStatus;
  distanceKm: number | null;
  etaMinutes: number | null;
  routingMode: RoutingMode | null;
  notes: string;
  performedBy: string;
  createdAt: string;
}

export interface ActiveDispatchRoute {
  incidentId: string;
  incidentTitle: string;
  incidentSeverity: IncidentSeverity;
  incidentStatus: IncidentStatus;
  crewId: string;
  crewName: string;
  crewStatus: CrewStatus;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  distanceKm: number;
  straightLineKm: number;
  etaMinutes: number;
  routingMode: RoutingMode;
  etaLabel: string;
  fallbackReason?: string;
  coordinates: [number, number][];
  locationSource: 'Simulated Demonstration Data';
}

export type AlertSeverity = 'Critical' | 'High' | 'Moderate' | 'Informational';

export type AlertLifecycleStatus = 'New' | 'Acknowledged' | 'Assigned' | 'Resolved';

export type AlertType =
  | 'risk_threshold'
  | 'weather_deterioration'
  | 'critical_vulnerability'
  | 'unassigned_incident'
  | 'crew_assignment'
  | 'restoration_delay'
  | 'incident_logged'
  | 'incident_resolved';

export interface AlertItem {
  id: string;
  dedupeKey: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertLifecycleStatus;
  title: string;
  message: string;
  explanation: string;
  districtId: string | null;
  districtName: string | null;
  incidentId: string | null;
  incidentTitle: string | null;
  assignedCrewId: string | null;
  assignedCrewName: string | null;
  provenance: DataProvenance;
  isOfficialWarning: boolean;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface AlertSummaryStats {
  total: number;
  unread: number;
  active: number;
  bySeverity: Record<AlertSeverity, number>;
  byStatus: Record<AlertLifecycleStatus, number>;
}

export interface AlertConfig {
  moderateRiskThreshold: number;
  highRiskThreshold: number;
  criticalRiskThreshold: number;
  highWindThresholdKmh: number;
  heavyRainThresholdMm: number;
  unassignedAlertMinutes: number;
  restorationDelayMinutes: number;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  smsWebhookStatus: string;
  whatsappWebhookStatus: string;
  emailSmtpStatus: string;
  updatedAt: string;
}

export interface RiskSnapshotRecord {
  id: string;
  districtId: string;
  districtName: string;
  riskScore: number;
  riskCategory: RiskCategory;
  rainMm: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  past24hRainMm?: number;
  activeIncidents?: number;
  confidence?: DataConfidence;
  recordedAt: string;
}

export type AiReferenceSourceType =
  | 'Live API Data'
  | 'Derived Prediction'
  | 'Simulated Demonstration Data'
  | 'Historical Snapshot'
  | 'Alert Engine'
  | 'Dispatch Engine';

export interface AiDataReference {
  sourceType: AiReferenceSourceType;
  label: string;
  value: string;
  timestamp?: string;
  districtName?: string;
  incidentId?: string;
}

export type AiActionType =
  | 'review_dispatch'
  | 'review_incident'
  | 'review_district_risk'
  | 'review_alerts'
  | 'advisory_only';

export interface AiRecommendedAction {
  priority: 'Immediate' | 'Short-Term' | 'Monitoring';
  target: string;
  action: string;
  actionType?: AiActionType;
  incidentId?: string;
  crewId?: string;
  districtId?: string;
  requiresConfirmation: boolean;
}

export type AiChartFocus =
  | 'top_risk_districts'
  | 'district_factors'
  | 'snapshot_comparison'
  | 'incident_crew_readiness'
  | 'forecast_24h'
  | 'none';

export interface AiGroundedChart {
  chartType: 'bar' | 'grouped_bar' | 'line';
  title: string;
  subtitle: string;
  xKey: string;
  series: Array<{
    key: string;
    label: string;
    color: string;
  }>;
  data: Array<Record<string, string | number>>;
}

export interface AiConversationTurnSummary {
  query: string;
  summary: string;
}

export interface AiStructuredResponse {
  summary: string;
  keyFindings: string[];
  dataReferences: AiDataReference[];
  recommendedActions: AiRecommendedAction[];
  unavailableOrSimulatedNotes: string[];
  dataTimestamp: string;
  dataWarnings: string[];
  confidenceNote: string;
  chartFocus?: AiChartFocus;
  groundedChart?: AiGroundedChart | null;
}

export type StormPresetId =
  | 'heavy_rainfall'
  | 'high_wind'
  | 'severe_thunderstorm'
  | 'combined_extreme'
  | 'custom';

export type StormSeverityLevel = 'Moderate' | 'Strong' | 'Severe' | 'Extreme';

export interface StormSimulationParams {
  targetDistrictId: string;
  presetId: StormPresetId;
  rainfallMm: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  stormSeverity: StormSeverityLevel;
  precipitationProbability: number;
  isThunderstorm: boolean;
  stormTrackBearingDeg: number;
  impactRadiusKm: number;
}

export interface SimulationStepDistrictSnapshot {
  score: number;
  category: RiskCategory;
  delta: number;
  rainfallMm: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  precipitationProbability: number;
  isThunderstorm: boolean;
}

export interface SimulationTimelineStep {
  stepIndex: number;
  hourOffset: number;
  label: string;
  phaseLabel: string;
  stormCenterLat: number;
  stormCenterLng: number;
  coreIntensityFactor: number;
  targetBaselineScore: number;
  targetSimulatedScore: number;
  elevatedDistrictCount: number;
  districtSnapshots: Record<string, SimulationStepDistrictSnapshot>;
}

export interface SimulatedDistrictImpact {
  district: TelanganaDistrict;
  baselineAssessment: RiskAssessment;
  simulatedAssessment: RiskAssessment;
  deltaScore: number;
  categoryChanged: boolean;
  distanceToTargetKm: number;
  attenuationFactor: number;
  simulatedWeather: {
    rainfallMm: number;
    windSpeedKmh: number;
    windGustsKmh: number;
    precipitationProbability: number;
    isThunderstorm: boolean;
  };
  vulnerableInfrastructure: {
    substationCount: number;
    exposedSubstationsEst: number;
    vulnerabilityIndex: number;
    vulnerabilityNotes: string;
    activeIncidentsCount: number;
    stationedCrewsCount: number;
    infrastructureStressLevel: 'Low' | 'Elevated' | 'High' | 'Critical';
  };
}

export interface SavedSimulationScenario {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  params: StormSimulationParams;
  targetDistrictName: string;
  baselineScore: number;
  simulatedScore: number;
  deltaScore: number;
  elevatedDistrictCount: number;
  peakCategory: RiskCategory;
  summaryNote: string;
}
