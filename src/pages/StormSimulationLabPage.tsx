import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CloudLightning,
  CloudRain,
  Compass,
  Download,
  FileJson,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldAlert,
  Sliders,
  Trash2,
  Wind,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RainfallVisualizer, WindFlowCanvas } from '../components/graphics/AtmosphericTelemetryGraphic';
import { StormSimulationMap } from '../components/simulation/StormSimulationMap';
import {
  LoadingGridSkeleton,
  RiskIndicator,
  formatIstDateTime,
} from '../components/ui/DataProvenanceTag';
import { useStormSense } from '../context/StormSenseContext';
import {
  SEVERITY_ORDER,
  STORM_PRESETS,
  buildSimulationCsvReport,
  buildSimulationJsonReport,
  buildSimulationTimeline,
  computeStormImpactForDistricts,
  createBaselineParams,
  createParamsFromPreset,
} from '../lib/stormSimulation';
import type {
  RiskCategory,
  SavedSimulationScenario,
  StormPresetId,
  StormSeverityLevel,
  StormSimulationParams,
} from '../lib/types';

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const STRESS_TEXT_CLASS: Record<'Low' | 'Elevated' | 'High' | 'Critical', string> = {
  Low: 'text-[#8BE0C4]',
  Elevated: 'text-[#F2C16E]',
  High: 'text-[#F0A478]',
  Critical: 'text-[#F29B9B]',
};

const PRIORITY_BADGE_CLASS: Record<'Immediate' | 'Preparedness' | 'Routine', string> = {
  Immediate: 'text-[#F29B9B] bg-[#E36D6D]/20 border-[#E36D6D]/50',
  Preparedness: 'text-[#F2C16E] bg-[#E5A94C]/18 border-[#E5A94C]/45',
  Routine: 'text-[#8BE0C4] bg-[#55B7B0]/18 border-[#55B7B0]/45',
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#344655',
  borderColor: '#60788A',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#E5EDF3',
};

function CategoryDeltaArrow({
  before,
  after,
}: {
  before: RiskCategory;
  after: RiskCategory;
}) {
  if (before === after) {
    return <span className="text-xs text-[#8FA3B3] font-mono">Unchanged</span>;
  }
  return (
    <span className="text-xs font-mono text-[#F2C16E]">
      {before} &rarr; {after}
    </span>
  );
}

export function StormSimulationLabPage() {
  const {
    districts,
    weather,
    assessments,
    incidents,
    crews,
    riskWeights,
    savedSimulations,
    selectedDistrictId,
    setSelectedDistrictId,
    currentUser,
    saveSimulationScenario,
    deleteSimulationScenario,
    isLoading,
  } = useStormSense();

  const canSaveScenario =
    currentUser?.role === 'Administrator' ||
    currentUser?.role === 'Operations Manager' ||
    currentUser?.role === 'Field Operator';
  const canDeleteScenario =
    currentUser?.role === 'Administrator' || currentUser?.role === 'Operations Manager';

  const [params, setParams] = useState<StormSimulationParams>(() =>
    createParamsFromPreset('severe_thunderstorm', selectedDistrictId || 'hyderabad')
  );

  useEffect(() => {
    if (selectedDistrictId && districts.some((d) => d.id === selectedDistrictId)) {
      setParams((prev) =>
        prev.targetDistrictId === selectedDistrictId
          ? prev
          : { ...prev, targetDistrictId: selectedDistrictId }
      );
    }
  }, [selectedDistrictId, districts]);

  const [activeStepIndex, setActiveStepIndex] = useState<number>(6);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2>(1);
  const [onlyElevatedRows, setOnlyElevatedRows] = useState<boolean>(false);

  const [scenarioName, setScenarioName] = useState<string>('');
  const [savingScenario, setSavingScenario] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const weatherMap = useMemo(
    () => new Map(weather.observations.map((w) => [w.districtId, w])),
    [weather.observations]
  );

  const impacts = useMemo(
    () =>
      computeStormImpactForDistricts({
        params,
        districts,
        baselineAssessments: assessments,
        weatherObservations: weather.observations,
        weights: riskWeights ?? undefined,
        incidents,
        crews,
      }),
    [params, districts, assessments, weather.observations, riskWeights, incidents, crews]
  );

  const timeline = useMemo(
    () =>
      buildSimulationTimeline({
        params,
        districts,
        baselineAssessments: assessments,
        weatherObservations: weather.observations,
        weights: riskWeights ?? undefined,
        incidents,
        crews,
      }),
    [params, districts, assessments, weather.observations, riskWeights, incidents, crews]
  );

  useEffect(() => {
    if (!isPlaying || timeline.length === 0) return;
    const intervalMs = playbackSpeed === 2 ? 450 : 850;
    const timer = window.setInterval(() => {
      setActiveStepIndex((prev) => {
        if (prev >= timeline.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackSpeed, timeline.length]);

  const targetImpact =
    impacts.find((i) => i.district.id === params.targetDistrictId) ?? impacts[0];
  const targetLiveWeather = targetImpact ? weatherMap.get(targetImpact.district.id) : undefined;
  const activeStep = timeline[activeStepIndex] ?? timeline[6] ?? timeline[0];
  const activeStepTargetSnap =
    activeStep && targetImpact ? activeStep.districtSnapshots[targetImpact.district.id] : undefined;

  const elevatedImpacts = useMemo(
    () => impacts.filter((i) => i.deltaScore >= 3),
    [impacts]
  );

  const totalExposedSubstations = useMemo(
    () => impacts.reduce((sum, i) => sum + i.vulnerableInfrastructure.exposedSubstationsEst, 0),
    [impacts]
  );

  const FACTOR_SHORT_LABELS: Record<string, string> = {
    rainfall: 'Rainfall',
    wind: 'Wind',
    gusts: 'Gusts',
    thunderstorm: 'Thunder',
    precipitation_prob: 'Precip %',
    historical_weather: '24h Hist',
    recorded_incidents: 'Incidents',
    grid_vulnerability: 'Grid Vuln',
  };

  const factorComparisonData = useMemo(() => {
    if (!targetImpact) return [];
    const simMap = new Map(
      targetImpact.simulatedAssessment.contributions.map((c) => [c.factor, c])
    );
    return targetImpact.baselineAssessment.contributions.map((baseC) => {
      const simC = simMap.get(baseC.factor);
      return {
        factorLabel: FACTOR_SHORT_LABELS[baseC.factor] ?? baseC.label,
        baselinePts: baseC.points,
        simulatedPts: simC?.points ?? baseC.points,
        maxPts: baseC.maxPoints,
      };
    });
  }, [targetImpact]);

  const timelineChartData = useMemo(
    () =>
      timeline.map((step) => ({
        label: step.label,
        baseline: step.targetBaselineScore,
        simulated: step.targetSimulatedScore,
        elevatedCount: step.elevatedDistrictCount,
      })),
    [timeline]
  );

  const visibleTableRows = useMemo(
    () => (onlyElevatedRows ? elevatedImpacts : impacts),
    [onlyElevatedRows, elevatedImpacts, impacts]
  );

  if (isLoading && districts.length === 0) {
    return <LoadingGridSkeleton />;
  }

  const handleSelectDistrict = (districtId: string) => {
    setSelectedDistrictId(districtId);
    setParams((prev) => ({ ...prev, targetDistrictId: districtId }));
  };

  const handleApplyPreset = (presetId: Exclude<StormPresetId, 'custom'>) => {
    setIsPlaying(false);
    setActiveStepIndex(6);
    setParams(createParamsFromPreset(presetId, params.targetDistrictId));
    setSaveFeedback(null);
    setSaveError(null);
  };

  const handleResetToLiveBaseline = () => {
    setIsPlaying(false);
    setActiveStepIndex(6);
    setParams(createBaselineParams(params.targetDistrictId, targetLiveWeather));
    setSaveFeedback(null);
    setSaveError(null);
  };

  const handlePlayToggle = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (activeStepIndex >= timeline.length - 1) {
      setActiveStepIndex(0);
    }
    setIsPlaying(true);
  };

  const handleResetTimeline = () => {
    setIsPlaying(false);
    setActiveStepIndex(0);
  };

  const updateParam = <K extends keyof StormSimulationParams>(
    key: K,
    value: StormSimulationParams[K]
  ) => {
    setParams((prev) => {
      const next: StormSimulationParams = {
        ...prev,
        presetId: 'custom',
        [key]: value,
      };
      if (key === 'windSpeedKmh' && typeof value === 'number' && next.windGustsKmh < value) {
        next.windGustsKmh = value;
      }
      if (key === 'windGustsKmh' && typeof value === 'number' && value < next.windSpeedKmh) {
        next.windSpeedKmh = value;
      }
      return next;
    });
  };

  const handleSaveScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetImpact) return;
    const defaultName = `${targetImpact.district.name} · ${
      STORM_PRESETS.find((p) => p.id === params.presetId)?.name ?? 'Custom Storm'
    }`;
    const trimmedName = (scenarioName.trim() || defaultName).slice(0, 100);
    if (trimmedName.length < 3) {
      setSaveError('Scenario name must be at least 3 characters.');
      return;
    }

    setSavingScenario(true);
    setSaveFeedback(null);
    setSaveError(null);
    try {
      const saved = await saveSimulationScenario({
        name: trimmedName,
        params,
        summaryNote: `Hypothetical ${params.stormSeverity} scenario (${params.rainfallMm} mm/h rain, ${params.windGustsKmh} km/h gusts) peaking at ${targetImpact.simulatedAssessment.score}/100 (${targetImpact.deltaScore >= 0 ? `+${targetImpact.deltaScore}` : targetImpact.deltaScore} pts).`,
      });
      setScenarioName('');
      setSaveFeedback(`Saved "${saved.name}" to scenario archive.`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save scenario.');
    } finally {
      setSavingScenario(false);
    }
  };

  const handleLoadSavedScenario = (saved: SavedSimulationScenario) => {
    setIsPlaying(false);
    setActiveStepIndex(6);
    setSelectedDistrictId(saved.params.targetDistrictId);
    setParams({ ...saved.params });
    setSaveFeedback(`Loaded saved scenario "${saved.name}".`);
    setSaveError(null);
  };

  const handleExportCsv = () => {
    const label =
      scenarioName.trim() ||
      `${targetImpact?.district.name ?? 'Telangana'}-${params.presetId}-${params.stormSeverity}`;
    const csv = buildSimulationCsvReport({
      scenarioName: label,
      params,
      impacts,
    });
    const safeSlug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    triggerDownload(`stormsense-simulation-${safeSlug}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handleExportJson = () => {
    const label =
      scenarioName.trim() ||
      `${targetImpact?.district.name ?? 'Telangana'}-${params.presetId}-${params.stormSeverity}`;
    const json = buildSimulationJsonReport({
      scenarioName: label,
      params,
      impacts,
      timeline,
    });
    const safeSlug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    triggerDownload(
      `stormsense-simulation-${safeSlug}.json`,
      json,
      'application/json;charset=utf-8'
    );
  };

  return (
    <div className="space-y-5">
      {/* Mandatory Data Provenance & Simulation Isolation Strip */}
      <section
        aria-label="Data Provenance and Simulation Scope"
        className="grid grid-cols-1 lg:grid-cols-3 gap-3"
      >
        <div className="rounded-lg ss-card px-4 py-3">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#55B7B0]">
            LIVE WEATHER DATA (BASELINE)
          </div>
          <div className="text-sm font-medium text-[#E5EDF3] mt-1 flex items-center justify-between gap-2">
            <span>{targetImpact?.district.name ?? 'Selected District'}</span>
            <span className="font-mono tabular-nums text-xs text-[#AABBC9]">
              {targetLiveWeather
                ? `${targetLiveWeather.rainMm.toFixed(1)} mm · ${targetLiveWeather.windGustsKmh.toFixed(0)} km/h gust`
                : 'Unavailable'}
            </span>
          </div>
          <div className="text-[11px] text-[#8FA3B3] mt-1 font-mono tabular-nums">
            {targetLiveWeather?.fetchedAt
              ? `Open-Meteo Sync: ${formatIstDateTime(targetLiveWeather.fetchedAt)}`
              : 'Live cache timestamp unavailable'}
          </div>
        </div>

        <div className="rounded-lg bg-[#E5A94C]/16 border border-[#E5A94C]/45 px-4 py-3 shadow-md">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#F2C16E]">
            SIMULATED SCENARIO (HYPOTHETICAL)
          </div>
          <div className="text-sm font-medium text-[#E5EDF3] mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            <span className="truncate">
              {STORM_PRESETS.find((p) => p.id === params.presetId)?.name ?? 'Custom Stress Test'}
            </span>
            <span className="font-mono tabular-nums text-xs text-[#F2C16E] whitespace-nowrap shrink-0">
              {params.rainfallMm.toFixed(1)} mm/h · {params.windGustsKmh.toFixed(0)} km/h gust
            </span>
          </div>
          <div className="text-[11px] text-[#E5C994] mt-1">
            Operator-configured stress test only — never an official forecast or live alert trigger.
          </div>
        </div>

        <div className="rounded-lg ss-card px-4 py-3">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#70A9CF]">
            DERIVED RISK PREDICTION
          </div>
          <div className="text-sm font-medium text-[#E5EDF3] mt-1 flex items-center justify-between gap-2">
            <span>Weighted Heuristic Engine</span>
            {targetImpact && (
              <span className="font-mono tabular-nums text-xs text-[#70A9CF] font-semibold">
                {targetImpact.baselineAssessment.score} &rarr;{' '}
                {targetImpact.simulatedAssessment.score} (
                {targetImpact.deltaScore >= 0
                  ? `+${targetImpact.deltaScore}`
                  : targetImpact.deltaScore}{' '}
                pts)
              </span>
            )}
          </div>
          <div className="text-[11px] text-[#8FA3B3] mt-1">
            Isolated sandbox: real incidents, active crews &amp; alert records remain untouched.
          </div>
        </div>
      </section>

      {/* Predefined Scenario Quick-Selectors + District Selector */}
      <section className="rounded-lg ss-card p-4 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-[#E5EDF3] flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
              <span>Scenario Target &amp; Predefined Storm Profiles</span>
            </h2>
            <p className="text-xs text-[#8FA3B3]">
              Select a target Telangana district and load a weather stress profile or dial custom
              storm cell parameters below.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="sim-district-select" className="text-xs text-[#AABBC9] font-medium">
              Target District:
            </label>
            <select
              id="sim-district-select"
              value={params.targetDistrictId}
              onChange={(e) => handleSelectDistrict(e.target.value)}
              className="px-3 py-1.5 rounded-md bg-[#344655] border border-[#60788A] text-sm text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
            >
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.discom})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleResetToLiveBaseline}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-[#E5EDF3] bg-[#3B5061] hover:bg-[#4F687B] border border-[#60788A] transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#8FA3B3]" aria-hidden="true" />
              <span>Reset to Live Baseline</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {STORM_PRESETS.map((preset) => {
            const isSelected = params.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset.id)}
                className={`text-left rounded-lg p-3 border transition-all ${
                  isSelected
                    ? 'bg-[#3B5061] border-[#70A9CF] ring-1 ring-[#70A9CF]/35 shadow-md'
                    : 'bg-[#344655]/85 border-[#60788A]/80 hover:border-[#70A9CF]/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#E5EDF3]">{preset.name}</span>
                  <span
                    className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                      preset.stormSeverity === 'Extreme'
                        ? 'text-[#F29B9B] border-[#E36D6D]/50 bg-[#E36D6D]/20'
                        : preset.stormSeverity === 'Severe'
                          ? 'text-[#F0A478] border-[#E58854]/45 bg-[#E58854]/18'
                          : 'text-[#F2C16E] border-[#E5A94C]/45 bg-[#E5A94C]/18'
                    }`}
                  >
                    {preset.stormSeverity}
                  </span>
                </div>
                <p className="text-xs text-[#8FA3B3] mt-1 line-clamp-2">{preset.shortDesc}</p>
                <div className="mt-2 pt-2 border-t border-[#52697A] flex items-center justify-between text-[11px] font-mono tabular-nums text-[#AABBC9]">
                  <span>Rain {preset.rainfallMm}mm/h</span>
                  <span>Gust {preset.windGustsKmh}km/h</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Split Workspace: Parameter Controls (Left) + Interactive Simulation Map & Timeline (Right) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left Column: Fine-grained Scenario Parameter Controls + Atmospheric Stress Visualizers */}
        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-lg ss-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#E5EDF3]">Storm Cell Parameters</h3>
              <span className="text-[11px] font-mono text-[#F2C16E] uppercase font-medium">
                {params.presetId === 'custom' ? 'Custom Profile' : 'Preset Active'}
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label htmlFor="sim-rain-slider" className="text-[#AABBC9] flex items-center gap-1.5">
                  <CloudRain className="w-3.5 h-3.5 text-[#70A9CF]" aria-hidden="true" />
                  <span>Rainfall Intensity</span>
                </label>
                <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                  {params.rainfallMm.toFixed(1)} mm/h
                </span>
              </div>
              <input
                id="sim-rain-slider"
                type="range"
                min={0}
                max={80}
                step={1}
                value={params.rainfallMm}
                onChange={(e) => updateParam('rainfallMm', Number(e.target.value))}
                className="w-full accent-[#70A9CF] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label htmlFor="sim-wind-slider" className="text-[#AABBC9] flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
                  <span>Sustained Wind Speed</span>
                </label>
                <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                  {params.windSpeedKmh.toFixed(0)} km/h
                </span>
              </div>
              <input
                id="sim-wind-slider"
                type="range"
                min={0}
                max={110}
                step={1}
                value={params.windSpeedKmh}
                onChange={(e) => updateParam('windSpeedKmh', Number(e.target.value))}
                className="w-full accent-[#55B7B0] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label htmlFor="sim-gust-slider" className="text-[#AABBC9] flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-[#E5A94C]" aria-hidden="true" />
                  <span>Peak Wind Gusts</span>
                </label>
                <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                  {params.windGustsKmh.toFixed(0)} km/h
                </span>
              </div>
              <input
                id="sim-gust-slider"
                type="range"
                min={0}
                max={140}
                step={1}
                value={params.windGustsKmh}
                onChange={(e) => updateParam('windGustsKmh', Number(e.target.value))}
                className="w-full accent-[#E5A94C] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label htmlFor="sim-prob-slider" className="text-[#AABBC9]">
                  Precipitation Probability
                </label>
                <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                  {params.precipitationProbability}%
                </span>
              </div>
              <input
                id="sim-prob-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={params.precipitationProbability}
                onChange={(e) => updateParam('precipitationProbability', Number(e.target.value))}
                className="w-full accent-[#70A9CF] cursor-pointer"
              />
            </div>

            <div>
              <div className="text-xs text-[#AABBC9] mb-1.5">Storm Severity Classification</div>
              <div className="grid grid-cols-4 gap-1.5">
                {SEVERITY_ORDER.map((sev: StormSeverityLevel) => {
                  const active = params.stormSeverity === sev;
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => updateParam('stormSeverity', sev)}
                      className={`px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                        active
                          ? 'bg-[#70A9CF] border-[#70A9CF] text-[#17222B] font-semibold'
                          : 'bg-[#344655] border-[#60788A] text-[#AABBC9] hover:text-[#E5EDF3] hover:border-[#70A9CF]'
                      }`}
                    >
                      {sev}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="sim-radius-slider" className="text-[#8FA3B3]">
                    Impact Radius
                  </label>
                  <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                    {params.impactRadiusKm} km
                  </span>
                </div>
                <input
                  id="sim-radius-slider"
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={params.impactRadiusKm}
                  onChange={(e) => updateParam('impactRadiusKm', Number(e.target.value))}
                  className="w-full accent-[#55B7B0] cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="sim-bearing-slider" className="text-[#8FA3B3] flex items-center gap-1">
                    <Compass className="w-3 h-3 text-[#8FA3B3]" aria-hidden="true" />
                    <span>Track Bearing</span>
                  </label>
                  <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                    {params.stormTrackBearingDeg}°
                  </span>
                </div>
                <input
                  id="sim-bearing-slider"
                  type="range"
                  min={0}
                  max={355}
                  step={5}
                  value={params.stormTrackBearingDeg}
                  onChange={(e) => updateParam('stormTrackBearingDeg', Number(e.target.value))}
                  className="w-full accent-[#55B7B0] cursor-pointer"
                />
              </div>
            </div>

            <label className="flex items-center justify-between px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] cursor-pointer">
              <span className="flex items-center gap-2 text-xs text-[#E5EDF3] font-medium">
                <CloudLightning className="w-4 h-4 text-[#E5A94C]" aria-hidden="true" />
                <span>Convective Lightning / Thunderstorm Flag</span>
              </span>
              <input
                type="checkbox"
                checked={params.isThunderstorm}
                onChange={(e) => updateParam('isThunderstorm', e.target.checked)}
                className="w-4 h-4 accent-[#70A9CF]"
              />
            </label>
          </div>

          <div className="rounded-lg ss-card p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#E5EDF3]">Simulated Stress Telemetry</span>
              <span className="font-mono text-[11px] text-[#F2C16E] font-medium">
                {activeStep?.label ?? 'T+3.0h'}
              </span>
            </div>
            <WindFlowCanvas
              windSpeedKmh={activeStepTargetSnap?.windSpeedKmh ?? params.windSpeedKmh}
              windGustsKmh={activeStepTargetSnap?.windGustsKmh ?? params.windGustsKmh}
              height={84}
            />
            <RainfallVisualizer
              rainMm={activeStepTargetSnap?.rainfallMm ?? params.rainfallMm}
              precipProb={
                activeStepTargetSnap?.precipitationProbability ?? params.precipitationProbability
              }
            />
          </div>
        </div>

        {/* Right Column: Interactive Storm Simulation Map + Play/Pause/Reset Timeline Bar */}
        <div className="xl:col-span-8 space-y-4">
          <StormSimulationMap
            districts={districts}
            baselineAssessments={assessments}
            timeline={timeline}
            activeStepIndex={activeStepIndex}
            params={params}
            onSelectDistrict={handleSelectDistrict}
          />

          <div className="rounded-lg ss-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePlayToggle}
                  className="px-3.5 py-2 rounded-md text-xs font-semibold bg-[#70A9CF] hover:bg-[#5E97BD] text-[#17222B] transition-colors flex items-center gap-1.5"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Play Simulation</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleResetTimeline}
                  className="px-3 py-2 rounded-md text-xs font-medium bg-[#3B5061] hover:bg-[#4F687B] text-[#E5EDF3] border border-[#60788A] transition-colors flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#AABBC9]" aria-hidden="true" />
                  <span>Reset Timeline</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setActiveStepIndex(6);
                  }}
                  className="px-3 py-2 rounded-md text-xs font-medium bg-[#344655] hover:bg-[#3B5061] text-[#70A9CF] border border-[#70A9CF]/50 transition-colors"
                >
                  Peak (T+3.0h)
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <span className="font-mono tabular-nums text-[#E5EDF3]">
                  Step: <strong className="text-[#55B7B0]">{activeStep?.label ?? 'T+3.0h'}</strong>{' '}
                  <span className="text-[#8FA3B3]">· {activeStep?.phaseLabel}</span>
                </span>
                <div className="flex items-center rounded border border-[#60788A] overflow-hidden bg-[#344655]">
                  {([1, 2] as const).map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-2 py-1 text-[11px] font-mono ${
                        playbackSpeed === spd
                          ? 'bg-[#70A9CF] text-[#17222B] font-semibold'
                          : 'bg-[#344655] text-[#AABBC9] hover:text-[#E5EDF3]'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <input
                type="range"
                aria-label="Simulation timeline step"
                min={0}
                max={Math.max(0, timeline.length - 1)}
                step={1}
                value={activeStepIndex}
                onChange={(e) => {
                  setIsPlaying(false);
                  setActiveStepIndex(Number(e.target.value));
                }}
                className="w-full accent-[#70A9CF] cursor-pointer"
              />
              <div className="flex justify-between text-[11px] font-mono tabular-nums text-[#8FA3B3] mt-1">
                <span>T+0.0h (Approach)</span>
                <span>T+1.5h</span>
                <span className="text-[#55B7B0] font-medium">T+3.0h (Peak Landfall)</span>
                <span>T+4.5h</span>
                <span>T+6.0h (Clearing)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Before-and-After KPI Comparison Strip */}
      {targetImpact && (
        <section
          aria-label="Before and After Risk Impact Summary"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
        >
          <div className="rounded-lg ss-card p-4">
            <div className="text-xs text-[#AABBC9] flex items-center justify-between">
              <span>{targetImpact.district.name} Risk Shift</span>
              <Activity className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
            </div>
            <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-xl text-[#8FA3B3]">{targetImpact.baselineAssessment.score}</span>
              <span className="text-[#8FA3B3]">&rarr;</span>
              <span className="text-2xl font-bold text-[#E5EDF3]">
                {targetImpact.simulatedAssessment.score}
              </span>
              <span
                className={`text-sm font-semibold ${
                  targetImpact.deltaScore > 0
                    ? 'text-[#F29B9B]'
                    : targetImpact.deltaScore < 0
                      ? 'text-[#8BE0C4]'
                      : 'text-[#8FA3B3]'
                }`}
              >
                ({targetImpact.deltaScore >= 0 ? `+${targetImpact.deltaScore}` : targetImpact.deltaScore})
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <RiskIndicator category={targetImpact.simulatedAssessment.category} />
              <CategoryDeltaArrow
                before={targetImpact.baselineAssessment.category}
                after={targetImpact.simulatedAssessment.category}
              />
            </div>
          </div>

          <div className="rounded-lg ss-card p-4">
            <div className="text-xs text-[#AABBC9] flex items-center justify-between">
              <span>Districts With Elevated Risk</span>
              <AlertTriangle className="w-4 h-4 text-[#E5A94C]" aria-hidden="true" />
            </div>
            <div className="mt-2 font-mono tabular-nums text-2xl font-bold text-[#E5EDF3]">
              {elevatedImpacts.length}
              <span className="text-sm font-normal text-[#8FA3B3]"> / {districts.length}</span>
            </div>
            <div className="mt-2 text-xs text-[#8FA3B3]">
              {elevatedImpacts.filter((i) => i.simulatedAssessment.category === 'CRITICAL').length}{' '}
              Critical ·{' '}
              {elevatedImpacts.filter((i) => i.simulatedAssessment.category === 'HIGH').length} High
              under peak footprint
            </div>
          </div>

          <div className="rounded-lg ss-card p-4">
            <div className="text-xs text-[#AABBC9] flex items-center justify-between">
              <span>Exposed Grid Substations (Est.)</span>
              <ShieldAlert className="w-4 h-4 text-[#E58854]" aria-hidden="true" />
            </div>
            <div className="mt-2 font-mono tabular-nums text-2xl font-bold text-[#E5EDF3]">
              {totalExposedSubstations}
              <span className="text-sm font-normal text-[#8FA3B3]">
                {' '}
                / {districts.reduce((acc, d) => acc + d.substationCount, 0)}
              </span>
            </div>
            <div className="mt-2 text-xs text-[#8FA3B3]">
              {targetImpact.district.name}: {targetImpact.vulnerableInfrastructure.exposedSubstationsEst}{' '}
              of {targetImpact.vulnerableInfrastructure.substationCount} substations exposed
            </div>
          </div>

          <div className="rounded-lg ss-card p-4">
            <div className="text-xs text-[#AABBC9] flex items-center justify-between">
              <span>Active Step Projection ({activeStep?.label ?? 'T+3.0h'})</span>
              <Zap className="w-4 h-4 text-[#70A9CF]" aria-hidden="true" />
            </div>
            <div className="mt-2 font-mono tabular-nums text-2xl font-bold text-[#55B7B0]">
              {activeStepTargetSnap?.score ?? targetImpact.simulatedAssessment.score}
              <span className="text-sm font-normal text-[#8FA3B3]"> / 100</span>
            </div>
            <div className="mt-2 text-xs text-[#8FA3B3] font-mono tabular-nums">
              Step Rain {(activeStepTargetSnap?.rainfallMm ?? params.rainfallMm).toFixed(1)} mm/h ·
              Gust {(activeStepTargetSnap?.windGustsKmh ?? params.windGustsKmh).toFixed(0)} km/h
            </div>
          </div>
        </section>
      )}

      {/* Before-and-After Analytical Comparison Charts */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-6 rounded-lg ss-card p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#E5EDF3]">
                6-Hour Risk Trajectory: Baseline vs Simulated
              </h3>
              <p className="text-xs text-[#8FA3B3]">
                Target district ({targetImpact?.district.name}) risk evolution across storm passage
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#F2C16E] whitespace-nowrap shrink-0">
              Derived Scenario Curve
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineChartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="simRiskFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E58854" stopOpacity={0.34} />
                    <stop offset="95%" stopColor="#E58854" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="label" tick={{ fill: '#AABBC9', fontSize: 11 }} stroke="#60788A" />
                <YAxis domain={[0, 100]} tick={{ fill: '#AABBC9', fontSize: 11 }} stroke="#60788A" />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#AABBC9' }} />
                <ReferenceLine
                  x={activeStep?.label}
                  stroke="#70A9CF"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="simulated"
                  name="Simulated Scenario Risk"
                  stroke="#E58854"
                  strokeWidth={2.2}
                  fill="url(#simRiskFill)"
                />
                <Area
                  type="monotone"
                  dataKey="baseline"
                  name="Current Live Baseline"
                  stroke="#55B7B0"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="xl:col-span-6 rounded-lg ss-card p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#E5EDF3]">
                Risk Factor Attribution: Baseline vs Simulated
              </h3>
              <p className="text-xs text-[#8FA3B3]">
                Points contributed by each weighted risk engine component (0–100 total scale)
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#55B7B0] whitespace-nowrap shrink-0">
              Same Engine Weights
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={factorComparisonData}
                margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis
                  dataKey="factorLabel"
                  tick={{ fill: '#AABBC9', fontSize: 11 }}
                  stroke="#60788A"
                  interval={0}
                  height={28}
                />
                <YAxis tick={{ fill: '#AABBC9', fontSize: 11 }} stroke="#60788A" />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#AABBC9' }} />
                <Bar dataKey="baselinePts" name="Baseline Live (pts)" fill="#55B7B0" radius={[3, 3, 0, 0]} />
                <Bar dataKey="simulatedPts" name="Simulated Peak (pts)" fill="#E58854" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Vulnerable Infrastructure + Preventive Recommendations */}
      {targetImpact && (
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-5 rounded-lg ss-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#E5EDF3]">
                Vulnerable Grid Infrastructure ({targetImpact.district.name})
              </h3>
              <span
                className={`text-xs font-mono font-semibold ${
                  STRESS_TEXT_CLASS[targetImpact.vulnerableInfrastructure.infrastructureStressLevel]
                }`}
              >
                {targetImpact.vulnerableInfrastructure.infrastructureStressLevel} Stress
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-md bg-[#344655] border border-[#60788A] p-3">
                <div className="text-[#8FA3B3]">DISCOM / Circle</div>
                <div className="text-sm font-semibold text-[#E5EDF3] mt-0.5">
                  {targetImpact.district.discom} · {targetImpact.district.circle}
                </div>
              </div>
              <div className="rounded-md bg-[#344655] border border-[#60788A] p-3">
                <div className="text-[#8FA3B3]">Substations at Risk (Est.)</div>
                <div className="text-sm font-mono tabular-nums font-semibold text-[#F2C16E] mt-0.5">
                  {targetImpact.vulnerableInfrastructure.exposedSubstationsEst} /{' '}
                  {targetImpact.vulnerableInfrastructure.substationCount}
                </div>
              </div>
              <div className="rounded-md bg-[#344655] border border-[#60788A] p-3">
                <div className="text-[#8FA3B3]">Baseline Vulnerability Index</div>
                <div className="text-sm font-mono tabular-nums font-semibold text-[#E5EDF3] mt-0.5">
                  {(targetImpact.vulnerableInfrastructure.vulnerabilityIndex * 100).toFixed(0)} / 100
                </div>
              </div>
              <div className="rounded-md bg-[#344655] border border-[#60788A] p-3">
                <div className="text-[#8FA3B3]">Active Incidents / Crews</div>
                <div className="text-sm font-mono tabular-nums font-semibold text-[#E5EDF3] mt-0.5">
                  {targetImpact.vulnerableInfrastructure.activeIncidentsCount} active ·{' '}
                  {targetImpact.vulnerableInfrastructure.stationedCrewsCount} crews
                </div>
              </div>
            </div>

            <div className="rounded-md bg-[#344655] border border-[#60788A] p-3 text-xs text-[#AABBC9] leading-relaxed">
              <div className="text-[11px] font-mono uppercase text-[#55B7B0] mb-1 font-medium">
                Feeder &amp; Substation Exposure Notes
              </div>
              {targetImpact.vulnerableInfrastructure.vulnerabilityNotes}
            </div>
          </div>

          <div className="xl:col-span-7 rounded-lg ss-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[#E5EDF3]">
                  Scenario-Driven Preventive Recommendations
                </h3>
                <p className="text-xs text-[#8FA3B3]">
                  Generated from simulated meteorological drivers and {targetImpact.district.name}{' '}
                  grid exposure
                </p>
              </div>
              <span className="text-[11px] font-mono text-[#F2C16E]">Advisory Playbook</span>
            </div>

            <div className="space-y-2.5">
              {targetImpact.simulatedAssessment.preventiveActions.map((rec, idx) => (
                <div
                  key={`${rec.factor}-${idx}`}
                  className="rounded-md bg-[#344655] border border-[#60788A] p-3 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#E5EDF3]">{rec.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono tabular-nums text-[#8FA3B3]">
                        {rec.driverValue}
                      </span>
                      <span
                        className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${PRIORITY_BADGE_CLASS[rec.priority]}`}
                      >
                        {rec.priority}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-[#AABBC9] leading-relaxed">{rec.action}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* District-by-District Spatial Propagation Comparison Table */}
      <section className="rounded-lg ss-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#E5EDF3]">
              District-Level Impact Comparison (Baseline vs Simulated Peak)
            </h3>
            <p className="text-xs text-[#8FA3B3]">
              Click any district row to recenter the hypothetical storm track and inspect local
              infrastructure exposure.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-[#AABBC9] cursor-pointer">
            <input
              type="checkbox"
              checked={onlyElevatedRows}
              onChange={(e) => setOnlyElevatedRows(e.target.checked)}
              className="w-4 h-4 accent-[#70A9CF]"
            />
            <span>Highlight Elevated Risk Only (+3 pts or higher)</span>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#60788A] text-[11px] font-mono uppercase text-[#8FA3B3] bg-[#344655]">
                <th className="py-2.5 px-3">District</th>
                <th className="py-2.5 px-3">Distance</th>
                <th className="py-2.5 px-3">Baseline</th>
                <th className="py-2.5 px-3">Simulated</th>
                <th className="py-2.5 px-3">Delta</th>
                <th className="py-2.5 px-3">Sim Rain / Gusts</th>
                <th className="py-2.5 px-3">Exposed Substations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#52697A]/70">
              {visibleTableRows.map((row) => {
                const isTarget = row.district.id === params.targetDistrictId;
                const isElevated = row.deltaScore >= 3;
                return (
                  <tr
                    key={row.district.id}
                    onClick={() => handleSelectDistrict(row.district.id)}
                    className={`cursor-pointer transition-colors ${
                      isTarget
                        ? 'bg-[#70A9CF]/18'
                        : isElevated
                          ? 'bg-[#E5A94C]/10 hover:bg-[#3B5061]/70'
                          : 'hover:bg-[#3B5061]/70'
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-[#E5EDF3] flex items-center gap-1.5">
                        <span>{row.district.name}</span>
                        {isTarget && (
                          <span className="text-[10px] font-mono text-[#55B7B0] uppercase font-semibold">
                            Target
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#8FA3B3]">{row.district.discom}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#AABBC9]">
                      {isTarget ? '0 km' : `${row.distanceToTargetKm} km`}
                    </td>
                    <td className="py-2.5 px-3">
                      <RiskIndicator
                        category={row.baselineAssessment.category}
                        score={row.baselineAssessment.score}
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <RiskIndicator
                        category={row.simulatedAssessment.category}
                        score={row.simulatedAssessment.score}
                      />
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums font-semibold">
                      <span
                        className={
                          row.deltaScore >= 15
                            ? 'text-[#F29B9B]'
                            : row.deltaScore >= 3
                              ? 'text-[#F2C16E]'
                              : 'text-[#8FA3B3]'
                        }
                      >
                        {row.deltaScore >= 0 ? `+${row.deltaScore}` : row.deltaScore} pts
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#AABBC9]">
                      {row.simulatedWeather.rainfallMm.toFixed(1)} mm/h ·{' '}
                      {row.simulatedWeather.windGustsKmh.toFixed(0)} km/h
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#E5EDF3]">
                      {row.vulnerableInfrastructure.exposedSubstationsEst} /{' '}
                      {row.vulnerableInfrastructure.substationCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Save Scenario Archive & Export Reports */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-5 rounded-lg ss-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[#E5EDF3] flex items-center gap-2">
            <Save className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
            <span>Save &amp; Export Scenario Results</span>
          </h3>
          <p className="text-xs text-[#8FA3B3]">
            Store scenarios in the StormSense scenario archive or export before-and-after impact
            reports clearly labeled as hypothetical simulations.
          </p>

          <form onSubmit={handleSaveScenario} className="space-y-3">
            <div>
              <label htmlFor="sim-name-input" className="block text-xs text-[#AABBC9] mb-1">
                Scenario Title
              </label>
              <input
                id="sim-name-input"
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder={
                  targetImpact
                    ? `${targetImpact.district.name} Monsoon Contingency`
                    : 'e.g., Khammam Peak Squall Drill'
                }
                maxLength={100}
                className="w-full px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-sm text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={savingScenario || !canSaveScenario}
                className="px-3.5 py-2 rounded-md text-xs font-semibold bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-50 text-[#17222B] transition-colors flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{savingScenario ? 'Saving...' : 'Save Scenario'}</span>
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-2 rounded-md text-xs font-medium bg-[#3B5061] hover:bg-[#4F687B] text-[#E5EDF3] border border-[#60788A] transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                onClick={handleExportJson}
                className="px-3 py-2 rounded-md text-xs font-medium bg-[#3B5061] hover:bg-[#4F687B] text-[#E5EDF3] border border-[#60788A] transition-colors flex items-center gap-1.5"
              >
                <FileJson className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
                <span>Export JSON</span>
              </button>
            </div>

            {!canSaveScenario && (
              <div className="text-[11px] text-[#F2C16E]">
                Read-only Evaluator role can run and export simulations; saving to archive requires
                Operator, Manager, or Administrator role.
              </div>
            )}
            {saveFeedback && (
              <div role="status" className="text-xs text-[#8BE0C4]">
                {saveFeedback}
              </div>
            )}
            {saveError && (
              <div role="alert" className="text-xs text-[#F29B9B]">
                {saveError}
              </div>
            )}
          </form>
        </div>

        <div className="xl:col-span-7 rounded-lg ss-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#E5EDF3] flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
              <span>Saved Simulation Archive</span>
            </h3>
            <span className="text-xs font-mono tabular-nums text-[#8FA3B3]">
              {savedSimulations.length} saved
            </span>
          </div>

          {savedSimulations.length === 0 ? (
            <div className="rounded-md bg-[#344655] border border-dashed border-[#60788A] p-6 text-center text-xs text-[#8FA3B3]">
              No saved scenarios yet. Configure a storm profile and click &ldquo;Save Scenario&rdquo;
              to preserve contingency drills for team review.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {savedSimulations.map((saved) => (
                <div
                  key={saved.id}
                  className="rounded-md bg-[#344655] border border-[#60788A] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#E5EDF3] truncate">{saved.name}</span>
                      <RiskIndicator category={saved.peakCategory} score={saved.simulatedScore} />
                      <span className="text-[11px] font-mono tabular-nums text-[#F2C16E]">
                        {saved.deltaScore >= 0 ? `+${saved.deltaScore}` : saved.deltaScore} pts
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8FA3B3] font-mono tabular-nums">
                      {saved.targetDistrictName} · {saved.elevatedDistrictCount} districts elevated ·{' '}
                      {formatIstDateTime(saved.createdAt)} · by {saved.createdBy}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleLoadSavedScenario(saved)}
                      className="px-2.5 py-1.5 rounded text-xs font-medium bg-[#3B5061] hover:bg-[#4F687B] text-[#70A9CF] border border-[#60788A] transition-colors"
                    >
                      Load
                    </button>
                    {canDeleteScenario && (
                      <button
                        type="button"
                        onClick={() => deleteSimulationScenario(saved.id)}
                        aria-label={`Delete scenario ${saved.name}`}
                        className="p-1.5 rounded text-[#8FA3B3] hover:text-[#F29B9B] hover:bg-[#E36D6D]/20 border border-[#60788A] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
