import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, Layers, Search } from 'lucide-react';
import { RiskGaugeArc } from '../components/graphics/RiskGaugeArc';
import { useStormSense } from '../context/StormSenseContext';
import { RiskIndicator, SeverityIndicator, ProvenanceText } from '../components/ui/DataProvenanceTag';

const RISK_COLORS: Record<string, string> = {
  LOW: '#5AC49E',
  MODERATE: '#E5A94C',
  HIGH: '#E58854',
  CRITICAL: '#E36D6D',
};

export function TelanganaMapPage() {
  const {
    districts,
    weather,
    assessments,
    incidents,
    crews,
    activeRoutes,
    selectedDistrictId,
    setSelectedDistrictId,
    setActivePage,
  } = useStormSense();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupsRef = useRef<{
    zones: L.LayerGroup;
    stations: L.LayerGroup;
    routes: L.LayerGroup;
    incidents: L.LayerGroup;
    crews: L.LayerGroup;
  } | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [discomFilter, setDiscomFilter] = useState<'ALL' | 'TGSPDCL' | 'TGNPDCL'>('ALL');
  const [showZones, setShowZones] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showCrews, setShowCrews] = useState(true);

  const filteredDistricts = useMemo(() => {
    return districts.filter((d) => {
      if (discomFilter !== 'ALL' && d.discom !== discomFilter) return false;
      if (searchTerm.trim() && !d.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [districts, discomFilter, searchTerm]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [17.85, 79.1],
      zoom: 7,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    layerGroupsRef.current = {
      zones: L.layerGroup().addTo(map),
      stations: L.layerGroup().addTo(map),
      routes: L.layerGroup().addTo(map),
      incidents: L.layerGroup().addTo(map),
      crews: L.layerGroup().addTo(map),
    };

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const groups = layerGroupsRef.current;
    if (!groups) return;

    groups.zones.clearLayers();
    groups.stations.clearLayers();
    groups.routes.clearLayers();
    groups.incidents.clearLayers();
    groups.crews.clearLayers();

    const weatherMap = new Map(weather.observations.map((w) => [w.districtId, w]));
    const riskMap = new Map(assessments.map((a) => [a.districtId, a]));
    const visibleDistrictIds = new Set(filteredDistricts.map((d) => d.id));
    const incidentMap = new Map(incidents.map((i) => [i.id, i]));

    for (const d of filteredDistricts) {
      const risk = riskMap.get(d.id);
      const w = weatherMap.get(d.id);
      const color = RISK_COLORS[risk?.category ?? 'LOW'] || '#55B7B0';
      const isSelected = d.id === selectedDistrictId;

      if (showZones) {
        const poly = L.polygon(d.boundaryPolygon, {
          color: isSelected ? '#70A9CF' : color,
          weight: isSelected ? 2.6 : 1.5,
          dashArray: isSelected ? undefined : '4 3',
          fillColor: color,
          fillOpacity: isSelected ? 0.28 : 0.14,
        });
        poly.on('click', () => setSelectedDistrictId(d.id));
        poly.bindTooltip(
          `<strong>${d.name}</strong> (${d.discom})<br/>Approx. Risk Zone: ${risk?.score ?? '—'}/100 (${risk?.category ?? 'N/A'})`,
          { sticky: true }
        );
        poly.addTo(groups.zones);
      }

      if (showStations) {
        if (isSelected) {
          L.circleMarker([d.lat, d.lng], {
            radius: 14,
            color: '#70A9CF',
            weight: 1.6,
            fillColor: '#55B7B0',
            fillOpacity: 0.2,
          }).addTo(groups.stations);
        }
        const marker = L.circleMarker([d.lat, d.lng], {
          radius: isSelected ? 9 : 6.5,
          color: isSelected ? '#E5EDF3' : '#283744',
          weight: 2,
          fillColor: color,
          fillOpacity: 0.96,
        });
        marker.on('click', () => setSelectedDistrictId(d.id));
        marker.bindTooltip(
          `${d.name}: ${w ? `${w.temperatureC.toFixed(1)}°C, Rain ${w.rainMm}mm, Gust ${w.windGustsKmh}km/h` : 'Weather unavailable'} · Risk ${risk?.score ?? '—'}`
        );
        marker.addTo(groups.stations);
      }
    }

    const enRouteAnimators: Array<{
      marker: L.CircleMarker;
      coords: [number, number][];
    }> = [];

    if (showRoutes) {
      for (const route of activeRoutes) {
        const inc = incidentMap.get(route.incidentId);
        if (inc && !visibleDistrictIds.has(inc.districtId)) continue;
        const isRoad = route.routingMode === 'osrm_road';
        const line = L.polyline(route.coordinates, {
          color: isRoad ? '#70A9CF' : '#E5A94C',
          weight: isRoad ? 3.5 : 2.5,
          opacity: 0.92,
          dashArray: isRoad ? undefined : '6 6',
        });
        line.bindPopup(
          `<div style="font-size:12px;line-height:1.45"><strong>${route.crewName} &rarr; ${route.incidentId}</strong><br/>Status: ${route.crewStatus} (${route.incidentStatus})<br/>Distance: ${route.distanceKm} km (${isRoad ? 'OSRM Road Route' : 'Estimated Straight-Line Fallback'})<br/>${route.etaLabel}<br/><em>Origin coordinates: ${route.locationSource} (GPS not connected)</em></div>`
        );
        line.bindTooltip(
          `${route.crewName} &rarr; ${route.incidentId}: ${route.distanceKm} km · ${route.etaLabel}`,
          { sticky: true }
        );
        line.addTo(groups.routes);

        if (route.crewStatus === 'En Route' && route.coordinates.length >= 2) {
          const midIdx = Math.floor(route.coordinates.length / 2);
          const transitDot = L.circleMarker(route.coordinates[midIdx], {
            radius: 5.5,
            color: '#E5EDF3',
            weight: 1.6,
            fillColor: '#55B7B0',
            fillOpacity: 1,
          });
          transitDot.bindTooltip(
            `${route.crewName} (Simulated En Route indicator · ${route.etaLabel})`
          );
          transitDot.addTo(groups.routes);
          enRouteAnimators.push({ marker: transitDot, coords: route.coordinates });
        }
      }
    }

    if (showIncidents) {
      for (const inc of incidents) {
        if (inc.status === 'Closed' || inc.status === 'Restored') continue;
        if (!visibleDistrictIds.has(inc.districtId)) continue;
        const icon = L.divIcon({
          className: '',
          html: `<div class="incident-marker-wrap"><span class="incident-marker-pulse"></span><span class="incident-marker-core"></span></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const m = L.marker([inc.lat, inc.lng], { icon });
        m.on('click', () => setSelectedDistrictId(inc.districtId));
        m.bindPopup(
          `<div style="font-size:12px;line-height:1.45"><strong>${inc.id} · ${inc.severity}</strong><br/>${inc.title}<br/>Status: ${inc.status}<br/>Assigned: ${inc.assignedCrewName || 'Unassigned'}<br/>Source: ${inc.source}</div>`
        );
        m.addTo(groups.incidents);
      }
    }

    if (showCrews) {
      for (const crew of crews) {
        if (!visibleDistrictIds.has(crew.districtId)) continue;
        const bg =
          crew.availability === 'Available'
            ? '#5AC49E'
            : crew.availability === 'Standby'
              ? '#E5A94C'
              : crew.availability === 'Deployed'
                ? crew.status === 'En Route'
                  ? '#55B7B0'
                  : '#70A9CF'
                : '#8FA3B3';
        const ringColor = crew.availability === 'Deployed' ? '#E5EDF3' : '#283744';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:14px;height:14px;background:${bg};border:2px solid ${ringColor};border-radius:50%;box-shadow:0 0 0 2px ${bg}44;"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const m = L.marker([crew.lat, crew.lng], { icon });
        m.on('click', () => setSelectedDistrictId(crew.districtId));
        m.bindPopup(
          `<div style="font-size:12px;line-height:1.45"><strong>${crew.name}</strong><br/>Availability: ${crew.availability} · Status: ${crew.status}<br/>Base: ${crew.baseLocation}<br/>Skills: ${crew.skills.join(', ')}${crew.activeIncidentId ? `<br/>Active Task: <strong>${crew.activeIncidentId}</strong>` : ''}<br/><em>${crew.locationSource} (GPS not connected)</em></div>`
        );
        m.addTo(groups.crews);
      }
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId: number | null = null;
    if (!prefersReducedMotion && enRouteAnimators.length > 0) {
      const startTime = performance.now();
      const CYCLE_MS = 10_000;
      const tick = (now: number) => {
        const elapsed = Math.max(0, now - startTime);
        const progress = (elapsed % CYCLE_MS) / CYCLE_MS;
        for (const item of enRouteAnimators) {
          if (item.coords.length < 2) continue;
          const maxIdx = item.coords.length - 1;
          const exactIdx = Math.max(0, Math.min(maxIdx, progress * maxIdx));
          const idx0 = Math.floor(exactIdx);
          const idx1 = Math.min(maxIdx, idx0 + 1);
          const frac = exactIdx - idx0;
          const p0 = item.coords[idx0];
          const p1 = item.coords[idx1];
          if (!p0 || !p1) continue;
          item.marker.setLatLng([p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac]);
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    filteredDistricts,
    weather,
    assessments,
    incidents,
    crews,
    activeRoutes,
    selectedDistrictId,
    showZones,
    showStations,
    showRoutes,
    showIncidents,
    showCrews,
    setSelectedDistrictId,
  ]);

  const focusDistrict = (districtId: string) => {
    setSelectedDistrictId(districtId);
    const d = districts.find((x) => x.id === districtId);
    if (d && mapRef.current) {
      mapRef.current.flyTo([d.lat, d.lng], 9, { duration: 0.6 });
    }
  };

  const resetTelanganaView = () => {
    if (mapRef.current) {
      mapRef.current.flyTo([17.85, 79.1], 7, { duration: 0.6 });
    }
  };

  const selectedDistrict = districts.find((d) => d.id === selectedDistrictId) || districts[0];
  const selectedWeather = weather.observations.find((w) => w.districtId === selectedDistrict?.id);
  const selectedRisk = assessments.find((a) => a.districtId === selectedDistrict?.id);
  const districtIncidents = incidents.filter(
    (i) => i.districtId === selectedDistrict?.id && i.status !== 'Closed' && i.status !== 'Restored'
  );

  return (
    <div className="space-y-4">
      <div className="p-3.5 ss-card flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8FA3B3] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search Telangana district..."
              aria-label="Search Telangana district"
              className="pl-8 pr-3 py-1.5 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] placeholder:text-[#8FA3B3] focus:outline-none focus:border-[#70A9CF]"
            />
          </div>

          <select
            aria-label="Filter by DISCOM"
            value={discomFilter}
            onChange={(e) => setDiscomFilter(e.target.value as 'ALL' | 'TGSPDCL' | 'TGNPDCL')}
            className="px-2.5 py-1.5 rounded-md bg-[#344655] border border-[#60788A] text-xs text-[#E5EDF3] focus:outline-none focus:border-[#70A9CF]"
          >
            <option value="ALL">All DISCOMs (16)</option>
            <option value="TGSPDCL">TGSPDCL (South)</option>
            <option value="TGNPDCL">TGNPDCL (North)</option>
          </select>

          <button
            type="button"
            onClick={resetTelanganaView}
            className="px-2.5 py-1.5 rounded-md bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs text-[#E5EDF3] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Crosshair className="w-3.5 h-3.5 text-[#55B7B0]" aria-hidden="true" />
            <span>Reset State View</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-[#8FA3B3] flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Layers:</span>
          </span>
          <label className="flex items-center gap-1.5 text-[#E5EDF3] cursor-pointer">
            <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} className="accent-[#70A9CF]" />
            <span>Approx Zones</span>
          </label>
          <label className="flex items-center gap-1.5 text-[#E5EDF3] cursor-pointer">
            <input type="checkbox" checked={showStations} onChange={(e) => setShowStations(e.target.checked)} className="accent-[#70A9CF]" />
            <span>Weather &amp; Risk</span>
          </label>
          <label className="flex items-center gap-1.5 text-[#E5EDF3] cursor-pointer">
            <input type="checkbox" checked={showIncidents} onChange={(e) => setShowIncidents(e.target.checked)} className="accent-[#70A9CF]" />
            <span>Incidents</span>
          </label>
          <label className="flex items-center gap-1.5 text-[#E5EDF3] cursor-pointer">
            <input type="checkbox" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} className="accent-[#70A9CF]" />
            <span>Dispatch Routes</span>
          </label>
          <label className="flex items-center gap-1.5 text-[#E5EDF3] cursor-pointer">
            <input type="checkbox" checked={showCrews} onChange={(e) => setShowCrews(e.target.checked)} className="accent-[#70A9CF]" />
            <span>Simulated Crews</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 ss-card overflow-hidden relative">
          <div
            ref={mapContainerRef}
            data-testid="telangana-leaflet-map"
            className="w-full h-[550px] z-0"
          />
          <div className="p-3 border-t border-[#52697A] bg-[#344655] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#AABBC9]">
            <div className="flex flex-wrap items-center gap-3.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#5AC49E] inline-block" /> Low (0–30)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E5A94C] inline-block" /> Moderate (31–60)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E58854] inline-block" /> High (61–80)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E36D6D] inline-block" /> Critical (81–100)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#E36D6D] rotate-45 inline-block border border-[#E5EDF3]" /> Active Incident
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#5AC49E] inline-block border border-[#283744]" /> Avail Crew
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#70A9CF] inline-block border border-[#E5EDF3]" /> Deployed Crew
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-[#70A9CF] inline-block" /> Road Route
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-[#E5A94C] inline-block" /> Est. Route
              </span>
            </div>
            <span className="text-[#8FA3B3]">
              Base: OpenStreetMap · Crew Positions: Simulated (GPS not connected)
            </span>
          </div>
        </div>

        <aside className="xl:col-span-4 p-5 ss-card space-y-4 flex flex-col justify-between">
          {selectedDistrict ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-semibold text-[#E5EDF3]">
                    {selectedDistrict.name}
                  </h2>
                  <p className="text-xs text-[#8FA3B3]">
                    {selectedDistrict.circle} · {selectedDistrict.discom} · {selectedDistrict.substationCount} substations
                  </p>
                </div>
                {selectedRisk && (
                  <RiskIndicator category={selectedRisk.category} score={selectedRisk.score} />
                )}
              </div>

              {selectedRisk && (
                <div className="p-3 rounded-lg bg-[#344655]/90 border border-[#52697A] flex items-center justify-between gap-3">
                  <RiskGaugeArc
                    score={selectedRisk.score}
                    category={selectedRisk.category}
                    label="Zone Risk"
                    size={104}
                  />
                  <div className="grid grid-cols-1 gap-1.5 text-xs flex-1">
                    <div>
                      <span className="text-[#8FA3B3]">Weather: </span>
                      <span className="text-[#E5EDF3] font-medium">
                        {selectedWeather ? `${selectedWeather.temperatureC.toFixed(1)}°C · ${selectedWeather.weatherLabel}` : 'Unavailable'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8FA3B3]">Rain: </span>
                      <span className="font-mono tabular-nums text-[#55B7B0] font-medium">
                        {selectedWeather ? `${selectedWeather.rainMm.toFixed(1)} mm (${selectedWeather.precipitationProbability}%)` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8FA3B3]">Wind / Gust: </span>
                      <span className="font-mono tabular-nums text-[#F2C16E] font-medium">
                        {selectedWeather ? `${selectedWeather.windSpeedKmh.toFixed(0)} / ${selectedWeather.windGustsKmh.toFixed(0)} km/h` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <ProvenanceText source="Live Open-Meteo + Derived Risk" timestamp={selectedWeather?.fetchedAt} />

              {selectedRisk && (
                <div className="p-3 rounded bg-[#344655]/85 border border-[#52697A] space-y-1">
                  <div className="text-xs font-semibold text-[#55B7B0]">Recommended Preventive Measure</div>
                  <p className="text-xs text-[#AABBC9] leading-relaxed">{selectedRisk.recommendedAction}</p>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-semibold text-[#E5EDF3]">
                  Active District Incidents ({districtIncidents.length})
                </div>
                {districtIncidents.length === 0 ? (
                  <p className="text-xs text-[#8FA3B3]">No open incidents logged in {selectedDistrict.name}.</p>
                ) : (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {districtIncidents.map((inc) => (
                      <div key={inc.id} className="p-2.5 rounded bg-[#344655] border border-[#52697A] space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-[#70A9CF] font-medium">{inc.id}</span>
                          <SeverityIndicator severity={inc.severity} />
                        </div>
                        <div className="text-xs text-[#E5EDF3] font-medium">{inc.title}</div>
                        <div className="text-[11px] text-[#8FA3B3]">
                          {inc.status} · {inc.assignedCrewName || 'Unassigned'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-[#52697A] space-y-2">
                <div className="text-xs font-medium text-[#8FA3B3]">Quick Focus District</div>
                <div className="flex flex-wrap gap-1.5">
                  {filteredDistricts.slice(0, 8).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => focusDistrict(d.id)}
                      className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                        d.id === selectedDistrict.id
                          ? 'bg-[#70A9CF]/20 border-[#70A9CF] text-[#E5EDF3] font-semibold'
                          : 'bg-[#344655] border-[#60788A] text-[#AABBC9] hover:border-[#70A9CF] hover:text-[#E5EDF3]'
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-3 border-t border-[#52697A]">
            <button
              type="button"
              onClick={() => setActivePage('risk')}
              className="flex-1 py-2 px-3 rounded bg-[#3B5061] border border-[#60788A] hover:border-[#70A9CF] text-xs font-medium text-[#E5EDF3] whitespace-nowrap transition-colors"
            >
              Risk Breakdown
            </button>
            <button
              type="button"
              onClick={() => setActivePage('incidents')}
              className="flex-1 py-2 px-3 rounded bg-[#70A9CF] hover:bg-[#5E97BD] text-xs font-semibold text-[#17222B] whitespace-nowrap transition-colors"
            >
              Log Incident
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
