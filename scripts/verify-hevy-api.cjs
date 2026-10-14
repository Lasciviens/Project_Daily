#!/usr/bin/env node
/*
 * Verification — the Hevy edge functions' side of Hevy's public API
 * (migration 154, docs/integrations/hevy.md), against the REAL function text
 * (no unit-test runner by this repo's convention):
 *   1. the shared Hevy block (import → end marker) is identical in all four
 *      functions (hevy-sync, hevy-initial-sync, hevy-incremental-sync,
 *      hevy-api) — the hand-mirrored copy rule;
 *   2. hevy-api's enum lists equal src/features/training/hevyEnums.ts;
 *   3. the shared block's guards and helpers, run through sucrase with a stub
 *      fetch and a stub database: templates (thumbnail_url checked like 154's
 *      CHECK), user info, the count, every page of a list (routine folders
 *      read past page 1), missing templates fetched by id, the pre-154
 *      fallback without thumbnail_url, the account refresh never throwing;
 *   4. the key only ever travels in the `api-key` header, never in a URL or a log;
 *   5. hevy-api dispatches the new actions; the events feed keeps a workout's
 *      newest edit and the cursor is the moment reading began.
 *
 *   Run:  node scripts/verify-hevy-api.cjs
 */
require('sucrase/register')
const fs = require('node:fs')
const path = require('node:path')
const { transform } = require('sucrase')

const root = path.join(__dirname, '..')
const FUNCTIONS = ['hevy-sync', 'hevy-initial-sync', 'hevy-incremental-sync', 'hevy-api']
const src = Object.fromEntries(FUNCTIONS.map(f => [f, fs.readFileSync(path.join(root, 'supabase/functions', f, 'index.ts'), 'utf8')]))
const END = '// ── End of the shared Hevy block'

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`) }
}

// ─── 1. One shared block ────────────────────────────────────────────────────
console.log('\n== The shared Hevy block ==')
const blocks = {}
for (const f of FUNCTIONS) {
  const at = src[f].indexOf(END)
  check(`${f}: has the end marker`, at > 0)
  blocks[f] = at > 0 ? src[f].slice(0, src[f].indexOf('\n', at)) : ''
}
const variants = new Set(Object.values(blocks))
check('the four copies are identical', variants.size === 1, `${variants.size} variants`)
const shared = blocks['hevy-api']
for (const fn of ['upsertWorkoutToDb', 'upsertRoutineToDb', 'cleanExerciseTemplate', 'upsertExerciseTemplatesToDb',
  'fetchExerciseTemplateById', 'ensureExerciseTemplates', 'cleanUserInfo', 'cleanWorkoutCount', 'refreshHevyAccount',
  'hevyListAll', 'syncAllRoutineFolders', 'syncAllExerciseTemplates']) {
  check(`shared block defines ${fn}`, new RegExp(`export (async )?function ${fn}\\(`).test(shared))
}

// ─── 2. Enums mirror the client's ───────────────────────────────────────────
console.log('\n== Enums (hevy-api ↔ hevyEnums.ts) ==')
const enums = require('../src/features/training/hevyEnums')
const listIn = (text, name) => {
  const m = text.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))
  return m ? JSON.parse(m[1].replace(/'/g, '"')) : null
}
for (const [name, list] of [['HEVY_EXERCISE_TYPES', enums.HEVY_EXERCISE_TYPES], ['HEVY_EQUIPMENT', enums.HEVY_EQUIPMENT], ['HEVY_MUSCLE_GROUPS', enums.HEVY_MUSCLE_GROUPS]]) {
  const edge = listIn(src['hevy-api'], name)
  check(`${name}: hevy-api has the same list as the app`, JSON.stringify(edge) === JSON.stringify([...list]), edge)
}
check('hevy-api caps titles at the app\'s HEVY_TITLE_MAX', new RegExp(`const HEVY_TITLE_MAX = ${enums.HEVY_TITLE_MAX}\\b`).test(src['hevy-api']))

// ─── 3. The shared helpers, run ─────────────────────────────────────────────
console.log('\n== Shared helpers (real text, stub fetch and database) ==')
const js = transform(shared, { transforms: ['typescript', 'imports'] }).code

/** A fake Hevy: path → { status, body } or a function of the path. */
function load(routes, db) {
  const calls = []
  const fetch = async (url, init) => {
    const p = url.replace('https://api.hevyapp.com', '')
    calls.push({ path: p, headers: init?.headers ?? {} })
    const hit = typeof routes === 'function' ? routes(p) : routes[p]
    const r = hit ?? { status: 404, body: { error: 'not found' } }
    return { status: r.status, text: async () => (r.body == null ? '' : JSON.stringify(r.body)) }
  }
  const mod = { exports: {} }
  const warnings = []
  const fakeConsole = { warn: m => warnings.push(m), log: () => {}, error: () => {} }
  new Function('exports', 'module', 'require', 'fetch', 'console', js)(
    mod.exports, mod, () => ({ createClient: () => ({}) }), fetch, fakeConsole)
  return { m: mod.exports, calls, warnings, db }
}

/** A database stub with just the calls the shared block makes. */
function fakeDb({ missingThumbnailColumn = false, failTable = null } = {}) {
  const tables = { hevy_exercise_templates: [], hevy_exercise_template_muscles: [], hevy_routine_folders: [], hevy_account: [] }
  const log = []
  const from = (table) => {
    const q = { filters: [], ins: null }
    const rows = () => tables[table].filter(r => q.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)))
    const api = {
      select: () => api,
      eq: (c, v) => { q.filters.push([c, v]); return api },
      in: (c, v) => { q.filters.push([c, v]); return api },
      upsert: async (input, opts) => {
        log.push({ op: 'upsert', table, input })
        if (failTable === table) return { error: { code: '42P01', message: `relation "${table}" does not exist` } }
        const list = Array.isArray(input) ? input : [input]
        if (missingThumbnailColumn && table === 'hevy_exercise_templates' && list.some(r => 'thumbnail_url' in r)) {
          return { error: { code: 'PGRST204', message: "Could not find the 'thumbnail_url' column of 'hevy_exercise_templates' in the schema cache" } }
        }
        const key = (opts?.onConflict ?? 'id').split(',')
        for (const r of list) {
          const i = tables[table].findIndex(x => key.every(k => x[k] === r[k]))
          if (i >= 0) tables[table][i] = { ...tables[table][i], ...r }
          else tables[table].push({ ...r })
        }
        return { error: null }
      },
      insert: async (input) => { log.push({ op: 'insert', table, input }); tables[table].push(...input); return { error: null } },
      delete: () => {
        const d = { filters: [] }
        const run = async () => {
          log.push({ op: 'delete', table, filters: d.filters })
          tables[table] = tables[table].filter(r => !d.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)))
          return { error: null }
        }
        const chain = {
          eq: (c, v) => { d.filters.push([c, v]); return chain },
          in: (c, v) => { d.filters.push([c, v]); return chain },
          then: (res, rej) => run().then(res, rej),
        }
        return chain
      },
      then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    }
    return api
  }
  return { client: { from }, tables, log }
}

const bench = {
  id: '79D0BB3A', title: 'Bench Press (Barbell)', type: 'weight_reps', primary_muscle_group: 'chest',
  secondary_muscle_groups: ['triceps', 'shoulders', 'triceps'], equipment: 'barbell', is_custom: false,
  thumbnail_url: 'https://d2l9nsnmtah87f.cloudfront.net/exercise-thumbnails/79D0BB3A.jpg',
}

;(async () => {
  {
    const { m } = load({})
    const t = m.cleanExerciseTemplate(bench)
    check('a template as the spec shows it is kept, with its picture', t && t.id === '79D0BB3A' && t.thumbnail_url === bench.thumbnail_url && t.primary_muscle_group === 'chest')
    check('secondary muscles are de-duplicated', t && t.secondary_muscle_groups.join() === 'triceps,shoulders', t && t.secondary_muscle_groups)
    check('thumbnail_url null stays null', m.cleanExerciseTemplate({ ...bench, thumbnail_url: null }).thumbnail_url === null)
    check('a missing thumbnail_url (a template from before Hevy had it) is null', m.cleanExerciseTemplate({ ...bench, thumbnail_url: undefined }).thumbnail_url === null)
    check('a non-http picture is dropped (154\'s CHECK would refuse it)', m.cleanExerciseTemplate({ ...bench, thumbnail_url: 'javascript:alert(1)' }).thumbnail_url === null)
    check('a URL with a space is dropped', m.cleanExerciseTemplate({ ...bench, thumbnail_url: 'https://x.example/a b.png' }).thumbnail_url === null)
    check('a URL over 2,048 characters is dropped', m.cleanExerciseTemplate({ ...bench, thumbnail_url: `https://x.example/${'a'.repeat(2100)}` }).thumbnail_url === null)
    check('a template without an id, title or type is skipped', m.cleanExerciseTemplate({ ...bench, id: '' }) === null
      && m.cleanExerciseTemplate({ ...bench, title: '  ' }) === null && m.cleanExerciseTemplate({ ...bench, type: null }) === null)
    check('is_custom is true only when Hevy says true', m.cleanExerciseTemplate({ ...bench, is_custom: 'yes' }).is_custom === false)
    check('a numeric id (POST /v1/exercise_templates answers one) becomes text', m.hevyTemplateId(123) === '123' && m.hevyTemplateId('a/b') === null)

    const u = m.cleanUserInfo({ data: { id: 'x', username: 'lasci', name: 'L', url: 'https://hevy.com/user/lasci', weight_unit: 'kg', distance_unit: 'kilometers', is_pro: true } })
    check('user info is read from { data: UserInfo }', u && u.username === 'lasci' && u.weight_unit === 'kg' && u.distance_unit === 'kilometers' && u.is_pro === true, u)
    check('a bare UserInfo is tolerated', m.cleanUserInfo({ username: 'lasci', weight_unit: 'lbs', distance_unit: 'miles', is_pro: false }).weight_unit === 'lbs')
    const odd = m.cleanUserInfo({ data: { username: '', weight_unit: 'stone', distance_unit: 'km', is_pro: 'yes' } })
    check('values outside Hevy\'s enums are unknown (NULL), never guessed', odd.username === null && odd.weight_unit === null && odd.distance_unit === null && odd.is_pro === null, odd)
    check('the count is read from { workout_count }', m.cleanWorkoutCount({ workout_count: 312 }) === 312)
    check('a missing or negative count is unknown', m.cleanWorkoutCount({}) === null && m.cleanWorkoutCount({ workout_count: -1 }) === null && m.cleanWorkoutCount({ workout_count: '312' }) === null)
  }

  {
    // Routine folders: three pages of at most 10 — the old code read only the first.
    const page = n => Array.from({ length: n === 3 ? 5 : 10 }, (_, i) => ({ id: (n - 1) * 10 + i + 1, index: i, title: `Folder ${(n - 1) * 10 + i + 1}`, updated_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }))
    const db = fakeDb()
    const { m, calls } = load(p => {
      const mm = p.match(/^\/v1\/routine_folders\?page=(\d+)&pageSize=10$/)
      return mm ? { status: 200, body: { page: Number(mm[1]), page_count: 3, routine_folders: page(Number(mm[1])) } } : null
    }, db)
    const n = await m.syncAllRoutineFolders(db.client, 'u1', 'KEY')
    check('routine folders: every page is read (3 pages, pageSize 10)', calls.length === 3 && n === 25, calls.map(c => c.path))
    check('routine folders: all 25 are stored', db.tables.hevy_routine_folders.length === 25)
    check('the key goes in the api-key header', calls.every(c => c.headers['api-key'] === 'KEY') && calls.every(c => !c.path.includes('KEY')))
  }

  {
    // hevyListAll edge cases.
    const { m } = load(p => {
      if (p.startsWith('/v1/a?')) return p.includes('page=1&') ? { status: 200, body: { page_count: 5, a: [{ id: 1 }] } } : { status: 404, body: { error: 'Page not found' } }
      if (p.startsWith('/v1/b?')) return { status: 200, body: { b: 'nope' } }
      if (p.startsWith('/v1/c?')) return p.includes('page=1&') ? { status: 200, body: { c: [{ id: 1 }] } } : { status: 200, body: { c: [] } }
      if (p.startsWith('/v1/d?')) return { status: 500, body: {} }
      return null
    })
    const seen = []
    const a = await m.hevyListAll('/v1/a', 'a', 10, 'K', async items => { seen.push(...items) })
    check('a 404 after page 1 ends the list ("Page not found")', a.complete === true && a.total === 1)
    const b = await m.hevyListAll('/v1/b', 'b', 10, 'K', async () => {})
    check('a page in another shape stops and says incomplete', b.complete === false)
    const c = await m.hevyListAll('/v1/c', 'c', 10, 'K', async () => {})
    check('without page_count it reads on until an empty page', c.complete === true && c.total === 1)
    let threw = null
    try { await m.hevyListAll('/v1/d', 'd', 10, 'K', async () => {}) } catch (e) { threw = e.message }
    check('a 5xx throws "Hevy API <status>" (mapped to 502), never partial success', threw && threw.startsWith('Hevy API 500'), threw)
  }

  {
    // Missing templates are fetched by id; known ones are not.
    const db = fakeDb()
    db.tables.hevy_exercise_templates.push({ id: '79D0BB3A', user_id: 'u1', title: 'Bench Press (Barbell)' })
    const custom = { id: 'c1a2b3c4-0000-4000-8000-000000000001', title: 'Cable Y Raise', type: 'weight_reps', primary_muscle_group: 'shoulders', secondary_muscle_groups: ['upper_back'], is_custom: true, thumbnail_url: null }
    const { m, calls } = load(p => (p === `/v1/exercise_templates/${custom.id}` ? { status: 200, body: custom }
      : p === '/v1/exercise_templates/GONE0001' ? { status: 404, body: { error: 'Exercise template not found' } } : null), db)
    const workouts = [{ exercises: [{ exercise_template_id: '79D0BB3A' }, { exercise_template_id: custom.id }] }, { exercises: [{ exercise_template_id: 'GONE0001' }, { exercise_template_id: custom.id }] }]
    const n = await m.ensureExerciseTemplates(db.client, 'u1', workouts, 'KEY')
    check('only templates not stored are fetched, each once',
      calls.map(c => c.path).sort().join() === [`/v1/exercise_templates/${custom.id}`, '/v1/exercise_templates/GONE0001'].sort().join(), calls.map(c => c.path))
    check('the one Hevy has is stored with its muscles; a 404 is skipped', n === 1 && db.tables.hevy_exercise_templates.some(t => t.id === custom.id && t.is_custom)
      && db.tables.hevy_exercise_template_muscles.some(r => r.exercise_template_id === custom.id && r.muscle_group === 'upper_back'))
    check('a wrapped { exercise_template } answer is tolerated', await (async () => {
      const w = load({ '/v1/exercise_templates/W1': { status: 200, body: { exercise_template: { ...custom, id: 'W1' } } } })
      return (await w.m.fetchExerciseTemplateById('W1', 'K'))?.id === 'W1'
    })())
  }

  {
    // Before migration 154: no thumbnail_url column — the rest is stored.
    const db = fakeDb({ missingThumbnailColumn: true })
    const { m } = load({}, db)
    await m.upsertExerciseTemplatesToDb(db.client, 'u1', [m.cleanExerciseTemplate(bench)])
    const stored = db.tables.hevy_exercise_templates.find(t => t.id === '79D0BB3A')
    check('without the 154 column the template is still stored (no thumbnail_url)', stored && !('thumbnail_url' in stored) && stored.title === bench.title)
    check('muscles: one delete for the batch, one insert', db.log.filter(l => l.table === 'hevy_exercise_template_muscles').map(l => l.op).join() === 'delete,insert')
  }

  {
    // The library: 100 per page.
    const db = fakeDb()
    const { m, calls } = load(p => {
      const mm = p.match(/^\/v1\/exercise_templates\?page=(\d+)&pageSize=100$/)
      if (!mm) return null
      const n = Number(mm[1])
      return { status: 200, body: { page: n, page_count: 2, exercise_templates: [{ ...bench, id: `T${n}A` }, { ...bench, id: `T${n}B`, thumbnail_url: null }, { id: 'bad' }] } }
    }, db)
    const n = await m.syncAllExerciseTemplates(db.client, 'u1', 'K')
    check('the exercise library pages at 100 and stores every valid template', calls.length === 2 && n === 4 && db.tables.hevy_exercise_templates.length === 4, { calls: calls.map(c => c.path), n })
  }

  {
    // The account refresh.
    const ok = fakeDb()
    let r = await load({ '/v1/user/info': { status: 200, body: { data: { username: 'lasci', weight_unit: 'kg', distance_unit: 'kilometers', is_pro: true } } },
      '/v1/workouts/count': { status: 200, body: { workout_count: 312 } } }, ok).m.refreshHevyAccount(ok.client, 'u1', 'K')
    const row = ok.tables.hevy_account[0]
    check('the account row holds user info and the count', r.ok && r.hevy_workout_count === 312 && row.username === 'lasci' && row.hevy_workout_count === 312 && !!row.count_checked_at && !!row.synced_at, row)
    const half = fakeDb()
    r = await load({ '/v1/workouts/count': { status: 200, body: { workout_count: 5 } } }, half).m.refreshHevyAccount(half.client, 'u1', 'K')
    check('user info failing still stores the count (and touches no user field)', !r.ok && half.tables.hevy_account[0].hevy_workout_count === 5 && !('username' in half.tables.hevy_account[0]))
    const missing = fakeDb({ failTable: 'hevy_account' })
    const t = load({ '/v1/user/info': { status: 200, body: { data: { username: 'x' } } }, '/v1/workouts/count': { status: 200, body: { workout_count: 1 } } }, missing)
    r = await t.m.refreshHevyAccount(missing.client, 'u1', 'K')
    check('before migration 154 (no table) it never throws, and says so', r.ok === false && t.warnings.length === 1)
    check('its warning names no key', t.warnings.every(w => !w.includes('K"') && !/api-key/i.test(w)))
  }

  // ─── 4. The key ──────────────────────────────────────────────────────────
  console.log('\n== The key ==')
  for (const f of FUNCTIONS) {
    check(`${f}: no key in a URL`, !/[?&](api[-_]?key|apikey)=/i.test(src[f]))
    check(`${f}: never logs the key`, !/console\.\w+\([^)]*hevyApiKey/.test(src[f]))
    check(`${f}: sends it as the api-key header`, /'api-key': hevyApiKey/.test(src[f]))
  }

  // ─── 5. Dispatch ─────────────────────────────────────────────────────────
  console.log('\n== hevy-api actions ==')
  for (const a of ['exercise_history', 'create_exercise_template', 'create_routine_folder', 'sync_missing_workouts',
    'create_workout', 'update_workout', 'create_routine', 'update_routine', 'upsert_body_measurement']) {
    check(`hevy-api dispatches ${a}`, src['hevy-api'].includes(`case '${a}':`))
  }
  check('hevy-api still checks the caller against HEVY_USER_ID', /user\.id !== ownerId/.test(src['hevy-api']))
  check('the incremental sync refreshes the exercise library and the account', /syncAllExerciseTemplates\(/.test(src['hevy-incremental-sync']) && /refreshHevyAccount\(/.test(src['hevy-incremental-sync']))
  check('the initial sync pages routine folders and refreshes the account', /syncAllRoutineFolders\(/.test(src['hevy-initial-sync']) && /refreshHevyAccount\(/.test(src['hevy-initial-sync']))
  check('the webhook fetches templates a new workout names', /ensureExerciseTemplates\(supabase, userId, \[workout\]/.test(src['hevy-sync']))
  // Events come newest first (the spec): keep the newest edit of a workout.
  check('events: a workout edited twice keeps its NEWEST version', /if \(!seen \|\| time\(event\.workout\) > time\(seen\)\) toUpdate\.set/.test(src['hevy-incremental-sync']))
  // The cursor is the moment reading began, never "now" after the work.
  check('events cursor = when the sync started reading', /const syncStartedAt = new Date\(\)\.toISOString\(\)[\s\S]*Paginate all events[\s\S]*last_events_since: syncStartedAt/.test(src['hevy-incremental-sync']))
  check('Import all sets the cursor to when it started', /const importStartedAt = new Date\(\)\.toISOString\(\)[\s\S]*last_events_since: importStartedAt/.test(src['hevy-initial-sync']))

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
