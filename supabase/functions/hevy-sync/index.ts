import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { upsertWorkoutToDb } from '../_shared/hevySync.ts'
import type { HevyWorkout } from '../_shared/hevySync.ts'

const jsonHeaders = { 'Content-Type': 'application/json' }

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const hevyApiKey = Deno.env.get('HEVY_API_KEY')!

async function hevyGet(path: string) {
  const res = await fetch(`https://api.hevyapp.com${path}`, {
    headers: { 'api-key': hevyApiKey },
  })
  if (!res.ok) throw new Error(`Hevy API ${res.status}: ${path}`)
  return res.json()
}

Deno.serve(async (req) => {
  // Handle preflight — Hevy servers won't send this but be safe
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  // Only POST is meaningful
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Verify webhook secret
  const secret = Deno.env.get('HEVY_WEBHOOK_SECRET')
  const authHeader = req.headers.get('authorization') ?? ''
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Resolve user ID (single-user app — stored in Vault)
  const userId = Deno.env.get('HEVY_USER_ID')
  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'HEVY_USER_ID not configured' }),
      { status: 500, headers: jsonHeaders }
    )
  }

  // Parse request body
  let workoutId: string
  try {
    const body = await req.json()
    workoutId = body?.workoutId
    if (!workoutId) throw new Error('missing workoutId')
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Bad request: ${(err as Error).message}` }),
      { status: 400, headers: jsonHeaders }
    )
  }

  // Fetch full workout from Hevy
  let workout: HevyWorkout
  try {
    const data = await hevyGet(`/v1/workouts/${workoutId}`)
    // GET /v1/workouts/{id} returns the workout directly; tolerate wrapped/array shapes too
    const raw = data?.workout ?? data
    workout = Array.isArray(raw) ? raw[0] : raw
    if (!workout?.id) throw new Error('no workout in Hevy response')
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Hevy fetch failed: ${(err as Error).message}` }),
      { status: 502, headers: jsonHeaders }
    )
  }

  try {
    await upsertWorkoutToDb(supabase, userId, workout)
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `upsert workout: ${(err as Error).message}` }),
      { status: 500, headers: jsonHeaders }
    )
  }

  return new Response(
    JSON.stringify({ ok: true, workoutId }),
    { status: 200, headers: jsonHeaders }
  )
})
