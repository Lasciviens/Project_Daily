#!/usr/bin/env node
/*
 * Verification — the Google Tasks sync (13.10.2026: "I do not see my tasks.
 * No sync."). Against the REAL un-mocked modules via sucrase (no unit-test
 * runner by convention), plus static checks on the files that must agree:
 *   1. the hand mirror in supabase/functions/google-tasks-sync/index.ts is
 *      identical to src/features/todo/api/googleTasksRules.ts;
 *   2. dates: Google's `due` is a date (read its date part, write midnight UTC);
 *   3. failures: Google's error reasons → what the owner can do;
 *   4. full vs incremental reads;
 *   5. the app's background run, Google links, the toast and the status line;
 *   6. the browser client against a fake Google (errors, dates);
 *   7. the function's wiring, 8. the browser's, 9. migration 145.
 *
 *   Run:  node scripts/verify-google-tasks.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

const R = require('../src/features/todo/api/googleTasksRules')
const Api = require('../src/features/todo/api/googleTasksApi')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const RULES_FILE = 'src/features/todo/api/googleTasksRules.ts'
const FUNCTION_FILE = 'supabase/functions/google-tasks-sync/index.ts'
const fnSource = read(FUNCTION_FILE)
const BLOCK_START = '// <google-tasks-rules>'
const BLOCK_END = '// </google-tasks-rules>'
function block(s) {
  const a = s.indexOf(BLOCK_START)
  const b = s.indexOf(BLOCK_END)
  return a >= 0 && b > a ? s.slice(a, b) : null
}
const fnOutsideBlock = fnSource.replace(block(fnSource) ?? '', '')

function mirrorSection() {
  console.log('\n1 · The edge function carries the same rules')
  const src = block(read(RULES_FILE))
  const fn = block(fnSource)
  check('both files have the <google-tasks-rules> block', !!src && !!fn)
  check('google-tasks-sync mirror is identical to googleTasksRules.ts', src === fn, 'copy the block from the src file into the function')
  check('the function has exactly one block', fnSource.split(BLOCK_START).length === 2)
  check('the block imports nothing', !/^\s*import\b/m.test(src ?? ''))
}

function dateSection() {
  console.log('\n2 · Due dates: a date, never a time')
  check('Google midnight UTC -> that day', R.googleDueToDate('2026-10-13T00:00:00.000Z') === '2026-10-13')
  check('even if Google ever sent a time, the date part is the day', R.googleDueToDate('2026-10-13T23:30:00.000Z') === '2026-10-13')
  check('no due -> null', R.googleDueToDate(undefined) === null && R.googleDueToDate(null) === null && R.googleDueToDate('') === null)
  check('garbage -> null, never a wrong day', R.googleDueToDate('13.10.2026') === null)
  check('a day -> midnight UTC of that day', R.dateToGoogleDue('2026-10-13') === '2026-10-13T00:00:00.000Z')
  check('no day -> null (clears due on PATCH)', R.dateToGoogleDue(null) === null && R.dateToGoogleDue('') === null)
  check('a malformed day is never sent', R.dateToGoogleDue('2026-10-13T12:00') === null && R.dateToGoogleDue('13.10.2026') === null)
  for (const d of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
    check(`round trip ${d} (DST edges, year end)`, R.googleDueToDate(R.dateToGoogleDue(d)) === d)
  }
  // The old browser read converted midnight UTC to a local time: west of UTC
  // that is the evening before. The date part never moves.
  const westOfUtc = new Date('2026-10-13T00:00:00.000Z').getTime() - 4 * 3600_000
  check('what the old local-time read got wrong (UTC-4 sees 12.10)', new Date(westOfUtc).toISOString().slice(0, 10) === '2026-10-12' && R.googleDueToDate('2026-10-13T00:00:00.000Z') === '2026-10-13')
}

const scopeBody = { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED',
  errors: [{ message: 'Insufficient Permission', domain: 'global', reason: 'insufficientPermissions' }],
  details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', domain: 'googleapis.com' }] } }
const disabledBody = { error: { code: 403, message: 'Google Tasks API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED',
  errors: [{ domain: 'usageLimits', reason: 'accessNotConfigured' }],
  details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }] } }

function failureSection() {
  console.log('\n3 · A failed call says what to do')
  check('reasons from errors[] and details[]', JSON.stringify(R.googleErrorReasons(scopeBody)) === JSON.stringify(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']))
  check('no body / odd body -> no reasons', R.googleErrorReasons(null).length === 0 && R.googleErrorReasons('x').length === 0
    && R.googleErrorReasons({ error: { errors: 'x', details: [null, 1, { reason: 7 }] } }).length === 0)
  const k = R.googleTasksFailureKind
  check('401 -> auth (sign-in expired)', k(401, []) === 'auth')
  check('404 -> not_found', k(404, []) === 'not_found')
  check('403 without the Tasks scope -> scope', k(403, R.googleErrorReasons(scopeBody)) === 'scope')
  check('403 with the API turned off -> api_disabled', k(403, R.googleErrorReasons(disabledBody)) === 'api_disabled')
  check('429 -> rate_limit', k(429, []) === 'rate_limit')
  check('403 rateLimitExceeded -> rate_limit', k(403, ['rateLimitExceeded']) === 'rate_limit')
  check('a bare 403 -> other (never guessed from the text)', k(403, []) === 'other')
  check('500 -> other', k(500, []) === 'other')
  const t = R.googleTasksFailureText
  check('scope text says reconnect and allow Tasks', /reconnect Google.*allow Tasks/.test(t('scope', 403, 'x')))
  check('auth text says reconnect', /reconnect Google in Settings → Subscriptions/.test(t('auth', 401)))
  check('api_disabled names the Cloud project', /turned off/.test(t('api_disabled', 403)))
  check('other keeps status and Google\'s message', t('other', 500, ' Backend Error ') === 'Google Tasks error 500: Backend Error')
  check('other without a message', t('other', 502, null) === 'Google Tasks error 502')
}

function planSection() {
  console.log('\n4 · Full or incremental')
  const now = Date.parse('2026-10-13T12:00:00Z')
  const P = R.googleTasksPullPlan
  check('never synced -> full', P(null, now).mode === 'full' && P({}, now).mode === 'full')
  check('no full read recorded (before 145) -> full', P({ last_success_at: '2026-10-13T11:40:00Z' }, now).mode === 'full')
  const inc = P({ last_success_at: '2026-10-13T11:40:00Z', last_full_sync_at: '2026-10-13T01:00:00Z' }, now)
  check('a full read today -> incremental', inc.mode === 'incremental')
  check('incremental starts 60 s before the last clean run', inc.updatedMin === '2026-10-13T11:39:00.000Z')
  check('the last full read a day ago -> full', P({ last_success_at: '2026-10-13T11:40:00Z', last_full_sync_at: '2026-10-12T12:00:00Z' }, now).mode === 'full')
  check('23 h ago -> still incremental', P({ last_success_at: '2026-10-13T11:40:00Z', last_full_sync_at: '2026-10-12T13:00:00Z' }, now).mode === 'incremental')
  check('"Sync now" asks for full', P({ last_success_at: '2026-10-13T11:40:00Z', last_full_sync_at: '2026-10-13T11:40:00Z' }, now, true).mode === 'full')
  check('a broken timestamp reads as never -> full', P({ last_success_at: 'x', last_full_sync_at: 'y' }, now).mode === 'full')
}

function browserRulesSection() {
  console.log('\n5 · Background run, links, toast, status line')
  const now = Date.parse('2026-10-13T12:00:00Z')
  const S = R.shouldBackgroundSync
  check('not connected here -> never', S(null, now, false) === false)
  check('never ran -> run', S(null, now, true) === true)
  check('the cron ran 5 min ago -> wait', S('2026-10-13T11:55:00Z', now, true) === false)
  check('last attempt 10 min ago -> run', S('2026-10-13T11:50:00Z', now, true) === true)

  const L = R.googleTaskLinks
  const links = L([{ type: 'email', description: 'Invoice', link: 'https://mail.google.com/mail/#all/abc' },
    { type: 'generic', description: ' Doc ', link: 'https://docs.google.com/x' },
    { type: 'generic', description: '', link: 'http://example.com' },
    { type: 'generic', description: 'bad', link: 'javascript:alert(1)' },
    { type: 'email', link: 42 }, null, 'x'])
  check('an email link reads "Open email"', links[0] && links[0].label === 'Open email' && links[0].url.startsWith('https://mail.google.com'))
  check('a generic link uses its description', links[1] && links[1].label === 'Doc')
  check('no description -> "Open link"', links[2] && links[2].label === 'Open link')
  check('only http(s) links survive (no javascript:, no non-strings)', links.length === 3)
  check('not a list -> none', L(null).length === 0 && L({ link: 'https://x' }).length === 0)

  const M = R.googleTasksSyncMessage
  check('nothing new', M({ ok: true, added: 0, drained: 0 }) === 'Google Tasks synced · nothing new')
  check('new and sent', M({ ok: true, added: 3, drained: 1 }) === 'Google Tasks synced · 3 new from Google · 1 change sent')
  check('a partial run says where to look', /some steps failed — see Settings → Subscriptions/.test(M({ ok: false, added: 1, drained: 2 })))

  const H = R.googleTasksSyncHealth
  check('no state -> never', H(null).kind === 'never')
  check('success only -> ok', H({ last_success_at: '2026-10-13T11:40:00Z', last_error: null, last_error_at: null }).kind === 'ok')
  const partial = H({ last_success_at: '2026-10-13T11:40:00Z', last_error: 'Calendar: stopped', last_error_at: '2026-10-13T11:40:00Z' })
  check('error in the same run as the success -> partial', partial.kind === 'partial' && partial.error === 'Calendar: stopped')
  const failedRun = H({ last_success_at: '2026-10-12T08:00:00Z', last_error: 'Google refused the stored sign-in (invalid_grant)', last_error_at: '2026-10-13T11:40:00Z' })
  check('a newer failure -> failed, with the last good run', failedRun.kind === 'failed' && failedRun.lastSuccessAt === '2026-10-12T08:00:00Z')
  check('never succeeded, failed -> failed', H({ last_success_at: null, last_error: 'x', last_error_at: '2026-10-13T11:40:00Z' }).kind === 'failed')
  check('an old error before a newer success -> ok', H({ last_success_at: '2026-10-13T11:40:00Z', last_error: 'x', last_error_at: '2026-10-13T10:00:00Z' }).kind === 'ok')
}

async function clientSection() {
  console.log('\n6 · The browser client against a fake Google')
  const calls = []
  let answer = { status: 200, body: { id: 'g1', title: 'T', status: 'needsAction', updated: '2026-10-13T00:00:00Z' } }
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    return { status: answer.status, ok: answer.status >= 200 && answer.status < 300, json: async () => answer.body }
  }
  const task = { title: 'Pay rent', description: null, due_date: '2026-10-31' }
  await Api.createGoogleTask('tok', 'list1', task)
  const sent = JSON.parse(calls[0].init.body)
  check('create sends due as midnight UTC of the day', sent.due === '2026-10-31T00:00:00.000Z')
  check('the token travels in the header, not the URL', calls[0].init.headers.Authorization === 'Bearer tok' && !/tok/.test(calls[0].url))
  await Api.updateGoogleTask('tok', 'list1', 'g1', { ...task, due_date: null })
  check('update with no day clears due (null)', JSON.parse(calls[1].init.body).due === null)

  answer = { status: 403, body: scopeBody }
  let err = null
  try { await Api.getGoogleTask('tok', 'list1', 'g1') } catch (e) { err = e }
  check('a 403 without the scope throws GoogleTasksApiError kind=scope', err instanceof Api.GoogleTasksApiError && err.kind === 'scope' && err.status === 403)
  check('…with the owner-facing text', err && /allow Tasks/.test(err.message))
  answer = { status: 404, body: { error: { message: 'Not Found' } } }
  err = null
  try { await Api.getGoogleTask('tok', 'list1', 'g1') } catch (e) { err = e }
  check('404 stays isGoogleTaskNotFound', Api.isGoogleTaskNotFound(err) && err.kind === 'not_found')
  answer = { status: 502, body: null }
  err = null
  try { await Api.getGoogleTask('tok', 'list1', 'g1') } catch (e) { err = e }
  check('a non-JSON error body still throws a typed error', err instanceof Api.GoogleTasksApiError && err.status === 502)
  check('the old constructor (status, message) still works', new Api.GoogleTasksApiError(500, 'x').kind === 'other')
}

function functionWiringSection() {
  console.log('\n7 · google-tasks-sync wiring')
  const f = fnOutsideBlock
  check('reads completed, hidden and deleted tasks', /showCompleted: 'true', showHidden: 'true', showDeleted: 'true'/.test(f))
  check('pages through nextPageToken at 100 a page', /maxResults: '100'/.test(f) && /pageToken = data\?\.nextPageToken/.test(f))
  check('updatedMin only for an incremental read of a known list',
    /plan\.mode === 'incremental' && !mirror\.newIds\.has\(list\.id\) \? plan\.updatedMin : undefined/.test(f))
  check('the run plan comes from googleTasksPullPlan (with "Sync now"\'s full)', /googleTasksPullPlan\(prevState as AnyRecord \| null, Date\.now\(\), forceFull\)/.test(f))
  check('a clean full run records last_full_sync_at', /errorKeys\.length === 0 && plan\.mode === 'full' \? \{ last_full_sync_at: syncedAt \}/.test(f))
  check('a list whose mirror write fails is reported, not dropped', /mirror\.errors\[l\.id\] = `list not mirrored/.test(f) && /listErrors: \{ \.\.\.mirror\.errors \}/.test(f))
  check('one failing task does not stop its list', /result\.taskErrors\.push\(`task \$\{rt\.id\}/.test(f))
  check('task errors do not hold the watermark back', !/errors\.tasks\s*=/.test(f) && /reported\.tasks = /.test(f))
  check('the upsert sends links and the known parent', /p_google_links: Array\.isArray\(rt\.links\)/.test(f) && /p_parent_task_id: parentLocalId/.test(f))
  check('a missing title is sent as empty, never dropped', /p_title: typeof rt\.title === 'string' \? rt\.title : ''/.test(f))
  check('due is read as a date', /p_due_date: googleDueToDate\(rt\.due\)/.test(f))
  check('due is written as midnight UTC (no local-noon conversion left)', !/T12:00:00/.test(fnSource) && (f.match(/dateToGoogleDue\(task\.due_date\)/g) ?? []).length === 2)
  check('parents resolve from one paged map, not a query per task', /loadLinkedTaskIds\(userId\)/.test(f) && /\.range\(from, from \+ 999\)/.test(f))
  check('"force" drains rows waiting out a backoff', /p_respect_backoff: !force/.test(f))
  check('Google errors carry their kind', /googleTasksFailureKind\(res\.status, googleErrorReasons\(data\)\)/.test(f))
  check('the same problem is logged once, not every 20 minutes', /if \(prevError\.includes\(message\)\) return/.test(f))
  check('the sync state survives a schema without last_full_sync_at', /error\.code === '42703' \|\| error\.code === 'PGRST204'/.test(f))
  check('JWT callers still pass the owner lock', /if \(userId && !\(await isAppUser\(userId\)\)\)/.test(f))
  check('the cron path still acts as HEVY_USER_ID', /if \(secret && syncSecretHeader === secret\) \{\s+userId = Deno\.env\.get\('HEVY_USER_ID'\)/.test(f))
  check('shouldSkipPendingCreate keeps both guards in the function copy',
    /if \(!task\.google_sync_enabled\) return true/.test(f) && /if \(task\.google_task_id && !forceRecreate\) return true/.test(f))
  const toml = read('supabase/config.toml')
  check('config.toml keeps JWT verification off for the cron\'s secret path', /\[functions\.google-tasks-sync\]\s*\nverify_jwt = false/.test(toml))
}

function browserWiringSection() {
  console.log('\n8 · The app')
  const api = read('src/features/todo/api/googleTasksApi.ts')
  const todos = read('src/features/todo/hooks/useTodos.ts')
  const hooks = read('src/features/todo/hooks/useGoogleTasksSync.ts')
  const sync = read('src/features/todo/api/googleTasksSync.ts')
  const outbox = read('src/features/todo/api/googleTasksOutbox.ts')
  check('no local-noon due conversion in the browser client', !/T12:00:00/.test(api) && (api.match(/dateToGoogleDue\(task\.due_date\)/g) ?? []).length === 2)
  check('the browser no longer runs its own pull (one pull: the function)', !/upsert_task_from_google/.test(sync + api + todos + hooks))
  check('"Sync now" runs the function in full, forcing the outbox', /runGoogleTasksSync\(\{ full: true, force: true \}\)/.test(hooks))
  check('the function is called through supabase.functions.invoke (user JWT)', /functions\.invoke\('google-tasks-sync'/.test(sync))
  check('the save-time drain refreshes an expired token first', /ensureValidCalendarToken\(\)/.test(todos) && !/drainGoogleTasksOutbox\(useCalendarStore/.test(todos))
  check('Push refreshes an expired token first', /const token = await ensureValidCalendarToken\(\)/.test(hooks))
  const listHooks = read('src/features/todo/hooks/useGoogleTaskLists.ts')
  check('list add/rename/delete refresh an expired token first', /await ensureValidCalendarToken\(\)/.test(listHooks) && !/useCalendarStore/.test(listHooks))
  check('the save-time drain respects the backoff; Push forces', /p_respect_backoff: !force/.test(outbox) && /drainGoogleTasksOutbox\(token, \{ force: true \}\)/.test(hooks))
  const boot = read('src/app/shell/useAppBootstrap.ts')
  check('the app syncs in the background when it opens', /useGoogleTasksBackgroundSync\(\)/.test(boot))
  const tasksApi = read('src/features/todo/api/tasksApi.ts')
  const all = tasksApi.slice(tasksApi.indexOf('export async function fetchAllTasks'), tasksApi.indexOf('export async function fetchTasksBySection'))
  check('fetchAllTasks pages past 1,000 rows (undated rows sort last)', /\.range\(from, from \+ PAGE - 1\)/.test(all) && /data\.length < PAGE/.test(all))
  const actions = read('src/features/todo/components/ToDoItemActions.tsx')
  check('task rows show Google\'s links (menu and hover strip)', /<GoogleTaskLinkMenuItems task=\{task\} \/>/.test(actions) && /<GoogleTaskLinkButtons task=\{task\} \/>/.test(actions))
  check('one consent list carries the Tasks scope', /'https:\/\/www\.googleapis\.com\/auth\/tasks'/.test(read('src/features/calendar/googleScopes.ts')))
}

function migrationSection() {
  console.log('\n9 · Migration 145')
  const sql = read('supabase/migrations/145_google_tasks_pull_fixes.sql')
  check('drops 076\'s title index (Google allows lists of one name)', /drop index if exists public\.google_task_lists_user_lower_title;/.test(sql))
  const dropAt = sql.indexOf('drop function if exists public.upsert_task_from_google(')
  const createAt = sql.indexOf('create or replace function public.upsert_task_from_google(')
  check('drops the old upsert signature before creating the new one (no overload)', dropAt > 0 && createAt > dropAt)
  check('the old signature dropped is 075\'s 15 arguments',
    /drop function if exists public\.upsert_task_from_google\(\s*text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid\s*\)/.test(sql))
  check('p_google_links is the last parameter', /p_user_id\s+uuid\s+default null,\s*p_google_links\s+jsonb\s+default null\s*\)/.test(sql))
  check('grants: only the service role (no anon, no signed-in browser)',
    (sql.match(/from public, anon, authenticated;/g) || []).length === 2 && !/to authenticated/.test(sql) && (sql.match(/to service_role;/g) || []).length === 2)
  check('adds last_full_sync_at if missing', /add column if not exists last_full_sync_at timestamptz/.test(sql))
  check('no BEGIN/COMMIT', !/^\s*(begin|commit)\s*;/im.test(sql))
  check('the DB scenarios run in the PR check', /node scripts\/verify-db-google-tasks-pull\.mjs/.test(read('.github/workflows/pr-check.yml')))
}

;(async () => {
  mirrorSection()
  dateSection()
  failureSection()
  planSection()
  browserRulesSection()
  await clientSection()
  functionWiringSection()
  browserWiringSection()
  migrationSection()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
