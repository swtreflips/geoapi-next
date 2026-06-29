import { getSupabase } from './supabase'

const TABLE = 'drayage_routes'

// The columns the app reads/writes; geom columns are filled by the DB trigger.
export type CachedRoute = {
  origin_query: string
  destination_query: string
  origin_lat: number
  origin_lon: number
  dest_lat: number
  dest_lon: number
  distance_m: number
  duration_s: number
  base_duration_s: number | null
  typical_duration_s: number | null
  polyline: string
  transport_mode: string
  provider: string
}

const COLS =
  'origin_query, destination_query, origin_lat, origin_lon, dest_lat, dest_lon, ' +
  'distance_m, duration_s, base_duration_s, typical_duration_s, polyline, transport_mode, provider'

// Read a cached route by its normalized (origin, destination) key pair. Directional.
export async function getCachedRoute(
  originKey: string,
  destKey: string,
): Promise<CachedRoute | null> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(COLS)
    .eq('origin_query', originKey)
    .eq('destination_query', destKey)
    .limit(1)

  if (error) throw error
  if (!data || data.length === 0) return null
  return data[0] as unknown as CachedRoute
}

// Upsert a route on the (origin_query, destination_query) PK. The origin_geom/dest_geom
// columns are populated by the DB trigger from the lat/lon columns.
export async function putCachedRoute(route: CachedRoute): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLE)
    .upsert(route, { onConflict: 'origin_query,destination_query' })

  if (error) throw error
}
