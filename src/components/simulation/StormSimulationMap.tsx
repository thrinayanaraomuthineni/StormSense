import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { SEVERITY_RADIUS_MULTIPLIER } from '../../lib/stormSimulation';
import type {
  RiskAssessment,
  RiskCategory,
  SimulationTimelineStep,
  StormSimulationParams,
  TelanganaDistrict,
} from '../../lib/types';

const RISK_COLORS: Record<RiskCategory, string> = {
  LOW: '#5AC49E',
  MODERATE: '#E5A94C',
  HIGH: '#E58854',
  CRITICAL: '#E36D6D',
};

interface StormSimulationMapProps {
  districts: TelanganaDistrict[];
  baselineAssessments: RiskAssessment[];
  timeline: SimulationTimelineStep[];
  activeStepIndex: number;
  params: StormSimulationParams;
  onSelectDistrict: (districtId: string) => void;
}

export function StormSimulationMap({
  districts,
  baselineAssessments,
  timeline,
  activeStepIndex,
  params,
  onSelectDistrict,
}: StormSimulationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    districts: L.LayerGroup;
    track: L.LayerGroup;
    stormCell: L.LayerGroup;
    markers: L.LayerGroup;
  } | null>(null);

  const currentStep = timeline[activeStepIndex] ?? timeline[0];
  const targetSnap = currentStep?.districtSnapshots[params.targetDistrictId];

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [17.88, 79.15],
      zoom: 7,
      zoomControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    layersRef.current = {
      districts: L.layerGroup().addTo(map),
      track: L.layerGroup().addTo(map),
      stormCell: L.layerGroup().addTo(map),
      markers: L.layerGroup().addTo(map),
    };

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const groups = layersRef.current;
    if (!groups || !currentStep) return;

    groups.districts.clearLayers();
    groups.track.clearLayers();
    groups.stormCell.clearLayers();
    groups.markers.clearLayers();

    const baselineMap = new Map(baselineAssessments.map((a) => [a.districtId, a]));

    for (const d of districts) {
      const snap = currentStep.districtSnapshots[d.id];
      const base = baselineMap.get(d.id);
      const score = snap?.score ?? base?.score ?? 0;
      const category = snap?.category ?? base?.category ?? 'LOW';
      const delta = snap?.delta ?? 0;
      const color = RISK_COLORS[category] ?? '#5AC49E';
      const isTarget = d.id === params.targetDistrictId;
      const isElevated = delta >= 3;

      const fillOpacity = isTarget
        ? 0.36
        : isElevated
          ? Math.min(0.3, 0.16 + score / 520)
          : 0.12;

      const poly = L.polygon(d.boundaryPolygon, {
        color: isTarget ? '#70A9CF' : isElevated ? color : '#8FA3B3',
        weight: isTarget ? 2.6 : isElevated ? 1.8 : 1.1,
        dashArray: isTarget ? undefined : isElevated ? undefined : '3 3',
        fillColor: color,
        fillOpacity,
      });

      poly.on('click', () => onSelectDistrict(d.id));
      poly.bindTooltip(
        `<div style="font-size:12px;line-height:1.4">
          <strong>${d.name}</strong> (${d.discom})${isTarget ? ' · <em>Target District</em>' : ''}<br/>
          Baseline: <strong>${base?.score ?? '—'}</strong> &rarr; Simulated (${currentStep.label}): <strong style="color:${color}">${score}/100 (${category})</strong><br/>
          Delta: <strong>${delta >= 0 ? `+${delta}` : delta} pts</strong> · Sim Rain ${snap?.rainfallMm ?? 0} mm/h · Gust ${snap?.windGustsKmh ?? 0} km/h
        </div>`,
        { sticky: true }
      );
      poly.addTo(groups.districts);

      if (isTarget) {
        L.circleMarker([d.lat, d.lng], {
          radius: 13,
          color: '#70A9CF',
          weight: 1.6,
          fillColor: '#55B7B0',
          fillOpacity: 0.22,
        }).addTo(groups.markers);
      }

      const centroidMarker = L.circleMarker([d.lat, d.lng], {
        radius: isTarget ? 7.5 : isElevated ? 6.5 : 5,
        color: '#283744',
        weight: 1.8,
        fillColor: color,
        fillOpacity: 0.96,
      });
      centroidMarker.on('click', () => onSelectDistrict(d.id));
      centroidMarker.bindTooltip(
        `${d.name}: ${base?.score ?? '—'} → ${score} (${delta >= 0 ? `+${delta}` : delta})`,
        { direction: 'top', offset: [0, -6] }
      );
      centroidMarker.addTo(groups.markers);
    }

    if (timeline.length >= 2) {
      const trackCoords: [number, number][] = timeline.map((s) => [
        s.stormCenterLat,
        s.stormCenterLng,
      ]);
      L.polyline(trackCoords, {
        color: '#70A9CF',
        weight: 2.3,
        opacity: 0.9,
        dashArray: '6 6',
      }).addTo(groups.track);

      L.circleMarker(trackCoords[0], {
        radius: 4,
        color: '#70A9CF',
        weight: 1.6,
        fillColor: '#E5EDF3',
        fillOpacity: 1,
      })
        .bindTooltip('Storm Track Entry (T+0.0h)')
        .addTo(groups.track);

      L.circleMarker(trackCoords[trackCoords.length - 1], {
        radius: 4,
        color: '#8FA3B3',
        weight: 1.5,
        fillColor: '#E5EDF3',
        fillOpacity: 1,
      })
        .bindTooltip('Storm Track Exit (T+6.0h)')
        .addTo(groups.track);
    }

    const effectiveRadiusKm =
      params.impactRadiusKm * (SEVERITY_RADIUS_MULTIPLIER[params.stormSeverity] ?? 1);
    const cellColor =
      params.stormSeverity === 'Extreme'
        ? '#E36D6D'
        : params.stormSeverity === 'Severe'
          ? '#E58854'
          : params.stormSeverity === 'Strong'
            ? '#E5A94C'
            : '#55B7B0';

    const center: [number, number] = [currentStep.stormCenterLat, currentStep.stormCenterLng];

    L.circle(center, {
      radius: effectiveRadiusKm * 1000 * (0.85 + 0.15 * currentStep.coreIntensityFactor),
      color: cellColor,
      weight: 1.5,
      dashArray: '5 5',
      fillColor: cellColor,
      fillOpacity: 0.12 + 0.08 * currentStep.coreIntensityFactor,
      interactive: false,
    }).addTo(groups.stormCell);

    L.circle(center, {
      radius: effectiveRadiusKm * 460 * (0.8 + 0.2 * currentStep.coreIntensityFactor),
      color: '#70A9CF',
      weight: 1.8,
      fillColor: cellColor,
      fillOpacity: 0.18 + 0.12 * currentStep.coreIntensityFactor,
      interactive: false,
    }).addTo(groups.stormCell);

    const vortexIcon = L.divIcon({
      className: '',
      html: `<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;position:relative;">
        <span style="position:absolute;inset:0;border-radius:9999px;border:2px solid ${cellColor};opacity:0.88;"></span>
        <span style="width:10px;height:10px;border-radius:9999px;background:#E5EDF3;border:2.5px solid ${cellColor};box-shadow:0 2px 8px rgba(15,24,32,0.55);"></span>
      </div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    L.marker(center, { icon: vortexIcon, interactive: true })
      .bindTooltip(
        `Simulated Storm Cell (${currentStep.label}) · ${currentStep.phaseLabel} · Intensity ${Math.round(currentStep.coreIntensityFactor * 100)}%`
      )
      .addTo(groups.stormCell);
  }, [districts, baselineAssessments, timeline, currentStep, params, onSelectDistrict]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const width = canvas.clientWidth || 720;
    const height = canvas.clientHeight || 430;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const windSpeed = targetSnap?.windSpeedKmh ?? params.windSpeedKmh;
    const rainMm = targetSnap?.rainfallMm ?? params.rainfallMm;
    const isThunder = Boolean(targetSnap?.isThunderstorm ?? params.isThunderstorm);
    const intensity = currentStep?.coreIntensityFactor ?? 0.7;

    const bearingRad = ((params.stormTrackBearingDeg - 90) * Math.PI) / 180;
    const vx = Math.cos(bearingRad);
    const vy = Math.sin(bearingRad);

    const windCount = Math.min(42, Math.max(10, Math.round(8 + windSpeed * 0.45)));
    const windParticles = Array.from({ length: windCount }, (_, idx) => ({
      x: ((idx * 97) % width) + Math.random() * 20,
      y: ((idx * 61) % height) + Math.random() * 20,
      len: 18 + (windSpeed / 100) * 32 + Math.random() * 14,
      speed: Math.max(0.8, (windSpeed / 18) * (0.85 + Math.random() * 0.4)),
      alpha: 0.3 + Math.min(0.36, (windSpeed / 140) * 0.34),
    }));

    const rainCount = rainMm <= 0.5 ? 0 : Math.min(54, Math.max(10, Math.round(rainMm * 1.1)));
    const rainDrops = Array.from({ length: rainCount }, (_, idx) => ({
      x: (idx * 53) % width,
      y: (idx * 41) % height,
      len: 8 + Math.min(16, rainMm * 0.25),
      speed: 2.4 + Math.min(4.8, rainMm * 0.08),
      alpha: 0.28 + Math.min(0.35, rainMm * 0.006),
    }));

    let frameTick = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      frameTick += 1;

      for (const p of windParticles) {
        const x2 = p.x - vx * p.len;
        const y2 = p.y - vy * p.len;
        const grad = ctx.createLinearGradient(x2, y2, p.x, p.y);
        grad.addColorStop(0, 'rgba(85, 183, 176, 0)');
        grad.addColorStop(1, `rgba(85, 183, 176, ${p.alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        if (!prefersReduced) {
          p.x += vx * p.speed;
          p.y += vy * p.speed;
          if (p.x < -60) p.x = width + 40;
          if (p.x > width + 60) p.x = -40;
          if (p.y < -60) p.y = height + 40;
          if (p.y > height + 60) p.y = -40;
        }
      }

      for (const r of rainDrops) {
        ctx.strokeStyle = `rgba(112, 169, 207, ${r.alpha})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x - 2.5, r.y + r.len);
        ctx.stroke();

        if (!prefersReduced) {
          r.x -= 0.7;
          r.y += r.speed;
          if (r.y > height + 20) {
            r.y = -15;
            r.x = Math.random() * width;
          }
          if (r.x < -10) r.x = width + 10;
        }
      }

      if (!prefersReduced && isThunder && intensity >= 0.65 && frameTick % 95 < 5) {
        const cx = width * 0.5 + ((frameTick % 7) - 3) * 18;
        const cy = height * 0.45 + ((frameTick % 5) - 2) * 14;
        ctx.strokeStyle = 'rgba(242, 193, 110, 0.85)';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 16);
        ctx.lineTo(cx - 6, cy - 2);
        ctx.lineTo(cx + 4, cy + 1);
        ctx.lineTo(cx - 4, cy + 18);
        ctx.stroke();
      }
    };

    draw();
    if (prefersReduced) return;

    let rafId = 0;
    const tick = () => {
      draw();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [params.stormTrackBearingDeg, params.windSpeedKmh, params.rainfallMm, params.isThunderstorm, targetSnap, currentStep]);

  return (
    <div className="relative rounded-lg border border-[#60788A] bg-[#344655] overflow-hidden shadow-md">
      <div
        ref={mapContainerRef}
        className="w-full h-[380px] sm:h-[440px] lg:h-[470px] z-0"
        aria-label="Interactive Telangana Storm Simulation Map"
      />

      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 w-full h-full z-[400]"
      />

      {/* Top-Left Scenario Telemetry Overlay */}
      <div className="pointer-events-none absolute top-3 left-14 right-3 sm:right-auto z-[410] flex flex-col gap-1.5 max-w-md">
        <div className="bg-[#344655]/92 backdrop-blur-sm border border-[#60788A] rounded-md px-3 py-2 shadow-lg">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[#F2C16E]">
            <span>SIMULATED SCENARIO OVERLAY</span>
            <span className="text-[#60788A]">·</span>
            <span className="text-[#70A9CF] font-semibold tabular-nums">
              {currentStep?.label ?? 'T+3.0h'}
            </span>
          </div>
          <div className="text-xs font-semibold text-[#E5EDF3] mt-0.5 truncate">
            {currentStep?.phaseLabel ?? 'Peak Landfall Over Target District'}
          </div>
          <div className="text-[11px] text-[#AABBC9] mt-0.5 font-mono tabular-nums">
            Not live weather · Click any Telangana district zone to retarget storm landfall
          </div>
        </div>
      </div>

      {/* Bottom Risk Scale & Track Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[410] bg-[#344655]/92 backdrop-blur-sm border border-[#60788A] rounded-md px-3 py-2 text-[11px] text-[#AABBC9] flex flex-wrap items-center gap-x-3 gap-y-1.5 shadow-lg">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#5AC49E] inline-block" />
          <span>Low 0–30</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#E5A94C] inline-block" />
          <span>Moderate 31–60</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#E58854] inline-block" />
          <span>High 61–80</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#E36D6D] inline-block" />
          <span>Critical 81–100</span>
        </span>
        <span className="flex items-center gap-1.5 text-[#70A9CF] font-medium">
          <span className="w-4 border-t-2 border-dashed border-[#70A9CF] inline-block" />
          <span>Storm Track</span>
        </span>
      </div>
    </div>
  );
}
