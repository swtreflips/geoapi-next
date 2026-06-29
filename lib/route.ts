import { fetchRoute } from './here'
import { normalize } from './geocode'
import { resolveLocation } from './resolve'
import { getCachedRoute, putCachedRoute, type CachedRoute } from './routeCache'
import type { GeocodeResponse, RouteResponse } from './types'

export type ResolveRouteResult =
  | { ok: true; route: RouteResponse }
  | { ok: false; reason: 'not_found' | 'no_route'; a_found: boolean; b_found: boolean }

// Reconstruct a geocode leg from coords stored on a cached route (no extra DB read).
function legFromCoords(query: string, latitude: number, longitude: number): GeocodeResponse {
  return { query, latitude, longitude, display_name: null, provider: 'cache', cached: true }
}

function toResponse(row: CachedRoute, cached: boolean, legs?: {
  origin: GeocodeResponse
  destination: GeocodeResponse
}): RouteResponse {
  return {
    origin: row.origin_query,
    destination: row.destination_query,
    distance_m: row.distance_m,
    duration_s: row.duration_s,
    base_duration_s: row.base_duration_s,
    typical_duration_s: row.typical_duration_s,
    polyline: row.polyline,
    transport_mode: row.transport_mode,
    provider: row.provider,
    cached,
    origin_result: legs?.origin ?? legFromCoords(row.origin_query, row.origin_lat, row.origin_lon),
    destination_result:
      legs?.destination ?? legFromCoords(row.destination_query, row.dest_lat, row.dest_lon),
  }
}

/**
 * Resolve a truck (drayage) route between two cities, cache-first:
 *  1. Check drayage_routes for the (origin, destination) pair — return it if present
 *     (no geocode, no HERE call).
 *  2. On miss, geocode both cities (cache + Nominatim via resolveLocation).
 *  3. Call HERE for the route, cache it, and return it.
 * Directional: A→B and B→A are distinct cache entries.
 */
export async function resolveRoute(rawA: string, rawB: string): Promise<ResolveRouteResult> {
  const aKey = normalize(rawA)
  const bKey = normalize(rawB)

  const cachedRoute = await getCachedRoute(aKey, bKey)
  if (cachedRoute) return { ok: true, route: toResponse(cachedRoute, true) }

  const [aLoc, bLoc] = await Promise.all([resolveLocation(rawA), resolveLocation(rawB)])
  if (!aLoc || !bLoc) {
    return { ok: false, reason: 'not_found', a_found: !!aLoc, b_found: !!bLoc }
  }

  const result = await fetchRoute(
    { latitude: aLoc.latitude, longitude: aLoc.longitude },
    { latitude: bLoc.latitude, longitude: bLoc.longitude },
  )
  if (!result) return { ok: false, reason: 'no_route', a_found: true, b_found: true }

  const row: CachedRoute = {
    origin_query: aKey,
    destination_query: bKey,
    origin_lat: aLoc.latitude,
    origin_lon: aLoc.longitude,
    dest_lat: bLoc.latitude,
    dest_lon: bLoc.longitude,
    distance_m: result.distance_m,
    duration_s: result.duration_s,
    base_duration_s: result.base_duration_s,
    typical_duration_s: result.typical_duration_s,
    polyline: result.polyline,
    transport_mode: 'truck',
    provider: 'here',
  }

  await putCachedRoute(row)

  return { ok: true, route: toResponse(row, false, { origin: aLoc, destination: bLoc }) }
}
