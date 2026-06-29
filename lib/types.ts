export type GeocodeResponse = {
  query: string
  latitude: number
  longitude: number
  display_name: string | null
  provider: string
  cached: boolean
}

// A cached HERE truck (drayage) route between two geocoded cities.
export type RouteResponse = {
  origin: string // normalized origin city key
  destination: string // normalized destination city key
  distance_m: number // summary.length
  duration_s: number // summary.duration
  base_duration_s: number | null // summary.baseDuration (free-flow)
  typical_duration_s: number | null // summary.typicalDuration (primary ETA)
  polyline: string // HERE flexible polyline (decode client-side)
  transport_mode: string
  provider: string
  cached: boolean
  origin_result: GeocodeResponse // the geocoded origin leg
  destination_result: GeocodeResponse // the geocoded destination leg
}
