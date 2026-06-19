import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_RP5_SUPABASE_URL  as string | undefined
const key = import.meta.env.VITE_RP5_SUPABASE_ANON_KEY as string | undefined

// Client is null when secrets aren't configured (dev without .env.local, or CI before secrets are added)
export const rp5 = url && key ? createClient(url, key) : null
