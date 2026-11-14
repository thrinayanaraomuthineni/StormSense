import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useStormSense } from '../context/StormSenseContext';
import type {
  FaultType,
  Incident,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
} from '../lib/types';
import {
  SeverityIndicator,
  formatIstDateTime,
} from '../components/ui/DataProvenanceTag';

const STATUS_FLOW: IncidentStatus[] = [
  'Detected',
  'Reported',
  'Assigned',
  'Crew En Route',
  'Under Maintenance',
  'Restored',
  'Closed',
];

const SEVERITIES: IncidentSeverity[] = ['Low', 'Medium', 'High', 'Critical'];
const FAULT_TYPES: FaultType[] = [
  'Feeder Trip',
  'Transformer Fault',
  'HT Line Snap',
  'Substation Breaker',
  'Vegetation Contact',
  'Lightning Surge',
];
const SOURCES: IncidentSource[] = [
  'Manually Entered Data',
  'Simulated Demonstration Data',
  'Externally Verified Feed',
];

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

export function IncidentsPage() {
  const {
    incidents,
    districts,
    currentUser,
    createIncident,
    updateIncident,
    deleteIncident,
    openDispatchForIncident,
  } = useStormSense();

  const isReadOnly = currentUser?.role === 'Read-only Evaluator';
  const canDelete =
    currentUser?.role === 'Administrator' || currentUser?.role === 'Operations Manager';

  const [search, setSearch] = useState('');
  const [districtFilter, setDistrictFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'time' | 'severity'>('time');

  const [showModal, setShowModal] = useState(false);
  const [editingIncident, setEditingIncident] = useState<Incident | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [districtId, setDistrictId] = useState('hyderabad');
  const [locationName, setLocationName] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('High');
  const [faultType, setFaultType] = useState<FaultType>('Feeder Trip');
  const [source, setSource] = useState<IncidentSource>('Manually Entered Data');
  const [affectedConsumers, setAffectedConsumers] = useState('1200');
  const [description, setDescription] = useState('');
  const [restorationNotes, setRestorationNotes] = useState('');

  const openCreateModal = () => {
    setEditingIncident(null);
    setTitle('');
    setDistrictId(districts[0]?.id || 'hyderabad');
    setLocationName('');
    setSeverity('High');
    setFaultType('Feeder Trip');
    setSource('Manually Entered Data');
    setAffectedConsumers('1200');
    setDescription('');
    setRestorationNotes('');
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (inc: Incident) => {
    setEditingIncident(inc);
    setTitle(inc.title);
    setDistrictId(inc.districtId);
    setLocationName(inc.locationName);
    setSeverity(inc.severity);
    setFaultType(inc.faultType);
    setSource(inc.source);
    setAffectedConsumers(String(inc.affectedConsumers));
    setDescription(inc.description);
    setRestorationNotes(inc.restorationNotes);
    setFormError(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (title.trim().length < 4) {
      setFormError('Incident title must be at least 4 characters.');
      return;
    }
    if (!locationName.trim()) {
      setFormError('Location / feeder identifier is required.');
      return;
    }
    const consumersNum = Number(affectedConsumers);
    if (!Number.isFinite(consumersNum) || consumersNum < 0) {
      setFormError('Estimated affected consumers must be 0 or greater.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingIncident) {
        await updateIncident(editingIncident.id, {
          title: title.trim(),
          locationName: locationName.trim(),
          severity,
          faultType,
          affectedConsumers: consumersNum,
          description: description.trim(),
          restorationNotes: restorationNotes.trim(),
        });
      } else {
        await createIncident({
          title: title.trim(),
          districtId,
          locationName: locationName.trim(),
          severity,
          faultType,
          source,
          affectedConsumers: consumersNum,
          description: description.trim(),
          restorationNotes: restorationNotes.trim(),
        });
      }
      setShowModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save incident.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, nextStatus: IncidentStatus) => {
    setActionError(null);
    try {
      await updateIncident(id, { status: nextStatus });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteIncident(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const filteredIncidents = useMemo(() => {
    return [...incidents]
      .filter((i) => {
        if (districtFilter !== 'ALL' && i.districtId !== districtFilter) return false;
        if (severityFilter !== 'ALL' && i.severity !== severityFilter) return false;
        if (statusFilter !== 'ALL' && i.status !== statusFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            i.id.toLowerCase().includes(q) ||
            i.title.toLowerCase().includes(q) ||
            i.locationName.toLowerCase().includes(q) ||
            i.districtName.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'severity') {
          const diff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
          if (diff !== 0) return diff;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [incidents, districtFilter, severityFilter, statusFilter, search, sortBy]);

  return (
    <div className="space-y-5">
      <div className="p-4 ss-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-[#E5EDF3]">
            Outage &amp; Feeder Incident Registry ({filteredIncidents.length})
          </h2>
          <p className="text-xs text-[#8FA3B3]">
            Persistently stored in SQLite · Distinguishes Simulated Demonstration Data, Manually Entered Data, and Externally Verified Feeds.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          disabled={isReadOnly}
          title={isReadOnly ? 'Read-only Evaluator cannot create incidents' : undefined}
          className="px-3.5 py-2 rounded-md bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-45 text-xs font-semibold text-[#17222B] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Report New Incident</span>
        </button>
      </div>

      {actionError && (
        <div role="alert" className="px-4 py-2.5 rounded-lg bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-xs text-[#F6C5C5]">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#8FA3B3] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, title, feeder..."
            aria-label="Search incidents"
            className="w-full pl-8 pr-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
          />
        </div>

        <select
          aria-label="Filter incidents by district"
          value={districtFilter}
          onChange={(e) => setDistrictFilter(e.target.value)}
          className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
        >
          <option value="ALL">All Districts</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter incidents by severity"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
        >
          <option value="ALL">All Severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter incidents by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
        >
          <option value="ALL">All Statuses</option>
          {STATUS_FLOW.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>

        <select
          aria-label="Sort incidents"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'time' | 'severity')}
          className="px-3 py-2 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
        >
          <option value="time">Sort: Latest First</option>
          <option value="severity">Sort: Highest Severity</option>
        </select>
      </div>

      {filteredIncidents.length === 0 ? (
        <div className="p-10 ss-card text-center space-y-3">
          <p className="text-sm text-[#AABBC9]">No incidents match your active filters.</p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setDistrictFilter('ALL');
              setSeverityFilter('ALL');
              setStatusFilter('ALL');
            }}
            className="px-3 py-1.5 rounded bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs text-[#E5EDF3] transition-colors"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredIncidents.map((inc) => (
            <article
              key={inc.id}
              className="p-4 ss-card hover:border-[#70A9CF]/70 transition-colors space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-[#70A9CF]">{inc.id}</span>
                    <SeverityIndicator severity={inc.severity} />
                    <span className="text-[#AABBC9]">{inc.faultType}</span>
                    <span aria-hidden="true" className="text-[#60788A]">·</span>
                    <span className="text-[#8FA3B3]">{inc.source}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-[#E5EDF3]">{inc.title}</h3>
                  <div className="text-xs text-[#8FA3B3]">
                    {inc.districtName} · {inc.locationName} ({inc.lat.toFixed(3)}, {inc.lng.toFixed(3)}) ·{' '}
                    <span className="font-mono tabular-nums text-[#E5EDF3] font-medium">
                      {inc.affectedConsumers.toLocaleString('en-IN')}
                    </span>{' '}
                    consumers · Logged {formatIstDateTime(inc.createdAt)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    aria-label={`Change status for ${inc.id}`}
                    value={inc.status}
                    disabled={isReadOnly}
                    onChange={(e) => handleStatusChange(inc.id, e.target.value as IncidentStatus)}
                    className="px-2.5 py-1.5 rounded bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] disabled:opacity-50 focus:outline-none focus:border-[#70A9CF]"
                  >
                    {STATUS_FLOW.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => openDispatchForIncident(inc.id)}
                    className="px-2.5 py-1.5 rounded bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs text-[#70A9CF] font-medium whitespace-nowrap transition-colors"
                  >
                    {inc.assignedCrewName ? `Crew: ${inc.assignedCrewName}` : 'Assign Crew'}
                  </button>

                  <button
                    type="button"
                    onClick={() => openEditModal(inc)}
                    disabled={isReadOnly}
                    aria-label={`Edit incident ${inc.id}`}
                    className="p-1.5 rounded bg-[#344655] border border-[#60788A] hover:border-[#70A9CF] text-[#AABBC9] hover:text-[#E5EDF3] disabled:opacity-40 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(inc.id)}
                      aria-label={`Delete incident ${inc.id}`}
                      className="p-1.5 rounded bg-[#344655] border border-[#60788A] hover:border-[#E36D6D]/70 hover:bg-[#E36D6D]/18 text-[#AABBC9] hover:text-[#F29B9B] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs text-[#AABBC9] leading-relaxed">{inc.description}</div>
              {inc.restorationNotes && (
                <div className="text-xs text-[#8FA3B3] pt-2 border-t border-[#52697A]">
                  <span className="text-[#E5EDF3] font-medium">Restoration Notes:</span> {inc.restorationNotes}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingIncident ? `Edit Incident ${editingIncident.id}` : 'Report New Incident'}
          className="fixed inset-0 z-50 bg-[#1B2631]/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-xl bg-[#3B5061] border border-[#60788A] p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-[#E5EDF3]">
                {editingIncident ? `Edit ${editingIncident.id}` : 'Report New Outage Incident'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close modal"
                className="p-1 text-[#8FA3B3] hover:text-[#E5EDF3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="inc-title" className="block text-[#AABBC9] font-medium mb-1">
                  Incident Title *
                </label>
                <input
                  id="inc-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., 33kV Banjara Hills Feeder Earth Fault"
                  className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="inc-district" className="block text-[#AABBC9] font-medium mb-1">
                    District *
                  </label>
                  <select
                    id="inc-district"
                    value={districtId}
                    disabled={Boolean(editingIncident)}
                    onChange={(e) => setDistrictId(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] disabled:opacity-60 focus:outline-none focus:border-[#70A9CF]"
                  >
                    {districts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="inc-location" className="block text-[#AABBC9] font-medium mb-1">
                    Substation / Feeder Location *
                  </label>
                  <input
                    id="inc-location"
                    type="text"
                    required
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="e.g., Madhapur 33/11kV SS"
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="inc-severity" className="block text-[#AABBC9] font-medium mb-1">
                    Severity
                  </label>
                  <select
                    id="inc-severity"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="inc-fault" className="block text-[#AABBC9] font-medium mb-1">
                    Fault Type
                  </label>
                  <select
                    id="inc-fault"
                    value={faultType}
                    onChange={(e) => setFaultType(e.target.value as FaultType)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                  >
                    {FAULT_TYPES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="inc-consumers" className="block text-[#AABBC9] font-medium mb-1">
                    Affected Consumers
                  </label>
                  <input
                    id="inc-consumers"
                    type="number"
                    min={0}
                    value={affectedConsumers}
                    onChange={(e) => setAffectedConsumers(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] font-mono focus:outline-none focus:border-[#70A9CF]"
                  />
                </div>
              </div>

              {!editingIncident && (
                <div>
                  <label htmlFor="inc-source" className="block text-[#AABBC9] font-medium mb-1">
                    Record Classification
                  </label>
                  <select
                    id="inc-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value as IncidentSource)}
                    className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
                  >
                    {SOURCES.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="inc-desc" className="block text-[#AABBC9] font-medium mb-1">
                  Description
                </label>
                <textarea
                  id="inc-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe relay trip, conductor damage, or weather cause..."
                  className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>

              <div>
                <label htmlFor="inc-notes" className="block text-[#AABBC9] font-medium mb-1">
                  Restoration Notes
                </label>
                <textarea
                  id="inc-notes"
                  rows={2}
                  value={restorationNotes}
                  onChange={(e) => setRestorationNotes(e.target.value)}
                  placeholder="Isolation switching or crew instructions..."
                  className="w-full px-3 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
                />
              </div>

              {formError && (
                <div role="alert" className="p-2.5 rounded bg-[#E36D6D]/16 border border-[#E36D6D]/45 text-[#F6C5C5]">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded bg-[#344655] border border-[#60788A] text-[#E5EDF3] hover:bg-[#43596A] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded bg-[#70A9CF] hover:bg-[#5E97BD] text-[#17222B] font-semibold transition-colors"
                >
                  {submitting ? 'Saving...' : editingIncident ? 'Save Changes' : 'Create Incident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
