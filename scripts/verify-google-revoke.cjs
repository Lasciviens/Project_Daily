#!/usr/bin/env node
/*
 * Verification — calendar-disconnect revokes the Google grant at Google before
 * forgetting it (owner-critic, 25.11.2026: a token from before Google Calendar
 * went still carries Calendar write access). Google's documented revoke:
 * POST https://oauth2.googleapis.com/revoke, `token=…` in a form body (never
 * the URL). Only 200, or 400 invalid_token (already revoked), lets the row go;
 * any other answer keeps it so Disconnect can be tried again. The token is
 * never answered or logged. The consent asks for Tasks only and never folds in
 * an earlier grant.
 *
 * Loads the REAL handler under Node (TypeScript stripped by sucrase) with a
 * stubbed Deno, an in-memory user_calendar_tokens table and a scripted fetch.
 *
 *   Run:  node scripts/verify-google-revoke.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const root = path.join(__dirname, '..')
const SRC = fs.readFileSync(path.join(root, 'supabase/functions/calendar-disconnect/index.ts'), 'utf8')
  .replace(/^import .*createClient.*$/m, '')
const CODE = transform(SRC, { transforms: ['typescript'] }).code
const ENV = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's', HEVY_USER_ID: 'owner' }
const REFRESH = 'refresh-TOKEN-0123456789'

function run({ row, answer }) {
  const tables = { user_calendar_tokens: row ? [{ user_id: 'owner', ...row }] : [] }
  const calls = []
  const logs = []
  const db = {
    auth: { getUser: async (t) => ({ data: { user: t === 'owner-jwt' ? { id: 'owner' } : null }, error: null }) },
    from: (table) => {
      const st = { del: false, filters: [] }
      const b = {
        select: () => b, delete: () => { st.del = true; return b },
        eq: (c, v) => { st.filters.push([c, v]); return b },
        maybeSingle: () => { st.single = true; return b },
        then: (res, rej) => Promise.resolve().then(() => {
          const t = tables[table] ?? []
          const hit = t.filter(r => st.filters.every(([c, v]) => r[c] === v))
          if (st.del) { tables[table] = t.filter(r => !hit.includes(r)); return { data: null, error: null } }
          if (table === 'app_allowed_users') return { data: null, error: null }
          return st.single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null }
        }).then(res, rej),
      }
      return b
    },
  }
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (answer === 'network') throw new TypeError(`error sending request for url (${url})`)
    const [status, error] = Array.isArray(answer) ? answer : [answer ?? 200]
    return new Response(error ? JSON.stringify({ error }) : '', { status })
  }
  const console = { error: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) }
  let handler
  new Function('Deno', 'createClient', 'fetch', 'console', CODE)({ env: { get: (k) => ENV[k] }, serve: (f) => { handler = f } }, () => db, fetchImpl, console)
  return { handler, tables, calls, logs }
}
const post = (handler) => handler(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer owner-jwt', origin: 'https://lasciviens.github.io' } }))

let passed = 0, failed = 0
const check = (name, cond, detail) => { if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) } }

;(async () => {
  let t = run({ row: { refresh_token: REFRESH } })
  let res = await post(t.handler)
  const call = t.calls[0]
  const form = new URLSearchParams(call?.init?.body ?? '')
  check('one call, to POST https://oauth2.googleapis.com/revoke', t.calls.length === 1 && call.url === 'https://oauth2.googleapis.com/revoke' && call.init.method === 'POST', JSON.stringify(t.calls.map(c => c.url)))
  check('the stored refresh token in a form body, never the URL', call?.init?.headers?.['Content-Type'] === 'application/x-www-form-urlencoded' && form.get('token') === REFRESH && !call.url.includes(REFRESH))
  const text = await res.text()
  check('revoked: answers ok and deletes the row', res.status === 200 && JSON.parse(text).ok === true && t.tables.user_calendar_tokens.length === 0)
  check('the token is never in the answer or a log', !text.includes(REFRESH) && !t.logs.some(l => l.includes(REFRESH)))

  t = run({ row: { refresh_token: REFRESH }, answer: [400, 'invalid_token'] })
  res = await post(t.handler)
  check('400 invalid_token (already revoked or expired): the row goes', res.status === 200 && t.tables.user_calendar_tokens.length === 0)

  for (const answer of [[400, 'invalid_request'], 503, 'network']) {
    t = run({ row: { refresh_token: REFRESH }, answer })
    res = await post(t.handler)
    const body = await res.text()
    check(`revoke ${JSON.stringify(answer)}: the row stays, an error says to try again`, res.status === 502 && /try again/.test(body) && t.tables.user_calendar_tokens.length === 1 && !body.includes(REFRESH))
  }

  t = run({ row: null })
  res = await post(t.handler)
  check('nothing stored: no call to Google, answers ok', t.calls.length === 0 && res.status === 200)

  check('the token is read server-side from user_calendar_tokens, never from the request body', /\.from\('user_calendar_tokens'\)\s*\.select\('refresh_token'\)/.test(SRC) && !/req\.json\(\)/.test(SRC))

  const scopes = fs.readFileSync(path.join(root, 'src/features/calendar/googleScopes.ts'), 'utf8')
  const tab = fs.readFileSync(path.join(root, 'src/features/developer/components/ConnectionsTab.tsx'), 'utf8')
  check('the consent asks for Google Tasks only', /export const GOOGLE_SCOPES = \[\s*'https:\/\/www\.googleapis\.com\/auth\/tasks',\s*\]/.test(scopes) && !/auth\/calendar/.test(scopes.replace(/^\/\/.*$/gm, '')))
  check('…and never folds in an earlier grant (include_granted_scopes: false)', /include_granted_scopes: false/.test(tab))
  check('the card forgets the token only once the server confirmed the disconnect', /await disconnectGoogle\(\)\s*\n\s*setAccessToken\(null\)/.test(tab))

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.log(`  ✗ crashed: ${e.stack}`); process.exit(1) })
