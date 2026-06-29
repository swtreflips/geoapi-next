import { getConfig } from './config'
import { UpstreamError } from './geocode'

export type LatLon = { latitude: number; longitude: number }

export type RouteResult = {
  distance_m: number
  duration_s: number
  base_duration_s: number | null
  typical_duration_s: number | null
  polyline: string
}

/**
 * Serializes calls and enforces a minimum interval between them — same pattern as the
 * Nominatim RateLimiter in geocode.ts. HERE's free tier is generous, but the cache means
 * only *uncached* city pairs ever reach HERE, so this is just polite best-effort throttling.
 */
class RateLimiter {
  private last = 0
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = this.minIntervalMs - (Date.now() - this.last)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      try {
        return await fn()
      } finally {
        this.last = Date.now()
      }
    }
    const result = this.chain.then(run, run)
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

// Optional var with a default → safe to read at module load (no throw).
const _limiter = new RateLimiter(Number(process.env.HERE_MIN_INTERVAL ?? '0.5') * 1000)

type HereSection = {
  polyline: string
  summary: {
    length: number
    duration: number
    baseDuration?: number
    typicalDuration?: number
  }
}

/**
 * Fetch a realistic truck (drayage) route between two coordinates from HERE Routing v8.
 * No `departureTime` is sent, so durations are traffic-typical (cache-stable). Returns
 * null when HERE finds no route; throws UpstreamError on transport/HTTP failure.
 */
export async function fetchRoute(origin: LatLon, destination: LatLon): Promise<RouteResult | null> {
  const cfg = getConfig()

  const url = new URL(cfg.hereApiUrl)
  url.searchParams.set('transportMode', 'truck')
  url.searchParams.set('routingMode', 'fast')
  url.searchParams.set('origin', `${origin.latitude},${origin.longitude}`)
  url.searchParams.set('destination', `${destination.latitude},${destination.longitude}`)
  url.searchParams.set('return', 'polyline,summary,typicalDuration')
  url.searchParams.set('truck[height]', String(cfg.truckHeightCm))
  url.searchParams.set('truck[width]', String(cfg.truckWidthCm))
  url.searchParams.set('truck[length]', String(cfg.truckLengthCm))
  url.searchParams.set('truck[weight]', String(cfg.truckWeightKg))
  url.searchParams.set('apikey', cfg.hereApiKey)

  return _limiter.schedule(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.hereTimeoutMs)

    let resp: Response
    try {
      resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (e) {
      throw new UpstreamError(`network: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }

    if (resp.status === 429) throw new UpstreamError('rate_limited')
    if (resp.status >= 500) throw new UpstreamError(`server_${resp.status}`)
    if (resp.status >= 400) throw new UpstreamError(`client_${resp.status}`)

    const data = (await resp.json()) as { routes?: Array<{ sections: HereSection[] }> }
    const section = data.routes?.[0]?.sections?.[0]
    if (!section) return null

    const { summary, polyline } = section
    return {
      distance_m: summary.length,
      duration_s: summary.duration,
      base_duration_s: summary.baseDuration ?? null,
      typical_duration_s: summary.typicalDuration ?? null,
      polyline,
    }
  })
}
