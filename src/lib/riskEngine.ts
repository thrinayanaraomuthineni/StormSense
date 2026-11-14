import type {
  DailyRiskPoint,
  DataConfidence,
  HistoricalWeatherSummary,
  HourlyRiskPoint,
  PreventiveRecommendation,
  RiskAssessment,
  RiskCategory,
  RiskFactorContribution,
  RiskFactorKey,
  RiskScoringWeights,
  TelanganaDistrict,
  WeatherObservation,
} from './types';

export const MODEL_TYPE_LABEL =
  'Rule-Based Predictive Prototype (Heuristic Index — Non-ML, Not a Failure Probability)';

export const DEFAULT_RISK_WEIGHTS: RiskScoringWeights = {
  rainfall: 20,
  wind: 14,
  gusts: 18,
  thunderstorm: 12,
  precipitationProb: 8,
  historicalWeather: 8,
  recordedIncidents: 10,
  gridVulnerability: 10,
};

export interface IncidentContextSummary {
  activeCount: number;
  totalCount: number;
  simulatedCount: number;
  manualCount: number;
}

export interface RiskScoringInput {
  district: TelanganaDistrict;
  rainfallMm: number;
  precipitationProbability: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  isThunderstorm: boolean;
  historicalOutageCount: number;
  recentHistory?: HistoricalWeatherSummary;
  isStale: boolean;
  weatherAvailable: boolean;
  forecastAvailable?: boolean;
  weights?: Partial<RiskScoringWeights>;
  incidentContext?: IncidentContextSummary;
}

export interface NormalizedFactorBudgets {
  rainfall: number;
  wind: number;
  gusts: number;
  thunderstorm: number;
  precipitationProb: number;
  historicalWeather: number;
  recordedIncidents: number;
  gridVulnerability: number;
}

export function classifyRiskScore(score: number): RiskCategory {
  if (score <= 30) return 'LOW';
  if (score <= 60) return 'MODERATE';
  if (score <= 80) return 'HIGH';
  return 'CRITICAL';
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

type WeightKey = keyof Omit<RiskScoringWeights, 'updatedAt'>;

const WEIGHT_KEYS: WeightKey[] = [
  'rainfall',
  'wind',
  'gusts',
  'thunderstorm',
  'precipitationProb',
  'historicalWeather',
  'recordedIncidents',
  'gridVulnerability',
];

/**
 * Normalizes any non-negative factor weight configuration so the sum of
 * maximum factor point budgets equals exactly 100.0.
 */
export function normalizeRiskWeights(
  input?: Partial<RiskScoringWeights> | null
): NormalizedFactorBudgets {
  const sanitized: Record<WeightKey, number> = {
    rainfall: DEFAULT_RISK_WEIGHTS.rainfall,
    wind: DEFAULT_RISK_WEIGHTS.wind,
    gusts: DEFAULT_RISK_WEIGHTS.gusts,
    thunderstorm: DEFAULT_RISK_WEIGHTS.thunderstorm,
    precipitationProb: DEFAULT_RISK_WEIGHTS.precipitationProb,
    historicalWeather: DEFAULT_RISK_WEIGHTS.historicalWeather,
    recordedIncidents: DEFAULT_RISK_WEIGHTS.recordedIncidents,
    gridVulnerability: DEFAULT_RISK_WEIGHTS.gridVulnerability,
  };

  if (input) {
    for (const key of WEIGHT_KEYS) {
      const val = input[key];
      if (typeof val === 'number' && Number.isFinite(val)) {
        sanitized[key] = Math.max(0, val);
      }
    }
  }

  const rawSum = WEIGHT_KEYS.reduce((acc, k) => acc + sanitized[k], 0);
  if (rawSum <= 0) {
    return { ...DEFAULT_RISK_WEIGHTS };
  }

  const normalized = {} as NormalizedFactorBudgets;
  let runningSum = 0;
  let largestKey: WeightKey = 'rainfall';
  let largestVal = -1;

  for (const key of WEIGHT_KEYS) {
    const scaled = round1((sanitized[key] / rawSum) * 100);
    normalized[key] = scaled;
    runningSum = round1(runningSum + scaled);
    if (sanitized[key] > largestVal) {
      largestVal = sanitized[key];
      largestKey = key;
    }
  }

  // Adjust rounding drift on the largest factor so sum === 100.0 exactly
  const drift = round1(100 - runningSum);
  if (drift !== 0) {
    normalized[largestKey] = round1(clamp(normalized[largestKey] + drift, 0, 100));
  }

  return normalized;
}

function buildPreventiveRecommendations(
  contributions: RiskFactorContribution[],
  category: RiskCategory,
  district: TelanganaDistrict
): { recommendedAction: string; preventiveActions: PreventiveRecommendation[] } {
  const actions: PreventiveRecommendation[] = [];
  const byFactor = new Map<RiskFactorKey, RiskFactorContribution>(
    contributions.map((c) => [c.factor, c])
  );

  const gusts = byFactor.get('gusts');
  const wind = byFactor.get('wind');
  if ((gusts && gusts.intensityPct >= 40) || (wind && wind.intensityPct >= 45)) {
    const dominant = (gusts?.points ?? 0) >= (wind?.points ?? 0) ? gusts! : wind!;
    actions.push({
      factor: dominant.factor,
      priority: dominant.intensityPct >= 65 ? 'Immediate' : 'Preparedness',
      title: 'Overhead Line Patrol & Vegetation Clearance',
      action: `Deploy line patrol teams with tree-trimming gear along exposed 11kV/33kV spurs in ${district.name} to mitigate conductor galloping and branch contact.`,
      driverValue: dominant.rawValue,
    });
  }

  const rain = byFactor.get('rainfall');
  const histWeather = byFactor.get('historical_weather');
  if ((rain && rain.intensityPct >= 35) || (histWeather && histWeather.intensityPct >= 45)) {
    const dominant = (rain?.points ?? 0) >= (histWeather?.points ?? 0) ? rain! : histWeather!;
    actions.push({
      factor: dominant.factor,
      priority: dominant.intensityPct >= 65 ? 'Immediate' : 'Preparedness',
      title: 'Substation Drainage & Insulator Moisture Inspection',
      action: `Verify 33kV/11kV substation sump pumps, inspect pin/disc insulators for wet flashover tracking, and check pole-base waterlogging in low-lying feeders.`,
      driverValue: dominant.rawValue,
    });
  }

  const thunder = byFactor.get('thunderstorm');
  if (thunder && thunder.intensityPct >= 50) {
    actions.push({
      factor: 'thunderstorm',
      priority: 'Immediate',
      title: 'Surge Arrester & Breaker Recloser Readiness',
      action:
        'Check lightning arresters on primary distribution transformers and prepare rapid auto-reclose isolation protocols for transient earth faults.',
      driverValue: thunder.rawValue,
    });
  }

  const incidents = byFactor.get('recorded_incidents');
  if (incidents && incidents.intensityPct >= 25) {
    actions.push({
      factor: 'recorded_incidents',
      priority: incidents.intensityPct >= 50 ? 'Immediate' : 'Preparedness',
      title: 'Feeder Load Transfer & Crew Re-Balancing',
      action: `Re-balance active restoration crews across ${district.name} and keep ring-main backfeed switching paths ready for overloaded adjacent feeders.`,
      driverValue: incidents.rawValue,
    });
  }

  const grid = byFactor.get('grid_vulnerability');
  if (grid && grid.intensityPct >= 70 && (category === 'HIGH' || category === 'CRITICAL')) {
    actions.push({
      factor: 'grid_vulnerability',
      priority: 'Preparedness',
      title: 'High-Exposure Asset Spares Pre-Staging',
      action: `Pre-stage spare DTR fuses, HT conductor sleeves, and mobile DG units near vulnerable substations (${district.substationCount} monitored substations).`,
      driverValue: grid.rawValue,
    });
  }

  if (actions.length === 0) {
    actions.push({
      factor: 'overall',
      priority: 'Routine',
      title: 'Routine SCADA Telemetry & Depot Readiness',
      action:
        'Maintain standard SCADA feeder monitoring, verify routine depot crew roster availability, and track hourly Open-Meteo updates.',
      driverValue: `${category} Risk Band`,
    });
  }

  const summary =
    category === 'CRITICAL'
      ? `Critical readiness in ${district.name}: ${actions.map((a) => a.title).join('; ')}.`
      : category === 'HIGH'
        ? `Elevated readiness in ${district.name}: ${actions.map((a) => a.title).join('; ')}.`
        : actions[0].action;

  return { recommendedAction: summary, preventiveActions: actions };
}

function buildScoreExplanation(params: {
  districtName: string;
  score: number;
  exactScore: number;
  category: RiskCategory;
  contributions: RiskFactorContribution[];
  weatherAvailable: boolean;
  isStale: boolean;
}): string {
  const { districtName, score, exactScore, category, contributions, weatherAvailable, isStale } =
    params;
  if (!weatherAvailable) {
    return `${districtName} scored ${score}/100 (${category}) using only baseline infrastructure exposure and recorded incidents because live Open-Meteo weather telemetry is currently unavailable.`;
  }

  const topDrivers = [...contributions]
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((c) => `${c.label} (${c.rawValue}, +${c.points} pts)`);

  const staleTag = isStale ? ' using cached Open-Meteo telemetry' : ' using live Open-Meteo telemetry';
  return `${districtName} scored ${score}/100 (exact sum ${exactScore.toFixed(1)}/100 · ${category})${staleTag}. Top drivers: ${topDrivers.join(', ') || 'minimal hazard activity'}.`;
}

/**
 * Deterministic, explainable rule-based outage risk scoring engine (Prototype v2.0).
 * Not a trained ML model and not a statistical failure probability; weights are
 * configurable and mathematically normalized to sum to 100.0 points.
 */
export function computeRiskBreakdown(input: RiskScoringInput): {
  score: number;
  exactScore: number;
  category: RiskCategory;
  contributions: RiskFactorContribution[];
  scoreExplanation: string;
  recommendedAction: string;
  preventiveActions: PreventiveRecommendation[];
  confidence: DataConfidence;
  confidenceReason: string;
  dataQualityScore: number;
  dataQualityFlags: string[];
} {
  const budgets = normalizeRiskWeights(input.weights);
  const weatherStatus: RiskFactorContribution['dataStatus'] = !input.weatherAvailable
    ? 'Unavailable'
    : input.isStale
      ? 'Stale'
      : 'Live';

  const rainIntensity = input.weatherAvailable ? clamp(input.rainfallMm / 25, 0, 1) : 0;
  const windIntensity = input.weatherAvailable
    ? clamp(Math.max(0, input.windSpeedKmh - 8) / 45, 0, 1)
    : 0;
  const gustIntensity = input.weatherAvailable
    ? clamp(Math.max(0, input.windGustsKmh - 15) / 60, 0, 1)
    : 0;
  const thunderIntensity = input.weatherAvailable && input.isThunderstorm ? 1 : 0;
  const probIntensity = input.weatherAvailable
    ? clamp(input.precipitationProbability / 100, 0, 1)
    : 0;

  const hasHistory = Boolean(input.recentHistory && input.recentHistory.observationHoursCount > 0);
  const histWeatherIntensity = hasHistory
    ? clamp(
        (input.recentHistory!.past24hRainMm / 40) * 0.6 +
          (Math.max(0, input.recentHistory!.past24hMaxGustsKmh - 25) / 55) * 0.25 +
          Math.min(1, input.recentHistory!.past24hThunderHours / 3) * 0.15,
        0,
        1
      )
    : 0;

  const incidentIntensity = clamp(input.historicalOutageCount / 4, 0, 1);
  const vulnIntensity = clamp(input.district.vulnerabilityIndex, 0, 1);

  const incCtx = input.incidentContext;
  const incidentStatus: RiskFactorContribution['dataStatus'] =
    incCtx && incCtx.simulatedCount > 0 && incCtx.manualCount === 0
      ? 'Simulated'
      : input.historicalOutageCount > 0
        ? 'Live'
        : 'Live';

  const histStatus: RiskFactorContribution['dataStatus'] = !hasHistory
    ? 'Unavailable'
    : input.isStale
      ? 'Stale'
      : 'Live';

  const contributions: RiskFactorContribution[] = [
    {
      factor: 'rainfall',
      label: 'Rainfall Intensity',
      rawValue: input.weatherAvailable ? `${input.rainfallMm.toFixed(1)} mm/h` : 'Unavailable',
      points: round1(rainIntensity * budgets.rainfall),
      maxPoints: budgets.rainfall,
      weightPct: budgets.rainfall,
      intensityPct: Math.round(rainIntensity * 100),
      dataStatus: weatherStatus,
      rationale: !input.weatherAvailable
        ? 'Open-Meteo rainfall feed unavailable; 0 points assigned.'
        : input.rainfallMm >= 10
          ? 'Heavy precipitation raises insulator flashover and transformer water-ingress exposure.'
          : input.rainfallMm > 0
            ? 'Light-to-moderate rainfall increases surface moisture on 11kV insulators.'
            : 'Dry conditions; negligible active precipitation pressure.',
    },
    {
      factor: 'wind',
      label: 'Sustained Wind Speed',
      rawValue: input.weatherAvailable ? `${input.windSpeedKmh.toFixed(1)} km/h` : 'Unavailable',
      points: round1(windIntensity * budgets.wind),
      maxPoints: budgets.wind,
      weightPct: budgets.wind,
      intensityPct: Math.round(windIntensity * 100),
      dataStatus: weatherStatus,
      rationale: !input.weatherAvailable
        ? 'Open-Meteo wind speed unavailable; 0 points assigned.'
        : input.windSpeedKmh >= 35
          ? 'High sustained wind stresses overhead conductor spans and pole cross-arms.'
          : 'Sustained wind remains within standard overhead conductor tolerances.',
    },
    {
      factor: 'gusts',
      label: 'Peak Wind Gusts',
      rawValue: input.weatherAvailable ? `${input.windGustsKmh.toFixed(1)} km/h` : 'Unavailable',
      points: round1(gustIntensity * budgets.gusts),
      maxPoints: budgets.gusts,
      weightPct: budgets.gusts,
      intensityPct: Math.round(gustIntensity * 100),
      dataStatus: weatherStatus,
      rationale: !input.weatherAvailable
        ? 'Open-Meteo peak gust feed unavailable; 0 points assigned.'
        : input.windGustsKmh >= 45
          ? 'Severe gusts elevate vegetation contact and conductor clashing risk.'
          : 'Wind gusts remain below critical overhead-line trip thresholds.',
    },
    {
      factor: 'thunderstorm',
      label: 'Thunderstorm / Lightning',
      rawValue: !input.weatherAvailable
        ? 'Unavailable'
        : input.isThunderstorm
          ? 'Active WMO Storm'
          : 'None',
      points: round1(thunderIntensity * budgets.thunderstorm),
      maxPoints: budgets.thunderstorm,
      weightPct: budgets.thunderstorm,
      intensityPct: Math.round(thunderIntensity * 100),
      dataStatus: weatherStatus,
      rationale: !input.weatherAvailable
        ? 'WMO weather code unavailable; 0 points assigned.'
        : input.isThunderstorm
          ? 'WMO convective storm code detected; elevated lightning surge and breaker trip pressure.'
          : 'No active thunderstorm WMO code reported in current observation.',
    },
    {
      factor: 'precipitation_prob',
      label: 'Precipitation Probability',
      rawValue: input.weatherAvailable ? `${Math.round(input.precipitationProbability)}%` : 'Unavailable',
      points: round1(probIntensity * budgets.precipitationProb),
      maxPoints: budgets.precipitationProb,
      weightPct: budgets.precipitationProb,
      intensityPct: Math.round(probIntensity * 100),
      dataStatus: weatherStatus,
      rationale: input.weatherAvailable
        ? 'Indicates short-horizon storm cell persistence over the feeder zone.'
        : 'Forecast probability unavailable; 0 points assigned.',
    },
    {
      factor: 'historical_weather',
      label: 'Past 24h Weather Stress',
      rawValue: hasHistory
        ? `${input.recentHistory!.past24hRainMm.toFixed(1)} mm / ${input.recentHistory!.past24hMaxGustsKmh.toFixed(0)} km/h gusts`
        : 'Unavailable',
      points: round1(histWeatherIntensity * budgets.historicalWeather),
      maxPoints: budgets.historicalWeather,
      weightPct: budgets.historicalWeather,
      intensityPct: Math.round(histWeatherIntensity * 100),
      dataStatus: histStatus,
      rationale: hasHistory
        ? `Open-Meteo past ${input.recentHistory!.observationHoursCount}h observations capture ground saturation, weakened trees, and cumulative storm fatigue (${input.recentHistory!.past24hThunderHours} storm hrs).`
        : 'Historical 24h Open-Meteo hourly observations unavailable; 0 points assigned.',
    },
    {
      factor: 'recorded_incidents',
      label: 'Recorded District Incidents',
      rawValue:
        incCtx && incCtx.simulatedCount > 0
          ? `${input.historicalOutageCount} active (${incCtx.simulatedCount} simulated)`
          : `${input.historicalOutageCount} active`,
      points: round1(incidentIntensity * budgets.recordedIncidents),
      maxPoints: budgets.recordedIncidents,
      weightPct: budgets.recordedIncidents,
      intensityPct: Math.round(incidentIntensity * 100),
      dataStatus: incidentStatus,
      rationale:
        input.historicalOutageCount > 0
          ? 'Active district incidents indicate stressed feeders and concurrent maintenance crew load.'
          : 'No active incident backlog recorded for this district.',
    },
    {
      factor: 'grid_vulnerability',
      label: 'Grid Structural Exposure',
      rawValue: `${Math.round(input.district.vulnerabilityIndex * 100)}% baseline`,
      points: round1(vulnIntensity * budgets.gridVulnerability),
      maxPoints: budgets.gridVulnerability,
      weightPct: budgets.gridVulnerability,
      intensityPct: Math.round(vulnIntensity * 100),
      dataStatus: 'Static',
      rationale: input.district.vulnerabilityNotes,
    },
  ];

  const rawTotal = contributions.reduce((acc, c) => acc + c.points, 0);
  const exactScore = round1(clamp(rawTotal, 0, 100));
  const score = Math.round(exactScore);
  const category = classifyRiskScore(score);

  const { recommendedAction, preventiveActions } = buildPreventiveRecommendations(
    contributions,
    category,
    input.district
  );

  const scoreExplanation = buildScoreExplanation({
    districtName: input.district.name,
    score,
    exactScore,
    category,
    contributions,
    weatherAvailable: input.weatherAvailable,
    isStale: input.isStale,
  });

  // Data quality & confidence assessment (honest, non-ML)
  let confidence: DataConfidence = 'HIGH';
  let confidenceReason =
    'Live Open-Meteo current, forecast, and 24h historical observations paired with district incident state.';
  const dataQualityFlags: string[] = [];
  let qualityScore = 0;

  if (!input.weatherAvailable) {
    confidence = 'UNAVAILABLE';
    confidenceReason =
      'Open-Meteo weather telemetry unavailable; meteorological factors defaulted to 0 points.';
    dataQualityFlags.push('Weather feed unavailable (only static grid exposure & incident logs scored)');
    qualityScore += 15; // static baseline + SQLite incidents only
  } else {
    qualityScore += 45;
    if (input.isStale) {
      confidence = 'DEGRADED';
      confidenceReason =
        'Using cached Open-Meteo telemetry because the latest live refresh failed or timed out.';
      dataQualityFlags.push('Weather telemetry is stale cached data');
      qualityScore += 5;
    } else {
      dataQualityFlags.push('Live Open-Meteo weather telemetry active');
      qualityScore += 20;
    }

    if (input.forecastAvailable !== false) {
      qualityScore += 15;
    } else {
      dataQualityFlags.push('Hourly/daily forecast projection arrays missing');
    }

    if (hasHistory) {
      qualityScore += 15;
      dataQualityFlags.push(
        `Past ${input.recentHistory!.observationHoursCount}h Open-Meteo historical weather included`
      );
    } else {
      if (confidence === 'HIGH') {
        confidence = 'DEGRADED';
        confidenceReason =
          'Live Open-Meteo telemetry active, but past 24h historical weather observations were unavailable.';
      }
      dataQualityFlags.push('Historical 24h weather observations missing (0 pts assigned)');
    }

    qualityScore += 5; // District incident & grid baseline present
  }

  if (incCtx && incCtx.simulatedCount > 0) {
    dataQualityFlags.push(
      `Includes ${incCtx.simulatedCount} Simulated Demonstration incident record(s) in SQLite`
    );
  }
  dataQualityFlags.push(
    'No empirical historical failure dataset connected — score is a heuristic index, not a statistical outage probability'
  );

  return {
    score,
    exactScore,
    category,
    contributions,
    scoreExplanation,
    recommendedAction,
    preventiveActions,
    confidence,
    confidenceReason,
    dataQualityScore: Math.round(clamp(qualityScore, 0, 100)),
    dataQualityFlags,
  };
}

export interface AssessDistrictRiskOptions {
  weights?: Partial<RiskScoringWeights>;
  incidentContext?: IncidentContextSummary;
}

export function assessDistrictRisk(
  district: TelanganaDistrict,
  weather: WeatherObservation | undefined,
  historicalOutageCount: number,
  options?: AssessDistrictRiskOptions
): RiskAssessment {
  const weatherAvailable = Boolean(weather);
  const forecastAvailable = Boolean(weather && weather.hourly.length > 0 && weather.daily.length > 0);
  const incidentContext: IncidentContextSummary = options?.incidentContext ?? {
    activeCount: historicalOutageCount,
    totalCount: historicalOutageCount,
    simulatedCount: 0,
    manualCount: historicalOutageCount,
  };

  const breakdown = computeRiskBreakdown({
    district,
    rainfallMm: weather?.rainMm ?? 0,
    precipitationProbability: weather?.precipitationProbability ?? 0,
    windSpeedKmh: weather?.windSpeedKmh ?? 0,
    windGustsKmh: weather?.windGustsKmh ?? 0,
    isThunderstorm: weather?.isThunderstorm ?? false,
    historicalOutageCount,
    recentHistory: weather?.recentHistory,
    isStale: weather?.isStale ?? false,
    weatherAvailable,
    forecastAvailable,
    weights: options?.weights,
    incidentContext,
  });

  const hourlyTrend: HourlyRiskPoint[] = (weather?.hourly ?? []).slice(0, 24).map((h) => {
    const isStorm = h.weatherCode >= 95;
    const hRes = computeRiskBreakdown({
      district,
      rainfallMm: h.rainMm,
      precipitationProbability: h.precipitationProbability,
      windSpeedKmh: h.windSpeedKmh,
      windGustsKmh: h.windGustsKmh,
      isThunderstorm: isStorm,
      historicalOutageCount,
      recentHistory: weather?.recentHistory,
      isStale: weather?.isStale ?? false,
      weatherAvailable,
      forecastAvailable,
      weights: options?.weights,
      incidentContext,
    });
    return {
      time: h.time,
      score: hRes.score,
      category: hRes.category,
      rainMm: h.rainMm,
      windGustsKmh: h.windGustsKmh,
      precipitationProbability: h.precipitationProbability,
    };
  });

  const dailyForecast: DailyRiskPoint[] = (weather?.daily ?? []).slice(0, 7).map((d) => {
    const isStorm = d.weatherCode >= 95;
    // Scale daily cumulative rainfall into peak-intensity equivalent for daily risk outlook
    const intensityEquivalent = d.precipitationSumMm / 4;
    const dRes = computeRiskBreakdown({
      district,
      rainfallMm: intensityEquivalent,
      precipitationProbability: d.precipitationProbabilityMax,
      windSpeedKmh: d.windSpeedMaxKmh,
      windGustsKmh: d.windGustsMaxKmh,
      isThunderstorm: isStorm,
      historicalOutageCount,
      recentHistory: weather?.recentHistory,
      isStale: weather?.isStale ?? false,
      weatherAvailable,
      forecastAvailable,
      weights: options?.weights,
      incidentContext,
    });
    return {
      date: d.date,
      score: dRes.score,
      category: dRes.category,
      precipitationSumMm: d.precipitationSumMm,
      windGustsMaxKmh: d.windGustsMaxKmh,
    };
  });

  return {
    districtId: district.id,
    districtName: district.name,
    score: breakdown.score,
    exactScore: breakdown.exactScore,
    category: breakdown.category,
    contributions: breakdown.contributions,
    scoreExplanation: breakdown.scoreExplanation,
    vulnerabilityIndex: district.vulnerabilityIndex,
    vulnerabilityNotes: district.vulnerabilityNotes,
    recommendedAction: breakdown.recommendedAction,
    preventiveActions: breakdown.preventiveActions,
    confidence: breakdown.confidence,
    confidenceReason: breakdown.confidenceReason,
    dataQualityScore: breakdown.dataQualityScore,
    dataQualityFlags: breakdown.dataQualityFlags,
    incidentContext,
    modelType: MODEL_TYPE_LABEL,
    calculatedAt: new Date().toISOString(),
    hourlyTrend,
    dailyForecast,
  };
}
