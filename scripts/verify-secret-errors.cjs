#!/usr/bin/env node
/*
 * Verification — server keys never come back in an error (security audit
 * 10.10.2026). Deno's fetch rejects with a TypeError that quotes the request
 * URL; ai-proxy, steam-api, igdb-api and trakt-api used to return that text,
 * key included, to the caller (and on into app_error_logs and the model).
 *
 * Loads each REAL handler under Node (TypeScript stripped by sucrase) with a
 * stubbed Deno, an in-memory database and every outside call failing — no
 * network — and checks the answer contains none of the keys. Also ai-proxy's
 * Gemini timeout: 20 s per attempt, a hung model hands over to the next one,
 * and the answer when the last one hangs is scrubbed too (07.11.2026).
 *
 *   Run:  node scripts/verify-secret-errors.cjs
 */
const fs = require('fs')
const path = require('path')
const sucrase = require('sucrase')
const REPO = path.join(__dirname, '..')

// Minimal PostgREST-like builder over in-memory tables. Records every op.
function makeDb(tables, users, log) {
  function builder(table) {
    const st = { table, kind: 'select', filters: [], wantRows: false, single: false }
    const b = {}
    const match = (r) => st.filters.every(([op, c, v]) => {
      if (op === 'eq') return r[c] === v
      if (op === 'neq') return r[c] !== v && r[c] != null && String(r[c]) !== String(v)
      if (op === 'in') return v.includes(r[c])
      if (op === 'is') return v === null ? r[c] == null : r[c] === v
      if (op === 'gte') return r[c] >= v
      if (op === 'lte') return r[c] <= v
      if (op === 'gt') return r[c] > v
      if (op === 'lt') return r[c] < v
      return true
    })
    for (const op of ['eq', 'neq', 'in', 'is', 'gte', 'lte', 'gt', 'lt']) b[op] = (c, v) => { st.filters.push([op, c, v]); return b }
    for (const op of ['order', 'limit', 'range', 'or', 'not', 'ilike', 'contains']) b[op] = () => b
    b.select = () => { if (st.kind !== 'select') st.wantRows = true; return b }
    b.insert = (rows) => { st.kind = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b }
    b.upsert = (rows) => { st.kind = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b }
    b.update = (vals) => { st.kind = 'update'; st.vals = vals; return b }
    b.delete = () => { st.kind = 'delete'; return b }
    b.single = () => { st.single = true; return b }
    b.maybeSingle = () => { st.single = true; return b }
    const run = () => {
      const t = (tables[table] ??= [])
      let data
      if (st.kind === 'select') data = t.filter(match)
      else if (st.kind === 'insert') { data = st.rows.map((r, i) => ({ id: `${table}-new-${t.length + i + 1}`, ...r })); t.push(...data) }
      else if (st.kind === 'update') { data = t.filter(match); for (const r of data) Object.assign(r, st.vals) }
      else if (st.kind === 'delete') { data = t.filter(match); tables[table] = t.filter(r => !data.includes(r)) }
      log.push({ table, kind: st.kind, filters: st.filters, rows: st.rows ?? null, vals: st.vals ?? null, affected: data.length })
      if (st.single) data = data[0] ?? null
      return { data, error: null }
    }
    b.then = (res, rej) => Promise.resolve().then(run).then(res, rej)
    return b
  }
  return {
    from: builder,
    rpc: async (name, args) => { log.push({ rpc: name, args }); return { data: null, error: { message: 'stub rpc' } } },
    auth: { getUser: async (tok) => ({ data: { user: users[tok] ? { id: users[tok] } : null }, error: null }) },
  }
}

function load(fnName, { env, tables, users, log, fetchImpl }) {
  const src = fs.readFileSync(`${REPO}/supabase/functions/${fnName}/index.ts`, 'utf8').replace(/^import .*createClient.*$/m, '')
  const code = sucrase.transform(src, { transforms: ['typescript'] }).code
  let handler
  const Deno = { env: { get: (k) => env[k] }, serve: (f) => { handler = f } }
  new Function('Deno', 'createClient', 'fetch', code)(Deno, () => makeDb(tables, users, log), fetchImpl)
  return handler
}

// Every outside call fails the way Deno's fetch does: a TypeError quoting the URL.
const failing = async (url) => { throw new TypeError(`error sending request for url (${url}): client error (Connect): dns error`) }
const SECRETS = { GEMINI_API_KEY: 'GEMINI-SECRET-123456', STEAM_API_KEY: 'STEAM-SECRET-123456', STEAM_ID64: '76561190000000000',
  IGDB_CLIENT_ID: 'igdb-client-id', IGDB_CLIENT_SECRET: 'IGDB-SECRET-123456', MDBLIST_API_KEY: 'MDBLIST-SECRET-123456',
  TMDB_API_KEY: 'TMDB-SECRET-123456', TRAKT_CLIENT_ID: 'tci', TRAKT_CLIENT_SECRET: 'TRAKT-SECRET-123456' }
const env = { ...SECRETS, HEVY_USER_ID: 'owner', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE-SECRET-123456', SUPABASE_ANON_KEY: 'a' }
let ok = 0, bad = 0
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n) } else { bad++; console.log('  ✗', n, d ?? '') } }
const leaks = (text) => Object.values(SECRETS).concat(env.SUPABASE_SERVICE_ROLE_KEY).filter(v => v.length > 10 && text.includes(v))
// An await that never settles empties the event loop, and Node would end the
// script with 0: a run that stops before the last line fails.
let finished = false
process.on('exit', () => {
  if (!finished) { console.log('  ✗ the script ended before every check ran (an await never settled)'); process.exitCode = 1 }
})

;(async () => {
  const cases = [
    ['ai-proxy', { messages: [{ role: 'user', content: 'hi' }] }],
    ['steam-api', { action: 'profile' }],
    ['igdb-api', { action: 'search', query: 'Zelda' }],
    ['trakt-api', { action: 'ratings', mediaType: 'movie', tmdbId: 603 }],
    // TMDB's v3 key travels in the URL; "Check now" on follows used a plain fetch (audit 28.10.2026).
    ['trakt-api', { action: 'follows_check' }, { media_follows: [{ id: 'f1', user_id: 'owner', kind: 'collection', tmdb_id: 10, known_ids: [], trailer_keys: [], last_checked_at: null }] }],
  ]
  for (const [fn, body, extra] of cases) {
    const handler = load(fn, { env, tables: { app_allowed_users: [], ...structuredClone(extra ?? {}) }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl: failing })
    const res = await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify(body) }))
    const text = await res.text()
    const l = leaks(text)
    check(`${fn} ${body.action ?? 'chat'}: a network failure answers ${res.status} without any key`, l.length === 0, `leaked ${l.join(', ')} in ${text.slice(0, 200)}`)
  }

  // Gemini attempts time out (promised in 038f0168, wired 07.11.2026): every
  // attempt asks for its own 20 s signal, a hung attempt moves the chain to
  // the next model, and when the last one hangs the answer names no key.
  // AbortSignal.timeout is shortened to 5 ms here; the length asked for is recorded.
  const realTimeout = AbortSignal.timeout
  const asked = []
  AbortSignal.timeout = (ms) => {
    asked.push(ms)
    const c = new AbortController()
    setTimeout(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 5)
    return c.signal
  }
  try {
    const tried = []
    // A Gemini call that never answers ends only when its signal fires, as Deno's fetch does.
    let slowBody = null
    const gemini = (answering) => async (url, init = {}) => {
      const model = /\/models\/([^:/]+):generateContent$/.exec(String(url))?.[1]
      if (!model) return failing(url)
      tried.push({ model, signal: !!init.signal })
      if (model === answering) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (model === slowBody) {
        // Headers in time, the answer itself never: the body fails when the attempt's signal fires, as Deno's fetch does.
        const body = new ReadableStream({ start(c) { init.signal?.addEventListener('abort', () => c.error(init.signal.reason), { once: true }) } })
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (!init.signal) throw new TypeError('no signal: this attempt would hang for ever')
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
    }
    const chat = async (fetchImpl) => {
      tried.length = 0
      asked.length = 0
      const handler = load('ai-proxy', { env, tables: { app_allowed_users: [] }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl })
      const res = await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }))
      return { status: res.status, text: await res.text() }
    }
    let r = await chat(gemini('gemini-3.1-flash-lite'))
    check('ai-proxy: a hung first model times out and the next model answers',
      r.status === 200 && JSON.parse(r.text).text === 'hello' && JSON.parse(r.text).model === 'gemini-3.1-flash-lite'
        && tried.map(t => t.model).join() === 'gemini-3.5-flash,gemini-3.1-flash-lite', `${r.status} ${r.text.slice(0, 200)} · ${tried.map(t => t.model).join()}`)
    slowBody = 'gemini-3.5-flash'
    r = await chat(gemini('gemini-3.1-flash-lite'))
    slowBody = null
    check('ai-proxy: an answer still arriving when the 20 s run out is a timed-out attempt too — the next model answers',
      r.status === 200 && JSON.parse(r.text).text === 'hello' && JSON.parse(r.text).model === 'gemini-3.1-flash-lite', `${r.status} ${r.text.slice(0, 200)}`)
    r = await chat(gemini(null))
    check('ai-proxy: every Gemini attempt carries its own 20 s signal',
      tried.length > 0 && tried.every(t => t.signal) && asked.length === tried.length && asked.every(ms => ms === 20_000), { asked, tried })
    check('ai-proxy: when every model hangs, each is tried once and the chain ends',
      tried.map(t => t.model).join() === 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite', tried.map(t => t.model).join())
    check('ai-proxy: …and answers 500 "Gemini timed out" without any key',
      r.status === 500 && /^Gemini timed out/.test(JSON.parse(r.text).error ?? '') && leaks(r.text).length === 0, `${r.status} ${r.text.slice(0, 200)}`)
  } finally {
    AbortSignal.timeout = realTimeout
  }

  // A tool's outside reads have a time limit too (07.11.2026, fetchWithin): a service that never answers is one
  // failed step the model is told about by name, and the reply goes on — a tool that threw used to end it.
  {
    const realTimeout = AbortSignal.timeout
    const asked = []
    AbortSignal.timeout = (ms) => {
      asked.push(ms)
      const c = new AbortController()
      setTimeout(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 5)
      return c.signal
    }
    try {
      const geminiBodies = []
      let enturSignal = false
      const fetchImpl = async (url, init = {}) => {
        const u = String(url)
        if (/:generateContent$/.test(u)) {
          geminiBodies.push(JSON.parse(init.body))
          const parts = geminiBodies.length === 1
            ? [{ functionCall: { name: 'search_transit_stops', args: { query: 'Jernbanetorget' } } }]
            : [{ text: 'EnTur is slow right now.' }]
          return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (u.includes('api.entur.io')) {
          enturSignal = !!init.signal
          if (!init.signal) throw new TypeError('no signal: this read would hang for ever')
          return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
        }
        return failing(url)
      }
      const handler = load('ai-proxy', { env, tables: { app_allowed_users: [] }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl })
      const res = await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Find the stop Jernbanetorget' }] }) }))
      const text = await res.text()
      const told = (geminiBodies[1]?.contents ?? []).flatMap(c => c.parts ?? []).find(p => p.functionResponse)?.functionResponse?.response
      check('ai-proxy: a tool\'s outside read carries its own time limit (EnTur: 10 s)', enturSignal && asked.includes(10_000), JSON.stringify({ enturSignal, asked }))
      check('ai-proxy: a tool whose service never answers is one failed step, named for the model, and the reply goes on',
        res.status === 200 && JSON.parse(text).text === 'EnTur is slow right now.' && told?.success === false && told?.error === 'EnTur did not answer within 10 s',
        `${res.status} ${text.slice(0, 200)} · ${JSON.stringify(told)}`)
    } finally {
      AbortSignal.timeout = realTimeout
    }
  }

  // The routine tools write to the owner's real Hevy account (guardian, 07.11.2026). When hevy-api gives no answer,
  // or fails after Hevy may have taken the write, the model is told the outcome is unknown and not to send it again;
  // Hevy refusing it stays a plain failure. A network error names the service, never the URL it went to.
  {
    const realTimeout = AbortSignal.timeout
    AbortSignal.timeout = () => new AbortController().signal // the waits are not what this tests
    try {
      const runTool = async (call, serviceAnswer) => {
        const geminiBodies = [], hevyPosts = []
        const fetchImpl = async (url, init = {}) => {
          const u = String(url)
          if (/:generateContent$/.test(u)) {
            geminiBodies.push(JSON.parse(init.body))
            const parts = geminiBodies.length === 1 ? [{ functionCall: call }] : [{ text: 'Told the user.' }]
            return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
          }
          if (u.endsWith('/hevy-api')) { hevyPosts.push(JSON.parse(init.body)); return serviceAnswer(u) }
          if (u.includes('api.entur.io')) return serviceAnswer(u)
          return failing(url)
        }
        const handler = load('ai-proxy', { env, tables: { app_allowed_users: [] }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl })
        const res = await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Make my push day' }] }) }))
        const text = await res.text()
        const told = (geminiBodies[1]?.contents ?? []).flatMap(c => c.parts ?? []).find(p => p.functionResponse)?.functionResponse?.response
        return { status: res.status, told, hevyPosts }
      }
      const create = { name: 'create_hevy_routine', args: { title: 'Push day', exercises: [{ exercise_template_id: 'X1', sets: [{ type: 'normal', reps: 8 }] }] } }
      const answer = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

      let r = await runTool(create, failing)
      check('ai-proxy: a routine create whose answer never came is "outcome unknown", and the model is told not to send it again',
        r.status === 200 && r.hevyPosts.length === 1 && r.told?.outcome_unknown === true && /do not call create_hevy_routine again/.test(r.told?.error ?? ''),
        `${r.status} ${JSON.stringify(r.told)}`)
      r = await runTool(create, answer(500, { error: 'duplicate key value violates unique constraint' }))
      check('ai-proxy: …and so is a hevy-api failure that can come after Hevy took it (its 500)', r.told?.outcome_unknown === true, JSON.stringify(r.told))
      r = await runTool(create, answer(502, { error: 'Hevy API 400 POST /v1/routines: invalid exercise_template_id' }))
      check('ai-proxy: Hevy refusing the routine stays a plain failure the model may correct',
        r.told?.success === false && !r.told?.outcome_unknown && /^Hevy API 400/.test(r.told?.error ?? ''), JSON.stringify(r.told))
      r = await runTool({ name: 'search_transit_stops', args: { query: 'Jernbanetorget' } }, failing)
      check('ai-proxy: a tool\'s network error names the service, never the URL it went to (the search\'s words, the runtime\'s address)',
        r.told?.error === 'EnTur could not be reached (network error)' && !/api\.entur\.io|Jernbanetorget/.test(JSON.stringify(r.told)), JSON.stringify(r.told))

      // A confirmed action's answer is scrubbed like every other outgoing error: its text and its step.
      const confirmFetch = async (url) => String(url).endsWith('/hevy-api')
        ? new Response(JSON.stringify({ error: `Hevy API 401 PUT /v1/routines/r1: bad key ${SECRETS.GEMINI_API_KEY}` }), { status: 502, headers: { 'content-type': 'application/json' } })
        : failing(url)
      const pending = [{ id: 'pa1', user_id: 'owner', tool: 'update_hevy_routine', args: { routine_id: 'r1', title: 'Push day', exercises: [{ exercise_template_id: 'X1', sets: [] }] },
        summary: 'update the routine Push day', done_at: null, expires_at: '2999-01-01T00:00:00.000Z' }]
      const confirmHandler = load('ai-proxy', { env, tables: { app_allowed_users: [], ai_pending_actions: pending }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl: confirmFetch })
      const confirmed = await confirmHandler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify({ confirmAction: { id: 'pa1', decision: 'confirm' } }) }))
      const confirmedText = await confirmed.text()
      check('ai-proxy: a confirmed action\'s error reaches the browser without any key, in its text and its step',
        confirmed.status === 200 && /That did not work/.test(confirmedText) && leaks(confirmedText).length === 0, confirmedText.slice(0, 300))
      // A confirmed routine change whose answer never came: the person reads that it may have gone through, never
      // "That did not work" nor the model's own instruction ("tell the user…").
      const unsure = load('ai-proxy', { env, tables: { app_allowed_users: [], ai_pending_actions: pending.map(r => ({ ...structuredClone(r), done_at: null, decision: null })) }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl: failing })
      const unsureRes = await unsure(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify({ confirmAction: { id: 'pa1', decision: 'confirm' } }) }))
      const unsureBody = JSON.parse(await unsureRes.text())
      check('ai-proxy: a confirmed Hevy change with no answer says it may have gone through, in words for the person',
        unsureBody.text === 'Hevy didn\'t confirm the change. It may have gone through: check the routine in Hevy before trying again.'
          && /^\? update_hevy_routine — not confirmed/.test(unsureBody.steps?.[0] ?? '') && !/tell the user|do not call/i.test(JSON.stringify(unsureBody)),
        JSON.stringify(unsureBody))
    } finally {
      AbortSignal.timeout = realTimeout
    }
  }

  // Keys travel in a header or a body, never in a URL (security review
  // 26.10.2026): Steam takes `x-webapi-key`, Twitch's token request a form body.
  const recorded = []
  const answering = async (url, init = {}) => {
    recorded.push({ url: String(url), init })
    const u = String(url)
    const body = u.includes('id.twitch.tv') ? { access_token: 'app-token', expires_in: 3600 }
      : u.includes('api.igdb.com') ? []
      : u.includes('GetPlayerAchievements') ? { playerstats: { success: true, achievements: [] } }
      : { response: { players: [{}], games: [] } }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  // STEAM_ID64 is the public account id Valve's calls take as `steamid`, not a key.
  const inUrl = () => recorded.flatMap(r => leaks(decodeURIComponent(r.url)).filter(k => k !== SECRETS.STEAM_ID64).map(k => `${k} in ${r.url.split('?')[0]}`))
  const ask = async (fn, body) => {
    const handler = load(fn, { env, tables: { app_allowed_users: [] }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl: answering })
    return handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify(body) }))
  }
  for (const action of ['profile', 'owned_games', 'achievements', 'level_badges']) await ask('steam-api', { action, appid: 440 })
  const steamCalls = recorded.filter(r => r.url.includes('api.steampowered.com'))
  const keyed = steamCalls.filter(r => !/GetGlobalAchievementPercentagesForApp/.test(r.url))
  check(`steam-api: ${steamCalls.length} Steam calls, no key in any URL`, steamCalls.length >= 6 && inUrl().length === 0, inUrl().join('; '))
  check('steam-api: every keyed call sends x-webapi-key', keyed.length >= 5 && keyed.every(r => r.init?.headers?.['x-webapi-key'] === SECRETS.STEAM_API_KEY))
  recorded.length = 0
  await ask('igdb-api', { action: 'search', query: 'Zelda' })
  const twitch = recorded.find(r => r.url.includes('id.twitch.tv'))
  check('igdb-api: no key in any URL', recorded.length >= 2 && inUrl().length === 0, inUrl().join('; ') || `${recorded.length} calls`)
  check('igdb-api: the Twitch token request is a POST with a form body',
    twitch?.url === 'https://id.twitch.tv/oauth2/token' && twitch.init.method === 'POST'
      && twitch.init.headers?.['Content-Type'] === 'application/x-www-form-urlencoded'
      && new URLSearchParams(twitch.init.body).get('client_secret') === SECRETS.IGDB_CLIENT_SECRET
      && new URLSearchParams(twitch.init.body).get('grant_type') === 'client_credentials')
  console.log(`\n${ok} passed, ${bad} failed`)
  finished = true
  process.exit(bad ? 1 : 0)
})()
