import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Secrets required in Supabase Dashboard → Edge Functions → health-ingest → Secrets:
//   HEALTH_INGEST_SECRET  — any random string you choose; put the same value in the Shortcut
//   HEALTH_INGEST_USER_ID — your Supabase user UUID (find in Dashboard → Authentication → Users)

const EXPECTED_SECRET = Deno.env.get('HEALTH_INGEST_SECRET')
const USER_ID         = Deno.env.get('HEALTH_INGEST_USER_ID')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Validate bearer token
  const auth = req.headers.get('Authorization') ?? ''
  if (!EXPECTED_SECRET || auth !== `Bearer ${EXPECTED_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (!USER_ID) {
    return new Response('HEALTH_INGEST_USER_ID secret not set', { status: 500 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const today = new Date().toISOString().slice(0, 10)
  const date  = typeof body.date === 'string' ? body.date : today

  const num = (v: unknown) =>
    v !== undefined && v !== null && v !== '' ? Number(v) : null

  const { error } = await supabase.from('health_daily_stats').upsert(
    {
      user_id:            USER_ID,
      date,
      steps:              num(body.steps),
      active_calories:    num(body.active_calories),
      exercise_minutes:   num(body.exercise_minutes),
      stand_hours:        num(body.stand_hours),
      heart_rate_avg:     num(body.heart_rate_avg),
      heart_rate_resting: num(body.heart_rate_resting),
      heart_rate_max:     num(body.heart_rate_max),
      vo2_max:            num(body.vo2_max),
      updated_at:         new Date().toISOString(),
    },
    { onConflict: 'user_id,date' },
  )

  if (error) {
    console.error('upsert error', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true, date }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
