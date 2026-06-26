import { NextResponse } from 'next/server'
import { getCached, putCached } from '@/lib/cache'
import { normalize, searchNominatim, UpstreamError } from '@/lib/geocode'
import type { GeocodeResponse } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/geocode?q=...  (mirrors the FastAPI /geocode endpoint)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')

  if (!q || q.length < 1 || q.length > 200) {
    return NextResponse.json({ detail: 'invalid_query' }, { status: 400 })
  }

  const key = normalize(q)

  try {
    const hit = await getCached(key)
    if (hit) return NextResponse.json(hit)

    let result
    try {
      result = await searchNominatim(key)
    } catch (e) {
      if (e instanceof UpstreamError) {
        return NextResponse.json({ detail: 'upstream_error' }, { status: 502 })
      }
      throw e
    }

    if (!result) {
      return NextResponse.json({ detail: 'no_result' }, { status: 404 })
    }

    await putCached({
      query: key,
      latitude: result.latitude,
      longitude: result.longitude,
      display_name: result.display_name,
      provider: 'nominatim',
    })

    const body: GeocodeResponse = {
      query: key,
      latitude: result.latitude,
      longitude: result.longitude,
      display_name: result.display_name,
      provider: 'nominatim',
      cached: false,
    }
    return NextResponse.json(body)
  } catch (e) {
    return NextResponse.json(
      { detail: 'internal_error', message: (e as Error).message },
      { status: 500 },
    )
  }
}
