import { NextResponse } from 'next/server'
import { resolveLocation } from '@/lib/resolve'
import { UpstreamError } from '@/lib/geocode'
import { getSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/within?a=...&b=...&miles=100
// Geocodes both locations (cache + Nominatim), then returns whether they are within
// `miles` of each other via the PostGIS cache_within_miles() function (ST_DWithin).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const a = searchParams.get('a')
  const b = searchParams.get('b')
  const miles = Number(searchParams.get('miles') ?? '100')

  if (!a || !b || a.length > 200 || b.length > 200) {
    return NextResponse.json({ detail: 'invalid_query' }, { status: 400 })
  }
  if (!Number.isFinite(miles) || miles <= 0) {
    return NextResponse.json({ detail: 'invalid_miles' }, { status: 400 })
  }

  try {
    const aRes = await resolveLocation(a)
    const bRes = await resolveLocation(b)
    if (!aRes || !bRes) {
      return NextResponse.json(
        { detail: 'no_result', a_found: !!aRes, b_found: !!bRes },
        { status: 404 },
      )
    }

    const { data, error } = await getSupabase().rpc('cache_within_miles', {
      a: aRes.query,
      b: bRes.query,
      miles,
    })
    if (error) throw error

    return NextResponse.json({
      a: aRes.query,
      b: bRes.query,
      miles,
      within: data as boolean,
      a_result: aRes,
      b_result: bRes,
    })
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
