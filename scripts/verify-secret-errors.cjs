#!/usr/bin/env node
/*
 * Verification — server keys never come back in an error (security audit
 * 10.10.2026). Deno's fetch rejects with a TypeError that quotes the request
 * URL; ai-proxy, steam-api, igdb-api and trakt-api used to return that text,
 * key included, to the caller (and on into app_error_logs and the model).
 *
 * Loads each REAL handler under Node (TypeScript stripped by sucrase) with a
 * stubbed Deno, an in-memory database and every outside call failing — no
 * network — and checks the answer contains none of the keys.
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

;(async () => {
  const cases = [
    ['ai-proxy', { messages: [{ role: 'user', content: 'hi' }] }],
    ['steam-api', { action: 'profile' }],
    ['igdb-api', { action: 'search', query: 'Zelda' }],
    ['trakt-api', { action: 'ratings', mediaType: 'movie', tmdbId: 603 }],
  ]
  for (const [fn, body] of cases) {
    const handler = load(fn, { env, tables: { app_allowed_users: [] }, users: { 'owner-jwt': 'owner' }, log: [], fetchImpl: failing })
    const res = await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-jwt' }, body: JSON.stringify(body) }))
    const text = await res.text()
    const l = leaks(text)
    check(`${fn}: a network failure answers ${res.status} without any key`, l.length === 0, `leaked ${l.join(', ')} in ${text.slice(0, 200)}`)
  }
  console.log(`\n${ok} passed, ${bad} failed`)
  process.exit(bad ? 1 : 0)
})()
