import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getConfig } from './config'

// Lazily-created server-only client (service-role key — never exposed to the browser).
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseKey } = getConfig()
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}
