export type GeocodeResponse = {
  query: string
  latitude: number
  longitude: number
  display_name: string | null
  provider: string
  cached: boolean
}
