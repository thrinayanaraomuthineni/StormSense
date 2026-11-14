import React, { useEffect, useMemo, useState } from 'react';
import { Camera, Lock, RotateCcw, Save, Sliders, SlidersHorizontal } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RainfallVisualizer, WindFlowCanvas } from '../components/graphics/AtmosphericTelemetryGraphic';
import { RiskGaugeArc } from '../components/graphics/RiskGaugeArc';
import {
  LoadingGridSkeleton,
  ProvenanceText,
  RiskIndicator,
  formatIstDateTime,
} from '../components/ui/DataProvenanceTag';
import { useStormSense } from '../context/StormSenseContext';
import {
  DEFAULT_RISK_WEIGHTS,
  computeRiskBreakdown,
  normalizeRiskWeights,
} from '../lib/riskEngine';
import { DISTRICT_MAP } from '../lib/telanganaDistricts';
import type { RiskScoringWeights } from '../lib/types';

const CATEGORY_COLORS: Record<string, string> = {
  LOW: '#5AC49E',
  MODERATE: '#E5A94C',
  HIGH: '#E58854',
  CRITICAL: '#E36D6D',
};

const DATA_STATUS_TEXT_COLOR: Record<string, string> = {
  Live: 'text-[#55B7B0] font-medium',
  Stale: 'text-[#F2C16E] font-medium',
  Simulated: 'text-[#F2C16E] font-medium',
  Static: 'text-[#8FA3B3]',
  Unavailable: 'text-[#F29B9B] font-medium',
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#344655',
  border: '1px solid #60788A',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#E5EDF3',
};

type WeightFieldKey = keyof Omit<RiskScoringWeights, 'updatedAt'>;

const WEIGHT_FIELDS: Array<{ key: WeightFieldKey; label: string }> = [
  { key: 'rainfall', label: 'Rainfall Intensity' },
  { key: 'wind', label: 'Sustained Wind' },
  { key: 'gusts', label: 'Peak Wind Gusts' },
  { key: 'thunderstorm', label: 'Thunderstorm / WMO' },
  { key: 'precipitationProb', label: 'Precip. Probability' },
  { key: 'historicalWeather', label: 'Past 24h Weather' },
  { key: 'recordedIncidents', label: 'District Incidents' },
  { key: 'gridVulnerability', label: 'Grid Exposure' },
];

export function RiskPredictionPage() {
  const {
    assessments,
    weather,
    incidents,
    riskWeights,
    riskSnapshots,
    currentUser,
    selectedDistrictId,
    setSelectedDistrictId,
    updateRiskWeights,
    resetRiskWeights,
    captureRiskSnapshot,
    isLoading,
  } = useStormSense();

  const canConfigureWeights =
    currentUser?.role === 'Administrator' || currentUser?.role === 'Operations Manager';
  const canCaptureSnapshot =
    currentUser?.role === 'Administrator' ||
    currentUser?.role === 'Operations Manager' ||
    currentUser?.role === 'Field Operator';

  const [simEnabled, setSimEnabled] = useState(false);
  const [simRain, setSimRain] = useState(14);
  const [simWind, setSimWind] = useState(34);
  const [simGusts, setSimGusts] = useState(56);
  const [simThunder, setSimThunder] = useState(true);

  const [weightsOpen, setWeightsOpen] = useState(false);
  const [draftWeights, setDraftWeights] = useState<Omit<RiskScoringWeights, 'updatedAt'>>(
    DEFAULT_RISK_WEIGHTS
  );
  const [savingWeights, setSavingWeights] = useState(false);
  const [weightsFeedback, setWeightsFeedback] = useState<string | null>(null);
  const [weightsError, setWeightsError] = useState<string | null>(null);
  const [capturingSnapshot, setCapturingSnapshot] = useState(false);

  const [compareDistrictId, setCompareDistrictId] = useState<string>('');

  useEffect(() => {
    if (riskWeights) {
      setDraftWeights({
        rainfall: riskWeights.rainfall,
        wind: riskWeights.wind,
        gusts: riskWeights.gusts,
        thunderstorm: riskWeights.thunderstorm,
        precipitationProb: riskWeights.precipitationProb,
        historicalWeather: riskWeights.historicalWeather,
        recordedIncidents: riskWeights.recordedIncidents,
        gridVulnerability: riskWeights.gridVulnerability,
      });
    }
  }, [riskWeights]);

  const selectedRisk =
    assessments.find((a) => a.districtId === selectedDistrictId) || assessments[0];
  const selectedDistrict = selectedRisk ? DISTRICT_MAP.get(selectedRisk.districtId) : undefined;
  const weatherMap = useMemo(
    () => new Map(weather.observations.map((w) => [w.districtId, w])),
    [weather.observations]
  );
  const selectedWeather = selectedRisk ? weatherMap.get(selectedRisk.districtId) : undefined;

  const effectiveCompareId = useMemo(() => {
    if (compareDistrictId && compareDistrictId !== selectedRisk?.districtId) {
      return compareDistrictId;
    }
    const sorted = [...assessments].sort((a, b) => b.score - a.score);
    const other = sorted.find((a) => a.districtId !== selectedRisk?.districtId);
    return other?.districtId ?? selectedRisk?.districtId ?? '';
  }, [compareDistrictId, assessments, selectedRisk?.districtId]);

  const compareRisk = assessments.find((a) => a.districtId === effectiveCompareId);
  const compareWeather = compareRisk ? weatherMap.get(compareRisk.districtId) : undefined;

  const normalizedPreview = useMemo(() => normalizeRiskWeights(draftWeights), [draftWeights]);
  const draftRawSum = WEIGHT_FIELDS.reduce((acc, f) => acc + (Number(draftWeights[f.key]) || 0), 0);

  const simulatedBreakdown = useMemo(() => {
    if (!selectedDistrict || !simEnabled) return null;
    const districtIncidents = incidents.filter(
      (i) =>
        i.districtId === selectedDistrict.id &&
        i.status !== 'Restored' &&
        i.status !== 'Closed'
    );
    const simulatedCount = districtIncidents.filter(
      (i) => i.source === 'Simulated Demonstration Data'
    ).length;
    const manualCount = districtIncidents.length - simulatedCount;

    return computeRiskBreakdown({
      district: selectedDistrict,
      rainfallMm: simRain,
      precipitationProbability: simRain > 0 ? 85 : 20,
      windSpeedKmh: simWind,
      windGustsKmh: simGusts,
      isThunderstorm: simThunder,
      historicalOutageCount: districtIncidents.length,
      recentHistory: selectedWeather?.recentHistory,
      isStale: false,
      weatherAvailable: true,
      forecastAvailable: true,
      weights: riskWeights ?? DEFAULT_RISK_WEIGHTS,
      incidentContext: {
        activeCount: districtIncidents.length,
        totalCount: districtIncidents.length,
        simulatedCount,
        manualCount,
      },
    });
  }, [
    selectedDistrict,
    simEnabled,
    simRain,
    simWind,
    simGusts,
    simThunder,
    incidents,
    selectedWeather?.recentHistory,
    riskWeights,
  ]);

  const sortedAssessments = useMemo(
    () => [...assessments].sort((a, b) => b.score - a.score),
    [assessments]
  );

  const stateAverageScore = useMemo(() => {
    if (assessments.length === 0) return 0;
    return Math.round(assessments.reduce((s, a) => s + a.score, 0) / assessments.length);
  }, [assessments]);

  const districtSnapshots = useMemo(() => {
    if (!selectedRisk) return [];
    return riskSnapshots
      .filter((s) => s.districtId === selectedRisk.districtId)
      .slice(0, 12);
  }, [riskSnapshots, selectedRisk]);

  const handleSaveWeights = async (e: React.FormEvent) => {
    e.preventDefault();
    setWeightsError(null);
    setWeightsFeedback(null);
    if (draftRawSum <= 0) {
      setWeightsError('At least one scoring weight must be greater than 0.');
      return;
    }
    setSavingWeights(true);
    try {
      await updateRiskWeights(draftWeights);
      setWeightsFeedback(
        'Normalized scoring weights saved to SQLite and applied across all 16 Telangana districts.'
      );
    } catch (err) {
      setWeightsError(err instanceof Error ? err.message : 'Unable to save risk weights.');
    } finally {
      setSavingWeights(false);
    }
  };

  const handleResetWeights = async () => {
    setWeightsError(null);
    setWeightsFeedback(null);
    setSavingWeights(true);
    try {
      await resetRiskWeights();
      setWeightsFeedback('Restored default 100-point risk factor weight budget.');
    } catch (err) {
      setWeightsError(err instanceof Error ? err.message : 'Unable to reset risk weights.');
    } finally {
      setSavingWeights(false);
    }
  };

  const handleCaptureSnapshot = async () => {
    setCapturingSnapshot(true);
    try {
      await captureRiskSnapshot();
    } finally {
      setCapturingSnapshot(false);
    }
  };

  if (isLoading && assessments.length === 0) {
    return <LoadingGridSkeleton />;
  }

  if (!selectedRisk) {
    return (
      <div className="p-8 rounded-lg ss-card text-center text-sm text-[#AABBC9]">
        No risk assessments available yet.
      </div>
    );
  }

  const displayedScore = simulatedBreakdown ? simulatedBreakdown.score : selectedRisk.score;
  const displayedExactScore = simulatedBreakdown
    ? simulatedBreakdown.exactScore
    : selectedRisk.exactScore;
  const displayedCategory = simulatedBreakdown ? simulatedBreakdown.category : selectedRisk.category;
  const displayedContribs = simulatedBreakdown
    ? simulatedBreakdown.contributions
    : selectedRisk.contributions;
  const displayedExplanation = simulatedBreakdown
    ? simulatedBreakdown.scoreExplanation
    : selectedRisk.scoreExplanation;
  const displayedPreventive = simulatedBreakdown
    ? simulatedBreakdown.preventiveActions
    : selectedRisk.preventiveActions;

  const distribution = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].map((cat) => ({
    category: cat,
    count: assessments.filter((a) => a.category === cat).length,
  }));

  const hourlyChart = selectedRisk.hourlyTrend.map((h) => ({
    hour: h.time.slice(11, 16),
    score: h.score,
  }));

  return (
    <div className="space-y-6">
      {/* Header: District Selector, Category, Confidence & Data-Quality Indicator */}
      <section className="p-5 rounded-lg ss-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
                {selectedRisk.districtName} Outage Risk Analysis
              </h2>
              <RiskIndicator category={displayedCategory} score={displayedScore} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#8FA3B3]">
              <span>{selectedRisk.modelType}</span>
              <span aria-hidden="true">·</span>
              <span>
                Confidence:{' '}
                <span
                  className={
                    selectedRisk.confidence === 'HIGH'
                      ? 'text-[#5AC49E] font-semibold'
                      : selectedRisk.confidence === 'DEGRADED'
                        ? 'text-[#F2C16E] font-semibold'
                        : 'text-[#F29B9B] font-semibold'
                  }
                >
                  {selectedRisk.confidence}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                Data Quality: {selectedRisk.dataQualityScore}/100
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <label htmlFor="risk-district-select" className="text-xs text-[#AABBC9]">
              Monitored District:
            </label>
            <select
              id="risk-district-select"
              value={selectedRisk.districtId}
              onChange={(e) => setSelectedDistrictId(e.target.value)}
              className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
            >
              {sortedAssessments.map((a) => (
                <option key={a.districtId} value={a.districtId}>
                  {a.districtName} — {a.score}/100 ({a.category})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Data-Quality & Provenance Flags */}
        <div className="pt-2.5 border-t border-[#52697A] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#AABBC9]">
          {selectedRisk.dataQualityFlags.map((flag, idx) => (
            <React.Fragment key={flag}>
              {idx > 0 && (
                <span aria-hidden="true" className="text-[#60788A]">
                  ·
                </span>
              )}
              <span>{flag}</span>
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* Main Split: Explainable Factors + Weight Configurator + Gauge */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-8 p-5 rounded-lg ss-card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
                Explainable Factor Breakdown (Sum = {displayedExactScore.toFixed(1)} / 100 →{' '}
                {displayedScore}/100)
              </h3>
              <ProvenanceText
                source={
                  simEnabled
                    ? 'Storm Simulation Lab (What-If Preview)'
                    : 'Rule-Based Prototype + Open-Meteo Telemetry'
                }
                timestamp={selectedWeather?.fetchedAt}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setWeightsOpen((w) => !w)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  weightsOpen
                    ? 'bg-[#70A9CF] border-[#70A9CF] text-[#17222B] font-semibold'
                    : 'bg-[#3B5061] border-[#60788A] text-[#E5EDF3] hover:border-[#70A9CF]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{weightsOpen ? 'Hide Scoring Weights' : 'Configure Weights'}</span>
              </button>

              <button
                type="button"
                onClick={() => setSimEnabled((s) => !s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  simEnabled
                    ? 'bg-[#55B7B0]/20 border-[#55B7B0] text-[#8BE0C4]'
                    : 'bg-[#3B5061] border-[#60788A] text-[#E5EDF3] hover:border-[#55B7B0]'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{simEnabled ? 'Exit Simulation Lab' : 'Test Weather Sensitivity'}</span>
              </button>
            </div>
          </div>

          {/* Plain-English Score Explanation */}
          <p className="text-xs text-[#AABBC9] leading-relaxed py-2.5 border-y border-[#52697A]">
            {displayedExplanation}
          </p>

          {/* Configurable Scoring Weights Panel */}
          {weightsOpen && (
            <form
              onSubmit={handleSaveWeights}
              className="p-4 rounded-lg bg-[#344655] border border-[#60788A] space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#E5EDF3]">
                    Configurable Factor Weights (Auto-Normalized to 100.0 pts)
                  </div>
                  <div className="text-[11px] text-[#8FA3B3]">
                    Raw sum: <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">{draftRawSum.toFixed(0)}</span> · Normalized budget always totals{' '}
                    <span className="font-mono tabular-nums text-[#55B7B0] font-semibold">100.0 pts</span> so scores remain mathematically consistent (0–100).
                  </div>
                </div>
                {!canConfigureWeights && (
                  <span className="text-[11px] text-[#F2C16E] flex items-center gap-1 font-medium">
                    <Lock className="w-3 h-3" aria-hidden="true" />
                    <span>Read-only for {currentUser?.role}</span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {WEIGHT_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label
                      htmlFor={`weight-${field.key}`}
                      className="flex items-center justify-between text-[#AABBC9] mb-1"
                    >
                      <span>{field.label}</span>
                      <span className="font-mono tabular-nums text-[11px] text-[#55B7B0] font-medium">
                        {normalizedPreview[field.key].toFixed(1)}%
                      </span>
                    </label>
                    <input
                      id={`weight-${field.key}`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!canConfigureWeights || savingWeights}
                      value={draftWeights[field.key]}
                      onChange={(e) =>
                        setDraftWeights((prev) => ({
                          ...prev,
                          [field.key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-[#283744] border border-[#60788A] text-[#E5EDF3] font-mono tabular-nums disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
                    />
                  </div>
                ))}
              </div>

              {weightsError && (
                <div role="alert" className="text-xs text-[#F29B9B]">
                  {weightsError}
                </div>
              )}
              {weightsFeedback && (
                <div role="status" className="text-xs text-[#8BE0C4]">
                  {weightsFeedback}
                </div>
              )}

              {canConfigureWeights && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#52697A]">
                  <button
                    type="button"
                    onClick={handleResetWeights}
                    disabled={savingWeights}
                    className="px-3 py-1.5 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs font-medium text-[#E5EDF3] flex items-center gap-1.5 transition-colors disabled:opacity-45"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Reset Defaults</span>
                  </button>
                  <button
                    type="submit"
                    disabled={savingWeights}
                    className="px-3.5 py-1.5 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] text-xs font-semibold text-[#17222B] flex items-center gap-1.5 transition-colors disabled:opacity-45"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{savingWeights ? 'Saving...' : 'Save Weights'}</span>
                  </button>
                </div>
              )}
            </form>
          )}

          {/* Storm Sensitivity Quick-Test Panel */}
          {simEnabled && (
            <div className="p-4 rounded-lg bg-[#344655] border border-[#70A9CF]/50 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#E5EDF3]">
                    Weather Sensitivity Test ({selectedRisk.districtName})
                  </div>
                  <div className="text-[11px] text-[#8FA3B3]">
                    Adjust meteorological inputs to inspect factor sensitivity without mutating persisted weather or incident records.
                  </div>
                </div>
                {simThunder && (
                  <span className="text-[11px] font-mono text-[#F2C16E] font-medium">
                    Convective Lightning Active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                <div className="md:col-span-4 flex justify-center">
                  <RiskGaugeArc
                    score={displayedScore}
                    category={displayedCategory}
                    label="Simulated Risk"
                    size={134}
                  />
                </div>
                <div className="md:col-span-8 space-y-2.5">
                  <WindFlowCanvas windSpeedKmh={simWind} windGustsKmh={simGusts} height={74} />
                  <RainfallVisualizer rainMm={simRain} precipProb={simRain > 0 ? 85 : 20} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-[#52697A]">
                <div>
                  <label className="block text-xs text-[#AABBC9] mb-1 font-mono tabular-nums">
                    Rain: {simRain} mm/h
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={simRain}
                    onChange={(e) => setSimRain(Number(e.target.value))}
                    className="w-full accent-[#70A9CF]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#AABBC9] mb-1 font-mono tabular-nums">
                    Wind: {simWind} km/h
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={65}
                    value={simWind}
                    onChange={(e) => setSimWind(Number(e.target.value))}
                    className="w-full accent-[#55B7B0]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#AABBC9] mb-1 font-mono tabular-nums">
                    Gusts: {simGusts} km/h
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    value={simGusts}
                    onChange={(e) => setSimGusts(Number(e.target.value))}
                    className="w-full accent-[#70A9CF]"
                  />
                </div>
                <div className="flex items-center gap-2 pt-3">
                  <input
                    id="sim-thunder"
                    type="checkbox"
                    checked={simThunder}
                    onChange={(e) => setSimThunder(e.target.checked)}
                    className="w-4 h-4 accent-[#70A9CF]"
                  />
                  <label htmlFor="sim-thunder" className="text-xs text-[#E5EDF3]">
                    Active Thunderstorm
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* 8-Factor Contribution Progress Bars */}
          <div className="space-y-3">
            {displayedContribs.map((c) => {
              const pct = c.maxPoints > 0 ? Math.min(100, Math.round((c.points / c.maxPoints) * 100)) : 0;
              return (
                <div key={c.factor} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#E5EDF3]">{c.label}</span>
                      <span className="text-[#AABBC9] font-mono tabular-nums">{c.rawValue}</span>
                      <span aria-hidden="true" className="text-[#60788A]">
                        ·
                      </span>
                      <span className={`text-[11px] ${DATA_STATUS_TEXT_COLOR[c.dataStatus] || 'text-[#8FA3B3]'}`}>
                        {c.dataStatus}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-[#70A9CF]">
                      +{c.points.toFixed(1)} / {c.maxPoints.toFixed(1)} pts
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#344655] overflow-hidden border border-[#52697A]">
                    <div
                      className="h-full bg-gradient-to-r from-[#55B7B0] to-[#70A9CF] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#8FA3B3]">{c.rationale}</p>
                </div>
              );
            })}
          </div>

          {/* Factor-Driven Preventive Recommendations */}
          <div className="pt-3 border-t border-[#52697A] space-y-2.5">
            <div className="text-xs font-semibold text-[#55B7B0]">
              Factor-Driven Preventive Recommendations
            </div>
            <div className="space-y-2">
              {displayedPreventive.map((rec) => (
                <div
                  key={`${rec.factor}-${rec.title}`}
                  className="py-2.5 px-3 rounded bg-[#344655] border border-[#60788A]/80 space-y-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#E5EDF3]">{rec.title}</span>
                    <span className="font-mono text-[11px] text-[#8FA3B3]">
                      {rec.priority} · Trigger: {rec.driverValue}
                    </span>
                  </div>
                  <p className="text-xs text-[#AABBC9] leading-relaxed">{rec.action}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right Column: Risk Gauge + Statewide Band Distribution + Prototype Note */}
        <section className="xl:col-span-4 p-5 rounded-lg ss-card space-y-5">
          <div className="p-4 rounded-lg bg-[#344655] border border-[#60788A] flex flex-col items-center">
            <RiskGaugeArc
              score={displayedScore}
              category={displayedCategory}
              label={`${selectedRisk.districtName} Heuristic Score`}
              size={148}
            />
            <div className="mt-3 text-[11px] font-mono tabular-nums text-[#8FA3B3] text-center">
              0–30 Low · 31–60 Moderate · 61–80 High · 81–100 Critical
            </div>
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              Statewide Risk Band Distribution
            </h3>
            <p className="text-xs text-[#8FA3B3]">
              All {assessments.length} Telangana districts · State mean:{' '}
              <span className="font-mono tabular-nums text-[#E5EDF3] font-semibold">{stateAverageScore}/100</span>
            </p>
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="category" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <YAxis allowDecimals={false} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="count" name="Districts" radius={[4, 4, 0, 0]} animationDuration={450}>
                  {distribution.map((d) => (
                    <Cell key={d.category} fill={CATEGORY_COLORS[d.category]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 pt-3 border-t border-[#52697A]">
            <div className="text-xs font-semibold text-[#E5EDF3]">
              Prototype Scope &amp; Data Integrity
            </div>
            <p className="text-xs text-[#8FA3B3] leading-relaxed">
              This engine is a rule-based predictive prototype. Because validated utility feeder-failure datasets are not connected, scores reflect transparent weighted hazard exposure (0–100) rather than empirical outage probabilities.
            </p>
          </div>
        </section>
      </div>

      {/* District-Level Risk Comparison */}
      <section className="p-5 rounded-lg ss-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              District-Level Risk Comparison
            </h3>
            <p className="text-xs text-[#8FA3B3]">
              Compare {selectedRisk.districtName} against another district and click any row to switch the monitored district.
            </p>
          </div>

          {compareRisk && (
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="compare-district-select" className="text-[#AABBC9]">
                Compare against:
              </label>
              <select
                id="compare-district-select"
                value={effectiveCompareId}
                onChange={(e) => setCompareDistrictId(e.target.value)}
                className="px-2.5 py-1.5 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
              >
                {sortedAssessments
                  .filter((a) => a.districtId !== selectedRisk.districtId)
                  .map((a) => (
                    <option key={a.districtId} value={a.districtId}>
                      {a.districtName} ({a.score}/100)
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>

        {/* Side-by-side Head-to-Head Comparison Strip */}
        {compareRisk && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-3 border-y border-[#52697A] text-xs">
            <div className="space-y-1">
              <div className="text-[#8FA3B3]">Monitored District</div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#E5EDF3]">{selectedRisk.districtName}</span>
                <RiskIndicator category={selectedRisk.category} score={selectedRisk.score} />
              </div>
              <div className="font-mono tabular-nums text-[#AABBC9]">
                Rain {selectedWeather?.rainMm.toFixed(1) ?? 'N/A'} mm/h · Gusts{' '}
                {selectedWeather?.windGustsKmh.toFixed(0) ?? 'N/A'} km/h · 24h Rain{' '}
                {selectedWeather?.recentHistory?.past24hRainMm.toFixed(1) ?? 'N/A'} mm
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[#8FA3B3]">Comparison District</div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#E5EDF3]">{compareRisk.districtName}</span>
                <RiskIndicator category={compareRisk.category} score={compareRisk.score} />
              </div>
              <div className="font-mono tabular-nums text-[#AABBC9]">
                Rain {compareWeather?.rainMm.toFixed(1) ?? 'N/A'} mm/h · Gusts{' '}
                {compareWeather?.windGustsKmh.toFixed(0) ?? 'N/A'} km/h · 24h Rain{' '}
                {compareWeather?.recentHistory?.past24hRainMm.toFixed(1) ?? 'N/A'} mm
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[#8FA3B3]">Spread vs. Comparison &amp; State Mean</div>
              <div className="font-mono tabular-nums text-sm font-semibold text-[#70A9CF]">
                {selectedRisk.score - compareRisk.score >= 0 ? '+' : ''}
                {selectedRisk.score - compareRisk.score} pts vs {compareRisk.districtName}
              </div>
              <div className="font-mono tabular-nums text-[#AABBC9]">
                {selectedRisk.score - stateAverageScore >= 0 ? '+' : ''}
                {selectedRisk.score - stateAverageScore} pts vs Telangana mean ({stateAverageScore})
              </div>
            </div>
          </div>
        )}

        {/* 16-District Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#60788A] text-[#8FA3B3]">
                <th className="py-2 pr-3 font-medium">District</th>
                <th className="py-2 px-3 font-medium">Risk Score</th>
                <th className="py-2 px-3 font-medium">Category</th>
                <th className="py-2 px-3 font-medium">Rain / 24h</th>
                <th className="py-2 px-3 font-medium">Wind / Gusts</th>
                <th className="py-2 px-3 font-medium">Incidents</th>
                <th className="py-2 px-3 font-medium">Quality</th>
                <th className="py-2 pl-3 font-medium">Primary Risk Driver</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#52697A]/70">
              {sortedAssessments.map((a) => {
                const w = weatherMap.get(a.districtId);
                const isSelected = a.districtId === selectedRisk.districtId;
                const topDriver = [...a.contributions].sort((x, y) => y.points - x.points)[0];
                return (
                  <tr
                    key={a.districtId}
                    className={`transition-colors ${
                      isSelected ? 'bg-[#70A9CF]/16' : 'hover:bg-[#3B5061]/70'
                    }`}
                  >
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setSelectedDistrictId(a.districtId)}
                        className={`text-left font-semibold hover:text-[#70A9CF] transition-colors ${
                          isSelected ? 'text-[#70A9CF]' : 'text-[#E5EDF3]'
                        }`}
                      >
                        {a.districtName}
                      </button>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono tabular-nums text-[#E5EDF3] font-medium w-8">{a.score}</span>
                        <div className="w-20 h-1.5 rounded-full bg-[#344655] overflow-hidden">
                          <div
                            className="h-full transition-all duration-300"
                            style={{
                              width: `${a.score}%`,
                              backgroundColor: CATEGORY_COLORS[a.category],
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <RiskIndicator category={a.category} />
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-[#AABBC9]">
                      {w ? `${w.rainMm.toFixed(1)} / ${w.recentHistory?.past24hRainMm.toFixed(1) ?? '—'} mm` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-[#AABBC9]">
                      {w ? `${w.windSpeedKmh.toFixed(0)} / ${w.windGustsKmh.toFixed(0)} km/h` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-[#AABBC9]">
                      {a.incidentContext.activeCount}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-[#AABBC9]">
                      {a.confidence} ({a.dataQualityScore}%)
                    </td>
                    <td className="py-2 pl-3 text-[#AABBC9]">
                      {topDriver ? `${topDriver.label} (+${topDriver.points.toFixed(1)})` : 'Baseline'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hourly Risk Trend & 7-Day Risk Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="p-5 rounded-lg ss-card space-y-3">
          <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
            24-Hour Projected Risk Score ({selectedRisk.districtName})
          </h3>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="hour" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <YAxis domain={[0, 100]} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Area
                  type="monotone"
                  dataKey="score"
                  name="Heuristic Risk Score"
                  stroke="#55B7B0"
                  fill="#55B7B0"
                  fillOpacity={0.22}
                  animationDuration={450}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="p-5 rounded-lg ss-card space-y-3">
          <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
            7-Day Daily Risk Outlook ({selectedRisk.districtName})
          </h3>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={selectedRisk.dailyForecast}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52697A" />
                <XAxis dataKey="date" stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 10 }} />
                <YAxis domain={[0, 100]} stroke="#60788A" tick={{ fill: '#AABBC9', fontSize: 11 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="score" name="Daily Risk Score" radius={[4, 4, 0, 0]} animationDuration={450}>
                  {selectedRisk.dailyForecast.map((d) => (
                    <Cell key={d.date} fill={CATEGORY_COLORS[d.category]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Historical Risk Snapshots Over Time */}
      <section className="p-5 rounded-lg ss-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              Historical Risk Snapshots ({selectedRisk.districtName})
            </h3>
            <p className="text-xs text-[#8FA3B3]">
              Persisted SQLite snapshots recorded periodically and on weather refreshes to analyze score changes over time.
            </p>
          </div>
          {canCaptureSnapshot && (
            <button
              type="button"
              onClick={handleCaptureSnapshot}
              disabled={capturingSnapshot}
              className="px-3 py-1.5 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs font-medium text-[#E5EDF3] flex items-center gap-1.5 transition-colors disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <Camera className="w-3.5 h-3.5 text-[#70A9CF]" aria-hidden="true" />
              <span>{capturingSnapshot ? 'Recording...' : 'Record Snapshot Now'}</span>
            </button>
          )}
        </div>

        {districtSnapshots.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#8FA3B3]">
            No historical snapshots recorded for {selectedRisk.districtName} yet. Snapshots are stored automatically on refresh or via Record Snapshot Now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#60788A] text-[#8FA3B3]">
                  <th className="py-2 pr-3 font-medium">Recorded Time</th>
                  <th className="py-2 px-3 font-medium">Score</th>
                  <th className="py-2 px-3 font-medium">Change</th>
                  <th className="py-2 px-3 font-medium">Category</th>
                  <th className="py-2 px-3 font-medium">Rain / 24h</th>
                  <th className="py-2 px-3 font-medium">Wind / Gusts</th>
                  <th className="py-2 pl-3 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#52697A]/70">
                {districtSnapshots.map((snap, idx) => {
                  const prev = districtSnapshots[idx + 1];
                  const delta = prev ? snap.riskScore - prev.riskScore : null;
                  return (
                    <tr key={snap.id} className="hover:bg-[#3B5061]/70">
                      <td className="py-2 pr-3 font-mono tabular-nums text-[#AABBC9]">
                        {formatIstDateTime(snap.recordedAt)}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums font-semibold text-[#E5EDF3]">
                        {snap.riskScore}/100
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums">
                        {delta === null ? (
                          <span className="text-[#8FA3B3]">Baseline</span>
                        ) : delta > 0 ? (
                          <span className="text-[#F29B9B] font-medium">+{delta}</span>
                        ) : delta < 0 ? (
                          <span className="text-[#8BE0C4] font-medium">{delta}</span>
                        ) : (
                          <span className="text-[#8FA3B3]">0</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <RiskIndicator category={snap.riskCategory} />
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-[#AABBC9]">
                        {snap.rainMm.toFixed(1)} / {(snap.past24hRainMm ?? 0).toFixed(1)} mm
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-[#AABBC9]">
                        {snap.windSpeedKmh.toFixed(0)} / {snap.windGustsKmh.toFixed(0)} km/h
                      </td>
                      <td className="py-2 pl-3 font-mono text-[#AABBC9]">
                        {snap.confidence || 'HIGH'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
