import {
  buildFallbackRouteEstimate,
  DEFAULT_MOBILIZATION_MINUTES,
  haversineDistanceKm,
} from '../src/lib/crewDispatch';
import type { ActiveDispatchRoute, Crew, Incident, RouteEstimate } from '../src/lib/types';

interface CachedRoute {
  estimate: RouteEstimate;
  expiresAt: number;
}

const ROUTE_CACHE_TTL_MS = 30 * 60_000;
const OSRM_TIMEOUT_MS = 3200;
const routeCache = new Map<string, CachedRoute>();

function makeCacheKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  return `${fromLat.toFixed(4)},${fromLng.toFixed(4)}->${toLat.toFixed(4)},${toLng.toFixed(4)}`;
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance: number; // meters
    duration: number; // seconds
    geometry?: {
      type: 'LineString';
      coordinates: [number, number][]; // [lng, lat]
    };
  }>;
}

export async function fetchRoadRouteEstimate(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  mobilizationMinutes = DEFAULT_MOBILIZATION_MINUTES
): Promise<RouteEstimate> {
  const straightLineKm = haversineDistanceKm(fromLat, fromLng, toLat, toLng);
  if (straightLineKm < 0.05) {
    return {
      distanceKm: 0,
      straightLineKm: 0,
      travelMinutes: 1,
      estimatedEtaMinutes: 1 + mobilizationMinutes,
      routingMode: 'osrm_road',
      etaLabel: `Road route (~${1 + mobilizationMinutes} min incl. ${mobilizationMinutes}m prep)`,
      routeCoordinates: [
        [fromLat, fromLng],
        [toLat, toLng],
      ],
    };
  }

  const key = makeCacheKey(fromLat, fromLng, toLat, toLng);
  const cached = routeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.estimate;
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'StormSense-Telangana-Grid/1.0',
      },
    });
    if (!res.ok) {
      throw new Error(`OSRM HTTP ${res.status}`);
    }
    const payload = (await res.json()) as OsrmResponse;
    const route = payload.routes?.[0];
    if (payload.code !== 'Ok' || !route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
      throw new Error(`OSRM route unavailable (${payload.code || 'no_route'})`);
    }

    const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
    const travelMinutes = Math.max(1, Math.round(route.duration / 60));
    const estimatedEtaMinutes = travelMinutes + mobilizationMinutes;
    const coordinates: [number, number][] =
      route.geometry?.coordinates && route.geometry.coordinates.length >= 2
        ? route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        : [
            [fromLat, fromLng],
            [toLat, toLng],
          ];

    const estimate: RouteEstimate = {
      distanceKm,
      straightLineKm,
      travelMinutes,
      estimatedEtaMinutes,
      routingMode: 'osrm_road',
      etaLabel: `OSRM Road ETA (~${estimatedEtaMinutes} min incl. ${mobilizationMinutes}m prep)`,
      routeCoordinates: coordinates,
    };

    routeCache.set(key, {
      estimate,
      expiresAt: Date.now() + ROUTE_CACHE_TTL_MS,
    });
    return estimate;
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Road routing timed out; using straight-line detour estimate'
          : `Road routing unavailable (${err.message}); using straight-line detour estimate`
        : 'Road routing unavailable; using straight-line detour estimate';

    const fallback = buildFallbackRouteEstimate(
      fromLat,
      fromLng,
      toLat,
      toLng,
      reason,
      mobilizationMinutes
    );

    // Cache short fallback for 2 minutes so repeated UI renders stay snappy if offline
    routeCache.set(key, {
      estimate: fallback,
      expiresAt: Date.now() + 2 * 60_000,
    });
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export async function computeDispatchRoutesForCrews(
  crews: Crew[],
  targetIncident: Incident
): Promise<Map<string, RouteEstimate>> {
  const entries = await Promise.all(
    crews.map(async (crew) => {
      const mobMinutes = crew.activeIncidentId === targetIncident.id && crew.status === 'En Route' ? 0 : DEFAULT_MOBILIZATION_MINUTES;
      const estimate = await fetchRoadRouteEstimate(
        crew.lat,
        crew.lng,
        targetIncident.lat,
        targetIncident.lng,
        mobMinutes
      );
      return [crew.id, estimate] as const;
    })
  );
  return new Map(entries);
}

export async function computeActiveDispatchRoutes(
  incidents: Incident[],
  crews: Crew[]
): Promise<ActiveDispatchRoute[]> {
  const crewMap = new Map(crews.map((c) => [c.id, c]));
  const activeAssigned = incidents.filter(
    (inc) =>
      inc.status !== 'Restored' &&
      inc.status !== 'Closed' &&
      Boolean(inc.assignedCrewId) &&
      crewMap.has(inc.assignedCrewId!)
  );

  const routes = await Promise.all(
    activeAssigned.map(async (inc) => {
      const crew = crewMap.get(inc.assignedCrewId!)!;
      const mobMinutes = crew.status === 'En Route' || crew.status === 'On Site - Restoring' ? 0 : DEFAULT_MOBILIZATION_MINUTES;
      const est = await fetchRoadRouteEstimate(crew.lat, crew.lng, inc.lat, inc.lng, mobMinutes);
      return {
        incidentId: inc.id,
        incidentTitle: inc.title,
        incidentSeverity: inc.severity,
        incidentStatus: inc.status,
        crewId: crew.id,
        crewName: crew.name,
        crewStatus: crew.status,
        fromLat: crew.lat,
        fromLng: crew.lng,
        toLat: inc.lat,
        toLng: inc.lng,
        distanceKm: est.distanceKm,
        straightLineKm: est.straightLineKm,
        etaMinutes: est.estimatedEtaMinutes,
        routingMode: est.routingMode,
        etaLabel: est.etaLabel,
        fallbackReason: est.fallbackReason,
        coordinates: est.routeCoordinates,
        locationSource: crew.locationSource,
      } satisfies ActiveDispatchRoute;
    })
  );

  return routes;
}
