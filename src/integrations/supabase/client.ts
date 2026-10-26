import { createClient } from '@supabase/supabase-js'

// The publishable key (sb_publishable_…) replaces the legacy anon key; the anon
// key stays the fallback until the owner switches legacy keys off
// (docs/backend/environment.md → Supabase API keys).
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey  = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (or the legacy VITE_SUPABASE_ANON_KEY)')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
