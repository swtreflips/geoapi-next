// Server-side configuration (mirrors the Python config.py).
// Resolved lazily via getConfig() so importing a module never throws at build time —
// only an actual request validates the required vars.

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function getConfig() {
  return {
    supabaseUrl: must('SUPABASE_URL'),
    supabaseKey: must('SUPABASE_SERVICE_ROLE_KEY'), // service-role: server-only, bypasses RLS
    contactEmail: must('CONTACT_EMAIL'),

    nominatimUrl: process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search',
    nominatimMinIntervalMs: Number(process.env.NOMINATIM_MIN_INTERVAL ?? '1') * 1000,
    nominatimTimeoutMs: Number(process.env.NOMINATIM_TIMEOUT ?? '10') * 1000,
    nominatimCountryCodes: process.env.NOMINATIM_COUNTRY_CODES ?? 'us', // US cities only

    appName: process.env.APP_NAME ?? 'schedules-geocoder',
    appVersion: process.env.APP_VERSION ?? '0.1',
  }
}
