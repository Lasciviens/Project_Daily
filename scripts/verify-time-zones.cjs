// Time zones from the phone (183; owner, 31.10.2026: "Time zones should be based on location … a smart way"):
// the phone's zone and how an item's zone is shown (shared/utils/timeZone.ts), the sheet sending a zone only for a
// new item or one the owner picked (planForm), an item's stored zone read back (itemRules), a day row's zone
// (dayItems), Apple's VTIMEZONE for any real zone — read back hour by hour against the runtime's own offsets —
// and an event written and read back on the item's own clock (icloud-calendar's pure block). The database half is
// verify-db-time-zones.
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

let n = 0
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${msg}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`); process.exit(1) }
  n++
}
const ok = (c, msg) => eq(!!c, true, msg)
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

// ── The phone's zone and how a zone is shown ────────────────────────────────
const Z = require('../src/shared/utils/timeZone.ts')
eq([Z.currentZoneName('Asia/Calcutta'), Z.currentZoneName('Europe/Kiev'), Z.currentZoneName('Europe/Istanbul')],
  ['Asia/Kolkata', 'Europe/Kyiv', 'Europe/Istanbul'], 'old names a browser may report become today\'s; others stay')
{
  const saved = process.env.TZ
  const as = tz => { process.env.TZ = tz; return Z.phoneTimeZone() }
  eq(as('Europe/Istanbul'), 'Europe/Istanbul', 'the phone\'s zone is the one its clock uses')
  eq(as('Asia/Calcutta'), 'Asia/Kolkata', '…by today\'s name')
  process.env.TZ = saved ?? ''
  if (saved === undefined) delete process.env.TZ
}
const winter = Date.UTC(2026, 10, 12, 12)
ok(Z.sameClock('Europe/Oslo', 'Europe/Stockholm', winter) && Z.sameClock('Europe/Oslo', 'Europe/Berlin', winter), 'Oslo, Stockholm and Berlin keep one clock (summer time too)')
ok(!Z.sameClock('Europe/Oslo', 'Europe/Istanbul', winter) && !Z.sameClock('Europe/Oslo', 'Europe/London', winter), '…Istanbul and London don\'t')
eq([Z.zoneCity('Europe/Istanbul'), Z.zoneCity('America/Argentina/Buenos_Aires'), Z.zoneCity('Etc/GMT+1'), Z.zoneCity('UTC'), Z.zoneCity('Not/AZone')],
  ['Istanbul', 'Buenos Aires', 'GMT-1', 'UTC', 'Oslo'], 'a zone for people: its place, an offset for one without (Etc/GMT+1 is UTC−1), garbage the home zone')
eq(Z.zoneTag(null, 'Europe/Oslo', winter), null, 'an item in the home zone seen at home says nothing')
eq(Z.zoneTag(null, 'Europe/Istanbul', winter), 'Oslo', '…seen in Istanbul it says "Oslo"')
eq(Z.zoneTag('Europe/Istanbul', 'Europe/Istanbul', winter), null, 'an item made in Istanbul, seen there, says nothing')
eq(Z.zoneTag('Europe/Istanbul', 'Europe/Oslo', winter), 'Istanbul', '…seen back home it says "Istanbul"')
eq(Z.zoneTag('Europe/Stockholm', 'Europe/Oslo', winter), null, 'a zone on the phone\'s clock says nothing (no noise)')
eq(Z.zoneTag('Europe/Oslo\r\nX:1', 'Europe/Istanbul', winter), 'Oslo', 'a stored value that is no zone name reads as the home zone')

// ── The sheet: a new item sends the phone's zone, an edit only a picked one ──
const F = require('../src/shared/components/plan-modal/planForm.ts')
{
  process.env.TZ = 'Europe/Istanbul'
  const fresh = F.buildInitialForm({ mode: 'task', today: '2026-11-02', nextTime: '17:00', defaults: { date: '2026-11-12', time: '17:00' } })
  eq(fresh.timeZone, 'Europe/Istanbul', 'a new item starts in the phone\'s zone')
  const ctx = { googleConnected: false, today: '2026-11-02' }
  eq(F.inputFromForm(fresh, ctx).timeZone, 'Europe/Istanbul', '…and the save sends it')
  const item = { taskId: 't1', blockId: 'b1', scheduleBlockId: null, scope: 'item', title: 'Gym', notes: null, domain: 'personal', priority: 'medium',
    date: '2026-11-12', time: '17:00', durationMinutes: 60, deadline: null, repeat: null, google: 'calendar', googleTaskList: null, source: null, timeZone: 'Europe/Oslo' }
  const edit = F.buildInitialForm({ mode: 'task', today: '2026-11-02', nextTime: '17:00', item })
  eq(edit.timeZone, 'Europe/Oslo', 'an edit shows the item\'s own zone')
  eq(F.inputFromForm(edit, { ...ctx, item }).timeZone, 'Europe/Oslo', 'an edit sends the zone the sheet shows — the item\'s own, so a sheet opened abroad never re-zones it')
  eq(F.inputFromForm({ ...edit, recurrence: 'weekly' }, { ...ctx, item }).timeZone, 'Europe/Oslo', '…and a one-off turned into a repeat keeps the clock it showed')
  const picked = { ...edit, timeZone: 'Europe/Istanbul' }
  eq(F.inputFromForm(picked, { ...ctx, item }).timeZone, 'Europe/Istanbul', 'a zone picked in the sheet is sent')
  const match = F.buildInitialForm({ mode: 'task', today: '2026-11-02', nextTime: '17:00', defaults: { date: '2026-11-12', startTime: '20:45', scheduled: true, timeZone: 'Europe/Oslo' } })
  eq([match.timeZone, F.inputFromForm(match, ctx).timeZone], ['Europe/Oslo', 'Europe/Oslo'], 'a new item whose default time is on another clock (a match\'s kick-off on Oslo\'s) keeps that zone, even from a phone in Istanbul')
  const old = F.buildInitialForm({ mode: 'task', today: '2026-11-02', nextTime: '17:00', item: { ...item, timeZone: null } })
  eq(old.timeZone, null, 'an older item (no zone) shows the home zone…')
  eq(F.inputFromForm(old, { ...ctx, item }).timeZone, 'Europe/Oslo', '…and its save stores that, by name (the same clock — nothing moves)')
  delete process.env.TZ
}

// ── Saved rows → the item's zone; a day row's zone ──
const R = require('../src/features/items/itemRules.ts')
const task = { id: 't', title: 'Gym', description: null, domain: 'personal', priority: 'medium', due_date: '2026-11-12', due_time: '17:00:00', source_type: 'manual', source_id: null, google_tasklist_id: null, google_sync_enabled: false, labels: [] }
const block = { id: 'b', date: '2026-11-12', title: 'Gym', start_time: '17:00:00', duration_minutes: 60, category: 'daily', notes: null, source_type: null, source_id: null, google_calendar_event_id: null, time_zone: 'Europe/Istanbul' }
eq(R.itemFromRows(task, block, null).timeZone, 'Europe/Istanbul', 'a slot\'s stored zone is the item\'s')
eq(R.itemFromRows(task, { ...block, time_zone: null }, null).timeZone, null, 'a slot with none: null (the home zone)')
const plan = { id: 'p', title: 'Run', category: 'daily', days_of_week: [2], effective_from: '2026-11-03', repeat_kind: 'weekly', repeat_interval: null, repeat_unit: null, repeat_dates: null, google_calendar_event_id: null, start_time: '07:00:00', end_time: '08:00:00' }
eq(R.itemFromRows(null, null, { ...plan, time_zone: null, google_calendar_time_zone: 'America/New_York' }).timeZone, 'America/New_York', 'a plan with none: the zone its Google series was made in')
eq(R.itemFromRows(task, null, null).timeZone, undefined, 'a task with no slot has no zone to show')
const D = require('../src/features/daily/dayItems.ts')
eq([D.rowTimeZone({ item: { block } }), D.rowTimeZone({ item: { template: { time_zone: null, google_calendar_time_zone: 'Asia/Tokyo' } } }), D.rowTimeZone({ item: null })],
  ['Europe/Istanbul', 'Asia/Tokyo', null], 'a day row\'s zone: its slot\'s, else its plan\'s (else its Google series\'), else none')
{
  const chip = src('src/shared/components/plan-modal/TimeChips.tsx')
  ok(/const abroad = !sameClock\(phone, SERVER_EVENT_TIME_ZONE\)/.test(chip) && /for \(const z of \[saved, phone, SERVER_EVENT_TIME_ZONE\]\)/.test(chip),
    'the sheet\'s zone chip shows while the phone is away from the home clock and offers the item\'s zone, the phone\'s and Oslo\'s (one per clock)')
}
ok(/timeZone: MATCH_TIME_ZONE/.test(src('src/features/football/hooks/useFootball.ts')) && (src('src/features/football/footballModel.ts').match(/timeZone: MATCH_TIME_ZONE/g) ?? []).length === 2,
  'a football plan (Plan it, a subscription, a moved kick-off) is on Oslo\'s clock and says so — its time is read there (osloParts)')
ok(/zoneTag\(rowTimeZone\(row\)\)/.test(src('src/features/daily/components/DayAgendaRows.tsx')) && /row\.kind === 'event' \? null/.test(src('src/features/daily/components/DayAgendaRows.tsx')),
  'the time column shows the zone of a slot or plan whose clock isn\'t the phone\'s — never of a Google event (already on the phone\'s clock)')

// ── Apple: a VTIMEZONE for any real zone, read back against the runtime's offsets ──
const E = require('../src/features/calendar/areas/icloudEvents.ts')
const icsLocal = s => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15))
const offMin = s => (s[0] === '-' ? -1 : 1) * (Number(s.slice(1, 3)) * 60 + Number(s.slice(3, 5)))
/** The offset a VTIMEZONE gives at `t` (RFC 5545: the newest onset at or before t; FREQ=YEARLY;BYMONTH;BYDAY rules). */
function vtzOffsetAt(lines, t) {
  const parts = []
  let cur = null
  for (const l of lines) {
    if (/^BEGIN:(STANDARD|DAYLIGHT)$/.test(l)) cur = {}
    else if (/^END:(STANDARD|DAYLIGHT)$/.test(l)) { parts.push(cur); cur = null }
    else if (cur) { const [k, v] = l.split(':'); cur[k] = v }
  }
  const onsets = []
  for (const p of parts) {
    const from = offMin(p.TZOFFSETFROM), to = offMin(p.TZOFFSETTO)
    const start = icsLocal(p.DTSTART)
    if (!p.RRULE) { onsets.push({ at: start - from * 60_000, to }); continue }
    const r = Object.fromEntries(p.RRULE.split(';').map(x => x.split('=')))
    const month = Number(r.BYMONTH), m = r.BYDAY.match(/^(-?\d)([A-Z]{2})$/)
    const wd = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(m[2]), nth = Number(m[1])
    const clock = start % 86_400_000
    for (let y = new Date(start).getUTCFullYear(); y <= new Date(t).getUTCFullYear() + 1; y++) {
      const days = []
      for (let d = 1; d <= 31; d++) { const x = new Date(Date.UTC(y, month - 1, d)); if (x.getUTCMonth() === month - 1 && x.getUTCDay() === wd) days.push(x.getTime()) }
      const day = nth > 0 ? days[nth - 1] : days[days.length + nth]
      onsets.push({ at: day + clock - from * 60_000, to })
    }
  }
  onsets.sort((a, b) => a.at - b.at)
  let off = null
  for (const o of onsets) if (o.at <= t) off = o.to
  return off ?? offMin(parts[0].TZOFFSETFROM)
}
const intlOffset = (zone, t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]))
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t) / 60_000)
}
eq(E.vtimezoneLines('Europe/Oslo', 2026), E.VTIMEZONE_OSLO, 'the home zone keeps the definition checked live in Phase 1')
for (const zone of ['America/New_York', 'Australia/Sydney', 'Europe/London', 'Europe/Istanbul', 'Asia/Kolkata', 'Asia/Kathmandu',
  'Australia/Lord_Howe', 'America/St_Johns', 'Pacific/Chatham', 'Africa/Casablanca', 'America/Sao_Paulo', 'UTC', 'Etc/GMT+1', 'Europe/Oslo']) {
  const lines = E.vtimezoneLines(zone, 2026)
  ok(lines[0] === 'BEGIN:VTIMEZONE' && lines[1] === `TZID:${zone}` && lines[lines.length - 1] === 'END:VTIMEZONE', `${zone}: one VTIMEZONE named by its zone`)
  let bad = null
  for (let t = Date.UTC(2025, 2, 1); t < Date.UTC(2029, 0, 1) && !bad; t += 3 * 3_600_000) {
    if (vtzOffsetAt(lines, t) !== intlOffset(zone, t)) bad = new Date(t).toISOString()
  }
  eq(bad, null, `${zone}: its VTIMEZONE gives the runtime's offset at every 3rd hour from 2025 to 2028 (summer-time changes included)`)
}
ok(E.vtimezoneLines('America/New_York', 2026).includes('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU')
  && E.vtimezoneLines('Europe/London', 2026).includes('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU'), 'a regular change is a yearly rule (2nd Sunday of March; last Sunday of October)')
ok(!E.vtimezoneLines('Africa/Casablanca', 2026).some(l => l.startsWith('RRULE')), 'an irregular zone lists its changes (no rule that isn\'t true)')
for (const bad of ['Europe/Oslo\r\nATTENDEE:mailto:x@example.com', 'Not/AZone', '', 'Europe/Oslo;X=1']) {
  let threw = false
  try { E.vtimezoneLines(bad, 2026) } catch { threw = true }
  ok(threw, `a zone that is no zone name is never written (${JSON.stringify(bad).slice(0, 30)})`)
}
const { DEFAULT_AREAS } = require('../src/features/calendar/areas/calendarAreas.ts')
const now = new Date('2026-11-02T10:00:00Z')
const look = { notes: 'link', allDayAlert: null }
const ev = E.slotEvent({ id: '0f8fad5b-d9cb-469f-a165-70867728950e', date: '2026-11-12', start_time: '17:00:00', duration_minutes: 60, title: 'Gym', busy: true },
  { done: false, area: DEFAULT_AREAS.personal, look, timeZone: 'Europe/Istanbul', appUrl: 'https://example.com/app/', now })
ok(ev.ics.includes('DTSTART;TZID=Europe/Istanbul:20261112T170000') && ev.ics.includes('DTEND;TZID=Europe/Istanbul:20261112T180000') && ev.ics.includes('TZID:Europe/Istanbul\r\n'),
  'a slot in Istanbul is written at 17:00 Istanbul time, with Istanbul\'s VTIMEZONE')
ok(!ev.ics.includes('TZID:Europe/Oslo'), '…and no Oslo definition it doesn\'t use')
let guarded = false
try {
  E.eventObject({ uid: 'x', body: { summary: 'x', start: { dateTime: '2026-11-12T17:00:00', timeZone: 'Europe/Oslo:20261112T170000\r\nX:1' }, end: { dateTime: '2026-11-12T18:00:00', timeZone: 'Europe/Oslo' }, transparency: 'opaque' },
    area: DEFAULT_AREAS.personal, look, notes: null, link: 'https://example.com', now })
} catch { guarded = true }
ok(guarded, 'the last guard: an event whose zone is no zone name is never written')

// ── The function: the generated copy is current, and it writes and reads in the item's zone ──
const fn = src('supabase/functions/icloud-calendar/index.ts')
ok(/timeZone: itemTimeZone\(b\.time_zone\)/.test(fn) && /timeZone: planTimeZone\(p\)/.test(fn), 'the drain writes a slot in its zone and a plan in its own (else its Google series\')')
ok(/icloud_etag, icloud_from, icloud_horizon, time_zone'\)/.test(fn) && /schedule_block_id, google_calendar_event_id, icloud_area, icloud_etag, time_zone'\)/.test(fn), '…reading each one\'s zone')
ok(/readbackChangeOf\(item\.ics, o\.entity, `lasci-\$\{o\.entity\}-\$\{o\.id\}@lasciviens\.github\.io`, emoji, zones\.get\(keyOf\(x\)\) \?\? OSLO\)/.test(fn),
  'the read-back reads each iPhone change on its item\'s own clock')
const block2 = fn.slice(fn.indexOf('// <icloud-pure>'), fn.indexOf('// </icloud-pure>'))
const uidOf = (kind, id) => [`lasci-${kind}-${id}`, 'lasciviens.github.io'].join('@')
const I = new Function(`${transform(block2.replace(/^export /gm, ''), { transforms: ['typescript'] }).code}; return { readbackChangeOf, startOf }`)()
const moved = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${uidOf('slot', 1)}`, 'DTSTART;TZID=Europe/Oslo:20261112T150000', 'DTEND;TZID=Europe/Oslo:20261112T163000',
  'SUMMARY:Gym', 'LAST-MODIFIED:20261102T090000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
const inIstanbul = I.readbackChangeOf(moved, 'slot', uidOf('slot', 1), '', 'Europe/Istanbul')
eq([inIstanbul.date, inIstanbul.time, inIstanbul.minutes], ['2026-11-12', '17:00', 90], 'an Istanbul item moved on an iPhone in Oslo to 15:00 Oslo time is 17:00 on its own clock')
const atHome = I.readbackChangeOf(moved, 'slot', uidOf('slot', 1), '')
eq([atHome.date, atHome.time], ['2026-11-12', '15:00'], 'an item in the home zone reads on Oslo\'s clock, as before')
const series = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${uidOf('plan', 2)}`, 'DTSTART;TZID=Asia/Tokyo:20261103T070000', 'DTEND;TZID=Asia/Tokyo:20261103T080000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE;TZID=Asia/Tokyo:20261110T070000', 'SUMMARY:Run', 'LAST-MODIFIED:20261102T090000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
eq(I.readbackChangeOf(series, 'plan', uidOf('plan', 2), '', 'Asia/Tokyo').days, [{ originalDate: '2026-11-10', cancelled: true }],
  'a day taken out on the iPhone is read on the plan\'s clock (on Oslo\'s it would be the day before)')

// ── The client sends the zone to the data API only ──
const client = src('src/integrations/supabase/client.ts')
ok(/url\.origin === apiOrigin && url\.pathname\.startsWith\('\/rest\/v1\/'\)/.test(client) && /headers\.set\('x-time-zone', zone\)/.test(client),
  'the phone\'s zone goes as x-time-zone to the data API only (never to an edge function: their CORS lists fixed headers)')
ok(/if \(zoneHeader === 'unknown' && !read\) return fetch\(input, init\)/.test(client) && /zoneHeader = 'refused'/.test(client),
  'writes carry it only once a read showed it passes; a read that fails with it and works without leaves it out — it never breaks the app')

console.log(`verify-time-zones: ${n} passed, 0 failed`)
