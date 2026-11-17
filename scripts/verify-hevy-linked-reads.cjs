// Checks that Training's linked reads (src/features/training/api/hevyApi.ts: a routine or a workout with its
// exercises and sets from ONE request) answer exactly what the level-by-level reads answer, and that a refused
// link falls back to them. Runs the real api module against the harness's PostgREST copy and made-up data.
//   node scripts/verify-hevy-linked-reads.cjs
require('sucrase/register')
const assert = require('assert')
const path = require('path')
const Module = require('module')
const fs = require('fs')
const { transform } = require('sucrase')
const { createClient } = require('@supabase/supabase-js')
const { Store, handleRest } = require('./harness/postgrest.cjs')
const { OWNER, RELATIONS, DEFAULTS, buildTables } = require('./harness/seed.cjs')

let n = 0
const check = (name, ok, extra = '') => { assert.ok(ok, `${name} ${extra}`); n++ }

const store = new Store({ tables: buildTables(new Date('2026-11-17T09:00:00Z')), relations: RELATIONS, ownerId: OWNER.id, log: () => {}, defaults: DEFAULTS })
const calls = []
let refuse = null   // null | 'PGRST200' | 'boom'
async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const linked = /hevy_[a-z_]+\(/.test(decodeURIComponent(url.search))
  calls.push({ table: url.pathname.replace('/rest/v1/', ''), linked })
  if (linked && refuse === 'PGRST200') return new Response(JSON.stringify({ code: 'PGRST200', message: "Could not find a relationship between 'a' and 'b' in the schema cache" }), { status: 400, headers: { 'content-type': 'application/json' } })
  if (linked && refuse === 'boom') return new Response(JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }), { status: 500, headers: { 'content-type': 'application/json' } })
  const headers = Object.fromEntries([...new Headers(init.headers || {}).entries()].map(([k, v]) => [k.toLowerCase(), v]))
  const res = handleRest(store, { method: init.method || 'GET', url, headers, body: init.body ? JSON.parse(init.body) : null }, {})
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers })
}
const supabase = createClient('https://mock.supabase.co', 'mock', { global: { fetch: mockFetch }, auth: { persistSession: false, autoRefreshToken: false } })
const logged = []

/** A fresh copy of the api module (its "linked reads off" memory starts clean). */
function freshApi() {
  const file = path.join(__dirname, '../src/features/training/api/hevyApi.ts')
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k]
  const load = Module._load
  Module._load = function (request, parent, isMain) {
    if (/integrations\/supabase\/client$/.test(request)) return { supabase }
    if (/shared\/utils\/logError$/.test(request)) return { logError: (m, c) => { logged.push({ m, c }) } }
    if (/shared\/utils\/requireUser$/.test(request)) return { currentUserId: async () => OWNER.id, requireUser: async () => ({ id: OWNER.id }) }
    return load.call(this, request, parent, isMain)
  }
  try {
    // The file reads import.meta.env (its edge-function calls), which only a bundler understands: compile it here.
    const code = transform(fs.readFileSync(file, 'utf8').replace(/import\.meta\.env/g, '({})'), { transforms: ['typescript', 'imports'], filePath: file }).code
    const m = new Module(file, module)
    m.filename = file
    m.paths = Module._nodeModulePaths(path.dirname(file))
    m._compile(code, file)
    return m.exports
  } finally { Module._load = load }
}

const FROM = '2026-05-01T00:00:00.000Z', TO = '2026-11-18T00:00:00.000Z'
const rounds = () => { const out = calls.map(c => c.table + (c.linked ? '+' : '')); calls.length = 0; return out }

;(async () => {
  // ── linked ─────────────────────────────────────────────────────────────────
  refuse = null
  let api = freshApi()
  const routinesLinked = await api.fetchHevyRoutines()
  const rRounds = rounds()
  const volumeLinked = await api.fetchMuscleVolume(FROM, TO)
  const vRounds = rounds()
  const historyLinked = await api.fetchTrainingHistory(FROM, TO)
  const hRounds = rounds()
  check('the made-up data has routines, exercises and sets to compare', routinesLinked.length >= 3 && routinesLinked.every(r => r.exercises.length > 0 && r.exercises.every(e => e.sets.length > 0)))
  console.log('   routines', routinesLinked.length, '· volume rows', volumeLinked.length, '· history sets', historyLinked.sets.length, '· templates', historyLinked.templates.length)
  check('…and workouts with working sets', volumeLinked.length > 20 && historyLinked.sets.length > 50 && historyLinked.templates.length > 3)
  check('routines: one request (it took four rounds)', rRounds.length === 1 && rRounds[0] === 'hevy_routines+', rRounds.join(', '))
  check('the muscle volume: one request (it took three rounds)', vRounds.length === 1 && vRounds[0] === 'hevy_workouts+', vRounds.join(', '))
  check('the training history: one request, then the exercise names', hRounds[0] === 'hevy_workouts+' && hRounds.slice(1).every(t => /^hevy_exercise_template/.test(t)) && hRounds.length === 3, hRounds.join(', '))
  check('nothing was logged', logged.length === 0)

  // ── the API can't follow a link → level by level, for the rest of the session ──
  refuse = 'PGRST200'
  api = freshApi()
  const routinesOld = await api.fetchHevyRoutines()
  const r2 = rounds()
  const volumeOld = await api.fetchMuscleVolume(FROM, TO)
  const v2 = rounds()
  const historyOld = await api.fetchTrainingHistory(FROM, TO)
  rounds()
  check('a refused link falls back to the level-by-level read', r2[0] === 'hevy_routines+' && r2.includes('hevy_routine_exercises') && r2.includes('hevy_routine_sets'), r2.join(', '))
  check('…is logged once, without data', logged.length === 1 && /hevy_linked_read_refused: routines/.test(logged[0].m) && logged[0].c.code === 'PGRST200')
  check('…and the linked read is not tried again this session', !v2.some(t => t.endsWith('+')) && v2[0] === 'hevy_workouts', v2.join(', '))

  // ── the answers are the same, to the last field and in the same order ───────
  const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true } catch (e) { return String(e.message).slice(0, 400) } }
  check('routines: the linked answer equals the level-by-level one', same(routinesLinked, routinesOld) === true, same(routinesLinked, routinesOld))
  check('…with the same keys on a routine and on an exercise (no leftover link fields)',
    same(Object.keys(routinesLinked[0]).sort(), Object.keys(routinesOld[0]).sort()) === true
    && same(Object.keys(routinesLinked[0].exercises[0]).sort(), Object.keys(routinesOld[0].exercises[0]).sort()) === true)
  check('…and a routine in a folder carries it, one without has none', routinesLinked.some(r => r.folder && r.folder.title) && routinesLinked.filter(r => r.folder_id == null).every(r => r.folder === undefined))
  check('the muscle volume: equal, row for row', same(volumeLinked, volumeOld) === true, same(volumeLinked, volumeOld))
  check('the training history: equal, set for set', same(historyLinked, historyOld) === true, same(historyLinked, historyOld))

  // ── any other failure of the linked read also falls back, but is tried again next time ──
  refuse = 'boom'
  logged.length = 0
  api = freshApi()
  const routinesBoom = await api.fetchHevyRoutines()
  const b1 = rounds()
  refuse = null
  await api.fetchHevyRoutines()
  const b2 = rounds()
  check('a linked read that fails for another reason still answers (level by level)', same(routinesBoom, routinesOld) === true && b1.includes('hevy_routine_sets'))
  check('…and the linked read is tried again next time', b2.length === 1 && b2[0] === 'hevy_routines+' && logged.length === 0, b2.join(', '))

  // ── empty account ──────────────────────────────────────────────────────────
  for (const t of ['hevy_routines', 'hevy_routine_exercises', 'hevy_routine_sets', 'hevy_workouts', 'hevy_workout_exercises', 'hevy_sets']) store.tables[t] = []
  api = freshApi()
  check('an empty account: empty answers', same(await api.fetchHevyRoutines(), []) === true && same(await api.fetchMuscleVolume(FROM, TO), []) === true && same(await api.fetchTrainingHistory(FROM, TO), { sets: [], templates: [] }) === true)

  console.log(`${n} passed, 0 failed`)
})().catch(e => { console.error(e.stack || e); process.exit(1) })
