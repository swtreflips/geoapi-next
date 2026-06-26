'use client'

import { useState } from 'react'
import type { GeocodeResponse } from '@/lib/types'

export default function Home() {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GeocodeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── proximity check (two locations within 100 miles) ──────────────────
  const [aLoc, setALoc] = useState('')
  const [bLoc, setBLoc] = useState('')
  const [nearLoading, setNearLoading] = useState(false)
  const [nearError, setNearError] = useState<string | null>(null)
  const [within, setWithin] = useState<null | {
    within: boolean
    a: string
    b: string
    miles: number
    a_result: GeocodeResponse
    b_result: GeocodeResponse
  }>(null)

  async function run() {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)
      const body = await res.json()
      if (!res.ok) {
        setError(`${res.status} — ${body.detail ?? 'error'}${body.message ? `: ${body.message}` : ''}`)
      } else {
        setResult(body as GeocodeResponse)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function runWithin() {
    if (!aLoc.trim() || !bLoc.trim()) return
    setNearLoading(true)
    setNearError(null)
    setWithin(null)
    try {
      const res = await fetch(
        `/api/within?a=${encodeURIComponent(aLoc)}&b=${encodeURIComponent(bLoc)}&miles=100`,
      )
      const body = await res.json()
      if (!res.ok) {
        setNearError(`${res.status} — ${body.detail ?? 'error'}${body.message ? `: ${body.message}` : ''}`)
      } else {
        setWithin(body)
      }
    } catch (err) {
      setNearError((err as Error).message)
    } finally {
      setNearLoading(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>geoapi-next</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
        Nominatim geocoder with a Supabase cache. Country-restricted to <code>us</code>.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 24 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Los Angeles, CA"
          style={{
            flex: 1,
            padding: '10px 12px',
            border: '1px solid #ccc',
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 16px',
            border: 'none',
            borderRadius: 8,
            background: '#111',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Geocoding…' : 'Geocode'}
        </button>
      </form>

      {error && (
        <div style={{ padding: 12, background: '#fde8e8', color: '#9b1c1c', borderRadius: 8, fontSize: 14 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <strong>{result.query}</strong>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: result.cached ? '#def7ec' : '#e1effe',
                color: result.cached ? '#03543f' : '#1e429f',
                fontWeight: 600,
              }}
            >
              {result.cached ? 'CACHED' : 'FRESH'}
            </span>
          </div>
          <div style={{ color: '#333', marginBottom: 8 }}>{result.display_name ?? '—'}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', color: '#555' }}>
            {result.latitude}, {result.longitude} · {result.provider}
          </div>
        </div>
      )}

      {/* ── Proximity check: two locations within 100 miles ───────────────── */}
      <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '32px 0 24px' }} />
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Within 100 miles?</h2>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        Geocodes both locations, then checks distance with PostGIS <code>ST_DWithin</code>.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void runWithin()
        }}
        style={{ display: 'grid', gap: 8, marginBottom: 16 }}
      >
        <input
          value={aLoc}
          onChange={(e) => setALoc(e.target.value)}
          placeholder="Location A — e.g. Los Angeles, CA"
          style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 8, fontSize: 14 }}
        />
        <input
          value={bLoc}
          onChange={(e) => setBLoc(e.target.value)}
          placeholder="Location B — e.g. Santa Monica, CA"
          style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 8, fontSize: 14 }}
        />
        <button
          type="submit"
          disabled={nearLoading}
          style={{
            padding: '10px 16px',
            border: 'none',
            borderRadius: 8,
            background: '#111',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            cursor: nearLoading ? 'default' : 'pointer',
            opacity: nearLoading ? 0.6 : 1,
            justifySelf: 'start',
          }}
        >
          {nearLoading ? 'Checking…' : 'Check 100 mi'}
        </button>
      </form>

      {nearError && (
        <div style={{ padding: 12, background: '#fde8e8', color: '#9b1c1c', borderRadius: 8, fontSize: 14 }}>
          {nearError}
        </div>
      )}

      {within && (
        <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, fontSize: 14 }}>
          <div style={{ marginBottom: 12 }}>
            <span
              style={{
                fontSize: 13,
                padding: '4px 12px',
                borderRadius: 999,
                background: within.within ? '#def7ec' : '#fde8e8',
                color: within.within ? '#03543f' : '#9b1c1c',
                fontWeight: 700,
              }}
            >
              {within.within ? `WITHIN ${within.miles} mi ✓ (true)` : `NOT within ${within.miles} mi (false)`}
            </span>
          </div>
          <div style={{ color: '#555', fontSize: 13 }}>
            <div>A: {within.a_result.display_name ?? within.a}</div>
            <div>B: {within.b_result.display_name ?? within.b}</div>
          </div>
        </div>
      )}
    </main>
  )
}
