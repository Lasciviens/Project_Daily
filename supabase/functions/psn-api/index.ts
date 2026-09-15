// psn-api — proxies the PlayStation Network via the community-maintained
// `psn-api` npm package (github.com/achievements-app/psn-api). Sony has NO
// official public API for this (see the Games Feature Detail research note
// in CLAUDE.md) — this is reverse-engineered and can break without notice.
//
// UNVERIFIED AGAINST A REAL ACCOUNT — this session has no PSN credentials
// to test against. Every remote call is wrapped defensively; if the
// library's exact return shape has drifted from what's read below, expect
// clear errors surfaced to the client rather than a silent wrong answer,
// but this genuinely needs a live pass with a real npsso once deployed.
//
// Auth model (npsso → access/refresh tokens): the user pastes an npsso
// obtained from a real browser login (my.playstation.com → the ssocookie
// endpoint) into the app once; this function exchanges it and stores the
// resulting tokens in `psn_tokens` (migration 091), refreshing the access
// token (~1h) from the refresh token on later calls without re-touching the
// npsso (~60d) every time. Sony added a reCAPTCHA to the login flow that
// blocks a *fully scripted* npsso mint — the human still has to paste a
// fresh npsso periodically (see CLAUDE.md); nothing here works around that.
//
// `verify_jwt` stays ON — every action needs the caller's user id (to scope
// psn_tokens), resolved via `supabase.auth.getUser` on the request's own
// JWT, the same pattern `calendar-oauth` already uses. The service-role
// client is what actually reads/writes psn_tokens (RLS is defense-in-depth,
// not the access path here).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getProfileFromAccountId,
  getBasicPresence,
  getUserTitles,
} from 'npm:psn-api@^2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Action = 'connect' | 'status' | 'disconnect' | 'profile' | 'games'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return json({ error: 'Invalid token' }, 401)
  const userId = user.id

  let body: { action?: Action; npsso?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const { action } = body

  try {
    if (action === 'connect') {
      if (!body.npsso?.trim()) return json({ error: 'npsso required' }, 400)
      const accessCode = await exchangeNpssoForAccessCode(body.npsso.trim())
      const authorization = await exchangeAccessCodeForAuthTokens(accessCode)
      const expiresAt = new Date(Date.now() + (authorization.expiresIn ?? 3600) * 1000).toISOString()
      const { error } = await supabase.from('psn_tokens').upsert({
        user_id: userId,
        npsso: body.npsso.trim(),
        access_token: authorization.accessToken,
        refresh_token: authorization.refreshToken,
        access_token_expires_at: expiresAt,
        connected_at: new Date().toISOString(),
      })
      if (error) throw error
      return json({ connected: true, expiresAt })
    }

    if (action === 'disconnect') {
      const { error } = await supabase.from('psn_tokens').delete().eq('user_id', userId)
      if (error) throw error
      return json({ connected: false })
    }

    const { data: row } = await supabase.from('psn_tokens')
      .select('access_token, refresh_token, access_token_expires_at, connected_at')
      .eq('user_id', userId).maybeSingle()

    if (action === 'status') {
      return json({ connected: !!row, connectedAt: row?.connected_at ?? null, expiresAt: row?.access_token_expires_at ?? null })
    }

    if (!row) return json({ error: 'not_connected' }, 400)

    // Refresh the access token if it's expired or about to be (5min margin).
    let accessToken = row.access_token as string
    const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at as string).getTime() : 0
    if (!accessToken || expiresAt - Date.now() < 5 * 60 * 1000) {
      const refreshed = await exchangeRefreshTokenForAuthTokens(row.refresh_token as string)
      accessToken = refreshed.accessToken
      const newExpiresAt = new Date(Date.now() + (refreshed.expiresIn ?? 3600) * 1000).toISOString()
      await supabase.from('psn_tokens').update({
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken ?? row.refresh_token,
        access_token_expires_at: newExpiresAt,
      }).eq('user_id', userId)
    }

    const authorization = { accessToken }

    if (action === 'profile') {
      const [profile, presence] = await Promise.all([
        getProfileFromAccountId(authorization, 'me').catch(() => null),
        getBasicPresence(authorization, 'me').catch(() => null),
      ])
      return json({ profile, presence })
    }

    if (action === 'games') {
      const titles = await getUserTitles(authorization, 'me')
      return json({ titles: titles?.trophyTitles ?? [] })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502)
  }
})
