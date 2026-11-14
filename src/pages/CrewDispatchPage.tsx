import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  MapPin,
  Navigation,
  Plus,
  Route,
  Sparkles,
  Trash2,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import { useStormSense } from '../context/StormSenseContext';
import type {
  Crew,
  CrewAvailability,
  CrewRecommendation,
  CrewStatus,
  DispatchHistoryAction,
} from '../lib/types';
import {
  ProvenanceText,
  SeverityIndicator,
  formatIstDateTime,
} from '../components/ui/DataProvenanceTag';

const AVAILABILITIES: CrewAvailability[] = ['Available', 'Standby', 'Deployed', 'Off-Duty'];
const CREW_STATUSES: CrewStatus[] = [
  'Ready at Depot',
  'En Route',
  'On Site - Restoring',
  'Standby Reserve',
  'Shift Completed',
];

const AVAILABILITY_DOT: Record<CrewAvailability, string> = {
  Available: 'bg-[#5AC49E]',
  Standby: 'bg-[#E5A94C]',
  Deployed: 'bg-[#70A9CF]',
  'Off-Duty': 'bg-[#8FA3B3]',
};

const ACTION_LABEL: Record<DispatchHistoryAction, { label: string; colorClass: string }> = {
  assigned: { label: 'Assigned', colorClass: 'text-[#55B7B0]' },
  reassigned: { label: 'Reassigned', colorClass: 'text-[#F2C16E]' },
  status_updated: { label: 'Status Synced', colorClass: 'text-[#70A9CF]' },
  availability_changed: { label: 'Availability', colorClass: 'text-[#AABBC9]' },
  work_completed: { label: 'Work Completed', colorClass: 'text-[#8BE0C4]' },
};

export function CrewDispatchPage() {
  const {
    crews,
    incidents,
    districts,
    dispatchHistory,
    dispatchTargetIncidentId,
    setDispatchTargetIncidentId,
    currentUser,
    assignCrewToIncident,
    getCrewRecommendations,
    createCrew,
    updateCrew,
    completeCrewWork,
    deleteCrew,
    setActivePage,
  } = useStormSense();

  const isReadOnly = currentUser?.role === 'Read-only Evaluator';
  const canManageRoster =
    currentUser?.role === 'Administrator' || currentUser?.role === 'Operations Manager';

  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'Restored' && i.status !== 'Closed'),
    [incidents]
  );

  const [selectedIncidentId, setSelectedIncidentId] = useState<string>(openIncidents[0]?.id || '');
  const [recommendations, setRecommendations] = useState<CrewRecommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [expandedScores, setExpandedScores] = useState<Record<string, boolean>>({});
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  const [historyFilter, setHistoryFilter] = useState<string>('');

  const [showCrewModal, setShowCrewModal] = useState(false);
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [crewName, setCrewName] = useState('');
  const [crewDistrictId, setCrewDistrictId] = useState('hyderabad');
  const [baseLocation, setBaseLocation] = useState('');
  const [members, setMembers] = useState('4');
  const [skillsText, setSkillsText] = useState('HT Restoration, 33kV Feeder, Tree Clearing');
  const [availability, setAvailability] = useState<CrewAvailability>('Available');
  const [crewFormError, setCrewFormError] = useState<string | null>(null);

  const [completingCrew, setCompletingCrew] = useState<Crew | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');

  useEffect(() => {
    if (dispatchTargetIncidentId && openIncidents.some((i) => i.id === dispatchTargetIncidentId)) {
      setSelectedIncidentId(dispatchTargetIncidentId);
      setDispatchTargetIncidentId(null);
    }
  }, [dispatchTargetIncidentId, openIncidents, setDispatchTargetIncidentId]);

  useEffect(() => {
    if ((!selectedIncidentId || !openIncidents.some((i) => i.id === selectedIncidentId)) && openIncidents[0]) {
      setSelectedIncidentId(openIncidents[0].id);
    } else if (openIncidents.length === 0) {
      setSelectedIncidentId('');
    }
  }, [openIncidents, selectedIncidentId]);

  useEffect(() => {
    if (!selectedIncidentId) {
      setRecommendations([]);
      return;
    }
    let cancelled = false;
    setLoadingRecs(true);
    getCrewRecommendations(selectedIncidentId)
      .then((recs) => {
        if (!cancelled) {
          setRecommendations(recs);
          if (recs[0]) {
            setExpandedScores((prev) => ({ [recs[0].crew.id]: true, ...prev }));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setRecommendations([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRecs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedIncidentId, crews, incidents, getCrewRecommendations]);

  const selectedIncident = openIncidents.find((i) => i.id === selectedIncidentId);
  const incidentMap = useMemo(() => new Map(incidents.map((i) => [i.id, i])), [incidents]);

  const routingBanner = useMemo(() => {
    if (recommendations.length === 0) return null;
    const roadCount = recommendations.filter((r) => r.routingMode === 'osrm_road').length;
    if (roadCount === recommendations.length) {
      return {
        mode: 'osrm_road' as const,
        text: 'OpenStreetMap OSRM Road Network active · Distances & ETAs include road geometry + 8m crew mobilization.',
      };
    }
    if (roadCount > 0) {
      return {
        mode: 'mixed' as const,
        text: `Road routing active for ${roadCount}/${recommendations.length} crews; straight-line detour fallback labeled where unavailable.`,
      };
    }
    return {
      mode: 'fallback' as const,
      text: 'Road routing service unreachable · All ETAs are labeled as straight-line detour estimates (not live navigation).',
    };
  }, [recommendations]);

  const fleetCounts = useMemo(() => {
    const counts = { Available: 0, Standby: 0, Deployed: 0, 'Off-Duty': 0 };
    for (const c of crews) {
      counts[c.availability] = (counts[c.availability] || 0) + 1;
    }
    return counts;
  }, [crews]);

  const filteredHistory = useMemo(() => {
    if (!historyFilter.trim()) return dispatchHistory;
    const q = historyFilter.toLowerCase();
    return dispatchHistory.filter(
      (h) =>
        h.incidentId.toLowerCase().includes(q) ||
        h.incidentTitle.toLowerCase().includes(q) ||
        h.crewName.toLowerCase().includes(q) ||
        h.crewId.toLowerCase().includes(q) ||
        h.notes.toLowerCase().includes(q)
    );
  }, [dispatchHistory, historyFilter]);

  const handleAssign = async (crewId: string, forceReassign = false) => {
    if (!selectedIncident) return;
    setDispatchError(null);
    setDispatchSuccess(null);
    setBusyActionKey(`assign:${crewId}`);
    try {
      await assignCrewToIncident(selectedIncident.id, crewId, { forceReassign });
      const crewName = crews.find((c) => c.id === crewId)?.name || crewId;
      setDispatchSuccess(
        forceReassign
          ? `Reassigned ${crewName} to ${selectedIncident.id} and synced Incident Management.`
          : `Dispatched ${crewName} to ${selectedIncident.id} and synced Incident Management.`
      );
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : 'Crew dispatch failed.');
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleInlineCrewPatch = async (
    crew: Crew,
    payload: Partial<{ availability: CrewAvailability; status: CrewStatus }>
  ) => {
    setDispatchError(null);
    setDispatchSuccess(null);
    setBusyActionKey(`patch:${crew.id}`);
    try {
      await updateCrew(crew.id, payload);
      setDispatchSuccess(
        crew.activeIncidentId
          ? `Updated ${crew.name} (${payload.status || payload.availability}) and synchronized ${crew.activeIncidentId}.`
          : `Updated ${crew.name} readiness.`
      );
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : 'Failed to update crew status.');
    } finally {
      setBusyActionKey(null);
    }
  };

  const openCompleteModal = (crew: Crew) => {
    setCompletingCrew(crew);
    setCompletionNotes(`Fault isolated, line tested, and supply restored by ${crew.name}.`);
  };

  const handleConfirmCompleteWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingCrew) return;
    setDispatchError(null);
    setDispatchSuccess(null);
    setBusyActionKey(`complete:${completingCrew.id}`);
    try {
      const incId = completingCrew.activeIncidentId;
      await completeCrewWork(completingCrew.id, completionNotes.trim());
      setDispatchSuccess(
        `Marked ${incId || 'assigned work'} Restored · ${completingCrew.name} returned to Available at depot.`
      );
      setCompletingCrew(null);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : 'Unable to mark work completed.');
    } finally {
      setBusyActionKey(null);
    }
  };

  const openCreateCrew = () => {
    setEditingCrew(null);
    setCrewName('');
    setCrewDistrictId(districts[0]?.id || 'hyderabad');
    setBaseLocation('');
    setMembers('4');
    setSkillsText('HT Restoration, 33kV Feeder, Tree Clearing');
    setAvailability('Available');
    setCrewFormError(null);
    setShowCrewModal(true);
  };

  const openEditCrew = (crew: Crew) => {
    setEditingCrew(crew);
    setCrewName(crew.name);
    setCrewDistrictId(crew.districtId);
    setBaseLocation(crew.baseLocation);
    setMembers(String(crew.members));
    setSkillsText(crew.skills.join(', '));
    setAvailability(crew.availability);
    setCrewFormError(null);
    setShowCrewModal(true);
  };

  const handleCrewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCrewFormError(null);
    if (crewName.trim().length < 3) {
      setCrewFormError('Crew name must be at least 3 characters.');
      return;
    }
    if (!baseLocation.trim()) {
      setCrewFormError('Base depot location is required.');
      return;
    }
    const skills = skillsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      if (editingCrew) {
        await updateCrew(editingCrew.id, {
          name: crewName.trim(),
          baseLocation: baseLocation.trim(),
          members: Number(members),
          skills,
          availability,
        });
      } else {
        await createCrew({
          name: crewName.trim(),
          districtId: crewDistrictId,
          baseLocation: baseLocation.trim(),
          members: Number(members),
          skills,
          availability,
        });
      }
      setShowCrewModal(false);
    } catch (err) {
      setCrewFormError(err instanceof Error ? err.message : 'Failed to save crew.');
    }
  };

  const handleDeleteCrew = async (id: string) => {
    setDispatchError(null);
    try {
      await deleteCrew(id);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : 'Unable to remove crew.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-4 ss-card flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
            Smart Maintenance Crew Dispatch &amp; Road-Aware Matcher
          </h2>
          <ProvenanceText source="Simulated Crew Coordinates (GPS not connected) · OSRM Road Routing / Fallback Estimates" />
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:border-r sm:border-[#52697A] sm:pr-4">
            <span className="flex items-center gap-1.5 text-[#8BE0C4] font-mono tabular-nums whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-[#5AC49E]" />
              {fleetCounts.Available} Avail
            </span>
            <span className="flex items-center gap-1.5 text-[#F2C16E] font-mono tabular-nums whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-[#E5A94C]" />
              {fleetCounts.Standby} Standby
            </span>
            <span className="flex items-center gap-1.5 text-[#70A9CF] font-mono tabular-nums whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-[#70A9CF]" />
              {fleetCounts.Deployed} Deployed
            </span>
            <span className="flex items-center gap-1.5 text-[#8FA3B3] font-mono tabular-nums whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-[#8FA3B3]" />
              {fleetCounts['Off-Duty']} Off-Duty
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActivePage('map')}
              className="px-3 py-2 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs text-[#E5EDF3] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
              <span>View Routes on GIS Map</span>
            </button>
            <button
              type="button"
              onClick={openCreateCrew}
              disabled={!canManageRoster}
              title={!canManageRoster ? 'Requires Administrator or Operations Manager role' : undefined}
              className="px-3.5 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-45 text-xs font-semibold text-[#17222B] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Add Crew Unit</span>
            </button>
          </div>
        </div>
      </div>

      {dispatchError && (
        <div
          role="alert"
          className="px-4 py-2.5 rounded-lg bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-xs text-[#F6C5C5] flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-[#E36D6D] shrink-0" aria-hidden="true" />
          <span>{dispatchError}</span>
        </div>
      )}
      {dispatchSuccess && (
        <div
          role="status"
          className="px-4 py-2.5 rounded-lg bg-[#5AC49E]/16 border border-[#5AC49E]/45 text-xs text-[#9EE8CD] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-[#5AC49E] shrink-0" aria-hidden="true" />
          <span>{dispatchSuccess}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-5 p-5 ss-card space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3]">
              1. Select Active Incident ({openIncidents.length})
            </h3>
            <button
              type="button"
              onClick={() => setActivePage('incidents')}
              className="text-[11px] text-[#70A9CF] hover:underline font-medium"
            >
              Open Incident Registry
            </button>
          </div>

          {openIncidents.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#8FA3B3] border border-dashed border-[#60788A] rounded-lg">
              All incidents are currently Restored or Closed.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {openIncidents.map((inc) => {
                const isSelected = inc.id === selectedIncidentId;
                return (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => setSelectedIncidentId(inc.id)}
                    className={`w-full text-left p-3.5 rounded-lg border transition-colors space-y-1.5 ${
                      isSelected
                        ? 'bg-[#70A9CF]/16 border-[#70A9CF]'
                        : 'bg-[#344655]/85 border-[#52697A] hover:border-[#70A9CF]/65'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[#70A9CF] font-semibold">{inc.id}</span>
                        <span className="text-[11px] text-[#8FA3B3]">· {inc.status}</span>
                      </div>
                      <SeverityIndicator severity={inc.severity} />
                    </div>
                    <div className="text-xs font-semibold text-[#E5EDF3]">{inc.title}</div>
                    <div className="text-[11px] text-[#8FA3B3]">
                      {inc.districtName} · {inc.locationName} · {inc.faultType}
                    </div>
                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <span className="text-[#8FA3B3] font-mono tabular-nums">
                        {inc.affectedConsumers.toLocaleString('en-IN')} consumers
                      </span>
                      <span className={inc.assignedCrewName ? 'text-[#8BE0C4] font-medium' : 'text-[#F2C16E] font-medium'}>
                        {inc.assignedCrewName ? `Crew: ${inc.assignedCrewName}` : 'Unassigned'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="xl:col-span-7 p-5 ss-card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <h3 className="font-display text-sm font-semibold text-[#E5EDF3] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
                <span>
                  2. Recommended Crews {selectedIncident ? `for ${selectedIncident.id}` : ''}
                </span>
              </h3>
              <p className="text-xs text-[#8FA3B3]">
                100-point weighted evaluation: Availability (35), Road/Estimated ETA (25), Technical Skills (20), District &amp; Severity Fit (10), Workload Balance (10).
              </p>
            </div>
          </div>

          {routingBanner && (
            <div
              className={`px-3 py-2 rounded-md border text-[11px] flex items-center gap-2 ${
                routingBanner.mode === 'osrm_road'
                  ? 'bg-[#70A9CF]/15 border-[#70A9CF]/45 text-[#B4D8EE]'
                  : 'bg-[#E5A94C]/16 border-[#E5A94C]/45 text-[#F2C16E]'
              }`}
            >
              <Route className="w-3.5 h-3.5 text-[#55B7B0] shrink-0" aria-hidden="true" />
              <span>{routingBanner.text}</span>
            </div>
          )}

          {!selectedIncident ? (
            <div className="p-8 text-center text-xs text-[#8FA3B3]">
              Select an open incident on the left to compute dispatch recommendations.
            </div>
          ) : loadingRecs ? (
            <div className="p-8 text-center text-xs text-[#8FA3B3]">
              Evaluating OSRM road routes &amp; skill alignment...
            </div>
          ) : (
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {recommendations.map((rec, index) => {
                const isAssignedHere = selectedIncident.assignedCrewId === rec.crew.id;
                const isExpanded = Boolean(expandedScores[rec.crew.id]);
                const isAssignBusy = busyActionKey === `assign:${rec.crew.id}`;

                return (
                  <div
                    key={rec.crew.id}
                    data-testid={`crew-rec-${rec.crew.id}`}
                    className={`p-4 rounded-lg border space-y-3 transition-colors ${
                      isAssignedHere
                        ? 'bg-[#5AC49E]/12 border-[#5AC49E]/50'
                        : !rec.isAssignable && !rec.canForceReassign
                          ? 'bg-[#344655]/70 border-[#52697A] opacity-80'
                          : 'bg-[#344655]/90 border-[#60788A] hover:border-[#70A9CF]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-mono text-xs text-[#8FA3B3]">#{index + 1}</span>
                          <span className="text-sm font-semibold text-[#E5EDF3]">{rec.crew.name}</span>
                          <span className="font-mono text-xs font-semibold text-[#55B7B0] tabular-nums">
                            {rec.matchScore}/100
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-xs text-[#AABBC9]">
                            <span
                              className={`w-2 h-2 rounded-full ${AVAILABILITY_DOT[rec.crew.availability]}`}
                            />
                            {rec.crew.availability} ({rec.crew.status})
                          </span>
                        </div>

                        <div className="text-xs text-[#AABBC9] flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[#E5EDF3] font-medium">
                            <Navigation className="w-3 h-3 text-[#55B7B0]" aria-hidden="true" />
                            {rec.distanceKm} km
                            {rec.routingMode === 'osrm_road' ? ' road' : ' est.'}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                            <Clock className="w-3 h-3 text-[#8FA3B3]" aria-hidden="true" />
                            <span
                              className={
                                rec.routingMode === 'osrm_road' ? 'text-[#8BE0C4]' : 'text-[#F2C16E]'
                              }
                            >
                              {rec.etaLabel}
                            </span>
                          </span>
                        </div>

                        <div className="text-[11px] text-[#8FA3B3]">
                          <span className="text-[#E5EDF3] font-medium">Location:</span>{' '}
                          {rec.crew.districtName} · {rec.crew.baseLocation} (
                          <span className="font-mono">
                            {rec.crew.lat.toFixed(3)}, {rec.crew.lng.toFixed(3)}
                          </span>{' '}
                          · Simulated)
                        </div>

                        <div className="text-[11px] text-[#8FA3B3]">
                          <span className="text-[#E5EDF3] font-medium">Skills:</span>{' '}
                          {rec.crew.skills.map((skill, idx) => {
                            const isMatched = rec.matchedSkills.includes(skill);
                            return (
                              <span key={skill}>
                                {idx > 0 ? ', ' : ''}
                                <span className={isMatched ? 'text-[#55B7B0] font-semibold' : 'text-[#8FA3B3]'}>
                                  {skill}
                                </span>
                              </span>
                            );
                          })}
                        </div>

                        <div className="text-[11px] text-[#8FA3B3]">
                          <span className="text-[#E5EDF3] font-medium">Reason:</span>{' '}
                          {rec.reasons.join(' · ')}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {isAssignedHere ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="px-3 py-1.5 rounded-md bg-[#344655] border border-[#5AC49E]/50 text-xs font-medium text-[#8BE0C4]">
                              Currently Assigned
                            </span>
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() => openCompleteModal(rec.crew)}
                              className="px-3 py-1.5 rounded-md bg-[#5AC49E] hover:bg-[#49B08A] text-xs text-[#17222B] flex items-center gap-1.5 disabled:opacity-45 transition-colors font-semibold whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Mark Completed</span>
                            </button>
                          </div>
                        ) : rec.isAssignable ? (
                          <button
                            type="button"
                            disabled={isReadOnly || isAssignBusy}
                            onClick={() => handleAssign(rec.crew.id, false)}
                            className="px-3.5 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-45 text-xs font-semibold text-[#17222B] whitespace-nowrap transition-colors"
                          >
                            {isAssignBusy
                              ? 'Dispatching...'
                              : selectedIncident.assignedCrewId
                                ? 'Reassign Here'
                                : 'Assign Crew'}
                          </button>
                        ) : rec.canForceReassign ? (
                          <button
                            type="button"
                            disabled={isReadOnly || isAssignBusy}
                            onClick={() => handleAssign(rec.crew.id, true)}
                            className="px-3.5 py-2 rounded-md bg-[#E5A94C] hover:bg-[#D19539] disabled:opacity-45 text-xs font-semibold text-[#17222B] whitespace-nowrap transition-colors"
                          >
                            {isAssignBusy ? 'Reassigning...' : 'Pull & Reassign'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="px-3 py-2 rounded-md bg-[#3B5061] border border-[#52697A] text-xs text-[#8FA3B3] cursor-not-allowed whitespace-nowrap"
                          >
                            Unavailable / Conflict
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedScores((prev) => ({
                              ...prev,
                              [rec.crew.id]: !prev[rec.crew.id],
                            }))
                          }
                          className="text-[11px] text-[#8FA3B3] hover:text-[#70A9CF] flex items-center gap-1"
                        >
                          <span>Score Breakdown</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {rec.conflictReason && !isAssignedHere && (
                      <div className="px-3 py-1.5 rounded bg-[#E5A94C]/16 border border-[#E5A94C]/45 text-[11px] text-[#F2C16E] flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-[#E5A94C] shrink-0 mt-0.5" />
                        <span>{rec.conflictReason}</span>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="pt-2.5 border-t border-[#52697A] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {rec.scoreBreakdown.map((factor) => {
                          const pct =
                            factor.maxPoints > 0
                              ? Math.round((factor.points / factor.maxPoints) * 100)
                              : 0;
                          return (
                            <div
                              key={factor.factor}
                              className="p-2 rounded bg-[#3B5061]/75 border border-[#52697A] space-y-1"
                            >
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-[#E5EDF3] font-medium">{factor.label}</span>
                                <span className="font-mono tabular-nums text-[#55B7B0] font-semibold">
                                  {factor.points}/{factor.maxPoints}
                                </span>
                              </div>
                              <div className="h-1 w-full rounded-full bg-[#283744] overflow-hidden">
                                <div
                                  className="h-full bg-[#70A9CF] rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-[#8FA3B3]">{factor.detail}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="p-5 ss-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3] flex items-center gap-2">
              <Truck className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
              <span>Maintenance Crew Units &amp; Live Status Sync ({crews.length})</span>
            </h3>
            <p className="text-[11px] text-[#8FA3B3]">
              Changing dispatch status or marking work completed automatically updates linked incidents and alert lifecycles.
            </p>
          </div>
          <span className="text-xs text-[#8FA3B3]">
            All crew coordinates are Simulated Demonstration Data
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#60788A] text-[#8FA3B3] bg-[#344655]">
                <th className="py-2 pr-3 pl-2 font-medium">Crew</th>
                <th className="py-2 px-3 font-medium">District &amp; Base</th>
                <th className="py-2 px-3 font-medium">Skills</th>
                <th className="py-2 px-3 font-medium">Availability</th>
                <th className="py-2 px-3 font-medium">Dispatch Status</th>
                <th className="py-2 px-3 font-medium">Active Incident</th>
                <th className="py-2 px-3 font-medium text-right">Jobs</th>
                <th className="py-2 pl-3 pr-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#52697A]/70">
              {crews.map((c) => {
                const linkedIncident = c.activeIncidentId
                  ? incidentMap.get(c.activeIncidentId)
                  : undefined;
                const isBusy = busyActionKey === `patch:${c.id}` || busyActionKey === `complete:${c.id}`;

                return (
                  <tr key={c.id} className="hover:bg-[#3B5061]/60 transition-colors">
                    <td className="py-2.5 pr-3 pl-2">
                      <div className="font-semibold text-[#E5EDF3]">{c.name}</div>
                      <div className="font-mono text-[11px] text-[#8FA3B3]">
                        {c.id} · {c.members} members
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[#AABBC9]">
                      <div>{c.districtName}</div>
                      <div className="text-[11px] text-[#8FA3B3]">{c.baseLocation}</div>
                      <div className="font-mono text-[10px] text-[#8FA3B3]">
                        {c.lat.toFixed(3)}, {c.lng.toFixed(3)} (Simulated)
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[#AABBC9] max-w-[220px]">{c.skills.join(', ')}</td>
                    <td className="py-2.5 px-3">
                      <select
                        aria-label={`Availability for ${c.name}`}
                        value={c.availability}
                        disabled={isReadOnly || isBusy}
                        onChange={(e) =>
                          handleInlineCrewPatch(c, {
                            availability: e.target.value as CrewAvailability,
                          })
                        }
                        className="px-2 py-1 rounded bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
                      >
                        {AVAILABILITIES.map((av) => (
                          <option key={av} value={av}>
                            {av}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3">
                      <select
                        aria-label={`Dispatch status for ${c.name}`}
                        value={c.status}
                        disabled={isReadOnly || isBusy}
                        onChange={(e) =>
                          handleInlineCrewPatch(c, { status: e.target.value as CrewStatus })
                        }
                        className="px-2 py-1 rounded bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
                      >
                        {CREW_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3">
                      {c.activeIncidentId ? (
                        <div>
                          <span className="font-mono text-[11px] text-[#70A9CF] font-medium">
                            {c.activeIncidentId}
                          </span>
                          {linkedIncident && (
                            <span className="block text-[10px] text-[#8FA3B3]">
                              {linkedIncident.status} · {linkedIncident.districtName}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[#8FA3B3]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#E5EDF3] font-medium">
                      {c.completedJobs}
                    </td>
                    <td className="py-2.5 pl-3 pr-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        {c.activeIncidentId && (
                          <button
                            type="button"
                            disabled={isReadOnly || isBusy}
                            onClick={() => openCompleteModal(c)}
                            className="px-2 py-1 rounded bg-[#5AC49E]/18 border border-[#5AC49E]/45 hover:bg-[#5AC49E]/28 text-[11px] text-[#8BE0C4] font-medium whitespace-nowrap disabled:opacity-40 transition-colors"
                          >
                            Mark Completed
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => openEditCrew(c)}
                          className="text-[#70A9CF] hover:text-[#9BC8E6] font-medium disabled:opacity-40"
                        >
                          Edit
                        </button>
                        {canManageRoster && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCrew(c.id)}
                            aria-label={`Remove ${c.name}`}
                            className="text-[#8FA3B3] hover:text-[#F29B9B]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="p-5 ss-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#E5EDF3] flex items-center gap-2">
              <History className="w-4 h-4 text-[#55B7B0]" aria-hidden="true" />
              <span>Assignment &amp; Dispatch Audit History ({filteredHistory.length})</span>
            </h3>
            <p className="text-[11px] text-[#8FA3B3]">
              Persistent SQLite trail of assignments, reassignments, status updates, availability changes, and completed restorations.
            </p>
          </div>
          <input
            type="text"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            placeholder="Filter by incident, crew, or note..."
            aria-label="Filter dispatch history"
            className="px-3 py-1.5 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF] w-64"
          />
        </div>

        {filteredHistory.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#8FA3B3] border border-dashed border-[#60788A] rounded-lg">
            No dispatch history records match your filter.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#60788A] text-[#8FA3B3] bg-[#344655]">
                  <th className="py-2 pr-3 pl-2 font-medium">Timestamp (IST)</th>
                  <th className="py-2 px-3 font-medium">Event</th>
                  <th className="py-2 px-3 font-medium">Incident</th>
                  <th className="py-2 px-3 font-medium">Crew</th>
                  <th className="py-2 px-3 font-medium">Route / ETA</th>
                  <th className="py-2 px-3 font-medium">Synced Status</th>
                  <th className="py-2 pl-3 pr-2 font-medium">Operator &amp; Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#52697A]/70">
                {filteredHistory.map((h) => {
                  const actionMeta = ACTION_LABEL[h.action] || {
                    label: h.action,
                    colorClass: 'text-[#AABBC9]',
                  };
                  return (
                    <tr key={h.id} className="hover:bg-[#3B5061]/60 transition-colors">
                      <td className="py-2.5 pr-3 pl-2 font-mono text-[11px] text-[#8FA3B3] whitespace-nowrap">
                        {formatIstDateTime(h.createdAt)}
                      </td>
                      <td className={`py-2.5 px-3 font-medium whitespace-nowrap ${actionMeta.colorClass}`}>
                        {actionMeta.label}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono text-[11px] text-[#70A9CF] font-medium">{h.incidentId}</div>
                        <div className="text-[11px] text-[#AABBC9] truncate max-w-[200px]">
                          {h.incidentTitle}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-[#E5EDF3] font-medium">{h.crewName}</div>
                        {h.previousCrewName && (
                          <div className="text-[10px] text-[#F2C16E]">
                            Prev: {h.previousCrewName}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-[#AABBC9] whitespace-nowrap">
                        {h.distanceKm !== null && h.etaMinutes !== null ? (
                          <span>
                            {h.distanceKm} km · ~{h.etaMinutes}m (
                            {h.routingMode === 'osrm_road' ? 'OSRM' : 'Est.'})
                          </span>
                        ) : (
                          <span className="text-[#8FA3B3]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-[#AABBC9] whitespace-nowrap">
                        <div>Crew: {h.crewStatus}</div>
                        <div className="text-[#8FA3B3]">Inc: {h.incidentStatus}</div>
                      </td>
                      <td className="py-2.5 pl-3 pr-2 text-[11px] text-[#AABBC9] max-w-xs">
                        <span className="text-[#E5EDF3] font-medium">{h.performedBy}: </span>
                        {h.notes}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {completingCrew && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Complete work for ${completingCrew.name}`}
          className="fixed inset-0 z-50 bg-[#1B2631]/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-[#3B5061] border border-[#60788A] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-[#E5EDF3] flex items-center gap-2">
                <Wrench className="w-4 h-4 text-[#5AC49E]" aria-hidden="true" />
                <span>Mark Restoration Completed</span>
              </h3>
              <button
                type="button"
                onClick={() => setCompletingCrew(null)}
                aria-label="Close completion modal"
                className="p-1 text-[#8FA3B3] hover:text-[#E5EDF3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-md bg-[#344655] border border-[#52697A] text-xs space-y-1">
              <div className="text-[#AABBC9]">
                Crew: <strong className="text-[#E5EDF3]">{completingCrew.name}</strong>
              </div>
              <div className="text-[#AABBC9]">
                Incident:{' '}
                <strong className="font-mono text-[#70A9CF]">
                  {completingCrew.activeIncidentId}
                </strong>
              </div>
              <div className="text-[11px] text-[#8FA3B3]">
                This will mark the incident as Restored, release the crew to Available at depot, resolve active incident alerts, and record completion in dispatch history.
              </div>
            </div>

            <form onSubmit={handleConfirmCompleteWork} className="space-y-3 text-xs">
              <div>
                <label htmlFor="completion-notes" className="block text-[#AABBC9] font-medium mb-1">
                  Restoration &amp; Verification Notes
                </label>
                <textarea
                  id="completion-notes"
                  rows={3}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCompletingCrew(null)}
                  className="px-4 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] hover:bg-[#43596A] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyActionKey === `complete:${completingCrew.id}`}
                  className="px-4 py-2 rounded bg-[#5AC49E] hover:bg-[#49B08A] disabled:opacity-50 text-[#17222B] font-semibold transition-colors"
                >
                  Confirm Work Completed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCrewModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingCrew ? `Edit ${editingCrew.name}` : 'Add New Crew Unit'}
          className="fixed inset-0 z-50 bg-[#1B2631]/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-[#3B5061] border border-[#60788A] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-[#E5EDF3]">
                {editingCrew ? `Edit ${editingCrew.name}` : 'Add Maintenance Crew Unit'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCrewModal(false)}
                aria-label="Close modal"
                className="p-1 text-[#8FA3B3] hover:text-[#E5EDF3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCrewSubmit} className="space-y-3 text-xs">
              <div>
                <label htmlFor="crew-name" className="block text-[#AABBC9] font-medium mb-1">
                  Crew Name *
                </label>
                <input
                  id="crew-name"
                  type="text"
                  required
                  value={crewName}
                  onChange={(e) => setCrewName(e.target.value)}
                  placeholder="e.g., Siddipet Rapid HT Unit"
                  className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>

              {!editingCrew && (
                <div>
                  <label htmlFor="crew-district" className="block text-[#AABBC9] font-medium mb-1">
                    Stationed District
                  </label>
                  <select
                    id="crew-district"
                    value={crewDistrictId}
                    onChange={(e) => setCrewDistrictId(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                  >
                    {districts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="crew-base" className="block text-[#AABBC9] font-medium mb-1">
                  Base Depot Location *
                </label>
                <input
                  id="crew-base"
                  type="text"
                  required
                  value={baseLocation}
                  onChange={(e) => setBaseLocation(e.target.value)}
                  placeholder="e.g., 132kV Sub-Station Yard"
                  className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="crew-members" className="block text-[#AABBC9] font-medium mb-1">
                    Members
                  </label>
                  <input
                    id="crew-members"
                    type="number"
                    min={1}
                    max={25}
                    value={members}
                    onChange={(e) => setMembers(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono focus:outline-none focus:border-[#70A9CF]"
                  />
                </div>
                <div>
                  <label htmlFor="crew-avail" className="block text-[#AABBC9] font-medium mb-1">
                    Availability
                  </label>
                  <select
                    id="crew-avail"
                    value={availability}
                    onChange={(e) => setAvailability(e.target.value as CrewAvailability)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                  >
                    {AVAILABILITIES.map((av) => (
                      <option key={av} value={av}>
                        {av}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="crew-skills" className="block text-[#AABBC9] font-medium mb-1">
                  Skills (comma-separated)
                </label>
                <input
                  id="crew-skills"
                  type="text"
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>

              {crewFormError && (
                <div role="alert" className="p-2 rounded bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-[#F6C5C5]">
                  {crewFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCrewModal(false)}
                  className="px-4 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] hover:bg-[#43596A] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-[#70A9CF] hover:bg-[#5E97BD] text-[#17222B] font-semibold transition-colors"
                >
                  {editingCrew ? 'Save Changes' : 'Add Crew'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
