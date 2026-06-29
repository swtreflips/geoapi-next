import { NextResponse } from 'next/server'
import { resolveRoute } from '@/lib/route'
import { UpstreamError } from '@/lib/geocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/route?a=...&b=...
// Geocodes both cities (cache + Nominatim), then returns a cached HERE truck (drayage)
// route between them — distance, durations, and polyline. Cache-first: a known pair never
// re-hits HERE; a pair of known cities never re-hits Nominatim.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const a = searchParams.get('a')
  const b = searchParams.get('b')

  if (!a || !b || a.length > 200 || b.length > 200) {
    return NextResponse.json({ detail: 'invalid_query' }, { status: 400 })
  }

  try {
    const res = await resolveRoute(a, b)
    if (!res.ok) {
      return NextResponse.json(
        { detail: res.reason, a_found: res.a_found, b_found: res.b_found },
        { status: 404 },
      )
    }
    return NextResponse.json(res.route)
  } catch (e) {
    if (e instanceof UpstreamError) {
      return NextResponse.json({ detail: 'upstream_error' }, { status: 502 })
    }
    return NextResponse.json(
      { detail: 'internal_error', message: (e as Error).message },
      { status: 500 },
    )
  }
}
