import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

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

    const { code } = await req.json()
    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing code' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // Exchange authorization code for Strava tokens
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     Deno.env.get('STRAVA_CLIENT_ID'),
        client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
        code,
        grant_type:    'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}))
      return new Response(JSON.stringify({ error: err.message ?? 'Strava token exchange failed' }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const data = await tokenRes.json()
    const { access_token, refresh_token, expires_at, athlete } = data

    await supabase.from('strava_tokens').upsert(
      {
        user_id:        user.id,
        access_token,
        refresh_token,
        expires_at,
        athlete_id:     athlete?.id ?? null,
        athlete_name:   athlete ? `${athlete.firstname} ${athlete.lastname}` : null,
        athlete_avatar: athlete?.profile_medium ?? null,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    // Return athlete info so client knows connection succeeded — never return tokens
    return new Response(JSON.stringify({
      connected:      true,
      athlete_id:     athlete?.id,
      athlete_name:   athlete ? `${athlete.firstname} ${athlete.lastname}` : null,
      athlete_avatar: athlete?.profile_medium ?? null,
    }), {
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
