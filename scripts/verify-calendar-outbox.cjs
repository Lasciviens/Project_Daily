#!/usr/bin/env node
/*
 * Verification — the Calendar outbox (migration 135): a time block deleted on
 * the server gets its Google Calendar event removed by google-tasks-sync.
 *
 * Against the REAL un-mocked module via sucrase (no unit-test runner by
 * convention), plus static checks on the files that must agree with it:
 *   1. the hand mirror in supabase/functions/google-tasks-sync/index.ts is
 *      identical to src/features/calendar/calendarOutboxRules.ts;
 *   2–5. Google's status → outcome, the retry curve, the missing-table guard,
 *      the request path and error text;
 *   6. the drain loop with fake I/O (stop, retry, kept, out of time, a row
 *      that fails after Google already deleted the event);
 *   7. every place that links an event uses the calendar the trigger queues;
 *   8. migration 135's shape, and 9. the function's wiring.
 *
 *   Run:  node scripts/verify-calendar-outbox.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

const R = require('../src/features/calendar/calendarOutboxRules')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const RULES_FILE = 'src/features/calendar/calendarOutboxRules.ts'
const FUNCTION_FILE = 'supabase/functions/google-tasks-sync/index.ts'
const MIGRATION_FILE = 'supabase/migrations/135_calendar_outbox.sql'
const fnSource = read(FUNCTION_FILE)
const migration = read(MIGRATION_FILE)

const BLOCK_START = '// <calendar-outbox-rules>'
const BLOCK_END = '// </calendar-outbox-rules>'
function block(s) {
  const a = s.indexOf(BLOCK_START)
  const b = s.indexOf(BLOCK_END)
  return a >= 0 && b > a ? s.slice(a, b) : null
}
// The function's own code, without the mirrored block (for wiring checks).
const fnOutsideBlock = fnSource.replace(block(fnSource) ?? '', '')

function mirrorSection() {
  console.log('\n1 · The edge function carries the same rules')
  const src = block(read(RULES_FILE))
  const fn = block(fnSource)
  check('both files have the <calendar-outbox-rules> block', !!src && !!fn)
  check('google-tasks-sync mirror is identical to calendarOutboxRules.ts', src === fn, 'copy the block from the src file into the function')
  check('the function has exactly one block', fnSource.split(BLOCK_START).length === 2)
}

function outcomeSection() {
  console.log('\n2 · Google\'s answer → what happens to the row')
  const o = R.calendarDeleteOutcome
  check('204 No Content (events.delete success) -> deleted', o(204) === 'deleted')
  check('200 -> deleted', o(200) === 'deleted')
  check('404 -> gone (never existed / purged)', o(404) === 'gone')
  check('410 "Resource has been deleted" -> gone (already in the bin, e.g. the browser removed it first)', o(410) === 'gone')
  check('401 -> stop the run', o(401) === 'stop')
  check('403 (scope missing, or Google\'s 403 rate limit) -> stop the run', o(403) === 'stop')
  check('429 -> stop the run', o(429) === 'stop')
  for (const s of [500, 502, 503, 504, 400, 409, 412]) check(`${s} -> retry`, o(s) === 'retry')
  check('no HTTP answer (null) -> retry', o(null) === 'retry')
  check('NaN -> retry, never deleted', o(NaN) === 'retry')
}

function retrySection() {
  console.log('\n3 · Retry curve = the Tasks outbox\'s own')
  const d = R.calendarRetryDelaySeconds
  const tasksCurve = (attempts) => Math.min(3600, 30 * 2 ** attempts)
  check('google-tasks-sync\'s Tasks drain still uses min(3600, 30·2^attempts)',
    /Math\.min\(3600, 30 \* 2 \*\* attempts\)/.test(fnOutsideBlock))
  let same = true
  for (let a = 1; a < R.CALENDAR_PARK_AFTER; a++) if (d(a) !== tasksCurve(a)) same = false
  check('attempts 1..7 match the Tasks curve exactly', same && R.CALENDAR_PARK_AFTER === 8)
  check('first failure waits 60 s', d(1) === 60)
  check('then doubles: 120, 240, 480', d(2) === 120 && d(3) === 240 && d(4) === 480)
  check('capped at an hour (attempt 7 would be 3840 s)', d(7) === 3600)
  check('parked from the 8th failure: once a day', d(8) === 86400 && d(1000) === 86400)
  check('0 / negative / NaN read as the first failure', d(0) === 60 && d(-3) === 60 && d(NaN) === 60)
  check('a fraction rounds down', d(2.9) === 120)
}

function missingTableSection() {
  console.log('\n4 · Missing table = migration 135 not applied')
  const m = R.isMissingTableError
  check('Postgres 42P01', m({ code: '42P01', message: 'relation "public.calendar_outbox" does not exist' }))
  check('PostgREST PGRST205', m({ code: 'PGRST205', message: "Could not find the table 'public.calendar_outbox' in the schema cache" }))
  check('message only', m({ message: "Could not find the table 'public.calendar_outbox' in the schema cache" }))
  check('permission denied is a real error', !m({ code: '42501', message: 'permission denied for table calendar_outbox' }))
  check('a JWT error is a real error', !m({ code: 'PGRST301', message: 'JWT expired' }))
  check('null / undefined', !m(null) && !m(undefined))
}

function pathSection() {
  console.log('\n5 · Request path and error text')
  const p = R.calendarEventPath
  check('primary + a plain id', p('primary', 'abc123') === '/calendars/primary/events/abc123')
  check('ids are encoded like calendarApi.ts', p('me@example.com', 'a/b#c d') === '/calendars/me%40example.com/events/a%2Fb%23c%20d')
  check('a block uuid with dashes stripped stays as it is',
    p('primary', '0f3c2b1a9e8d4c7b8a6f5e4d3c2b1a09') === '/calendars/primary/events/0f3c2b1a9e8d4c7b8a6f5e4d3c2b1a09')
  check('calendarApi.ts builds its event paths the same way',
    read('src/features/calendar/api/calendarApi.ts').includes('`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`'))
  const t = R.errorText
  check('Error -> its message', t(new Error('boom')) === 'boom')
  check('Error without a message -> its name', t(new TypeError('')) === 'TypeError')
  check('a supabase-js error object -> its message', t({ message: 'duplicate key', code: '23505' }) === 'duplicate key')
  check('anything else -> String()', t('plain') === 'plain' && t(42) === '42' && t(null) === 'null')
}

const row = (event, attempts = 0) => ({ id: `row-${event}`, calendar_id: 'primary', event_id: event, attempts })

function fakeDeps(answers, opts = {}) {
  const log = { asked: [], removed: [], backedOff: [] }
  const deps = {
    stillLinked: new Set(opts.stillLinked ?? []),
    deleteEvent: async (r) => {
      log.asked.push(r.event_id)
      const a = answers[r.event_id]
      if (a instanceof Error) throw a
      return a ?? { status: 204, message: '' }
    },
    removeRow: async (r) => {
      // supabase-js throws plain objects, not Errors
      if (opts.removeFails?.includes(r.event_id)) throw { message: `could not remove ${r.event_id}` }
      log.removed.push(r.event_id)
    },
    backOff: async (r, attempts, delaySeconds, message) => {
      if (opts.backOffFails) throw new Error('backoff write failed')
      log.backedOff.push({ event: r.event_id, attempts, delaySeconds, message })
    },
  }
  if (opts.timeLeft) deps.timeLeft = opts.timeLeft
  return { deps, log }
}

async function drainSection() {
  console.log('\n6 · The drain loop (fake I/O)')
  const scenario = async (name, fn) => {
    try { await fn() } catch (e) { check(name, false, `threw: ${e && e.message}`) }
  }

  await scenario('mixed batch', async () => {
    const rows = [row('a'), row('b'), row('c'), row('linked'), row('flaky'), row('d'), row('net')]
    const { deps, log } = fakeDeps({
      b: { status: 410, message: 'Calendar API 410: Resource has been deleted' },
      c: { status: 404, message: 'Calendar API 404: Not Found' },
      flaky: { status: 503, message: 'Calendar API 503: Backend Error' },
      net: { status: null, message: 'Calendar API unreachable: connection reset' },
    }, { stillLinked: ['linked'] })
    const s = await R.drainCalendarRows(rows, deps)
    check('204 counted as deleted (a, d)', s.deleted === 2, JSON.stringify(s))
    check('404 and 410 counted as already gone', s.already_gone === 2)
    check('an event a live block still points at is kept, and Google is never asked about it', s.kept === 1 && !log.asked.includes('linked'))
    check('kept and settled rows leave the queue', ['a', 'b', 'c', 'linked', 'd'].every((e) => log.removed.includes(e)))
    check('503 and no-answer back off and the run carries on', s.failed === 2 && log.asked.includes('d') && log.asked.includes('net'))
    check('failed rows stay queued', !log.removed.includes('flaky') && !log.removed.includes('net'))
    check('backoff counts the attempt and waits 60 s the first time',
      log.backedOff.length === 2 && log.backedOff.every((b) => b.attempts === 1 && b.delaySeconds === 60))
    check('backoff carries Google\'s message', log.backedOff[0].message === 'Calendar API 503: Backend Error')
    check('no stop, nothing left', s.stopped === null && s.left === 0)
  })

  for (const status of [401, 403, 429]) {
    await scenario(`stop on ${status}`, async () => {
      const rows = [row('a'), row('blocked', 2), row('c'), row('d')]
      const { deps, log } = fakeDeps({ blocked: { status, message: `Calendar API ${status}: no` } })
      const s = await R.drainCalendarRows(rows, deps)
      check(`${status}: rows before it still settle`, s.deleted === 1 && log.removed.includes('a'))
      check(`${status}: the run stops — Google is not asked about the rest`, log.asked.length === 2 && !log.asked.includes('c'))
      check(`${status}: the stopping row backs off (attempt 3 -> 240 s)`,
        log.backedOff.length === 1 && log.backedOff[0].attempts === 3 && log.backedOff[0].delaySeconds === 240)
      check(`${status}: the rest are left untouched for the next run`, s.left === 2 && !log.removed.includes('c') && !log.removed.includes('d'))
      check(`${status}: the summary says why`, s.stopped === `Calendar API ${status}: no` && s.failed === 1)
    })
  }

  await scenario('a row failing for the 8th time is parked', async () => {
    const { deps, log } = fakeDeps({ old: { status: 400, message: 'Calendar API 400: Bad Request' }, young: { status: 400, message: 'x' } })
    const s = await R.drainCalendarRows([row('old', 7), row('young', 2)], deps)
    check('the 8th failure parks it: counted once and set to wait a day', s.parked === 1 && log.backedOff[0].attempts === 8 && log.backedOff[0].delaySeconds === 86400)
    check('a younger failing row is not counted as parked', log.backedOff[1].attempts === 3 && s.failed === 2)
  })

  await scenario('a stop on the last row', async () => {
    const { deps } = fakeDeps({ z: { status: 403, message: 'm' } })
    const s = await R.drainCalendarRows([row('y'), row('z')], deps)
    check('a stop on the last row leaves nothing behind', s.left === 0 && s.stopped === 'm' && s.deleted === 1)
  })

  await scenario('row removal fails after Google deleted the event', async () => {
    const { deps, log } = fakeDeps({}, { removeFails: ['a'] })
    const s = await R.drainCalendarRows([row('a'), row('b')], deps)
    check('counted as failed (not deleted) and backed off with the error text',
      s.failed === 1 && s.deleted === 1 && log.backedOff[0].event === 'a' && log.backedOff[0].message === 'could not remove a')
    check('the run carries on with the next row', log.removed.includes('b'))
  })

  await scenario('deleteEvent rejects anyway', async () => {
    const { deps, log } = fakeDeps({ a: new Error('fetch failed') })
    const s = await R.drainCalendarRows([row('a'), row('b')], deps)
    check('a rejected delete backs off as a retry', s.failed === 1 && log.backedOff[0].message === 'fetch failed' && s.deleted === 1)
  })

  await scenario('backOff itself fails', async () => {
    const { deps } = fakeDeps({ a: { status: 500, message: 'Calendar API 500' } }, { backOffFails: true })
    const s = await R.drainCalendarRows([row('a'), row('b')], deps)
    check('the drain still resolves and carries on', s.failed === 1 && s.deleted === 1)
  })

  await scenario('empty messages get a fallback', async () => {
    const { deps, log } = fakeDeps({ a: { status: 500, message: '' }, b: { status: null, message: '' } })
    await R.drainCalendarRows([row('a'), row('b')], deps)
    check('a status without text -> "Calendar API 500"', log.backedOff[0].message === 'Calendar API 500')
    check('no answer without text -> "Calendar API unreachable"', log.backedOff[1].message === 'Calendar API unreachable')
  })

  await scenario('time budget', async () => {
    const none = fakeDeps({}, { timeLeft: () => false })
    const s0 = await R.drainCalendarRows([row('a'), row('b'), row('c')], none.deps)
    check('out of time from the start: nothing is touched, all left',
      s0.left === 3 && none.log.asked.length === 0 && none.log.removed.length === 0)
    let calls = 0
    const two = fakeDeps({}, { timeLeft: () => ++calls <= 2 })
    const s2 = await R.drainCalendarRows([row('a'), row('b'), row('c'), row('d')], two.deps)
    check('time runs out after two rows: two settled, two left', s2.deleted === 2 && s2.left === 2 && two.log.asked.length === 2)
  })

  await scenario('late attempts', async () => {
    const { deps, log } = fakeDeps({ a: { status: 502, message: 'x' } })
    await R.drainCalendarRows([row('a', 6)], deps)
    check('attempt 7 waits the one-hour cap', log.backedOff[0].attempts === 7 && log.backedOff[0].delaySeconds === 3600)
  })

  await scenario('empty batch', async () => {
    const { deps } = fakeDeps({})
    const s = await R.drainCalendarRows([], deps)
    check('an empty batch is an empty summary', JSON.stringify(s) === JSON.stringify(R.emptyCalendarDrainSummary()))
    check('the empty summary is a fresh object each time', R.emptyCalendarDrainSummary() !== R.emptyCalendarDrainSummary())
  })
}

function calendarAgreementSection() {
  console.log('\n7 · Every linked event lives in the calendar the trigger queues')
  const want = R.LINKED_EVENT_CALENDAR_ID
  check('the linked calendar is primary', want === 'primary')
  const callRe = /\b(create|get|update|delete)CalendarEvent\(\s*token\s*,\s*'([^']+)'/g
  const callers = [
    'src/shared/components/plan-modal/UnifiedPlanModal.tsx',
    'src/features/daily/api/scheduleApi.ts',
    'src/features/calendar/api/calendarTokenSync.ts',
  ]
  for (const file of callers) {
    const calls = [...read(file).matchAll(callRe)]
    const other = calls.filter((m) => m[2] !== want).map((m) => `${m[1]}CalendarEvent → '${m[2]}'`)
    check(`${path.basename(file)}: ${calls.length} block-event call(s), all in '${want}'`, calls.length > 0 && other.length === 0, other.join(', '))
  }
  check('UnifiedPlanModal creates the linked event (createCalendarEvent) in it',
    [...read(callers[0]).matchAll(callRe)].some((m) => m[1] === 'create' && m[2] === want))
  const insert = migration.match(/INSERT INTO public\.calendar_outbox[\s\S]*?VALUES\s*\(\s*OLD\.user_id\s*,\s*'([^']+)'/)
  check(`migration 135's trigger queues '${want}'`, !!insert && insert[1] === want, insert ? insert[1] : 'INSERT not found')
  const columnDefault = migration.match(/calendar_id\s+TEXT\s+NOT NULL DEFAULT '([^']+)'/)
  check(`calendar_outbox.calendar_id defaults to '${want}'`, !!columnDefault && columnDefault[1] === want)
}

function migrationSection() {
  console.log('\n8 · Migration 135')
  const sql = migration
  // The statements outside the trigger function's body, without comments, so
  // a word in the body or in prose can't satisfy (or fail) a table-level check.
  const outsideFunction = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, '').replace(/--.*$/gm, '')
  check('creates calendar_outbox idempotently', /CREATE TABLE IF NOT EXISTS public\.calendar_outbox/.test(sql))
  for (const col of ['user_id', 'calendar_id', 'event_id', 'operation', 'time_block_id', 'payload', 'attempts', 'next_retry_at', 'last_error', 'created_at', 'updated_at']) {
    check(`has column ${col}`, new RegExp(`\\n\\s+${col}\\s+[A-Z]`).test(sql))
  }
  check('user_id follows the owner pattern (DEFAULT auth.uid(), FK ON DELETE CASCADE)',
    /user_id\s+UUID\s+NOT NULL DEFAULT auth\.uid\(\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(sql))
  check('one row per (user, calendar, event)', /UNIQUE \(user_id, calendar_id, event_id\)/.test(sql))
  check('the enqueue is a no-op for an event already waiting', /ON CONFLICT \(user_id, calendar_id, event_id\) DO NOTHING/.test(sql))
  check('operation is a CHECK, not an enum', /operation\s+TEXT\s+NOT NULL DEFAULT 'delete' CHECK \(operation IN \('delete'\)\)/.test(sql))
  check('RLS is enabled', /ALTER TABLE public\.calendar_outbox ENABLE ROW LEVEL SECURITY/.test(sql))
  const policies = [...outsideFunction.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.calendar_outbox\s+FOR (\w+)/g)]
  check('exactly one policy, and it only reads', policies.length === 1 && policies[0][2] === 'SELECT', policies.map((p) => p[2]).join(', '))
  check('the policy uses (select auth.uid())', /USING \(\(select auth\.uid\(\)\) = user_id\)/.test(sql))
  check('the policy is created inside the pg_policies guard', /IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies[\s\S]*?calendar_outbox/.test(sql))
  check('no trg_audit on the queue (a transient work queue)', !/CREATE TRIGGER trg_audit/.test(outsideFunction))
  check('the trigger is AFTER DELETE ... FOR EACH ROW on time_blocks',
    /CREATE TRIGGER trg_enqueue_calendar_event_delete\s+AFTER DELETE ON public\.time_blocks\s+FOR EACH ROW EXECUTE FUNCTION public\.enqueue_calendar_event_delete\(\)/.test(sql))
  check('the trigger is dropped first (re-runnable)', /DROP TRIGGER IF EXISTS trg_enqueue_calendar_event_delete ON public\.time_blocks/.test(sql))
  check('the trigger function is SECURITY DEFINER with a fixed search_path',
    /enqueue_calendar_event_delete\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public/.test(sql))
  check('it skips an account that is being deleted (or that FK would abort the deletion)',
    /IF NOT EXISTS \(SELECT 1 FROM auth\.users WHERE id = OLD\.user_id\) THEN\s+RETURN NULL;/.test(sql))
  check('it skips blocks without an event', /OLD\.google_calendar_event_id IS NULL OR btrim\(OLD\.google_calendar_event_id\) = ''/.test(sql))
  check('updates no existing row (no top-level UPDATE / DELETE / INSERT)', !/^\s*(UPDATE|DELETE|INSERT)\b/m.test(outsideFunction))
  check('every index is IF NOT EXISTS', !/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/.test(sql))
}

function wiringSection() {
  console.log('\n9 · google-tasks-sync wiring')
  const f = fnOutsideBlock
  check('the handler runs the calendar step', /calendar = await drainCalendarOutbox\(access_token, userId\)/.test(f))
  check('the step goes through drainCalendarRows', /return drainCalendarRows\(rows, \{/.test(f))
  check('a missing table is skipped, not an error', /isMissingTableError\(error\)\) return \{ \.\.\.emptyCalendarDrainSummary\(\), skipped: 'not_migrated' \}/.test(f))
  check('the request path comes from calendarEventPath', /calendarEventPath\(calendarId, eventId\)/.test(f))
  const queueRead = f.slice(f.indexOf("from('calendar_outbox')"), f.indexOf('.limit(CALENDAR_BATCH)'))
  check('it reads the queue for this user only', /\.eq\('user_id', userId\)/.test(queueRead))
  check('it reads delete rows only (a later operation is never taken for a delete)', /\.eq\('operation', 'delete'\)/.test(queueRead))
  check('it reads due rows only, oldest first',
    /\.lte\('next_retry_at', new Date\(\)\.toISOString\(\)\)/.test(queueRead) && /\.order\('created_at', \{ ascending: true \}\)/.test(queueRead))
  check('writes to the queue are scoped to the user', (f.match(/\.eq\('id', row\.id\)\.eq\('user_id', userId\)/g) ?? []).length === 2)
  check('still-linked events are read from time_blocks for this user',
    /from\('time_blocks'\)\s*\.select\('google_calendar_event_id'\)\s*\.eq\('user_id', userId\)\s*\.in\('google_calendar_event_id'/.test(f))
  check('the response carries the calendar summary', /imported, calendar, /.test(f))
  check('calendar trouble never gates the Tasks watermark', /errorKeys\.length === 0 \? \{ last_success_at: syncedAt \}/.test(f) && /const errorKeys = Object\.keys\(errors\)/.test(f))
  check('no _shared/ import (self-contained function)', !/from ['"]\.\.\/_shared/.test(fnSource))
}

;(async () => {
  mirrorSection()
  outcomeSection()
  retrySection()
  missingTableSection()
  pathSection()
  await drainSection()
  calendarAgreementSection()
  migrationSection()
  wiringSection()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
