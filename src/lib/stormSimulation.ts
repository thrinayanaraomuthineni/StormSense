import { haversineDistanceKm } from './crewDispatch';
import { computeRiskBreakdown, MODEL_TYPE_LABEL, type IncidentContextSummary } from './riskEngine';
import type {
  Crew,
  Incident,
  RiskAssessment,
  RiskCategory,
  RiskScoringWeights,
  SimulatedDistrictImpact,
  SimulationStepDistrictSnapshot,
  SimulationTimelineStep,
  StormPresetId,
  StormSeverityLevel,
  StormSimulationParams,
  TelanganaDistrict,
  WeatherObservation,
} from './types';

export interface StormPresetDefinition {
  id: Exclude<StormPresetId, 'custom'>;
  name: string;
  shortDesc: string;
  rainfallMm: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  stormSeverity: StormSeverityLevel;
  precipitationProbability: number;
  isThunderstorm: boolean;
  stormTrackBearingDeg: number;
  impactRadiusKm: number;
}

export const STORM_PRESETS: StormPresetDefinition[] = [
  {
    id: 'heavy_rainfall',
    name: 'Heavy Rainfall',
    shortDesc: 'Sustained monsoon downpour stressing substation drainage & 11kV insulators',
    rainfallMm: 34,
    windSpeedKmh: 26,
    windGustsKmh: 40,
    stormSeverity: 'Strong',
    precipitationProbability: 92,
    isThunderstorm: false,
    stormTrackBearingDeg: 315,
    impactRadiusKm: 95,
  },
  {
    id: 'high_wind',
    name: 'High Wind Event',
    shortDesc: 'Dry squall-line gusts elevating conductor clashing & vegetation contact',
    rainfallMm: 4,
    windSpeedKmh: 58,
    windGustsKmh: 82,
    stormSeverity: 'Severe',
    precipitationProbability: 45,
    isThunderstorm: false,
    stormTrackBearingDeg: 290,
    impactRadiusKm: 105,
  },
  {
    id: 'severe_thunderstorm',
    name: 'Severe Thunderstorm',
    shortDesc: 'Convective lightning cell with heavy rain bursts and feeder breaker trips',
    rainfallMm: 28,
    windSpeedKmh: 48,
    windGustsKmh: 76,
    stormSeverity: 'Severe',
    precipitationProbability: 95,
    isThunderstorm: true,
    stormTrackBearingDeg: 325,
    impactRadiusKm: 90,
  },
  {
    id: 'combined_extreme',
    name: 'Combined Extreme Weather',
    shortDesc: 'Cyclonic depression band combining cloudburst rain, severe gusts & lightning',
    rainfallMm: 52,
    windSpeedKmh: 72,
    windGustsKmh: 105,
    stormSeverity: 'Extreme',
    precipitationProbability: 100,
    isThunderstorm: true,
    stormTrackBearingDeg: 310,
    impactRadiusKm: 130,
  },
];

export const SEVERITY_ORDER: StormSeverityLevel[] = ['Moderate', 'Strong', 'Severe', 'Extreme'];

export const SEVERITY_RADIUS_MULTIPLIER: Record<StormSeverityLevel, number> = {
  Moderate: 0.85,
  Strong: 1.0,
  Severe: 1.15,
  Extreme: 1.3,
};

export function createParamsFromPreset(
  presetId: Exclude<StormPresetId, 'custom'>,
  targetDistrictId: string
): StormSimulationParams {
  const preset = STORM_PRESETS.find((p) => p.id === presetId) ?? STORM_PRESETS[2];
  return {
    targetDistrictId,
    presetId: preset.id,
    rainfallMm: preset.rainfallMm,
    windSpeedKmh: preset.windSpeedKmh,
    windGustsKmh: preset.windGustsKmh,
    stormSeverity: preset.stormSeverity,
    precipitationProbability: preset.precipitationProbability,
    isThunderstorm: preset.isThunderstorm,
    stormTrackBearingDeg: preset.stormTrackBearingDeg,
    impactRadiusKm: preset.impactRadiusKm,
  };
}

export function createBaselineParams(
  targetDistrictId: string,
  baselineWeather?: WeatherObservation
): StormSimulationParams {
  return {
    targetDistrictId,
    presetId: 'custom',
    rainfallMm: Math.round((baselineWeather?.rainMm ?? 0) * 10) / 10,
    windSpeedKmh: Math.round(baselineWeather?.windSpeedKmh ?? 12),
    windGustsKmh: Math.round(baselineWeather?.windGustsKmh ?? 20),
    stormSeverity: baselineWeather?.isThunderstorm ? 'Strong' : 'Moderate',
    precipitationProbability: Math.round(baselineWeather?.precipitationProbability ?? 20),
    isThunderstorm: Boolean(baselineWeather?.isThunderstorm),
    stormTrackBearingDeg: 315,
    impactRadiusKm: 90,
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function summarizeIncidentsByDistrict(incidents: Incident[]): Map<string, IncidentContextSummary> {
  const map = new Map<string, IncidentContextSummary>();
  for (const inc of incidents) {
    const cur = map.get(inc.districtId) ?? {
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
    map.set(inc.districtId, cur);
  }
  return map;
}

function computeAttenuation(distanceKm: number, effectiveRadiusKm: number): number {
  if (distanceKm <= 1) return 1;
  if (distanceKm > effectiveRadiusKm * 1.45) return 0;
  const sigma = Math.max(20, effectiveRadiusKm * 0.56);
  const gauss = Math.exp(-0.5 * (distanceKm / sigma) ** 2);
  return gauss < 0.04 ? 0 : gauss;
}

function blendWeatherForCell(
  params: StormSimulationParams,
  attenuation: number,
  intensityMultiplier: number,
  baselineWeather: WeatherObservation | undefined,
  isTargetPeakCell: boolean
) {
  const effectiveFactor = clamp(attenuation * intensityMultiplier, 0, 1);
  const baseRain = baselineWeather?.rainMm ?? 0;
  const baseWind = baselineWeather?.windSpeedKmh ?? 10;
  const baseGust = baselineWeather?.windGustsKmh ?? 18;
  const baseProb = baselineWeather?.precipitationProbability ?? 15;
  const baseThunder = baselineWeather?.isThunderstorm ?? false;

  if (isTargetPeakCell && intensityMultiplier >= 0.999) {
    return {
      rainfallMm: round1(params.rainfallMm),
      windSpeedKmh: round1(params.windSpeedKmh),
      windGustsKmh: round1(Math.max(params.windGustsKmh, params.windSpeedKmh)),
      precipitationProbability: Math.round(clamp(params.precipitationProbability, 0, 100)),
      isThunderstorm: params.isThunderstorm,
    };
  }

  const rainfallMm = round1(baseRain + (params.rainfallMm - baseRain) * effectiveFactor);
  const windSpeedKmh = round1(baseWind + (params.windSpeedKmh - baseWind) * effectiveFactor);
  const windGustsKmh = round1(
    Math.max(windSpeedKmh, baseGust + (params.windGustsKmh - baseGust) * effectiveFactor)
  );
  const precipitationProbability = Math.round(
    clamp(baseProb + (params.precipitationProbability - baseProb) * effectiveFactor, 0, 100)
  );
  const isThunderstorm =
    baseThunder || (params.isThunderstorm && effectiveFactor >= 0.48);

  return {
    rainfallMm: Math.max(0, rainfallMm),
    windSpeedKmh: Math.max(0, windSpeedKmh),
    windGustsKmh: Math.max(0, windGustsKmh),
    precipitationProbability,
    isThunderstorm,
  };
}

function inferStressLevel(
  score: number,
  category: RiskCategory
): 'Low' | 'Elevated' | 'High' | 'Critical' {
  if (category === 'CRITICAL' || score >= 81) return 'Critical';
  if (category === 'HIGH' || score >= 61) return 'High';
  if (category === 'MODERATE' || score >= 31) return 'Elevated';
  return 'Low';
}

export function computeStormImpactForDistricts(input: {
  params: StormSimulationParams;
  districts: TelanganaDistrict[];
  baselineAssessments: RiskAssessment[];
  weatherObservations: WeatherObservation[];
  weights?: Partial<RiskScoringWeights>;
  incidents: Incident[];
  crews: Crew[];
}): SimulatedDistrictImpact[] {
  const { params, districts, baselineAssessments, weatherObservations, weights, incidents, crews } =
    input;

  const targetDistrict =
    districts.find((d) => d.id === params.targetDistrictId) ?? districts[0];
  if (!targetDistrict) return [];

  const baselineMap = new Map(baselineAssessments.map((a) => [a.districtId, a]));
  const weatherMap = new Map(weatherObservations.map((w) => [w.districtId, w]));
  const incCtxMap = summarizeIncidentsByDistrict(incidents);
  const crewsByDistrict = new Map<string, number>();
  for (const c of crews) {
    crewsByDistrict.set(c.districtId, (crewsByDistrict.get(c.districtId) ?? 0) + 1);
  }

  const effectiveRadius =
    params.impactRadiusKm * (SEVERITY_RADIUS_MULTIPLIER[params.stormSeverity] ?? 1);

  return districts
    .map((district) => {
      const distanceToTargetKm = haversineDistanceKm(
        district.lat,
        district.lng,
        targetDistrict.lat,
        targetDistrict.lng
      );
      const isTarget = district.id === targetDistrict.id;
      const attenuationFactor = isTarget ? 1 : computeAttenuation(distanceToTargetKm, effectiveRadius);
      const baseWeather = weatherMap.get(district.id);
      const incCtx = incCtxMap.get(district.id) ?? {
        activeCount: 0,
        totalCount: 0,
        simulatedCount: 0,
        manualCount: 0,
      };

      const baselineAssessment =
        baselineMap.get(district.id) ??
        (() => {
          const fallback = computeRiskBreakdown({
            district,
            rainfallMm: baseWeather?.rainMm ?? 0,
            precipitationProbability: baseWeather?.precipitationProbability ?? 0,
            windSpeedKmh: baseWeather?.windSpeedKmh ?? 0,
            windGustsKmh: baseWeather?.windGustsKmh ?? 0,
            isThunderstorm: baseWeather?.isThunderstorm ?? false,
            historicalOutageCount: incCtx.activeCount,
            recentHistory: baseWeather?.recentHistory,
            isStale: baseWeather?.isStale ?? false,
            weatherAvailable: Boolean(baseWeather),
            forecastAvailable: Boolean(baseWeather),
            weights,
            incidentContext: incCtx,
          });
          return {
            districtId: district.id,
            districtName: district.name,
            score: fallback.score,
            exactScore: fallback.exactScore,
            category: fallback.category,
            contributions: fallback.contributions,
            scoreExplanation: fallback.scoreExplanation,
            vulnerabilityIndex: district.vulnerabilityIndex,
            vulnerabilityNotes: district.vulnerabilityNotes,
            recommendedAction: fallback.recommendedAction,
            preventiveActions: fallback.preventiveActions,
            confidence: fallback.confidence,
            confidenceReason: fallback.confidenceReason,
            dataQualityScore: fallback.dataQualityScore,
            dataQualityFlags: fallback.dataQualityFlags,
            incidentContext: incCtx,
            modelType: MODEL_TYPE_LABEL,
            calculatedAt: new Date().toISOString(),
            hourlyTrend: [],
            dailyForecast: [],
          } satisfies RiskAssessment;
        })();

      const simulatedWeather = blendWeatherForCell(
        params,
        attenuationFactor,
        1,
        baseWeather,
        isTarget
      );

      // Recompute using the exact StormSense risk engine with hypothetical weather inputs
      const simBreakdown = computeRiskBreakdown({
        district,
        rainfallMm: simulatedWeather.rainfallMm,
        precipitationProbability: simulatedWeather.precipitationProbability,
        windSpeedKmh: simulatedWeather.windSpeedKmh,
        windGustsKmh: simulatedWeather.windGustsKmh,
        isThunderstorm: simulatedWeather.isThunderstorm,
        historicalOutageCount: incCtx.activeCount,
        recentHistory: baseWeather?.recentHistory,
        isStale: false,
        weatherAvailable: true,
        forecastAvailable: true,
        weights,
        incidentContext: incCtx,
      });

      const labeledContributions = simBreakdown.contributions.map((c) => {
        if (
          c.factor === 'rainfall' ||
          c.factor === 'wind' ||
          c.factor === 'gusts' ||
          c.factor === 'thunderstorm' ||
          c.factor === 'precipitation_prob'
        ) {
          return { ...c, dataStatus: 'Simulated' as const };
        }
        return c;
      });

      const deltaScore = simBreakdown.score - baselineAssessment.score;
      const simulatedAssessment: RiskAssessment = {
        districtId: district.id,
        districtName: district.name,
        score: simBreakdown.score,
        exactScore: simBreakdown.exactScore,
        category: simBreakdown.category,
        contributions: labeledContributions,
        scoreExplanation: `HYPOTHETICAL SIMULATED SCENARIO: ${district.name} projected at ${simBreakdown.score}/100 (${simBreakdown.category}, ${deltaScore >= 0 ? `+${deltaScore}` : deltaScore} pts vs live baseline ${baselineAssessment.score}). Derived via rule-based risk engine; not a meteorological forecast.`,
        vulnerabilityIndex: district.vulnerabilityIndex,
        vulnerabilityNotes: district.vulnerabilityNotes,
        recommendedAction: simBreakdown.recommendedAction,
        preventiveActions: simBreakdown.preventiveActions,
        confidence: baselineAssessment.confidence,
        confidenceReason:
          'Derived Risk Prediction computed from hypothetical user-configured scenario parameters.',
        dataQualityScore: simBreakdown.dataQualityScore,
        dataQualityFlags: [
          'HYPOTHETICAL SIMULATED SCENARIO — Meteorological inputs overridden for what-if stress testing',
          ...simBreakdown.dataQualityFlags.filter((f) => !f.includes('Live Open-Meteo')),
        ],
        incidentContext: incCtx,
        modelType: `${MODEL_TYPE_LABEL} [Scenario Simulation]`,
        calculatedAt: new Date().toISOString(),
        hourlyTrend: [],
        dailyForecast: [],
      };

      const stressRatio = clamp(simBreakdown.score / 100, 0, 1);
      const exposedSubstationsEst =
        deltaScore > 0 || simBreakdown.score >= 31
          ? Math.min(
              district.substationCount,
              Math.max(
                1,
                Math.round(district.substationCount * district.vulnerabilityIndex * stressRatio * 0.65)
              )
            )
          : 0;

      return {
        district,
        baselineAssessment,
        simulatedAssessment,
        deltaScore,
        categoryChanged: simulatedAssessment.category !== baselineAssessment.category,
        distanceToTargetKm,
        attenuationFactor: round1(attenuationFactor * 100) / 100,
        simulatedWeather,
        vulnerableInfrastructure: {
          substationCount: district.substationCount,
          exposedSubstationsEst,
          vulnerabilityIndex: district.vulnerabilityIndex,
          vulnerabilityNotes: district.vulnerabilityNotes,
          activeIncidentsCount: incCtx.activeCount,
          stationedCrewsCount: crewsByDistrict.get(district.id) ?? 0,
          infrastructureStressLevel: inferStressLevel(simBreakdown.score, simBreakdown.category),
        },
      };
    })
    .sort((a, b) => {
      if (a.district.id === targetDistrict.id) return -1;
      if (b.district.id === targetDistrict.id) return 1;
      if (b.deltaScore !== a.deltaScore) return b.deltaScore - a.deltaScore;
      return b.simulatedAssessment.score - a.simulatedAssessment.score;
    });
}

function offsetLatLngKm(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number
): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceKm * Math.cos(rad)) / 111.32;
  const dLng = (distanceKm * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [Number((lat + dLat).toFixed(4)), Number((lng + dLng).toFixed(4))];
}

const TIMELINE_PHASE_LABELS = [
  'Approaching Outer Band',
  'Squall Front Entering Circle',
  'Intensifying Core Arrival',
  'Peak Landfall Over Target District',
  'Post-Peak Passing Band',
  'Dissipating Downwind Band',
  'System Clearing Zone',
];

export function buildSimulationTimeline(input: {
  params: StormSimulationParams;
  districts: TelanganaDistrict[];
  baselineAssessments: RiskAssessment[];
  weatherObservations: WeatherObservation[];
  weights?: Partial<RiskScoringWeights>;
  incidents: Incident[];
  crews: Crew[];
}): SimulationTimelineStep[] {
  const { params, districts, baselineAssessments, weatherObservations, weights, incidents, crews } =
    input;
  const targetDistrict =
    districts.find((d) => d.id === params.targetDistrictId) ?? districts[0];
  if (!targetDistrict) return [];

  const baselineMap = new Map(baselineAssessments.map((a) => [a.districtId, a]));
  const weatherMap = new Map(weatherObservations.map((w) => [w.districtId, w]));
  const incCtxMap = summarizeIncidentsByDistrict(incidents);
  const effectiveRadius =
    params.impactRadiusKm * (SEVERITY_RADIUS_MULTIPLIER[params.stormSeverity] ?? 1);

  const TOTAL_STEPS = 13; // T+0.0h .. T+6.0h every 0.5h
  const TRACK_HALF_SPAN_KM = 84;
  const upwindBearing = (params.stormTrackBearingDeg + 180) % 360;

  const steps: SimulationTimelineStep[] = [];

  for (let i = 0; i < TOTAL_STEPS; i++) {
    const tNorm = i / (TOTAL_STEPS - 1); // 0.0 -> 1.0
    const hourOffset = i * 0.5;
    // Signed distance along track: -84 km upwind at T+0 -> 0 km at T+3h -> +84 km downwind at T+6h
    const signedOffsetKm = (tNorm - 0.5) * 2 * TRACK_HALF_SPAN_KM;
    const [stormCenterLat, stormCenterLng] =
      signedOffsetKm === 0
        ? [targetDistrict.lat, targetDistrict.lng]
        : offsetLatLngKm(
            targetDistrict.lat,
            targetDistrict.lng,
            signedOffsetKm < 0 ? upwindBearing : params.stormTrackBearingDeg,
            Math.abs(signedOffsetKm)
          );

    // Core intensity ramps cleanly to 1.0 at peak passage (T+3.0h) then tapers smoothly
    const distFromPeakNorm = Math.abs(tNorm - 0.5) * 2; // 1 at edges, 0 at T+3h
    const coreIntensityFactor = Number((0.45 + 0.55 * Math.cos((distFromPeakNorm * Math.PI) / 2)).toFixed(3));

    const districtSnapshots: Record<string, SimulationStepDistrictSnapshot> = {};
    let elevatedDistrictCount = 0;

    for (const district of districts) {
      const baseWeather = weatherMap.get(district.id);
      const baseAssessment = baselineMap.get(district.id);
      const incCtx = incCtxMap.get(district.id) ?? {
        activeCount: 0,
        totalCount: 0,
        simulatedCount: 0,
        manualCount: 0,
      };

      const distToStormCenter = haversineDistanceKm(
        district.lat,
        district.lng,
        stormCenterLat,
        stormCenterLng
      );
      const attenuation = computeAttenuation(distToStormCenter, effectiveRadius);
      const isPeakAtTarget =
        district.id === targetDistrict.id && i === 6 && coreIntensityFactor >= 0.999;

      const simW = blendWeatherForCell(
        params,
        attenuation,
        coreIntensityFactor,
        baseWeather,
        isPeakAtTarget
      );

      const breakdown = computeRiskBreakdown({
        district,
        rainfallMm: simW.rainfallMm,
        precipitationProbability: simW.precipitationProbability,
        windSpeedKmh: simW.windSpeedKmh,
        windGustsKmh: simW.windGustsKmh,
        isThunderstorm: simW.isThunderstorm,
        historicalOutageCount: incCtx.activeCount,
        recentHistory: baseWeather?.recentHistory,
        isStale: false,
        weatherAvailable: true,
        forecastAvailable: true,
        weights,
        incidentContext: incCtx,
      });

      const baseScore = baseAssessment?.score ?? breakdown.score;
      const delta = breakdown.score - baseScore;
      if (delta >= 3 || (baseAssessment && breakdown.category !== baseAssessment.category && delta > 0)) {
        elevatedDistrictCount += 1;
      }

      districtSnapshots[district.id] = {
        score: breakdown.score,
        category: breakdown.category,
        delta,
        rainfallMm: simW.rainfallMm,
        windSpeedKmh: simW.windSpeedKmh,
        windGustsKmh: simW.windGustsKmh,
        precipitationProbability: simW.precipitationProbability,
        isThunderstorm: simW.isThunderstorm,
      };
    }

    const targetSnap = districtSnapshots[targetDistrict.id];
    const targetBaseScore = baselineMap.get(targetDistrict.id)?.score ?? targetSnap.score;
    const phaseIdx =
      i <= 1 ? 0 : i <= 3 ? 1 : i <= 5 ? 2 : i === 6 ? 3 : i <= 8 ? 4 : i <= 10 ? 5 : 6;

    steps.push({
      stepIndex: i,
      hourOffset,
      label: `T+${hourOffset.toFixed(1)}h`,
      phaseLabel: TIMELINE_PHASE_LABELS[phaseIdx],
      stormCenterLat,
      stormCenterLng,
      coreIntensityFactor,
      targetBaselineScore: targetBaseScore,
      targetSimulatedScore: targetSnap.score,
      elevatedDistrictCount,
      districtSnapshots,
    });
  }

  return steps;
}

export function buildSimulationCsvReport(input: {
  scenarioName: string;
  params: StormSimulationParams;
  impacts: SimulatedDistrictImpact[];
  generatedAt?: string;
}): string {
  const { scenarioName, params, impacts, generatedAt = new Date().toISOString() } = input;
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const disclaimer = [
    `# HYPOTHETICAL SIMULATED SCENARIO REPORT — NOT LIVE WEATHER OR OFFICIAL FORECAST`,
    `# Scenario Name: ${scenarioName}`,
    `# Target District ID: ${params.targetDistrictId} | Preset: ${params.presetId} | Severity: ${params.stormSeverity}`,
    `# Hypothetical Peak Inputs: Rain ${params.rainfallMm} mm/h | Wind ${params.windSpeedKmh} km/h | Gusts ${params.windGustsKmh} km/h | Precip Prob ${params.precipitationProbability}% | Thunderstorm: ${params.isThunderstorm ? 'Yes' : 'No'}`,
    `# Generated At: ${generatedAt}`,
  ];

  const headers = [
    'District',
    'DISCOM',
    'Distance From Target (km)',
    'Baseline Live Risk Score',
    'Baseline Category',
    'Simulated Scenario Risk Score',
    'Simulated Category',
    'Risk Delta (pts)',
    'Simulated Rain (mm/h)',
    'Simulated Wind (km/h)',
    'Simulated Gusts (km/h)',
    'Total Substations',
    'Estimated Exposed Substations',
    'Primary Preventive Action',
  ];

  const rows = impacts.map((imp) =>
    [
      imp.district.name,
      imp.district.discom,
      imp.distanceToTargetKm,
      imp.baselineAssessment.score,
      imp.baselineAssessment.category,
      imp.simulatedAssessment.score,
      imp.simulatedAssessment.category,
      imp.deltaScore >= 0 ? `+${imp.deltaScore}` : imp.deltaScore,
      imp.simulatedWeather.rainfallMm,
      imp.simulatedWeather.windSpeedKmh,
      imp.simulatedWeather.windGustsKmh,
      imp.vulnerableInfrastructure.substationCount,
      imp.vulnerableInfrastructure.exposedSubstationsEst,
      imp.simulatedAssessment.preventiveActions[0]?.title ?? 'Routine monitoring',
    ]
      .map(esc)
      .join(',')
  );

  return [...disclaimer, headers.join(','), ...rows].join('\n');
}

export function buildSimulationJsonReport(input: {
  scenarioName: string;
  params: StormSimulationParams;
  impacts: SimulatedDistrictImpact[];
  timeline: SimulationTimelineStep[];
  generatedAt?: string;
}): string {
  const { scenarioName, params, impacts, timeline, generatedAt = new Date().toISOString() } = input;
  return JSON.stringify(
    {
      disclaimer:
        'HYPOTHETICAL SIMULATED SCENARIO — Inputs are operator-configured test parameters and derived heuristic risk index outputs. This is not live Open-Meteo telemetry or an official IMD/government weather forecast.',
      scenarioName,
      generatedAt,
      modelType: MODEL_TYPE_LABEL,
      scenarioParams: params,
      districtComparisons: impacts.map((imp) => ({
        districtId: imp.district.id,
        districtName: imp.district.name,
        discom: imp.district.discom,
        baselineScore: imp.baselineAssessment.score,
        baselineCategory: imp.baselineAssessment.category,
        simulatedScore: imp.simulatedAssessment.score,
        simulatedCategory: imp.simulatedAssessment.category,
        deltaScore: imp.deltaScore,
        simulatedWeather: imp.simulatedWeather,
        vulnerableInfrastructure: imp.vulnerableInfrastructure,
        preventiveActions: imp.simulatedAssessment.preventiveActions,
      })),
      timelineSummary: timeline.map((step) => ({
        label: step.label,
        phaseLabel: step.phaseLabel,
        stormCenterLat: step.stormCenterLat,
        stormCenterLng: step.stormCenterLng,
        targetBaselineScore: step.targetBaselineScore,
        targetSimulatedScore: step.targetSimulatedScore,
        elevatedDistrictCount: step.elevatedDistrictCount,
      })),
    },
    null,
    2
  );
}
