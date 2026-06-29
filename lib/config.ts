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

    // HERE Routing v8 — truck (drayage) routes. Key is server-only, never NEXT_PUBLIC_*.
    hereApiUrl: process.env.HERE_API_URL ?? 'https://router.hereapi.com/v8/routes',
    hereApiKey: must('HERE_API_KEY'),
    hereMinIntervalMs: Number(process.env.HERE_MIN_INTERVAL ?? '0.5') * 1000,
    hereTimeoutMs: Number(process.env.HERE_TIMEOUT ?? '15') * 1000,
    // Truck profile (HERE v8 units: dimensions in CENTIMETERS, weight in KILOGRAMS).
    truckHeightCm: Number(process.env.TRUCK_HEIGHT_CM ?? '400'),
    truckWidthCm: Number(process.env.TRUCK_WIDTH_CM ?? '300'),
    truckLengthCm: Number(process.env.TRUCK_LENGTH_CM ?? '1600'),
    truckWeightKg: Number(process.env.TRUCK_WEIGHT_KG ?? '36000'),

    appName: process.env.APP_NAME ?? 'schedules-geocoder',
    appVersion: process.env.APP_VERSION ?? '0.1',
  }
}
