#!/usr/bin/env node
/*
 * Verification — strava-disconnect revokes on Strava's side the documented way
 * (security review 26.10.2026; developers.strava.com/docs/authentication):
 * POST /oauth/revoke with Basic auth (client id:secret) and the refresh token
 * in a form body — never the retiring /oauth/deauthorize, never a token in a
 * URL — and a failed revoke never blocks the local disconnect or leaks a
 * token into the log.
 *
 * Loads the REAL handler under Node (TypeScript stripped by sucrase) with a
 * stubbed Deno, an in-memory strava_tokens table and a scripted fetch.
 *
 *   Run:  node scripts/verify-strava-revoke.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/strava-disconnect/index.ts'), 'utf8')
  .replace(/^import .*createClient.*$/m, '')
const CODE = transform(SRC, { transforms: ['typescript'] }).code
const ENV = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's', HEVY_USER_ID: 'owner', STRAVA_CLIENT_ID: '12345', STRAVA_CLIENT_SECRET: 'abc123' }
const REFRESH = 'refresh-TOKEN-0123456789', ACCESS = 'access-TOKEN-0123456789'

function run({ row, answer, env = ENV }) {
  const tables = { strava_tokens: row ? [{ user_id: 'owner', ...row }] : [] }
  const calls = []
  const logs = []
  const db = {
    auth: { getUser: async (t) => ({ data: { user: t === 'owner-jwt' ? { id: 'owner' } : null }, error: null }) },
    from: (table) => {
      const st = { del: false, filters: [] }
      const b = {
        select: () => b, delete: () => { st.del = true; return b },
        eq: (c, v) => { st.filters.push([c, v]); return b },
        maybeSingle: () => b,
        single: () => { st.single = true; return b },
        then: (res, rej) => Promise.resolve().then(() => {
          const t = tables[table] ?? []
          const hit = t.filter(r => st.filters.every(([c, v]) => r[c] === v))
          if (st.del) { tables[table] = t.filter(r => !hit.includes(r)); return { data: null, error: null } }
          if (table === 'app_allowed_users') return { data: null, error: null }
          return st.single ? (hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: 'no rows' } }) : { data: hit, error: null }
        }).then(res, rej),
      }
      return b
    },
  }
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (answer === 'network') throw new TypeError(`error sending request for url (${url})`)
    return new Response('', { status: answer ?? 200 })
  }
  const console = { error: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) }
  let handler
  new Function('Deno', 'createClient', 'fetch', 'console', CODE)({ env: { get: (k) => env[k] }, serve: (f) => { handler = f } }, () => db, fetchImpl, console)
  return { handler, tables, calls, logs }
}
const post = (handler) => handler(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer owner-jwt', origin: 'https://lasciviens.github.io' } }))

let passed = 0, failed = 0
const check = (name, cond, detail) => { if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) } }

;(async () => {
  let t = run({ row: { access_token: ACCESS, refresh_token: REFRESH } })
  let res = await post(t.handler)
  const call = t.calls[0]
  const form = new URLSearchParams(call?.init?.body ?? '')
  check('one call, to POST https://www.strava.com/oauth/revoke', t.calls.length === 1 && call.url === 'https://www.strava.com/oauth/revoke' && call.init.method === 'POST', JSON.stringify(t.calls.map(c => c.url)))
  check('Basic auth with client id:secret (Strava\'s own example: 12345:abc123 → MTIzNDU6YWJjMTIz)', call?.init?.headers?.Authorization === 'Basic MTIzNDU6YWJjMTIz')
  check('the refresh token in a form body, with its hint', call?.init?.headers?.['Content-Type'] === 'application/x-www-form-urlencoded' && form.get('token') === REFRESH && form.get('token_type_hint') === 'refresh_token')
  check('no token in the URL', !call?.url.includes(REFRESH) && !call?.url.includes(ACCESS))
  check('answers { disconnected: true } and deletes the row', res.status === 200 && (await res.json()).disconnected === true && t.tables.strava_tokens.length === 0)
  check('a successful revoke logs nothing', t.logs.length === 0, t.logs.join(' | '))

  for (const answer of [401, 503, 'network']) {
    t = run({ row: { access_token: ACCESS, refresh_token: REFRESH }, answer })
    res = await post(t.handler)
    const body = await res.json()
    check(`revoke ${answer}: still disconnects locally, same answer`, res.status === 200 && body.disconnected === true && Object.keys(body).length === 1 && t.tables.strava_tokens.length === 0)
    check(`revoke ${answer}: one log line, no token or secret in it`, t.logs.length === 1 && !t.logs.some(l => l.includes(REFRESH) || l.includes(ACCESS) || l.includes('abc123')), t.logs.join(' | '))
  }

  t = run({ row: { access_token: ACCESS, refresh_token: null } })
  await post(t.handler)
  const f2 = new URLSearchParams(t.calls[0]?.init?.body ?? '')
  check('no refresh token stored: the access token is revoked instead', f2.get('token') === ACCESS && f2.get('token_type_hint') === 'access_token')

  t = run({ row: null })
  res = await post(t.handler)
  check('no stored row: no call to Strava, still answers disconnected', t.calls.length === 0 && res.status === 200 && (await res.json()).disconnected === true)

  t = run({ row: { access_token: ACCESS, refresh_token: REFRESH }, env: { ...ENV, STRAVA_CLIENT_SECRET: undefined } })
  res = await post(t.handler)
  check('app secrets missing: no call, local disconnect, a log line naming the setting', t.calls.length === 0 && res.status === 200 && t.tables.strava_tokens.length === 0 && /STRAVA_CLIENT_SECRET/.test(t.logs.join(' ')))

  check('the retiring /oauth/deauthorize is not called anywhere', !/['"`]https:\/\/www\.strava\.com\/oauth\/deauthorize/.test(SRC))

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.log(`  ✗ crashed: ${e.stack}`); process.exit(1) })
