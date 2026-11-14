import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, RotateCcw, Save } from 'lucide-react';
import { useStormSense } from '../context/StormSenseContext';
import { DEFAULT_RISK_WEIGHTS, normalizeRiskWeights } from '../lib/riskEngine';
import type { RiskScoringWeights } from '../lib/types';

type WeightFieldKey = keyof Omit<RiskScoringWeights, 'updatedAt'>;

const WEIGHT_FIELDS: Array<{ key: WeightFieldKey; label: string }> = [
  { key: 'rainfall', label: 'Rainfall Intensity' },
  { key: 'wind', label: 'Sustained Wind Speed' },
  { key: 'gusts', label: 'Peak Wind Gusts' },
  { key: 'thunderstorm', label: 'Thunderstorm / WMO Code' },
  { key: 'precipitationProb', label: 'Precipitation Probability' },
  { key: 'historicalWeather', label: 'Past 24h Weather Stress' },
  { key: 'recordedIncidents', label: 'Recorded District Incidents' },
  { key: 'gridVulnerability', label: 'Grid Structural Exposure' },
];

export function SettingsPage() {
  const {
    alertConfig,
    riskWeights,
    currentUser,
    updateSettings,
    updateRiskWeights,
    resetRiskWeights,
  } = useStormSense();
  const canEdit =
    currentUser?.role === 'Administrator' || currentUser?.role === 'Operations Manager';

  const [moderateRiskThreshold, setModerateRiskThreshold] = useState(31);
  const [highRiskThreshold, setHighRiskThreshold] = useState(61);
  const [criticalRiskThreshold, setCriticalRiskThreshold] = useState(81);
  const [highWindThresholdKmh, setHighWindThresholdKmh] = useState(40);
  const [heavyRainThresholdMm, setHeavyRainThresholdMm] = useState(10);
  const [unassignedAlertMinutes, setUnassignedAlertMinutes] = useState(30);
  const [restorationDelayMinutes, setRestorationDelayMinutes] = useState(120);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [draftWeights, setDraftWeights] = useState<Omit<RiskScoringWeights, 'updatedAt'>>(
    DEFAULT_RISK_WEIGHTS
  );
  const [savingWeights, setSavingWeights] = useState(false);
  const [weightMessage, setWeightMessage] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);

  useEffect(() => {
    if (!riskWeights) return;
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
  }, [riskWeights]);

  const normalizedWeights = useMemo(() => normalizeRiskWeights(draftWeights), [draftWeights]);
  const weightRawSum = WEIGHT_FIELDS.reduce((acc, f) => acc + (Number(draftWeights[f.key]) || 0), 0);

  useEffect(() => {
    if (!alertConfig) return;
    setModerateRiskThreshold(alertConfig.moderateRiskThreshold ?? 31);
    setHighRiskThreshold(alertConfig.highRiskThreshold);
    setCriticalRiskThreshold(alertConfig.criticalRiskThreshold);
    setHighWindThresholdKmh(alertConfig.highWindThresholdKmh);
    setHeavyRainThresholdMm(alertConfig.heavyRainThresholdMm);
    setUnassignedAlertMinutes(alertConfig.unassignedAlertMinutes);
    setRestorationDelayMinutes(alertConfig.restorationDelayMinutes);
    setSmsEnabled(alertConfig.smsEnabled);
    setWhatsappEnabled(alertConfig.whatsappEnabled);
    setEmailEnabled(alertConfig.emailEnabled);
  }, [alertConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveMessage(null);
    if (
      moderateRiskThreshold < 10 ||
      highRiskThreshold <= moderateRiskThreshold ||
      criticalRiskThreshold <= highRiskThreshold ||
      criticalRiskThreshold > 100
    ) {
      setSaveError('Ensure 10 ≤ Moderate < High < Critical ≤ 100.');
      return;
    }
    setSaving(true);
    try {
      await updateSettings({
        moderateRiskThreshold,
        highRiskThreshold,
        criticalRiskThreshold,
        highWindThresholdKmh,
        heavyRainThresholdMm,
        unassignedAlertMinutes,
        restorationDelayMinutes,
        smsEnabled,
        whatsappEnabled,
        emailEnabled,
      });
      setSaveMessage(
        'Alert thresholds saved to SQLite and automated alerts re-evaluated against current conditions.'
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWeights = async (e: React.FormEvent) => {
    e.preventDefault();
    setWeightError(null);
    setWeightMessage(null);
    if (weightRawSum <= 0) {
      setWeightError('At least one risk factor weight must be greater than 0.');
      return;
    }
    setSavingWeights(true);
    try {
      await updateRiskWeights(draftWeights);
      setWeightMessage(
        'Risk scoring weights saved to SQLite and normalized to 100.0 points across all 16 districts.'
      );
    } catch (err) {
      setWeightError(err instanceof Error ? err.message : 'Failed to save risk weights.');
    } finally {
      setSavingWeights(false);
    }
  };

  const handleResetWeights = async () => {
    setWeightError(null);
    setWeightMessage(null);
    setSavingWeights(true);
    try {
      await resetRiskWeights();
      setWeightMessage('Restored default 100-point risk scoring factor weights.');
    } catch (err) {
      setWeightError(err instanceof Error ? err.message : 'Failed to reset risk weights.');
    } finally {
      setSavingWeights(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <form onSubmit={handleSave} className="p-6 ss-card space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#52697A]">
          <div>
            <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
              Automated Alert Threshold Configuration
            </h2>
            <p className="text-xs text-[#8FA3B3]">
              Controls when StormSense generates in-app application alerts. Restricted to Administrator and Operations Manager roles.
            </p>
          </div>
          {!canEdit && (
            <span className="text-xs text-[#F2C16E] flex items-center gap-1 font-medium">
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Read-only for {currentUser?.role}</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div>
            <label htmlFor="cfg-mod-risk" className="block text-[#AABBC9] font-medium mb-1">
              Moderate Risk Alert Threshold (0–100)
            </label>
            <input
              id="cfg-mod-risk"
              type="number"
              min={10}
              max={90}
              disabled={!canEdit}
              value={moderateRiskThreshold}
              onChange={(e) => setModerateRiskThreshold(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
            />
          </div>

          <div>
            <label htmlFor="cfg-high-risk" className="block text-[#AABBC9] font-medium mb-1">
              High Risk Alert Threshold (0–100)
            </label>
            <input
              id="cfg-high-risk"
              type="number"
              min={15}
              max={95}
              disabled={!canEdit}
              value={highRiskThreshold}
              onChange={(e) => setHighRiskThreshold(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
            />
          </div>

          <div>
            <label htmlFor="cfg-crit-risk" className="block text-[#AABBC9] font-medium mb-1">
              Critical Risk Alert Threshold (0–100)
            </label>
            <input
              id="cfg-crit-risk"
              type="number"
              min={30}
              max={100}
              disabled={!canEdit}
              value={criticalRiskThreshold}
              onChange={(e) => setCriticalRiskThreshold(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
            />
          </div>

          <div>
            <label htmlFor="cfg-wind" className="block text-[#AABBC9] font-medium mb-1">
              High Wind Gust Trigger (km/h)
            </label>
            <input
              id="cfg-wind"
              type="number"
              min={15}
              max={120}
              disabled={!canEdit}
              value={highWindThresholdKmh}
              onChange={(e) => setHighWindThresholdKmh(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
            />
          </div>

          <div>
            <label htmlFor="cfg-rain" className="block text-[#AABBC9] font-medium mb-1">
              Heavy Rainfall Trigger (mm/h)
            </label>
            <input
              id="cfg-rain"
              type="number"
              min={1}
              max={100}
              disabled={!canEdit}
              value={heavyRainThresholdMm}
              onChange={(e) => setHeavyRainThresholdMm(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
            />
          </div>

          <div>
            <label htmlFor="cfg-unassigned" className="block text-[#AABBC9] font-medium mb-1">
              Unassigned Incident SLA (minutes)
            </label>
            <input
              id="cfg-unassigned"
              type="number"
              min={5}
              max={240}
              disabled={!canEdit}
              value={unassignedAlertMinutes}
              onChange={(e) => setUnassignedAlertMinutes(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
            />
          </div>

          <div>
            <label htmlFor="cfg-delay" className="block text-[#AABBC9] font-medium mb-1">
              Restoration Delay SLA (minutes)
            </label>
            <input
              id="cfg-delay"
              type="number"
              min={15}
              max={720}
              disabled={!canEdit}
              value={restorationDelayMinutes}
              onChange={(e) => setRestorationDelayMinutes(Number(e.target.value))}
              className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-[#52697A] space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-[#E5EDF3]">
              External Notification Gateways (Optional Integrations)
            </h3>
            <p className="text-xs text-[#8FA3B3]">
              In-app notifications are active. External SMS, WhatsApp, and SMTP email delivery require external gateway credentials and are never simulated as live.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <label className="p-3 rounded bg-[#344655]/90 border border-[#52697A] hover:border-[#70A9CF] flex items-start gap-2.5 cursor-pointer transition-colors">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={smsEnabled}
                onChange={(e) => setSmsEnabled(e.target.checked)}
                className="mt-0.5 accent-[#70A9CF]"
              />
              <div>
                <div className="font-medium text-[#E5EDF3]">SMS Gateway Routing</div>
                <div className="text-[11px] text-[#F2C16E] mt-0.5">
                  {alertConfig?.smsWebhookStatus || 'Credentials required'}
                </div>
              </div>
            </label>

            <label className="p-3 rounded bg-[#344655]/90 border border-[#52697A] hover:border-[#70A9CF] flex items-start gap-2.5 cursor-pointer transition-colors">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={whatsappEnabled}
                onChange={(e) => setWhatsappEnabled(e.target.checked)}
                className="mt-0.5 accent-[#70A9CF]"
              />
              <div>
                <div className="font-medium text-[#E5EDF3]">WhatsApp Dispatch Alerts</div>
                <div className="text-[11px] text-[#F2C16E] mt-0.5">
                  {alertConfig?.whatsappWebhookStatus || 'Credentials required'}
                </div>
              </div>
            </label>

            <label className="p-3 rounded bg-[#344655]/90 border border-[#52697A] hover:border-[#70A9CF] flex items-start gap-2.5 cursor-pointer transition-colors">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="mt-0.5 accent-[#70A9CF]"
              />
              <div>
                <div className="font-medium text-[#E5EDF3]">Departmental Email Relay</div>
                <div className="text-[11px] text-[#F2C16E] mt-0.5">
                  {alertConfig?.emailSmtpStatus || 'Credentials required'}
                </div>
              </div>
            </label>
          </div>
        </div>

        {saveError && (
          <div role="alert" className="p-3 rounded bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-xs text-[#F6C5C5]">
            {saveError}
          </div>
        )}
        {saveMessage && (
          <div role="status" className="p-3 rounded bg-[#5AC49E]/16 border border-[#5AC49E]/45 text-xs text-[#9EE8CD] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#5AC49E]" aria-hidden="true" />
            <span>{saveMessage}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canEdit || saving}
            className="px-4 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-45 text-xs font-semibold text-[#17222B] flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>

      <form onSubmit={handleSaveWeights} className="p-6 ss-card space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#52697A]">
          <div>
            <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
              Outage Risk Engine Factor Weights
            </h2>
            <p className="text-xs text-[#8FA3B3]">
              Adjust relative factor weights for the Rule-Based Predictive Prototype. Values automatically normalize to 100.0 points so risk scores remain mathematically bounded between 0 and 100.
            </p>
          </div>
          <span className="font-mono tabular-nums text-xs text-[#55B7B0] font-medium">
            Normalized Total: 100.0 pts (Raw: {weightRawSum.toFixed(0)})
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {WEIGHT_FIELDS.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={`settings-weight-${field.key}`}
                className="flex items-center justify-between text-[#AABBC9] font-medium mb-1"
              >
                <span>{field.label}</span>
                <span className="font-mono tabular-nums text-[11px] text-[#55B7B0] font-semibold">
                  {normalizedWeights[field.key].toFixed(1)}%
                </span>
              </label>
              <input
                id={`settings-weight-${field.key}`}
                type="number"
                min={0}
                max={100}
                step={1}
                disabled={!canEdit || savingWeights}
                value={draftWeights[field.key]}
                onChange={(e) =>
                  setDraftWeights((prev) => ({
                    ...prev,
                    [field.key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  }))
                }
                className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono tabular-nums disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
              />
            </div>
          ))}
        </div>

        {weightError && (
          <div role="alert" className="p-3 rounded bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-xs text-[#F6C5C5]">
            {weightError}
          </div>
        )}
        {weightMessage && (
          <div role="status" className="p-3 rounded bg-[#5AC49E]/16 border border-[#5AC49E]/45 text-xs text-[#9EE8CD] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#5AC49E]" aria-hidden="true" />
            <span>{weightMessage}</span>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleResetWeights}
            disabled={!canEdit || savingWeights}
            className="px-3.5 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] disabled:opacity-45 text-xs font-medium text-[#E5EDF3] flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset Default Weights</span>
          </button>
          <button
            type="submit"
            disabled={!canEdit || savingWeights}
            className="px-4 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-45 text-xs font-semibold text-[#17222B] flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{savingWeights ? 'Saving...' : 'Save Risk Weights'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
