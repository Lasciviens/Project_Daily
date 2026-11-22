// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the entry point
//
//  POST /functions/v1/claude, called by the app. This is the only part that
//  touches the server itself: it reads the secrets, creates the two database
//  clients, and decides who is asking. Then it hands over:
//    { "action": "describe" }                       → describe.ts
//    { "action": "run", "job": "…", "input": { … } } → run.ts
//    { "action": "diagnose" }                       → diagnose.ts
//  It also hands the run the network and the name lookup a job may use to read
//  an outside page (the recipe link), since only this part touches Deno.
//
//  Supabase checks the sign-in token before this code starts (the function is
//  not listed in supabase/config.toml, so platform verification is on). That
//  check admits any token of the project, so the code below still asks whose
//  token it is and whether that account is on the owner list.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { ANTHROPIC_INFO, anthropicProvider } from './provider-anthropic.ts'
import { describeFunction } from './describe.ts'
import { errorPlace, LIMITS, ownValue, parseObject, readCapped } from './guard.ts'
import { runJob, type RunContext } from './run.ts'
import { runDiagnose } from './diagnose.ts'
import type { DnsLookup } from './types.ts'

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

// The name lookup of the page fetch (page-fetch.ts): Deno's DNS question, with Deno's own errors turned into the
// neutral ones the part knows. "No such record" is an empty list. Only a missing `Deno.resolveDns`, `PermissionDenied`
// and `NotCapable` mean "this runtime has no lookup" (Supabase's Edge Runtime is not confirmed to allow it, so the
// hostname check then stands alone, said once per instance in the log); every other error fails closed.
let noLookupSaid = false
function noLookupHere(why: string): never {
  if (!noLookupSaid) { noLookupSaid = true; console.warn(`[claude] no DNS lookup here (${why}), hostname check only`) }
  throw Object.assign(new Error('no DNS lookup here'), { name: 'NoLookup' })
}
const dnsLookup: DnsLookup = async (name, type, signal) => {
  if (typeof Deno.resolveDns !== 'function') return noLookupHere('missing')
  try {
    return await Deno.resolveDns(name, type, { signal })
  } catch (e) {
    const kind = (e as Error)?.name
    if (kind === 'AbortError') throw e
    if (kind === 'PermissionDenied' || kind === 'NotCapable') return noLookupHere(kind)
    if (Deno.errors?.NotFound && e instanceof Deno.errors.NotFound) return []
    throw e
  }
}

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
  const headers = corsHeaders(req.headers.get('origin'))
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' })

  try {
    // Who is asking: the token's own account, then the owner list.
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return reply(401, { error: 'Missing authorization header' })
    const sessionOff = { persistSession: false, autoRefreshToken: false }
    const adminDb = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: sessionOff })
    const { data: { user }, error: authError } = await adminDb.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return reply(401, { error: 'Invalid token' })
    if (!(await isAppUser(user.id))) return reply(403, { error: 'forbidden' })

    // What is asked: a small JSON object with an action.
    const text = await readCapped(req.body, LIMITS.requestMaxBytes)
    if (text === null) return reply(400, { error: `The request is larger than ${LIMITS.requestMaxBytes / 1024} KB` })
    const body = parseObject(text)
    if (!body) return reply(400, { error: 'The request must be a JSON object' })
    const action = ownValue(body, 'action')
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

    if (action === 'describe') return reply(200, { ok: true, about: describeFunction(apiKey !== '', ANTHROPIC_INFO) })
    if (action !== 'run' && action !== 'diagnose') return reply(400, { error: 'The action must be "describe", "run" or "diagnose"' })
    const jobName = ownValue(body, 'job')
    if (action === 'run' && typeof jobName !== 'string') return reply(400, { error: 'A run needs the name of its job' })

    // The owner's own client: it carries their token, so row level security decides what it reads.
    const userDb = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), {
      global: { headers: { Authorization: authHeader } }, auth: sessionOff,
    })
    const context: RunContext = {
      userId: user.id,
      caller: 'app',
      userDb,
      adminDb,
      // `fetch` is handed over by name, so a test that swaps the network swaps it for the SDK too.
      provider: apiKey ? anthropicProvider(apiKey, fetch) : null,
      providerName: ANTHROPIC_INFO.name,
      page: { fetch, dnsLookup },
      secrets: [apiKey, serviceKey(), publishableKey()],
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      report: line => console.error(`[claude] ${line}`),
    }
    if (action === 'diagnose') return reply(200, await runDiagnose(context))
    const answer = await runJob(context, jobName as string, ownValue(body, 'input'))
    return reply(200, answer)
  } catch (error) {
    console.error(`[claude] unexpected error: ${errorPlace(error)}`)
    return reply(500, { error: 'Internal error' })
  }
})
