import { getCached, putCached } from './cache'
import { normalize, searchNominatim } from './geocode'
import type { GeocodeResponse } from './types'

/**
 * Ensure a location is geocoded: return the cached hit, else fetch from Nominatim and
 * cache it. Returns null if Nominatim has no result; throws UpstreamError on upstream
 * failure. Shared by /api/geocode and /api/within.
 */
export async function resolveLocation(rawQuery: string): Promise<GeocodeResponse | null> {
  const key = normalize(rawQuery)

  const hit = await getCached(key)
  if (hit) return hit

  const result = await searchNominatim(key)
  if (!result) return null

  await putCached({
    query: key,
    latitude: result.latitude,
    longitude: result.longitude,
    display_name: result.display_name,
    provider: 'nominatim',
  })

  return {
    query: key,
    latitude: result.latitude,
    longitude: result.longitude,
    display_name: result.display_name,
    provider: 'nominatim',
    cached: false,
  }
}
