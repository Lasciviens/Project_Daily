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

async function refreshIfExpired(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: token } = await supabase
    .from('strava_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single()

  if (!token) return null

  // Refresh if token expires within 5 minutes
  const nowSec = Math.floor(Date.now() / 1000)
  if (token.expires_at > nowSec + 300) return token.access_token

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      refresh_token: token.refresh_token,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) return null

  const { access_token, refresh_token, expires_at } = await res.json()
  await supabase
    .from('strava_tokens')
    .update({ access_token, refresh_token, expires_at, updated_at: new Date().toISOString() })
    .eq('user_id', userId)

  return access_token
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

    const accessToken = await refreshIfExpired(supabase, user.id)
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'not_connected' }), {
        status: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const { per_page = 30, before, after } = await req.json().catch(() => ({}))

    const params = new URLSearchParams({ per_page: String(per_page) })
    if (before) params.set('before', String(before))
    if (after)  params.set('after', String(after))

    const activitiesRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!activitiesRes.ok) {
      return new Response(JSON.stringify({ error: 'Strava fetch failed' }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const activities = await activitiesRes.json()

    // Upsert each activity into training_sessions (source=strava, skip if already manual)
    for (const a of activities) {
      const paceSecPerKm = a.distance > 0
        ? Math.round((a.moving_time / (a.distance / 1000)))
        : null

      const type = mapStravaType(a.type)

      await supabase.from('training_sessions').upsert(
        {
          user_id:              user.id,
          strava_activity_id:   a.id,
          source:               'strava',
          type,
          title:                a.name,
          completed_at:         a.start_date,
          planned_date:         a.start_date?.slice(0, 10),
          distance_meters:      a.distance ? Math.round(a.distance) : null,
          duration_seconds:     a.moving_time ?? null,
          elevation_gain_m:     a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
          avg_heart_rate:       a.average_heartrate ? Math.round(a.average_heartrate) : null,
          avg_pace_sec_per_km:  paceSecPerKm,
          updated_at:           new Date().toISOString(),
        },
        { onConflict: 'strava_activity_id', ignoreDuplicates: false }
      )
    }

    return new Response(JSON.stringify({ synced: activities.length }), {
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

function mapStravaType(stravaType: string): string {
  const map: Record<string, string> = {
    Run:           'run',
    Ride:          'cycling',
    Walk:          'walk',
    Swim:          'swim',
    WeightTraining:'strength',
    Workout:       'strength',
    Yoga:          'yoga',
  }
  return map[stravaType] ?? 'other'
}
