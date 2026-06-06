import { supabase } from '../../../integrations/supabase/client'

const EDGE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID
const REDIRECT_URI = `${window.location.origin}${window.location.pathname}#/training`

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session!.access_token}` }
}

export function buildStravaOAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     STRAVA_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope:         'read,activity:read_all,profile:read_all',
  })
  return `https://www.strava.com/oauth/authorize?${params}`
}

export async function exchangeStravaCode(code: string): Promise<{
  connected: boolean
  athlete_name: string | null
  athlete_avatar: string | null
}> {
  const res = await fetch(`${EDGE}/strava-auth`, {
    method:  'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Strava auth failed')
  }
  return res.json()
}

export async function syncStravaActivities(): Promise<{ synced: number }> {
  const res = await fetch(`${EDGE}/strava-activities`, {
    method:  'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body:    JSON.stringify({ per_page: 50 }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Strava sync failed')
  }
  return res.json()
}

export async function disconnectStrava(): Promise<void> {
  const res = await fetch(`${EDGE}/strava-disconnect`, {
    method:  'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  })
  if (!res.ok) throw new Error('Disconnect failed')
}
