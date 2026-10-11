#!/usr/bin/env node
/*
 * Verification — the owner lock (migration 139, security audit 10.10.2026).
 *
 * The app serves one owner (plus an optional test account in
 * app_allowed_users). Static checks that keep it that way:
 *   1. every edge function that resolves a browser caller (auth.getUser) also
 *      calls isAppUser() on it, and every copy of isAppUser() is identical
 *      (functions are self-contained, so each carries its own copy);
 *   2. isAppUser() itself: the owner passes without a database call, a listed
 *      account passes, anyone else (or a failed lookup) is refused — run on the
 *      real function text with a stub client;
 *   3. migration 139 has its self-check, its undo and the storage policy;
 *   4. every migration after 139 that creates a table in public also calls
 *      public.owner_lock_apply() on it (a new table would otherwise be open to
 *      any signed-in account).
 *
 *   Run:  node scripts/verify-owner-lock.cjs
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// Functions whose browser callers are not checked by isAppUser on purpose.
//   hevy-*, screenscraper-sync: compare the caller with HEVY_USER_ID themselves.
const OWN_OWNER_CHECK = ['hevy-api', 'hevy-incremental-sync', 'hevy-initial-sync', 'screenscraper-sync']

const fnDir = 'supabase/functions'
const fns = fs.readdirSync(path.join(root, fnDir)).filter(d => fs.existsSync(path.join(root, fnDir, d, 'index.ts')))
const helperRe = /async function isAppUser\(userId: string\): Promise<boolean> \{[\s\S]*?\n\}\n/

console.log('1. every browser-facing edge function checks the owner')
const copies = new Set()
for (const fn of fns) {
  const src = read(`${fnDir}/${fn}/index.ts`)
  const browser = /auth\.getUser\(/.test(src)
  if (!browser) continue
  if (OWN_OWNER_CHECK.includes(fn)) {
    check(`${fn}: compares the caller with HEVY_USER_ID`, /HEVY_USER_ID/.test(src))
    continue
  }
  const m = src.match(helperRe)
  check(`${fn}: has isAppUser()`, !!m)
  check(`${fn}: calls isAppUser() on the caller`, (src.match(/await isAppUser\(/g) || []).length >= 1)
  if (m) copies.add(m[0])
}
check('steam-api and food-search resolve the caller (verify_jwt alone admits the anon key)',
  ['steam-api', 'food-search'].every(fn => /auth\.getUser\(/.test(read(`${fnDir}/${fn}/index.ts`))))
check('every isAppUser() copy is identical', copies.size === 1, `${copies.size} variants`)

console.log('2. isAppUser() behaviour (real text, stub client)')
const helper = [...copies][0]
if (helper) {
  const js = require('sucrase').transform(helper, { transforms: ['typescript'] }).code
  const make = (rows, fail) => {
    const calls = { db: 0 }
    const createClient = () => ({
      from: () => ({ select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => {
        calls.db++
        if (fail) return { data: null, error: { message: 'relation does not exist' } }
        return { data: rows.includes(v) ? { user_id: v } : null, error: null }
      } }) }) }),
    })
    const Deno = { env: { get: k => ({ HEVY_USER_ID: 'owner', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] } }
    // eslint-disable-next-line no-new-func
    const isAppUser = new Function('createClient', 'Deno', `${js}; return isAppUser`)(createClient, Deno)
    return { isAppUser, calls }
  }
  ;(async () => {
    let t = make(['test'], false)
    check('owner passes without a database call', (await t.isAppUser('owner')) === true && t.calls.db === 0)
    check('a listed test account passes', (await t.isAppUser('test')) === true)
    check('anyone else is refused', (await t.isAppUser('stranger')) === false)
    t = make([], true)
    check('owner still passes before migration 139 (table missing)', (await t.isAppUser('owner')) === true)
    check('a failed lookup refuses everyone else', (await t.isAppUser('test')) === false)
    rest()
  })()
} else rest()

function rest() {
  console.log('3. migration 139')
  const m = read('supabase/migrations/139_owner_lock.sql')
  check('allow-list table is not readable by the browser roles', /revoke all on table public\.app_allowed_users from anon, authenticated/.test(m))
  check('restrictive policy on every public table', /as restrictive for all to public/.test(m) && /owner_lock_apply\(r\.t\)/.test(m))
  check('restrictive policy on storage.objects', /create policy app_owner_lock on storage\.objects as restrictive/.test(m))
  check('self-check compares the owner before/after and a stranger', /owner_lock_counts\(v_owner\)/.test(m) && /owner_lock_counts\(gen_random_uuid\(\)\)/.test(m))
  check('runs as one repeatable-read transaction', /\nbegin isolation level repeatable read;/.test(m) && /\ncommit;\s*$/.test(m))
  check('undo function exists and is not callable from the browser', /function public\.owner_lock_disable\(\)/.test(m) && /revoke all on function public\.owner_lock_disable\(\) from public, anon, authenticated/.test(m))
  check('owner detection refuses anything but exactly one account', /array_length\(v_ids, 1\), 0\) <> 1/.test(m))

  console.log('4. tables created after 139 carry the lock')
  const migs = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => /^\d+_.*\.sql$/.test(f) && parseInt(f, 10) > 139).sort()
  if (!migs.length) check('no later migrations yet', true)
  for (const f of migs) {
    const src = read(`supabase/migrations/${f}`).replace(/--.*$/gm, '')
    const created = [...src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?)([a-z_][a-z0-9_]*)\1/gi)]
      .map(x => x[2]).filter(t => !/^pg_temp|^temp/i.test(t))
    for (const t of created) {
      const re = new RegExp(`owner_lock_apply\\(\\s*'(?:public\\.)?${t}'`, 'i')
      check(`${f}: ${t} calls owner_lock_apply`, re.test(src))
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
