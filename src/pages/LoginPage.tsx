import React, { useState } from 'react';
import { ArrowRight, ShieldCheck, Zap } from 'lucide-react';
import { AtmosphericBackdrop } from '../components/graphics/AtmosphericBackdrop';
import { TelanganaWeatherRadar } from '../components/graphics/TelanganaWeatherRadar';
import { useStormSense } from '../context/StormSenseContext';
import { TELANGANA_DISTRICTS } from '../lib/telanganaDistricts';
import type { UserAccount, UserRole } from '../lib/types';

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  Administrator: 'Full control over incidents, crew roster, alert thresholds, and gateway configuration.',
  'Operations Manager': 'Create/resolve incidents, dispatch and reassign crews, configure alert rules, and export reports.',
  'Field Operator': 'Update restoration progress, log field incidents, and manage assigned crew status.',
  'Read-only Evaluator': 'Inspect live weather, risk explanations, GIS map, AI intelligence, and analytics (mutations blocked).',
};

export function LoginPage() {
  const { users, districts, weather, assessments, incidents, loginAs } = useStormSense();
  const [selectedUserId, setSelectedUserId] = useState<string>('USR-MGR');
  const [customEmail, setCustomEmail] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const selectedUser: UserAccount | undefined =
    users.find((u) => u.id === selectedUserId) || users[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedUser) {
      setFormError('Operational accounts are still loading from the server.');
      return;
    }
    if (customEmail.trim() && !customEmail.includes('@')) {
      setFormError('Please enter a valid departmental email address or leave blank to use the selected role profile.');
      return;
    }
    loginAs(
      customEmail.trim()
        ? { ...selectedUser, email: customEmail.trim() }
        : selectedUser
    );
  };

  return (
    <div className="min-h-screen ss-atmospheric-backdrop text-[#E5EDF3] grid lg:grid-cols-12 relative overflow-hidden">
      {/* Global animated atmospheric clouds, pressure contours, wind streamlines & gentle precipitation */}
      <AtmosphericBackdrop showPrecipitation intensity="normal" />

      {/* Left Atmospheric Command Hero Panel */}
      <div className="lg:col-span-7 relative z-10 flex flex-col justify-between p-8 lg:p-12 border-b lg:border-b-0 lg:border-r border-[#60788A]/60 bg-[#283744]/40">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-[#3B5061]/90 border border-[#70A9CF]/50 shadow-md flex items-center justify-center">
            <Zap className="w-5 h-5 text-[#70A9CF]" aria-hidden="true" />
          </div>
          <div>
            <span className="font-display font-bold text-2xl text-[#E5EDF3] tracking-tight block leading-none">
              StormSense
            </span>
            <span className="text-xs text-[#AABBC9] block mt-1">
              Telangana Grid Intelligence · Meteorological Operations Command
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-center my-8 lg:my-0">
          <div className="xl:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#55B7B0]">
              <span>TGSPDCL &amp; TGNPDCL Grid Telemetry</span>
              <span aria-hidden="true" className="text-[#60788A]">·</span>
              <span>16 Districts</span>
            </div>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold text-[#E5EDF3] leading-[1.12]">
              Predictive Weather Intelligence &amp; Smart Crew Dispatch
            </h1>

            <p className="text-sm lg:text-base text-[#AABBC9] leading-relaxed max-w-xl">
              Live Open-Meteo meteorological telemetry across 16 Telangana districts paired with
              explainable outage risk scoring, interactive GIS situational awareness, and road-aware
              maintenance crew routing.
            </p>

            <div className="grid grid-cols-3 gap-4 pt-5 border-t border-[#60788A]/65">
              <div>
                <div className="font-mono text-base font-semibold text-[#55B7B0] tabular-nums whitespace-nowrap">
                  16 Districts
                </div>
                <div className="text-xs text-[#8FA3B3]">Open-Meteo Feeds</div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold text-[#70A9CF] tabular-nums whitespace-nowrap">
                  0–100 Index
                </div>
                <div className="text-xs text-[#8FA3B3]">Explainable Risk</div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold text-[#E5EDF3] tabular-nums whitespace-nowrap">
                  4 RBAC Roles
                </div>
                <div className="text-xs text-[#8FA3B3]">Server-Enforced</div>
              </div>
            </div>
          </div>

          <div className="xl:col-span-5 flex flex-col items-center space-y-3">
            <TelanganaWeatherRadar
              districts={districts.length ? districts : TELANGANA_DISTRICTS}
              weather={weather.observations}
              assessments={assessments}
              incidents={incidents}
              size={268}
              showTimeControls={false}
            />
            <span className="text-[11px] font-mono text-[#8FA3B3] text-center">
              Statewide Station Radar · {districts.length || 16} Monitored Circles
            </span>
          </div>
        </div>

        <div className="text-xs text-[#8FA3B3] flex flex-wrap items-center gap-2">
          <span className="font-medium text-[#E5EDF3]">Data Integrity Protocol</span>
          <span aria-hidden="true" className="text-[#60788A]">·</span>
          <span>Live Open-Meteo telemetry, derived predictions, and demonstration records are explicitly labeled.</span>
        </div>
      </div>

      {/* Right Translucent Blue-Grey Authentication Panel */}
      <div className="lg:col-span-5 relative z-10 flex items-center justify-center p-6 sm:p-10 lg:p-12 bg-[#344655]/55">
        <div className="w-full max-w-md space-y-6 bg-[#3B5061]/95 border border-[#60788A] rounded-xl p-6 sm:p-8 shadow-[0_20px_50px_rgba(12,20,28,0.45),inset_0_1px_0_rgba(229,237,243,0.08)]">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-[#55B7B0]">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              <span>State Grid Control Room Access</span>
            </div>
            <h2 className="font-display text-2xl font-semibold text-[#E5EDF3]">
              Sign in to StormSense
            </h2>
            <p className="text-xs text-[#AABBC9]">
              Select an operational role profile to authenticate with backend RBAC enforcement.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#AABBC9]">
                Departmental Role Profile
              </label>
              <div className="space-y-2">
                {users.map((u) => {
                  const isSelected = (selectedUser?.id ?? '') === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedUserId(u.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all duration-150 ${
                        isSelected
                          ? 'bg-[#43596A] border-[#70A9CF] ring-1 ring-[#70A9CF]/40 text-[#E5EDF3] shadow-md'
                          : 'bg-[#344655]/85 border-[#60788A]/80 text-[#AABBC9] hover:bg-[#43596A]/75 hover:border-[#70A9CF]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#E5EDF3]">{u.role}</span>
                        <span className="font-mono text-[11px] font-medium text-[#55B7B0]">{u.discom}</span>
                      </div>
                      <div className="text-xs text-[#AABBC9] mt-0.5">
                        {u.name} · {u.email}
                      </div>
                      <div className="text-[11px] text-[#8FA3B3] mt-1 leading-snug">
                        {ROLE_DESCRIPTIONS[u.role]}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="operator-email" className="block text-xs font-medium text-[#AABBC9] mb-1.5">
                Official Email Override (Optional)
              </label>
              <input
                id="operator-email"
                type="email"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                placeholder={selectedUser?.email || 'operator@energy.telangana.gov.in'}
                className="w-full px-3 py-2.5 rounded-lg bg-[#344655] border border-[#60788A] text-sm text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
              />
            </div>

            {formError && (
              <div role="alert" className="text-xs text-[#F29B9B] bg-[#E36D6D]/18 border border-[#E36D6D]/50 rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={users.length === 0}
              className="w-full py-2.5 px-4 rounded-lg bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-50 text-[#17222B] text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-md"
            >
              <span>Enter Control Center</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
