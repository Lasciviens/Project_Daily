import { createClient } from '@supabase/supabase-js'
import { phoneTimeZone } from '../../shared/utils/timeZone'

// The publishable key (sb_publishable_…) replaces the legacy anon key; the anon
// key stays the fallback until the owner switches legacy keys off
// (docs/backend/environment.md → Supabase API keys).
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey  = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (or the legacy VITE_SUPABASE_ANON_KEY)')
}

// The phone's time zone travels with every database call as `x-time-zone` (183): the database gives a new slot or
// plan that zone and stamps a food log's time on the phone's clock (docs/features/calendar-plan.md → Time zones).
// Only to the data API: the app's edge functions answer a fixed list of headers. Read at each call, so landing in
// another zone needs no reload. Writes carry it once a read has shown the API takes it; if a read with it fails and
// the same read without it works, it is left out for this session — the header never breaks the app.
const apiOrigin = new URL(supabaseUrl).origin
let zoneHeader: 'unknown' | 'ok' | 'refused' = 'unknown'

function isDataApiCall(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return url.origin === apiOrigin && url.pathname.startsWith('/rest/v1/')
  } catch {
    return false
  }
}

async function fetchWithTimeZone(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const zone = zoneHeader === 'refused' ? null : phoneTimeZone()
  if (!zone || !isDataApiCall(input)) return fetch(input, init)
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const read = method === 'GET' || method === 'HEAD'
  if (zoneHeader === 'unknown' && !read) return fetch(input, init)
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.set('x-time-zone', zone)
  try {
    const res = await fetch(input, { ...init, headers })
    zoneHeader = 'ok'
    return res
  } catch (err) {
    if (zoneHeader === 'ok' || !read) throw err
    const res = await fetch(input, init)
    zoneHeader = 'refused'
    return res
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: fetchWithTimeZone } })
