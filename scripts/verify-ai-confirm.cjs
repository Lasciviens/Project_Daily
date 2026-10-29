#!/usr/bin/env node
/*
 * Verification — the assistant's guardrails in ai-proxy (security audit
 * 10.10.2026). Loads the REAL ai-proxy handler under Node (TypeScript stripped
 * by sucrase) with a stubbed Deno, an in-memory database and a scripted Gemini
 * — no network, no live service:
 *   - a delete from the tool loop only becomes a Confirm card; the row goes only
 *     on Confirm, exactly the rows shown, once, for the same account;
 *   - Cancel deletes nothing; the phone (no button) cannot delete or confirm;
 *   - an account outside the allow-list gets 403;
 *   - the assistant cannot set link columns (google_calendar_event_id …),
 *     cannot pass off a memory as the user's, and play counts are capped;
 *   - it cannot write the retired tomorrow / this_week task sections;
 *   - the app's 'aiWrite' refresh reaches every table it can write.
 *
 *   Run:  node scripts/verify-ai-confirm.cjs
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

const OWNER = 'owner-uuid', STRANGER = 'stranger-uuid'
let script = []
const gemini = (parts) => ({ candidates: [{ content: { role: 'model', parts } }], usageMetadata: {} })
const fetchImpl = async (url) => {
  if (String(url).includes('generativelanguage')) {
    const next = script.shift() ?? gemini([{ text: 'ok' }])
    return { ok: true, status: 200, json: async () => next, text: async () => JSON.stringify(next) }
  }
  throw new Error('unexpected fetch ' + url)
}
const tables = { tasks: [{ id: 't1', user_id: OWNER, title: 'Buy milk' }, { id: 't2', user_id: OWNER, title: 'Keep me' }], app_allowed_users: [] }
const log = []
const env = { GEMINI_API_KEY: 'k', HEVY_USER_ID: OWNER, PHONE_GATEWAY_SECRET: 'phone', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a' }
const handler = load('ai-proxy', { env, tables, users: { 'owner-jwt': OWNER, 'stranger-jwt': STRANGER }, log, fetchImpl })
const call = async (body, headers) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() } }
let ok = 0, bad = 0; const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n) } else { bad++; console.log('  ✗', n, d ?? '') } }

function checkAiWriteGroup() {
  require('sucrase/register')
  const { INVALIDATION_GROUPS } = require(`${REPO}/src/shared/query/invalidate.ts`)
  const { qk } = require(`${REPO}/src/shared/query/keys.ts`)
  const { partialMatchKey } = require('@tanstack/query-core')
  const d = '2026-10-28', w = '2026-10-26'
  // One key (or more) a screen reads each writable table under.
  const SCREENS = {
    tasks: [qk.tasks.day(d, d), qk.tasks.projects()], time_blocks: [qk.schedule.day(d)], training_skips: [qk.training.skips(w)],
    recipes: [qk.recipes.all], recipe_ingredients: [qk.recipes.all], recipe_ingredient_library: [qk.ingredients.all],
    food_log_entries: [qk.foodLog.day(d), qk.mealPlan.dayNutrition(d), qk.health.cutDiary(w, d), qk.supplements.facts(w, d)],
    water_log_entries: [qk.water.day(d)], quick_guess_items: [qk.quickGuess.list()],
    supplement_schedules: [qk.supplements.schedules()], supplement_dose_state: [qk.supplements.facts(w, d)],
    shop_categories: [qk.shop.categories()], shop_items: [qk.shop.items()], shop_item_links: [qk.shop.links()], shop_item_costs: [qk.shop.costs()],
    wish_items: [qk.wishes.all], books: [qk.books.library()], reading_settings: [qk.books.settings()],
    user_movie_entries: [qk.media.userMovies(), qk.media.recent()], user_tv_entries: [qk.media.userTv()],
    user_tv_episodes: [qk.media.watched('e1'), qk.media.nextEpisode('e1'), qk.media.recent()],
    media_watches: [qk.media.userMovies(), qk.media.watched('e1')], movie_cinema_visits: [qk.media.cinemaVisits()],
    projects: [qk.projects.list()], project_phases: [qk.projects.phases()],
    project_blocks: [qk.projects.blocks('p1')], project_entries: [qk.projects.entries('p1'), qk.projects.openQuestions()],
    sleep_night_confirmations: [qk.health.sleepConfirmations], diary_entries: [qk.diary.day('2026-10-28')], athlete_profile: [qk.athlete.profile],
    day_targets: [qk.dayTargets.all], athlete_limitations: [qk.athlete.limitations],
    dev_requests: [qk.devRequests.all], ai_memory: [qk.memory.all],
    // written by its own tools, not the catalogue
    user_transit_stops: [qk.transit.stops()], user_transit_routes: [qk.transit.routes()],
  }
  const src = fs.readFileSync(`${REPO}/supabase/functions/ai-proxy/index.ts`, 'utf8')
  const rw = [...src.matchAll(/^ {2}([a-z_]+): \{\n {4}access: 'rw'/gm)].map(m => m[1])
  check(`DB_CATALOG lists its rw tables (${rw.length})`, rw.length > 25, rw.length)
  const unmapped = rw.filter(t => !SCREENS[t])
  check('every rw table has a screen key here', !unmapped.length, unmapped.join(', '))
  const roots = INVALIDATION_GROUPS.aiWrite
  const stale = Object.entries(SCREENS).flatMap(([t, keys]) => keys.filter(k => !roots.some(r => partialMatchKey(k, r))).map(k => `${t} ${JSON.stringify(k)}`))
  check("'aiWrite' refreshes every one of them", !stale.length, stale.join('; '))
}
;(async () => {
  const web = { authorization: 'Bearer owner-jwt' }
  const msg = [{ role: 'user', content: 'Delete my Buy milk task' }]
  // 1. a delete becomes a proposal
  script = [gemini([{ functionCall: { name: 'db_delete', args: { table: 'tasks', filters: '{"title":"Buy milk"}' } } }])]
  let r = await call({ messages: msg }, web)
  const c = r.body.confirms?.[0]
  check('model delete → Confirm card, nothing deleted', r.status === 200 && c && /Delete 1 task: "Buy milk"/.test(c.summary) && tables.tasks.length === 2, JSON.stringify(r.body))
  // 2. cancel leaves it
  // 3. confirm deletes exactly that row
  r = await call({ confirmAction: { id: c.id, decision: 'confirm' } }, web)
  check('Confirm deletes exactly the shown row', /^Done:/.test(r.body.text) && tables.tasks.length === 1 && tables.tasks[0].id === 't2', JSON.stringify(r.body))
  r = await call({ confirmAction: { id: c.id, decision: 'confirm' } }, web)
  check('a used confirmation cannot run twice', /expired or was already used/.test(r.body.text))
  // 4. cancel path
  script = [gemini([{ functionCall: { name: 'db_delete', args: { table: 'tasks', filters: '{"id":"t2"}' } } }])]
  r = await call({ messages: msg }, web)
  const c2 = r.body.confirms?.[0]
  r = await call({ confirmAction: { id: c2.id, decision: 'cancel' } }, web)
  check('Cancel deletes nothing', /Cancelled/.test(r.body.text) && tables.tasks.length === 1)
  // 5. phone path: no button → refused, loop continues
  script = [gemini([{ functionCall: { name: 'db_delete', args: { table: 'tasks', filters: '{"id":"t2"}' } } }]), gemini([{ text: 'Open the app to delete it.' }])]
  r = await call({ messages: msg, surface: 'general' }, { 'x-phone-secret': 'phone' })
  check('phone: delete refused, no card, nothing deleted', !r.body.confirms && tables.tasks.length === 1 && r.body.text === 'Open the app to delete it.', JSON.stringify(r.body))
  r = await call({ confirmAction: { id: c2.id, decision: 'confirm' } }, { 'x-phone-secret': 'phone' })
  check('phone cannot send a confirmation', r.status === 400)
  // 6. a confirmation belongs to its account
  script = [gemini([{ functionCall: { name: 'db_delete', args: { table: 'tasks', filters: '{"id":"t2"}' } } }])]
  r = await call({ messages: msg }, web)
  const c3 = r.body.confirms?.[0]
  tables.app_allowed_users.push({ user_id: STRANGER })   // even an allowed second account
  r = await call({ confirmAction: { id: c3.id, decision: 'confirm' } }, { authorization: 'Bearer stranger-jwt' })
  check('another account cannot confirm it', /expired or was already used/.test(r.body.text) && tables.tasks.length === 1)
  tables.app_allowed_users = []
  // 7. stranger is refused outright
  r = await call({ messages: msg }, { authorization: 'Bearer stranger-jwt' })
  check('unlisted account → 403', r.status === 403)
  // 8. column guard and memory label
  script = [gemini([{ functionCall: { name: 'db_insert', args: { table: 'time_blocks', values: '{"date":"2026-10-11","title":"x","google_calendar_event_id":"someone-elses"}' } } }]), gemini([{ text: 'done' }])]
  r = await call({ messages: msg }, web)
  check('AI cannot set google_calendar_event_id', !(tables.time_blocks ?? []).length && r.body.steps?.some(s => s.includes('may not set google_calendar_event_id')), JSON.stringify(r.body.steps))
  script = [gemini([{ functionCall: { name: 'db_insert', args: { table: 'ai_memory', values: '{"title":"t","content":"c","kind":"fact","source":"user"}' } } }]), gemini([{ text: 'saved' }])]
  r = await call({ messages: msg }, web)
  check("AI-written memory is labelled 'ai' even when it claims 'user'", tables.ai_memory?.[0]?.source === 'ai', JSON.stringify(tables.ai_memory))
  script = [gemini([{ functionCall: { name: 'db_update', args: { table: 'user_movie_entries', filters: '{"id":"m1"}', values: '{"repeat_count":10000}' } } }]), gemini([{ text: 'x' }])]
  r = await call({ messages: msg }, web)
  check('AI play count capped', r.body.steps?.some(s => s.includes('repeat_count must be')), JSON.stringify(r.body.steps))
  // 8a. the retired Tomorrow / This week sections are never written (taskRules.sectionForDay)
  const tasksBefore = JSON.stringify(tables.tasks)
  script = [gemini([{ functionCall: { name: 'db_insert', args: { table: 'tasks', values: '{"title":"Call mum","section":"tomorrow","due_date":"2026-10-15"}' } } }]), gemini([{ text: 'x' }])]
  r = await call({ messages: msg }, web)
  check('AI cannot file a new task under the retired tomorrow', JSON.stringify(tables.tasks) === tasksBefore && r.body.steps?.some(s => s.includes('tomorrow is a retired task section')), JSON.stringify(r.body.steps))
  script = [gemini([{ functionCall: { name: 'db_update', args: { table: 'tasks', filters: `{"id":"${tables.tasks[0].id}"}`, values: '{"section":"this_week"}' } } }]), gemini([{ text: 'x' }])]
  r = await call({ messages: msg }, web)
  check('AI cannot move a task to the retired this_week', JSON.stringify(tables.tasks) === tasksBefore && r.body.steps?.some(s => s.includes('this_week is a retired task section')), JSON.stringify(r.body.steps))
  // 8b. the card speaks plainly: table words and DD.MM.YYYY dates
  tables.water_log_entries = [{ id: 'w1', user_id: OWNER, amount_ml: 250, date: '2026-10-11' }]
  script = [gemini([{ functionCall: { name: 'db_delete', args: { table: 'water_log_entries', filters: '{"id":"w1"}' } } }])]
  r = await call({ messages: msg }, web)
  check('Confirm card: "Delete 1 water entry: "250 ml on 11.10.2026""', r.body.confirms?.[0]?.summary === 'Delete 1 water entry: "250 ml on 11.10.2026"', r.body.confirms?.[0]?.summary)
  // 9. no embed inside a shared catalogue table (it could list other accounts' rows)
  tables.user_movie_entries = [{ id: 'm1', user_id: OWNER, movie_id: 'mv1' }]
  script = [gemini([{ functionCall: { name: 'db_query', args: { table: 'user_movie_entries', select: '*, movie:movies(title, peers:user_movie_entries(*))' } } }]), gemini([{ text: 'x' }])]
  r = await call({ messages: msg }, web)
  check('embed inside movies is refused', r.body.steps?.some(s => s.includes('nothing may be embedded inside movies')), JSON.stringify(r.body.steps))
  script = [gemini([{ functionCall: { name: 'db_query', args: { table: 'user_movie_entries', select: 'id, status, movie:movies(title, release_date)' } } }]), gemini([{ text: 'x' }])]
  r = await call({ messages: msg }, web)
  check('a plain catalogue embed still works', r.body.steps?.some(s => s.startsWith('✓ db_query')), JSON.stringify(r.body.steps))
  // 10. after a turn AIPanel refreshes the 'aiWrite' group: it must reach a screen's key
  // for every table the assistant may write. A new rw table fails here until mapped.
  checkAiWriteGroup()
  console.log(`\n${ok} passed, ${bad} failed`)
  process.exit(bad ? 1 : 0)
})()
