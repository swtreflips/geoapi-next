import { getSupabase } from './supabase'
import type { GeocodeResponse } from './types'

const TABLE = 'geocode_cache'

// Read a cached geocode by its normalized query key (mirrors cache.py get).
export async function getCached(query: string): Promise<GeocodeResponse | null> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('query, latitude, longitude, display_name, provider')
    .eq('query', query)
    .limit(1)

  if (error) throw error
  if (!data || data.length === 0) return null

  const row = data[0]
  return {
    query: row.query,
    latitude: row.latitude,
    longitude: row.longitude,
    display_name: row.display_name ?? null,
    provider: row.provider,
    cached: true,
  }
}

// Upsert a geocode into the cache on the `query` PK (mirrors cache.py put).
// The `geom` column is populated by the DB trigger from latitude/longitude.
export async function putCached(params: {
  query: string
  latitude: number
  longitude: number
  display_name: string | null
  provider: string
}): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLE)
    .upsert(params, { onConflict: 'query' })

  if (error) throw error
}
