import { NextResponse } from 'next/server'
import { resolveLocation } from '@/lib/resolve'
import { UpstreamError } from '@/lib/geocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/geocode?q=...  (mirrors the FastAPI /geocode endpoint)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')

  if (!q || q.length < 1 || q.length > 200) {
    return NextResponse.json({ detail: 'invalid_query' }, { status: 400 })
  }

  try {
    const result = await resolveLocation(q)
    if (!result) {
      return NextResponse.json({ detail: 'no_result' }, { status: 404 })
    }
    return NextResponse.json(result)
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
