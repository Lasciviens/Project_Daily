#!/usr/bin/env node
/*
 * Verification — a repeating plan (schedule_blocks) as ONE repeating Google
 * Calendar event (migration 147): src/features/calendar/calendarSeries.ts,
 * against the REAL un-mocked module via sucrase.
 *
 *   1. every kind → its RRULE / RDATE lines, and the event's first day;
 *   2. the occurrences Google would expand (a small RFC 5545 expander for
 *      the parts we send) are exactly recurrence.ts's occurrencesBetween —
 *      every kind, two years, with days taken out;
 *   3. except_dates → EXDATE (only real occurrences, the first day too);
 *   4. time zones and daylight saving: wall-clock times + TZID, never UTC;
 *   5. plans crossing midnight end on the next day;
 *   6. the horizon of the monthly kinds and when it is pushed again;
 *   7. the agenda shows a linked plan once (instances carry recurringEventId).
 *
 *   Run:  node scripts/verify-calendar-recurrence.cjs
 */
require('sucrase/register')
const S = require('../src/features/calendar/calendarSeries')
const { occurrencesBetween, addDaysIso, dayNumber, weekdayOfIso } = require('../src/features/daily/recurrence')
const { buildDaySchedule, linkedCalendarEventIds, isLinkedCalendarEvent } = require('../src/features/daily/daySchedule')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const TZ = 'Europe/Oslo'
const TODAY = '2026-10-13' // a Tuesday
const plan = (over) => ({
  title: 'Plan', start_time: '16:30:00', end_time: '17:30:00', days_of_week: [], effective_from: TODAY,
  except_dates: [], ...over,
})
const map = (t, today = TODAY, tz = TZ) => S.seriesEventFor(t, { today, timeZone: tz })
const line = (p, prefix) => p.body.recurrence.find(l => l.startsWith(prefix)) ?? null

// ── A small RFC 5545 expander for exactly what we send ──────────────────────
// start = DTSTART (always an occurrence); RRULE FREQ=DAILY|WEEKLY with
// INTERVAL, WKST=MO and BYDAY; RDATE / EXDATE ;TZID=…:yyyymmddThhmmss lists.
// Returns the days ('yyyy-MM-dd') from start to `to`, and checks every stamp
// carries the start's own clock time.
function expand(p, to) {
  const first = p.body.start.dateTime.slice(0, 10)
  const clock = p.body.start.dateTime.slice(11).replace(/:/g, '')
  const days = new Set([first])
  const dayOfStamp = (s) => {
    if (!new RegExp(`^\\d{8}T${clock}$`).test(s)) throw new Error(`stamp ${s} is not at the start's clock time ${clock}`)
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  const list = (l) => l.slice(l.indexOf(':') + 1).split(',').map(dayOfStamp)
  const ex = new Set()
  for (const l of p.body.recurrence) {
    if (l.startsWith('RDATE')) list(l).forEach(d => days.add(d))
    else if (l.startsWith('EXDATE')) list(l).forEach(d => ex.add(d))
    else if (l.startsWith('RRULE:')) {
      const parts = Object.fromEntries(l.slice(6).split(';').map(kv => kv.split('=')))
      const n = Number(parts.INTERVAL ?? 1)
      if (parts.FREQ === 'DAILY') {
        for (let k = 0; addDaysIso(first, k * n) <= to; k++) days.add(addDaysIso(first, k * n))
      } else if (parts.FREQ === 'WEEKLY') {
        if (parts.WKST !== 'MO') throw new Error('WEEKLY without WKST=MO')
        const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
        const wanted = parts.BYDAY.split(',').map(c => codes.indexOf(c))
        const monday = addDaysIso(first, -((weekdayOfIso(first) + 6) % 7))
        for (let w = 0; addDaysIso(monday, w * 7) <= to; w += n) {
          for (let i = 0; i < 7; i++) {
            const d = addDaysIso(monday, w * 7 + i)
            if (d >= first && d <= to && wanted.includes(weekdayOfIso(d))) days.add(d)
          }
        }
      } else throw new Error(`unexpected FREQ ${parts.FREQ}`)
    }
  }
  return [...days].filter(d => d <= to && !ex.has(d)).sort()
}

console.log('\n1 · Each kind → its lines and its first day')
{
  const wk = map(plan({ days_of_week: [1, 3] })) // Mon + Wed, started on a Tuesday
  check('weekly Mon/Wed → RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE', eq(wk.body.recurrence, ['RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE']), JSON.stringify(wk.body.recurrence))
  check('…started on a Tuesday: the event starts on the first Wednesday (14.10), never on the Tuesday', wk.first === '2026-10-14' && wk.body.start.dateTime === '2026-10-14T16:30:00')
  check('…no horizon (the RRULE carries every occurrence)', wk.horizon === null)
  check('weekdays → BYDAY=MO,TU,WE,TH,FR', line(map(plan({ days_of_week: [5, 4, 3, 2, 1] })), 'RRULE') === 'RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,TU,WE,TH,FR')
  check('Sunday sorts last (Monday-first, like the planner)', line(map(plan({ days_of_week: [0, 1] })), 'RRULE') === 'RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,SU')
  const every = map(plan({ days_of_week: [0, 1, 2, 3, 4, 5, 6] }))
  check('every day → RRULE:FREQ=DAILY, starting on the start', eq(every.body.recurrence, ['RRULE:FREQ=DAILY']) && every.first === TODAY)
  check('a weekly plan with no day has no event', map(plan({ days_of_week: [] })) === null)
  const d3 = map(plan({ repeat_kind: 'interval', repeat_unit: 'day', repeat_interval: 3 }))
  check('every 3 days → RRULE:FREQ=DAILY;INTERVAL=3 from the start', eq(d3.body.recurrence, ['RRULE:FREQ=DAILY;INTERVAL=3']) && d3.first === TODAY)
  check('every 1 day → FREQ=DAILY (no INTERVAL=1)', line(map(plan({ repeat_kind: 'interval', repeat_unit: 'day', repeat_interval: 1 })), 'RRULE') === 'RRULE:FREQ=DAILY')
  const w2 = map(plan({ repeat_kind: 'interval', repeat_unit: 'week', repeat_interval: 2, days_of_week: [2, 4], effective_from: '2026-10-16' }))
  check('every 2 weeks Tue/Thu → RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=TU,TH', line(w2, 'RRULE') === 'RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=TU,TH', line(w2, 'RRULE'))
  check('…started on a Friday: Tue/Thu of that week are before it, the next counted week is two weeks on (27.10)', w2.first === '2026-10-27', w2.first)
  const mo = map(plan({ repeat_kind: 'monthly', days_of_week: [6] }))
  check('monthly (Saturday nearest the 13th) → no RRULE, an RDATE list', !line(mo, 'RRULE') && !!line(mo, 'RDATE;TZID=Europe/Oslo:'))
  check('…13.10 + Saturday: 10.10 is before the start, the first is 14.11', mo.first === '2026-11-14', mo.first)
  check('…the RDATE list starts after the first day (that one is the event\'s start)', line(mo, 'RDATE').split(':')[1].split(',')[0] === '20261212T163000', line(mo, 'RDATE'))
  check('…its horizon is a year after the later of today and the first day (14.11.2027)', mo.horizon === '2027-11-14', mo.horizon)
  const m2 = map(plan({ repeat_kind: 'interval', repeat_unit: 'month', repeat_interval: 2, days_of_week: [], effective_from: '2026-01-31' }), '2026-01-31')
  check('every 2 months on the 31st → 31.01, then the last day of March, of May…',
    m2.first === '2026-01-31' && line(m2, 'RDATE').includes('20260331T163000') && line(m2, 'RDATE').includes('20260531T163000') && !line(m2, 'RDATE').includes('202602'))
  const picks = ['2026-10-20', '2027-12-24', '2026-11-02', '2026-10-13']
  const dt = map(plan({ repeat_kind: 'dates', repeat_dates: picks }))
  check('picked dates → DTSTART the earliest, the rest as RDATE (sorted)',
    dt.first === '2026-10-13' && line(dt, 'RDATE') === 'RDATE;TZID=Europe/Oslo:20261020T163000,20261102T163000,20271224T163000', line(dt, 'RDATE'))
  check('…every pick is listed, even past a year: no horizon to extend', dt.horizon === null)
  const one = map(plan({ repeat_kind: 'dates', repeat_dates: ['2026-10-20'] }))
  check('one picked date → an event with no recurrence line', one.first === '2026-10-20' && one.body.recurrence.length === 0)
  check('the title is the summary', map(plan({ title: 'Haircut', days_of_week: [2] })).body.summary === 'Haircut')
  const nostart = map(plan({ days_of_week: [2], effective_from: undefined }))
  check('a row with no effective_from (before 081) starts from today', nostart.first === TODAY)
  check('a broken time gives no event', map(plan({ days_of_week: [2], start_time: 'soon' })) === null && map(plan({ days_of_week: [2], end_time: '25:00' })) === null)
}

console.log('\n2 · Google\'s expansion = the app\'s occurrences (two years, every kind)')
{
  const to = '2028-10-13'
  const cases = [
    ['weekly Mon/Wed/Fri', plan({ days_of_week: [1, 3, 5] })],
    ['weekdays', plan({ days_of_week: [1, 2, 3, 4, 5], effective_from: '2026-10-17' })],
    ['every day', plan({ days_of_week: [0, 1, 2, 3, 4, 5, 6] })],
    ['every 3 days', plan({ repeat_kind: 'interval', repeat_unit: 'day', repeat_interval: 3 })],
    ['every 2 weeks Tue/Thu from a Friday', plan({ repeat_kind: 'interval', repeat_unit: 'week', repeat_interval: 2, days_of_week: [2, 4], effective_from: '2026-10-16' })],
    ['every 3 weeks on Sunday from a Monday', plan({ repeat_kind: 'interval', repeat_unit: 'week', repeat_interval: 3, days_of_week: [0], effective_from: '2026-10-12' })],
    ['every 2 weeks Mon+Sun (Sunday ends a Monday-first week)', plan({ repeat_kind: 'interval', repeat_unit: 'week', repeat_interval: 2, days_of_week: [0, 1], effective_from: '2026-10-14' })],
    ['monthly Saturday nearest the 13th', plan({ repeat_kind: 'monthly', days_of_week: [6] })],
    ['monthly on the 31st', plan({ repeat_kind: 'monthly', days_of_week: [], effective_from: '2026-10-31' })],
    ['every 3 months, Friday nearest the 1st', plan({ repeat_kind: 'interval', repeat_unit: 'month', repeat_interval: 3, days_of_week: [5], effective_from: '2026-11-01' })],
    ['picked dates', plan({ repeat_kind: 'dates', repeat_dates: ['2026-10-20', '2026-12-24', '2027-03-01', '2028-02-29'] })],
    ['weekly with days taken out', plan({ days_of_week: [1, 4], except_dates: ['2026-10-15', '2026-10-19', '2026-10-20', '2027-01-04'] })],
    ['monthly with a day taken out', plan({ repeat_kind: 'monthly', days_of_week: [6], except_dates: ['2026-12-12'] })],
    ['every 3 days, first day taken out', plan({ repeat_kind: 'interval', repeat_unit: 'day', repeat_interval: 3, except_dates: [TODAY] })],
  ]
  for (const [name, t] of cases) {
    const p = map(t)
    // the monthly kinds are listed up to the horizon only
    const until = p.horizon && p.horizon < to ? p.horizon : to
    let got
    try { got = expand(p, until) } catch (e) { check(name, false, e.message); continue }
    const want = occurrencesBetween(t, t.effective_from ?? TODAY, until)
    check(`${name}: ${want.length} occurrences, the same days`, eq(got, want),
      `first diff: ${got.find((d, i) => d !== want[i]) ?? want.find(d => !got.includes(d))}`)
  }
}

console.log('\n3 · except_dates → EXDATE')
{
  const t = plan({ days_of_week: [1, 4], except_dates: ['2026-10-19', '2026-10-15', '2026-10-21', '2026-09-01', 'nonsense'] })
  const p = map(t)
  check('real occurrences become one EXDATE line, sorted', line(p, 'EXDATE') === 'EXDATE;TZID=Europe/Oslo:20261015T163000,20261019T163000', line(p, 'EXDATE'))
  check('a day the rule doesn\'t have (a Wednesday) is left out — Google wants an EXDATE to name a real occurrence', !line(p, 'EXDATE').includes('20261021'))
  check('a day before the first is left out', !line(p, 'EXDATE').includes('20260901'))
  const skipFirst = map(plan({ days_of_week: [1, 3], except_dates: ['2026-10-14'] }))
  check('the first day taken out stays the start and gets an EXDATE (skipping never moves the series)',
    skipFirst.first === '2026-10-14' && line(skipFirst, 'EXDATE') === 'EXDATE;TZID=Europe/Oslo:20261014T163000')
  const mo = map(plan({ repeat_kind: 'monthly', days_of_week: [6], except_dates: ['2026-12-12'] }))
  check('monthly: a later day taken out is simply not in the RDATE list (no EXDATE)', !line(mo, 'RDATE').includes('20261212') && !line(mo, 'EXDATE'))
  const moFirst = map(plan({ repeat_kind: 'monthly', days_of_week: [6], except_dates: ['2026-11-14'] }))
  check('monthly: the first day taken out → an EXDATE of the start', moFirst.first === '2026-11-14' && line(moFirst, 'EXDATE') === 'EXDATE;TZID=Europe/Oslo:20261114T163000')
  check('picked dates all taken out → no event at all', map(plan({ repeat_kind: 'dates', repeat_dates: ['2026-10-20', '2026-10-27'], except_dates: ['2026-10-20', '2026-10-27'] })) === null)
  check('the only picked date taken out → no event', map(plan({ repeat_kind: 'dates', repeat_dates: ['2026-10-20'], except_dates: ['2026-10-20'] })) === null)
}

console.log('\n4 · Time zones and daylight saving')
{
  // Oslo leaves summer time on 25.10.2026: a Thursday 16:30 plan stays 16:30.
  const p = map(plan({ days_of_week: [4], except_dates: ['2026-10-22', '2026-10-29'] }))
  check('start is wall-clock time with no offset and no Z', p.body.start.dateTime === '2026-10-15T16:30:00' && !/[Z+]/.test(p.body.start.dateTime.slice(10)))
  check('start and end name the zone (required for a repeating event)', p.body.start.timeZone === TZ && p.body.end.timeZone === TZ)
  check('an EXDATE before and one after the change are both 16:30 local (never converted to UTC)',
    line(p, 'EXDATE') === 'EXDATE;TZID=Europe/Oslo:20261022T163000,20261029T163000', line(p, 'EXDATE'))
  const mo = map(plan({ repeat_kind: 'monthly', days_of_week: [], effective_from: '2027-03-15' }), '2027-03-15')
  check('RDATE across the spring change (28.03.2027) keeps 16:30', line(mo, 'RDATE').startsWith('RDATE;TZID=Europe/Oslo:20270415T163000'))
  const ny = map(plan({ days_of_week: [2] }), TODAY, 'America/New_York')
  check('another zone is passed through as is', ny.body.start.timeZone === 'America/New_York')
  check('no zone from the device → Europe/Oslo', S.seriesTimeZone('') === 'Europe/Oslo' && S.seriesTimeZone(undefined) === 'Europe/Oslo' && S.seriesTimeZone('Asia/Tokyo') === 'Asia/Tokyo')
  const mo2 = map(plan({ repeat_kind: 'monthly', days_of_week: [6], except_dates: ['2026-11-14'] }), TODAY, '')
  check('the fallback zone is used in RDATE/EXDATE too', line(mo2, 'EXDATE').startsWith('EXDATE;TZID=Europe/Oslo:') && line(mo2, 'RDATE').startsWith('RDATE;TZID=Europe/Oslo:'))
  check('HH:MM is read as HH:MM:00', map(plan({ days_of_week: [2], start_time: '07:05', end_time: '07:45' })).body.start.dateTime === '2026-10-13T07:05:00')
  check('icalStamp', S.icalStamp('2026-03-29', '02:30:00') === '20260329T023000')
}

console.log('\n5 · Crossing midnight')
{
  const late = map(plan({ days_of_week: [5], start_time: '23:00:00', end_time: '01:00:00' }))
  check('23:00–01:00 ends at 01:00 the next day', late.body.start.dateTime === '2026-10-16T23:00:00' && late.body.end.dateTime === '2026-10-17T01:00:00')
  const midnight = map(plan({ days_of_week: [5], start_time: '23:30:00', end_time: '00:00:00' }))
  check('23:30–00:00 ends at midnight the next day', midnight.body.end.dateTime === '2026-10-17T00:00:00')
  const full = map(plan({ days_of_week: [5], start_time: '10:00:00', end_time: '10:00:00' }))
  check('equal start and end = 24 hours (the agenda reads it so too)', full.body.end.dateTime === '2026-10-17T10:00:00')
  const same = map(plan({ days_of_week: [5], start_time: '09:00:00', end_time: '17:15:00' }))
  check('a same-day plan ends that day', same.body.end.dateTime === '2026-10-16T17:15:00')
}

console.log('\n6 · The horizon of the monthly kinds')
{
  const mo = plan({ repeat_kind: 'monthly', days_of_week: [6], google_calendar_event_id: 'abc' })
  const h = (horizon, today = TODAY) => S.needsHorizonTopUp({ ...mo, google_calendar_horizon: horizon }, today)
  check('120 days left → no push', !h(addDaysIso(TODAY, 120)))
  check('89 days left → pushed again', h(addDaysIso(TODAY, 89)))
  check('exactly 90 days left → no push yet', !h(addDaysIso(TODAY, 90)))
  check('no horizon stored → pushed', h(null))
  check('not on Google → never pushed', !S.needsHorizonTopUp({ ...mo, google_calendar_event_id: null, google_calendar_horizon: null }, TODAY))
  check('weekly / every N days / picked dates never need it',
    !S.needsHorizonTopUp(plan({ days_of_week: [1], google_calendar_event_id: 'a' }), TODAY)
    && !S.needsHorizonTopUp(plan({ repeat_kind: 'interval', repeat_unit: 'day', repeat_interval: 2, google_calendar_event_id: 'a' }), TODAY)
    && !S.needsHorizonTopUp(plan({ repeat_kind: 'dates', repeat_dates: ['2026-11-01'], google_calendar_event_id: 'a' }), TODAY))
  check('every N months is a horizon kind', S.isHorizonKind(plan({ repeat_kind: 'interval', repeat_unit: 'month', repeat_interval: 2 })))
  const later = map(mo, '2027-08-01')
  check('pushed again later: the list runs a year past that day', later.horizon === '2028-07-31' && line(later, 'RDATE').endsWith(',20280715T163000'))
  check('…and still starts at the first day (past ones stay on Google)', later.first === '2026-11-14')
  const future = map(plan({ repeat_kind: 'monthly', days_of_week: [], effective_from: '2027-06-10' }))
  check('a plan starting after today: a year past its first day', future.horizon === '2028-06-09', future.horizon)
  check('the horizon constants (a year, 90 days)', S.SERIES_HORIZON_DAYS === 365 && S.SERIES_TOPUP_DAYS === 90)
}

console.log('\n6b · The zone a push uses, and the retry list')
{
  check('a save from the planner takes the device\'s zone (it may change it)', S.seriesPushZone('Europe/Oslo', 'America/New_York', true) === 'America/New_York')
  check('any other push keeps the series\' own zone (opening the app abroad never re-zones it)', S.seriesPushZone('Europe/Oslo', 'America/New_York', false) === 'Europe/Oslo')
  check('no stored zone: the device\'s, else Europe/Oslo', S.seriesPushZone(null, 'Asia/Tokyo', false) === 'Asia/Tokyo' && S.seriesPushZone('', '', false) === 'Europe/Oslo' && S.seriesPushZone(undefined, undefined, true) === 'Europe/Oslo')
  check('the retry list: garbage reads as empty', eq(S.parsePendingSeries('nope'), []) && eq(S.parsePendingSeries(null), []) && eq(S.parsePendingSeries('{"a":1}'), []))
  check('…entries without a plan id are dropped, odd block ids too',
    eq(S.parsePendingSeries(JSON.stringify([{ planId: 'p', blockIds: ['b', 7, '', 'b'] }, { blockIds: ['x'] }, null])), [{ planId: 'p', blockIds: ['b'] }]))
  let list = S.addPendingSeries([], 'p1', 'b1')
  list = S.addPendingSeries(list, 'p1', 'b2')
  list = S.addPendingSeries(list, 'p1', 'b1')
  list = S.addPendingSeries(list, 'p2', null, true)
  list = S.addPendingSeries(list, 'p2', 'b9')
  check('one entry per plan, days merged once each; relink is kept', eq(list, [{ planId: 'p1', blockIds: ['b1', 'b2'] }, { planId: 'p2', blockIds: ['b9'], relink: true }]), JSON.stringify(list))
  check('…and it round-trips through storage', eq(S.parsePendingSeries(JSON.stringify(list)), list))
  check('the storage key is the one sign-out clears', S.SERIES_PENDING_KEY === 'lasci.calendarSeries.pending'
    && require('fs').readFileSync(require('path').join(__dirname, '../src/security/accountState.ts'), 'utf8').includes('localStorage.removeItem(SERIES_PENDING_KEY)'))
}

console.log('\n7 · The agenda shows a linked plan once')
{
  const tpl = {
    id: 'tpl-1', user_id: 'u', title: 'Upper A', days_of_week: [2], start_time: '16:30:00', end_time: '17:30:00',
    color: 'blue', category: 'training', effective_from: '2026-09-01', except_dates: [], repeat_kind: 'weekly',
    google_calendar_event_id: 'seriesabc', created_at: '', updated_at: '',
  }
  const ev = (id, extra = {}) => ({ id, summary: id, htmlLink: '', start: { dateTime: '2026-10-13T16:30:00+02:00' }, end: { dateTime: '2026-10-13T17:30:00+02:00' }, ...extra })
  const events = [
    ev('seriesabc_20261013T143000Z', { recurringEventId: 'seriesabc' }), // the plan's own instance
    ev('blockevent'),                                                       // a linked one-off block's event
    ev('other_20261013T120000Z', { recurringEventId: 'someoneelse' }),      // a repeating event not ours
    ev('dentist'),
  ]
  const block = { id: 'b1', date: TODAY, title: 'Call', start_time: '09:00:00', duration_minutes: 30, google_calendar_event_id: 'blockevent' }
  const items = buildDaySchedule({ date: TODAY, blocks: [block], prevBlocks: [], templates: [tpl], events })
  const calendarRows = items.filter(i => i.kind === 'calendar').map(i => i.id)
  check('the plan shows once, as its own row', items.filter(i => i.kind === 'recurring').length === 1)
  check('its Google instance (recurringEventId = its event) is not shown again', !calendarRows.includes('seriesabc_20261013T143000Z'))
  check('a linked block\'s event is still not shown again', !calendarRows.includes('blockevent'))
  check('other events — a repeating one that is not ours too — still show', eq(calendarRows.sort(), ['dentist', 'other_20261013T120000Z']))
  const unlinked = buildDaySchedule({ date: TODAY, blocks: [], prevBlocks: [], templates: [{ ...tpl, google_calendar_event_id: null }], events: [ev('seriesabc_20261013T143000Z', { recurringEventId: 'seriesabc' })] })
  check('a plan no longer linked: its event is a plain Google event again', unlinked.some(i => i.kind === 'calendar'))
  const ids = linkedCalendarEventIds([{ google_calendar_event_id: 'a' }, { google_calendar_event_id: null }], [{ google_calendar_event_id: 'b' }, {}])
  check('linkedCalendarEventIds: blocks and plans, empty ones dropped', eq([...ids].sort(), ['a', 'b']))
  check('isLinkedCalendarEvent: by id or by recurringEventId', isLinkedCalendarEvent({ id: 'a' }, ids) && isLinkedCalendarEvent({ id: 'x', recurringEventId: 'b' }, ids) && !isLinkedCalendarEvent({ id: 'x' }, ids))
  // yesterday's late plan crossing midnight: Google returns its instance for today too
  const lateTpl = { ...tpl, id: 'tpl-2', days_of_week: [1], start_time: '23:00:00', end_time: '01:00:00', google_calendar_event_id: 'lateseries' }
  const lateItems = buildDaySchedule({
    date: TODAY, blocks: [], prevBlocks: [], templates: [lateTpl],
    events: [ev('lateseries_20261012T210000Z', { recurringEventId: 'lateseries', start: { dateTime: '2026-10-12T23:00:00+02:00' }, end: { dateTime: '2026-10-13T01:00:00+02:00' } })],
  })
  check('a cross-midnight plan\'s tail shows once (the projection\'s spillover, not the instance)',
    lateItems.length === 1 && lateItems[0].kind === 'recurring' && lateItems[0].spillover)
  check('dayNumber sanity', dayNumber('2026-10-14') - dayNumber(TODAY) === 1)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
