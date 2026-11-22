// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the entry point
//
//  POST /functions/v1/claude, called by the app. This is the only part that
//  touches the server itself: it reads the secrets, creates the two database
//  clients, and decides who is asking. Then it hands over:
//    { "action": "describe" }                       → describe.ts
//    { "action": "run", "job": "…", "input": { … } } → run.ts
//    { "action": "count", "input": { … } }          → run.ts (the Test bench's free token count)
//    { "action": "diagnose" }                       → diagnose.ts
//  Two kinds of caller, told apart before anything is read:
//    · the app: `Authorization: Bearer <the owner's sign-in token>`, checked with getUser and the owner list;
//    · a device function (kobo-sync, phone-gateway), which has already checked its own device secret: the header
//      `x-claude-server-key` carries a value derived from the project's service key (HMAC-SHA256 of a fixed
//      label, guard.ts; never the key itself), compared in constant time with this function's own copy. It may only `run`, and only as caller `kobo` or `phone`, acting as the owner (HEVY_USER_ID, read here,
//      never from the request), so a job runs for a device only when its `callers` list names that device.
//  It also hands the run the network and the name lookup a job may use to read
//  an outside page (the recipe link), since only this part touches Deno.
//
//  Platform JWT verification is OFF for this function (supabase/config.toml): the new `sb_secret_` keys are not
//  JWTs, so the platform would refuse the device path. Both paths are therefore checked here, before the body is
//  read: a request with neither a valid sign-in token of an owner-list account nor the right server key is a 401.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { ANTHROPIC_INFO, anthropicProvider } from './provider-anthropic.ts'
import { describeFunction } from './describe.ts'
import { claudeDeviceCredential, deviceCaller, errorPlace, LIMITS, ownValue, parseObject, readCapped, sameSecret } from './guard.ts'
import { countJob, runJob, type RunContext } from './run.ts'
import { runDiagnose } from './diagnose.ts'
import { findJob } from './jobs.ts'
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

/** A size in the unit people say it in (16 KB, 1.5 MB), for the message of the limit that was really hit. */
function sizeWords(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 104857.6) / 10} MB` : `${Math.round(bytes / 1024)} KB`
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
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
    const sessionOff = { persistSession: false, autoRefreshToken: false }
    const adminDb = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: sessionOff })

    // Who is asking, part 1: a device function. The header is the service key; any other value (or none while the
    // server has no key) is refused outright, and a request with the header never falls through to the token path.
    const serverKeyHeader = req.headers.get('x-claude-server-key')
    let device = false
    if (serverKeyHeader !== null) {
      // The header holds a value derived from the service key (never the key itself); no key set: every device is refused.
      const own = serviceKey()
      const derived = own ? await claudeDeviceCredential(own) : ''
      if (!own || !(await sameSecret(serverKeyHeader, derived))) return reply(401, { error: 'Invalid server key' })
      device = true
    }

    // Who is asking, part 2: the app. The token's own account, then the owner list.
    const authHeader = req.headers.get('authorization')
    let userId = ''
    if (device) {
      // The account a device acts as comes from this function's own environment, never from the request.
      userId = Deno.env.get('HEVY_USER_ID') ?? ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return reply(503, { error: 'Server not configured (HEVY_USER_ID)' })
    } else {
      if (!authHeader) return reply(401, { error: 'Missing authorization header' })
      const { data: { user }, error: authError } = await adminDb.auth.getUser(authHeader.replace('Bearer ', ''))
      if (authError || !user) return reply(401, { error: 'Invalid token' })
      if (!(await isAppUser(user.id))) return reply(403, { error: 'forbidden' })
      userId = user.id
    }

    // What is asked: a small JSON object with an action.
    // The app may send a photo (up to LIMITS.imageRequestMaxBytes) but only to a job that takes one; every other
    // request, and every device request, stays within LIMITS.requestMaxBytes. The bigger read is only a read: the
    // size is checked again once the job is known.
    const readLimit = device ? LIMITS.requestMaxBytes : LIMITS.imageRequestMaxBytes
    const text = await readCapped(req.body, readLimit)
    if (text === null) return reply(400, { error: `The request is larger than ${sizeWords(readLimit)}` })
    const body = parseObject(text)
    if (!body) return reply(400, { error: 'The request must be a JSON object' })
    const action = ownValue(body, 'action')
    if (new TextEncoder().encode(text).length > LIMITS.requestMaxBytes) {
      const job = action === 'run' ? findJob(ownValue(body, 'job')) : null
      if (!job?.acceptsImage) return reply(400, { error: `The request is larger than ${LIMITS.requestMaxBytes / 1024} KB` })
    }

    // A device may only run a job, as the one device it is. `describe`, `count` and `diagnose` are the app's.
    let caller: 'app' | 'kobo' | 'phone' = 'app'
    if (device) {
      if (action !== 'run') return reply(400, { error: 'A device may only run a job' })
      const named = deviceCaller(ownValue(body, 'caller'))
      if (!named) return reply(400, { error: 'The caller must be "kobo" or "phone"' })
      caller = named as 'kobo' | 'phone'
    }

    if (action === 'describe') return reply(200, { ok: true, about: describeFunction(apiKey !== '', ANTHROPIC_INFO) })
    if (action !== 'run' && action !== 'diagnose' && action !== 'count') return reply(400, { error: 'The action must be "describe", "run", "count" or "diagnose"' })
    const jobName = ownValue(body, 'job')
    if (action === 'run' && typeof jobName !== 'string') return reply(400, { error: 'A run needs the name of its job' })

    // The app's own client carries the owner's token, so row level security decides what it reads. A device has no
    // token: the service-role client reads instead, and every read of it names the user id in the query itself.
    const userDb = device ? adminDb : createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), {
      global: { headers: { Authorization: authHeader as string } }, auth: sessionOff,
    })
    const context: RunContext = {
      userId,
      caller,
      readAs: device ? 'server' : 'owner',
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
    if (action === 'count') return reply(200, await countJob(context, 'test_bench', ownValue(body, 'input')))
    const answer = await runJob(context, jobName as string, ownValue(body, 'input'))
    return reply(200, answer)
  } catch (error) {
    console.error(`[claude] unexpected error: ${errorPlace(error)}`)
    return reply(500, { error: 'Internal error' })
  }
})
