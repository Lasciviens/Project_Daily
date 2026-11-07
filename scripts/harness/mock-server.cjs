'use strict'
// The browser test harness: the real app (Vite dev server) on a mock Supabase.
//
// installMocks(context) answers every request a Playwright BrowserContext makes
// outside the app's own server:
//   https://mock.supabase.co  auth, PostgREST tables and RPCs, edge functions and
//                             storage — from in-memory made-up data (seed.cjs),
//                             a fresh copy per context, so writes stay in it;
//   every other host          blocked (an image gets a transparent pixel), so a
//                             test never reaches the real internet.
// SESSION is the signed-in session; the page reads it from localStorage under
// 'sb-mock-auth-token' (the key supabase-js derives from the mock URL).
// HARNESS_LOG=1 prints every request the mock could not answer from its data.
// How to start the app and extend the data: README.md in this folder.

const { Store, handleRest } = require('./postgrest.cjs')
const { OWNER, buildTables, RELATIONS } = require('./seed.cjs')
const { RPCS } = require('./rpc.cjs')
const { FUNCTIONS } = require('./functions.cjs')

const SUPABASE_HOST = 'mock.supabase.co'
const APP_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
let warnedFs = false

// ── The signed-in owner ──────────────────────────────────────────────────────

const issuedAt = Math.floor(Date.now() / 1000)
const expiresAt = issuedAt + 365 * 24 * 3600
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

const USER = {
  id: OWNER.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: OWNER.email,
  email_confirmed_at: '2026-01-05T08:00:00Z',
  phone: '',
  confirmed_at: '2026-01-05T08:00:00Z',
  last_sign_in_at: new Date(issuedAt * 1000).toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: OWNER.name },
  identities: [],
  created_at: '2026-01-05T08:00:00Z',
  updated_at: new Date(issuedAt * 1000).toISOString(),
  is_anonymous: false,
}

// An unsigned token in the JWT shape: nothing checks its signature.
const ACCESS_TOKEN = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    aud: 'authenticated', exp: expiresAt, iat: issuedAt, iss: `https://${SUPABASE_HOST}/auth/v1`,
    sub: OWNER.id, email: OWNER.email, role: 'authenticated', aal: 'aal1',
    session_id: '00000000-0000-4000-8000-00000000a001', is_anonymous: false,
  }),
  Buffer.from('mock-signature').toString('base64url'),
].join('.')

const SESSION = {
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: expiresAt - issuedAt,
  expires_at: expiresAt,
  refresh_token: 'mock-refresh-token',
  user: USER,
}

// ── Answers ──────────────────────────────────────────────────────────────────

const json = (status, body) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: body === undefined ? '' : JSON.stringify(body) })
const empty = (status = 204) => ({ status, headers: {}, body: '' })
// 1×1 transparent PNG: what every blocked image and stored file shows.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

function authAnswer(method, path) {
  const p = path.replace(/^\/auth\/v1/, '')
  if (p === '/token') return json(200, SESSION) // password sign-in and refresh alike
  if (p === '/user') return json(200, USER)
  if (p === '/logout') return empty()
  if (p === '/settings') return json(200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: false })
  if (p.startsWith('/.well-known/jwks.json')) return json(200, { keys: [] })
  return json(200, {}) // recover, otp, resend, factors …
}

function storageAnswer(method, path, body) {
  const p = path.replace(/^\/storage\/v1/, '')
  const sign = /^\/object\/sign\/([^/]+)\/?(.*)$/.exec(p)
  if (sign && method === 'POST') {
    const paths = Array.isArray(body?.paths) ? body.paths : [sign[2]]
    const one = (x) => ({ path: x, signedURL: `/object/sign/${sign[1]}/${x}?token=mock`, signedUrl: `https://${SUPABASE_HOST}/storage/v1/object/sign/${sign[1]}/${x}?token=mock`, error: null })
    return json(200, Array.isArray(body?.paths) ? paths.map(one) : { signedURL: one(paths[0]).signedURL })
  }
  if (p.startsWith('/object/list/')) return json(200, [])
  if (p.startsWith('/bucket')) return json(200, [])
  if (method === 'GET' && p.startsWith('/object/')) return { status: 200, headers: { 'content-type': 'image/png' }, body: PIXEL }
  if (method === 'DELETE') return json(200, [])
  return json(200, { Key: p.replace(/^\/object\//, ''), Id: '00000000-0000-4000-8000-00000000f11e' }) // an upload
}

function functionAnswer(req, store, log) {
  const name = req.url.pathname.replace(/^\/functions\/v1\//, '').split('/')[0]
  const fn = FUNCTIONS[name]
  if (!fn) {
    log(`function ${name}: no answer defined, answered {}`)
    return json(200, {})
  }
  const out = fn({ ...req, store, log })
  if (out && typeof out === 'object' && 'status' in out && 'body' in out) return out
  return json(200, out ?? {})
}

function parseBody(req) {
  let raw = null
  try { raw = req.postData() } catch { return null }
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return raw }
}

function supabaseAnswer(request, url, store, log) {
  const headers = request.headers()
  const method = request.method()
  const cors = {
    'access-control-allow-origin': headers.origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-expose-headers': 'content-range, content-type, preference-applied, x-relay-error',
    vary: 'Origin',
  }
  if (method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS',
        'access-control-allow-headers': headers['access-control-request-headers'] || '*',
        'access-control-max-age': '86400',
      },
      body: '',
    }
  }
  const req = { method, url, headers, body: parseBody(request) }
  let res
  if (url.pathname.startsWith('/rest/v1/')) res = handleRest(store, req, RPCS)
  else if (url.pathname.startsWith('/auth/v1/')) res = authAnswer(method, url.pathname)
  else if (url.pathname.startsWith('/functions/v1/')) res = functionAnswer(req, store, log)
  else if (url.pathname.startsWith('/storage/v1/')) res = storageAnswer(method, url.pathname, req.body)
  else {
    log(`${method} ${url.pathname}: not a Supabase path the harness knows`)
    res = json(404, { message: 'not handled by the harness' })
  }
  return { status: res.status, headers: { ...cors, ...res.headers }, body: res.body }
}

/**
 * Routes every request of `context` (a Playwright BrowserContext) through the mock.
 * @param opts.tables  { name: rows[] } — replaces those tables' made-up rows (e.g. [] for an empty state)
 * @param opts.now     Date — the day the made-up data is built around (default: now)
 * @param opts.log     (message) => void — what the mock could not answer (default: stderr when HARNESS_LOG=1)
 * @param opts.outside (url, request) => { status, headers, body } | null — a test's own answer for an outside
 *                     host (a fixture); null keeps it blocked
 * @returns the Store, so a test can read what the page wrote or change rows before a reload
 */
async function installMocks(context, opts = {}) {
  const log = opts.log || (process.env.HARNESS_LOG ? (m) => console.error(`[harness] ${m}`) : () => {})
  const store = new Store({ tables: buildTables(opts.now || new Date()), relations: RELATIONS, ownerId: OWNER.id, log })
  for (const [name, rows] of Object.entries(opts.tables || {})) store.tables[name] = rows

  // Vite serves nothing outside the project folder: in a git worktree whose
  // node_modules is a symlink, the Inter font answers 403 and every page
  // renders in a fallback font — wrong for any text measurement (README.md).
  context.on('response', (res) => {
    if (warnedFs || res.status() !== 403 || !res.url().includes('/@fs/')) return
    warnedFs = true
    console.error(`[harness] Vite refused ${res.url()} (outside the project folder; is node_modules a symlink?). Text renders in a fallback font: see scripts/harness/README.md.`)
  })

  await context.route('**/*', async (route) => {
    const request = route.request()
    let url
    try { url = new URL(request.url()) } catch { return route.abort('blockedbyclient') }
    if (url.protocol === 'data:' || url.protocol === 'blob:' || APP_HOSTS.has(url.hostname)) return route.fallback()
    if (url.hostname === SUPABASE_HOST) return route.fulfill(supabaseAnswer(request, url, store, log))
    // Anything else is the outside world: never reached.
    const fixture = opts.outside ? opts.outside(url, request) : null
    if (fixture) return route.fulfill(fixture)
    log(`blocked ${request.method()} ${url.host}${url.pathname}`)
    if (request.resourceType() === 'image') {
      return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: PIXEL })
    }
    return route.abort('blockedbyclient')
  })
  // WebSockets skip context.route: one to anywhere but the app's own server
  // (Vite's live reload) is closed before it opens — Supabase Realtime included.
  await context.routeWebSocket(url => !APP_HOSTS.has(url.hostname), ws => ws.close())
  return store
}

module.exports = { installMocks, SESSION, USER, OWNER }
