import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

// Strava's revoke (developers.strava.com/docs/authentication, checked
// 26.10.2026): POST /oauth/revoke since 01.06.2026, the only way from
// 01.06.2027 when /oauth/deauthorize ends. HTTP Basic auth with the app's
// client id and secret, `token` (+ `token_type_hint`) in a form body; revoking
// a refresh token revokes its access tokens too, and a stored access token
// may already have expired, so the refresh token goes first. 200 also when
// the token was unknown. Returns null when Strava took it, else a short
// reason that names no token.
async function revokeOnStrava(refreshToken: string | null, accessToken: string | null): Promise<string | null> {
  const clientId = Deno.env.get('STRAVA_CLIENT_ID')
  const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET')
  if (!clientId || !clientSecret) return 'STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not set'
  const form = refreshToken
    ? new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' })
    : new URLSearchParams({ token: accessToken ?? '', token_type_hint: 'access_token' })
  try {
    const res = await fetch('https://www.strava.com/oauth/revoke', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
    await res.body?.cancel()
    return res.ok ? null : `HTTP ${res.status}`
  } catch {
    return 'Strava could not be reached'
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }
    if (!(await isAppUser(user.id))) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // Revoke the app's access on Strava's side before deleting locally. A failed
    // revoke never blocks the local disconnect; it is logged without the token.
    const { data: token } = await supabase
      .from('strava_tokens')
      .select('access_token, refresh_token')
      .eq('user_id', user.id)
      .single()

    if (token?.refresh_token || token?.access_token) {
      const problem = await revokeOnStrava(token.refresh_token ?? null, token.access_token ?? null)
      if (problem) console.error(`strava-disconnect: Strava revoke failed (${problem}); the local connection is removed anyway`)
    }

    await supabase.from('strava_tokens').delete().eq('user_id', user.id)

    return new Response(JSON.stringify({ disconnected: true }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }
})
