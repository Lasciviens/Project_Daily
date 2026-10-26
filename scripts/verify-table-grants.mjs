// From 30.10.2026 Supabase gives a new table in `public` no Data API access by
// itself (the default privileges for anon, authenticated and service_role go;
// tables that exist keep theirs). So every migration after 165 — the last one
// deployed before that day — that creates a table in public must grant it:
//   - service_role: select, insert, update, delete (edge functions and the
//     scale/phone/Kobo gateways use the server key);
//   - authenticated: what the app does with it — or a revoke from
//     authenticated, for a token table that only the service role reads;
//   - never anon (the owner lock: nobody signed out uses the app);
//   - a serial column's sequence: `grant usage` (an identity column needs none).
// Static: reads the migration files, no database. The checker runs on known
// good and broken samples first, so a parser that sees nothing fails too.
// Background: docs/backend/database.md (point 10).
//   node scripts/verify-table-grants.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CUTOFF = 165
const CRUD = ['select', 'insert', 'update', 'delete']

const bare = name => name.trim().replace(/"/g, '').replace(/^public\./i, '').toLowerCase()

/** Each statement of a migration, comments removed (dollar-quoted bodies split badly but never start with grant/revoke). */
function statements(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(s => s.trim().replace(/\s+/g, ' '))
}

/** The tables a migration creates in public, with their serial columns. */
function createdTables(sql) {
  const src = sql.replace(/--.*$/gm, '')
  const out = []
  for (const m of src.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi)) {
    const full = m[1].replace(/"/g, '')
    if (full.includes('.') && !/^public\./i.test(full)) continue
    // The column list: up to the bracket that closes the one after the name.
    let depth = 0
    let end = m.index + m[0].length - 1
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++
      else if (src[end] === ')' && --depth === 0) break
    }
    const body = src.slice(m.index + m[0].length, end)
    const serials = [...body.matchAll(/(?:^|[,(])\s*"?(\w+)"?\s+(?:small|big)?serial\d?\b/gim)].map(x => x[1].toLowerCase())
    out.push({ table: bare(full), serials })
  }
  return out
}

/** grant / revoke statements on tables or sequences: { kind, privileges, objects, roles, onSequence, allTables }. */
function grantsOf(sql) {
  const out = []
  for (const s of statements(sql)) {
    const g = s.match(/^grant (.+?) on (?:(table|sequence) )?(.+?) to (.+?)(?: with grant option)?$/i)
    const r = s.match(/^revoke (.+?) on (?:(table|sequence) )?(.+?) from (.+?)(?: cascade| restrict)?$/i)
    const m = g ?? r
    if (!m) continue
    const target = m[3]
    if (/^(function|procedure|routine|schema|all (functions|routines|procedures|sequences)) /i.test(target)) continue
    const allTables = /^all tables in schema public$/i.test(target)
    out.push({
      kind: g ? 'grant' : 'revoke',
      privileges: m[1].toLowerCase().split(',').map(p => p.trim().replace(/ privileges$/, '')),
      objects: allTables ? [] : target.split(',').map(bare),
      roles: m[4].toLowerCase().split(',').map(x => x.trim()),
      onSequence: (m[2] ?? '').toLowerCase() === 'sequence',
      allTables,
    })
  }
  return out
}

/** What a migration is missing, one line per problem. */
export function grantProblems(sql) {
  const problems = []
  const grants = grantsOf(sql)
  const on = (table, kind, role) => grants.filter(x => x.kind === kind && !x.onSequence && x.roles.includes(role)
    && (x.allTables || x.objects.includes(table)))
  for (const { table, serials } of createdTables(sql)) {
    const privs = new Set(on(table, 'grant', 'service_role').flatMap(x => x.privileges))
    if (!privs.has('all') && !CRUD.every(p => privs.has(p))) {
      problems.push(`${table}: no "grant select, insert, update, delete on public.${table} to service_role"`)
    }
    if (!on(table, 'grant', 'authenticated').length && !on(table, 'revoke', 'authenticated').length) {
      problems.push(`${table}: no grant to authenticated (or, for a token table, a revoke from authenticated)`)
    }
    if (on(table, 'grant', 'anon').length) problems.push(`${table}: granted to anon (nobody signed out uses the app)`)
    for (const col of serials) {
      const seq = `${table}_${col}_seq`
      if (!grants.some(x => x.kind === 'grant' && x.onSequence && x.objects.includes(seq) && x.privileges.includes('usage') && x.roles.includes('service_role'))) {
        problems.push(`${table}.${col}: a serial column, but no "grant usage on sequence public.${seq}" to the roles that insert`)
      }
    }
  }
  return problems
}

let passed = 0
let failed = 0
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('1. the checker on known samples')
const TABLE = 'create table if not exists public.things (\n  id uuid primary key default gen_random_uuid(),\n  user_id uuid not null\n);\n'
const FULL = 'grant select, insert, update, delete on public.things to authenticated;\ngrant select, insert, update, delete on public.things to service_role;\n'
const samples = [
  ['both roles granted', TABLE + FULL, 0],
  ['one statement for both roles and two tables',
    TABLE + 'create table public.other (id uuid);\ngrant select, insert, update, delete on table public.things, public.other to authenticated, service_role;', 0],
  ['grant all to service_role', TABLE + 'grant select on public.things to authenticated;\ngrant all privileges on table public.things to service_role;', 0],
  ['a token table: service_role only, revoked from the browser roles',
    TABLE + 'revoke all on public.things from anon, authenticated;\ngrant select, insert, update, delete on public.things to service_role;', 0],
  ['another schema is not checked', 'create table if not exists deploy.applied (name text);', 0],
  ['a grant inside a comment does not count', TABLE + '-- grant select, insert, update, delete on public.things to service_role;\ngrant select on public.things to authenticated;', 1],
  ['no grants at all', TABLE, 2],
  ['service_role missing', TABLE + 'grant select, insert, update, delete on public.things to authenticated;', 1],
  ['service_role may only read', TABLE + 'grant select, insert, update, delete on public.things to authenticated;\ngrant select on public.things to service_role;', 1],
  ['the grant names another table', TABLE + FULL.replaceAll('public.things', 'public.thing'), 2],
  ['granted to anon', TABLE + FULL + 'grant select on public.things to anon;', 1],
  ['a serial column without its sequence', 'create table public.counts (\n  id bigserial primary key,\n  n int\n);\n' + FULL.replaceAll('things', 'counts'), 1],
  ['a serial column with its sequence',
    'create table public.counts (\n  id bigserial primary key,\n  n int\n);\n' + FULL.replaceAll('things', 'counts')
    + 'grant usage, select on sequence public.counts_id_seq to authenticated, service_role;', 0],
  ['an identity column needs no sequence grant', 'create table public.counts (\n  id bigint generated always as identity primary key\n);\n' + FULL.replaceAll('things', 'counts'), 0],
]
for (const [name, sql, want] of samples) {
  const got = grantProblems(sql)
  check(`${name}: ${want} problem(s)`, got.length === want, got.join('; ') || 'none')
}
// A real migration from before the cutoff: the parser must see its authenticated grants and
// report only the service_role ones it never needed then.
const m163 = grantProblems(readFileSync(join(root, 'supabase/migrations/163_football.sql'), 'utf8'))
check('163 (before the cutoff) reads as granted to authenticated, not to service_role',
  m163.length === 2 && m163.every(p => /to service_role/.test(p)), m163.join('; '))

console.log(`2. migrations after ${CUTOFF} grant every new table`)
const migs = readdirSync(join(root, 'supabase/migrations')).filter(f => /^\d+_.*\.sql$/.test(f) && parseInt(f, 10) > CUTOFF).sort()
if (!migs.length) check(`no migrations after ${CUTOFF} yet`, true)
for (const f of migs) {
  const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8')
  const tables = createdTables(sql)
  if (!tables.length) continue
  const problems = grantProblems(sql)
  check(`${f}: ${tables.map(t => t.table).join(', ')}`, !problems.length, problems.join('; '))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
