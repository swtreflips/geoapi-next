import { getConfig } from './config'

export class UpstreamError extends Error {}

export type NominatimResult = {
  latitude: number
  longitude: number
  display_name: string | null
}

// Cache key normalization (mirrors cache.py normalize).
export function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Serializes calls and enforces a minimum interval between them — a faithful port of the
 * Python async RateLimiter (Nominatim's usage policy allows ~1 req/s).
 *
 * NOTE: on serverless (Vercel) each warm instance holds its own copy, so this is
 * best-effort across concurrent invocations — acceptable here because the cache means
 * only *uncached* cities ever reach Nominatim. Locally (one dev process) it behaves
 * exactly like the FastAPI version.
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
    // keep the chain alive regardless of outcome, without leaking rejections
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

// Optional var with a default → safe to read at module load (no throw).
const _limiter = new RateLimiter(Number(process.env.NOMINATIM_MIN_INTERVAL ?? '1') * 1000)

export async function searchNominatim(query: string): Promise<NominatimResult | null> {
  const cfg = getConfig()

  const url = new URL(cfg.nominatimUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('addressdetails', '0')
  if (cfg.nominatimCountryCodes) {
    url.searchParams.set('countrycodes', cfg.nominatimCountryCodes)
  }

  const userAgent = `${cfg.appName}/${cfg.appVersion} (${cfg.contactEmail})`

  return _limiter.schedule(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.nominatimTimeoutMs)

    let resp: Response
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
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

    const data = (await resp.json()) as Array<{
      lat: string
      lon: string
      display_name?: string
    }>
    if (!Array.isArray(data) || data.length === 0) return null

    const hit = data[0]
    return {
      latitude: Number(hit.lat),
      longitude: Number(hit.lon),
      display_name: hit.display_name ?? null,
    }
  })
}
