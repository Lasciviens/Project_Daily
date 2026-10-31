#!/usr/bin/env node
/*
 * Verification — the app's calendars per area (Settings → Calendar, Phase 2a
 * of docs/features/calendar-plan.md): the saved settings are checked where
 * they enter (a wrong value falls back to its default, never a broken
 * calendar), the function's copy of the rules is the same text, the stored
 * app-specific password is sealed (AES-GCM, bound to the account) and never
 * stored plain by connect, and "Create in Apple Calendar" writes calendars
 * only — no event.
 *
 *   Run:  node scripts/verify-calendar-areas.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')
require('sucrase/register')
const A = require('../src/features/calendar/areas/calendarAreas')

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}

console.log('\n== The settings ==')
const d = A.readCalendarPrefs(null)
eq(A.AREA_KEYS, ['training', 'work', 'personal', 'media', 'football', 'games'], 'six areas (owner, 29.10.2026; Games its own, 31.10.2026)')
eq(A.AREA_KEYS.map(k => d.areas[k].alertMinutes), [null, null, null, null, null, null], 'no area has an alert by default (owner, 31.10.2026: "off by default")')
eq([d.areas.games.name, d.areas.games.emoji, d.areas.games.app], ['Lasci · Games', '🎮', 'google'], 'Games: its own calendar, on Google until switched')
eq(A.AREA_KEYS.every(k => d.areas[k].emoji && d.areas[k].enabled && /^#[0-9A-F]{6}$/.test(d.areas[k].color)), true, 'every area has an emoji, a colour and is in use by default')
const saved = A.readCalendarPrefs({ areas: { training: { name: '  Gym  ', emoji: '💪', color: '#ff00aa', alertMinutes: 30, enabled: false }, work: { name: 'Jobb – æøå' } } })
eq(saved.areas.training, { name: 'Gym', emoji: '💪', color: '#FF00AA', alertMinutes: 30, enabled: false, app: 'google' }, 'a saved area is read as saved (name trimmed, colour upper case)')
eq([A.readCalendarPrefs({ areas: { football: { app: 'apple' } } }).areas.football.app, A.readCalendarPrefs({ areas: { football: { app: 'outlook' } } }).areas.football.app, d.areas.training.app],
  ['apple', 'google', 'google'], "an area goes to Google Calendar until it is switched to Apple (Phase 2b); anything else reads as Google")
eq(saved.areas.work.name, 'Jobb – æøå', 'æøå in a name are kept')
eq([saved.areas.work.emoji, saved.areas.work.alertMinutes], ['💼', null], 'a value not saved keeps its default')
const bad = A.readCalendarPrefs({ areas: { media: { name: '', emoji: '😀'.repeat(13), color: 'purple', alertMinutes: -7, enabled: 'yes' }, football: { alertMinutes: null, emoji: '' } } })
eq(bad.areas.media, A.DEFAULT_AREAS.media, 'a wrong name, emoji, colour, alert or switch falls back to its default')
eq([bad.areas.football.alertMinutes, bad.areas.football.emoji], [null, ''], 'an alert of None and no emoji are real choices, kept')
eq(A.readCalendarPrefs({ areas: { training: { name: 'x'.repeat(61) } } }).areas.training.name, A.DEFAULT_AREAS.training.name, 'a name over 60 characters is not taken')
eq(A.readCalendarPrefs('nonsense').areas.personal, A.DEFAULT_AREAS.personal, 'a broken document reads as the defaults')
eq([d.notes, d.allDayAlert], ['notes+link', null], 'every event: notes + link and no all-day alert by default (as before 2b-3)')
eq(A.readCalendarPrefs({ notes: 'link', allDayAlert: { dayBefore: true, time: '18:00' } }), { areas: d.areas, notes: 'link', allDayAlert: { dayBefore: true, time: '18:00' } },
  'a saved notes choice and all-day alert are read back')
eq(['<script>', 'NOTES', 7, null].map(n => A.readCalendarPrefs({ notes: n }).notes), ['notes+link', 'notes+link', 'notes+link', 'notes+link'], 'an unknown notes choice falls back to the default')
eq([{ time: '24:00' }, { time: '9:00' }, { time: '09:00\r\nX:1' }, { time: 900 }, 'on', { dayBefore: 'yes', time: '07:30' }].map(a => A.readCalendarPrefs({ allDayAlert: a }).allDayAlert),
  [null, null, null, null, null, { dayBefore: false, time: '07:30' }], 'an all-day alert takes only a HH:MM time; anything else means none')
eq([A.rewritesEvents(d, { ...d, notes: 'link' }), A.rewritesEvents(d, { ...d, allDayAlert: { dayBefore: false, time: '09:00' } }),
  A.rewritesEvents(d, { ...d, areas: { ...d.areas, work: { ...d.areas.work, alertMinutes: 30 } } }),
  A.rewritesEvents(d, { ...d, areas: { ...d.areas, work: { ...d.areas.work, name: 'Jobb' } } }), A.rewritesEvents(d, A.readCalendarPrefs(null))],
  [true, true, true, false, false], 'the save says events update only when it rewrites them (notes, all-day alert, an area\'s emoji/alert/use — not a name)')
eq([A.areaSlug('football'), A.appleColor('#ff9500')], ['lasci-football/', '#FF9500FF'], "each area's fixed place in iCloud, and Apple's colour form")
eq([A.alertLabel(null), A.alertLabel(0), A.alertLabel(10), A.alertLabel(60), A.alertLabel(120), A.alertLabel(1440)],
  ['None', 'At the start', '10 min before', '1 h before', '2 h before', '1 day before'], 'alert labels')
eq([A.alertLabel(45), A.alertLabel(90), A.alertLabel(2880), A.alertLabel(1500)], ['45 min before', '1 h 30 min before', '2 days before', '1 day 1 h before'], 'a custom alert reads in days, hours and minutes')
eq(A.readCalendarPrefs({ areas: { training: { alertMinutes: 45 }, work: { alertMinutes: 40321 }, media: { alertMinutes: 2.5 }, personal: { alertMinutes: -5 } } }).areas.training.alertMinutes, 45,
  'any whole number of minutes is a real alert choice (owner, 30.10.2026: "Should have a custom input as well")')
eq(['work', 'media', 'personal'].map(k => A.readCalendarPrefs({ areas: { work: { alertMinutes: 40321 }, media: { alertMinutes: 2.5 }, personal: { alertMinutes: -5 } } }).areas[k].alertMinutes), [null, null, null],
  'more than four weeks, a fraction or a negative falls back to the default')
eq(A.areaProblem({ ...d.areas.training, alertMinutes: 40321 }) !== null && A.areaProblem({ ...d.areas.training, alertMinutes: 45 }) === null, true, 'the form says so before saving')
eq([A.areaProblem({ ...d.areas.training, name: ' ' }), A.areaProblem(d.areas.training), A.areaProblem({ ...d.areas.training, emoji: '😀'.repeat(13) })],
  ['Give the calendar a name', null, 'Use one emoji (or none)'], 'the form says what is wrong before saving')

console.log('\n== The function ==')
const fnSrc = fs.readFileSync(path.join(__dirname, '../supabase/functions/icloud-calendar/index.ts'), 'utf8')
const appSrc = fs.readFileSync(path.join(__dirname, '../src/features/calendar/areas/calendarAreas.ts'), 'utf8')
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b) + b.length)
eq(between(fnSrc, '// <calendar-areas>', '// </calendar-areas>') === between(appSrc, '// <calendar-areas>', '// </calendar-areas>'), true,
  "the function's copy of the area rules is the same text as the app's")
const setup = fnSrc.slice(fnSrc.indexOf("if (action === 'setup')"), fnSrc.indexOf("if (action === 'remove')"))
eq(setup.length > 0 && !/'(PUT|DELETE)'/.test(setup) && /readCalendarPrefs\(/.test(setup), true, 'Create in Apple Calendar reads the saved settings and writes calendars only — no event, nothing deleted')
const place = fnSrc.slice(fnSrc.indexOf('async function placeAreaCalendar'), fnSrc.indexOf('const DRAIN_MAX_ROWS'))
eq(/'PROPPATCH'/.test(place) && /'MKCALENDAR'/.test(place) && !/'DELETE'/.test(place) && /mk\.status === 201[\s\S]{0,800}'PROPFIND'[\s\S]{0,400}calendar\[/.test(place), true,
  "a calendar is renamed/recoloured in place, made at its area's place, or — on any refusal — taken there only when it is a calendar")
eq(/notMade\.length \? `\$\{NOT_MADE\}: /.test(setup) && /const NOT_MADE = 'Not made in Apple Calendar'/.test(fnSrc) && /last_error: lastError/.test(setup), true, 'a calendar not made stays the last problem, so a reload still says why')
const connect = fnSrc.slice(fnSrc.indexOf("if (action === 'connect')"), fnSrc.indexOf("if (action === 'disconnect')"))
eq(/if \(!key\) return answer\(\{ error: keyProblem\(\) \}/.test(connect) && /const sealed = await sealSecret\(password, key, user\.id\)/.test(connect)
   && (connect.match(/app_password: /g) || []).length === 2 && (connect.match(/app_password: sealed/g) || []).length === 2, true,
  'connect stores the password only sealed, and refuses without a key')
eq(/openSecret\(row\.app_password, key, userId\)/.test(fnSrc) && /!isSealed\(row\.app_password\)[\s\S]{0,200}sealSecret/.test(fnSrc), true,
  'a stored password is opened with the key, and one stored before sealing is sealed on the next read')

eq(/Deno\.env\.get\('ICLOUD_ENC_KEY'\)\?\.trim\(\)\s*\?\s*'ICLOUD_ENC_KEY is set, but/.test(fnSrc), true,
  "a key that is set but unusable is named as such, not as \"not set\" (owner, 30.10.2026)")
console.log('\n== Sealing the password ==')
const block = between(fnSrc, '// <icloud-pure>', '// </icloud-pure>')
const code = transform(block.replace(/^export /gm, ''), { transforms: ['typescript'] }).code
const F = new Function(`${code}\nreturn { sealKey, sealSecret, openSecret, isSealed }`)()

console.log('\n== The switch per area (2b-2) ==')
const g = A.readCalendarPrefs(null)
const withApp = (over) => A.readCalendarPrefs({ areas: over })
eq(A.areaSwitches(g, withApp({ football: { app: 'apple' } })), [{ area: 'football', to: 'apple' }], 'an area set to Apple is a switch to Apple')
eq(A.areaSwitches(withApp({ football: { app: 'apple' } }), g), [{ area: 'football', to: 'google' }], '…and back')
eq(A.areaSwitches(withApp({ football: { app: 'apple' } }), withApp({ football: { app: 'apple', enabled: false } })), [{ area: 'football', to: 'google' }],
  'an area on Apple switched off goes back to Google (an area not in use has no calendar of its own)')
eq(A.areaSwitches(g, withApp({ football: { app: 'apple', emoji: '🥅' }, media: { emoji: '🎬' } })).length, 1, 'other edits are no switch')
eq(A.areaSwitches(g, withApp({ media: { app: 'apple', enabled: false } })), [], 'Apple picked for an area not in use moves nothing')
const res = { toApple: 0, toGoogle: 0, notOnGoogle: 0, foreign: 0, failed: 0, waiting: 0, partial: false }
eq(A.switchResultText({ ...res, toApple: 14 }), 'Calendar settings saved · 14 items in Apple Calendar', 'what moved, in one line')
eq(A.switchResultText(res), 'Calendar settings saved · nothing to move', '…or that nothing had to')
eq(A.switchResultText({ ...res, toGoogle: 3, notOnGoogle: 1 }), "Calendar settings saved · 3 items back in Google Calendar · 1 item stayed in Apple Calendar (Google didn't take it; saving one puts it in Google Calendar)",
  'one Google did not take stays in Apple Calendar, and says what puts it there')
eq(A.switchResultText({ ...res, toApple: 2, problem: 'Apple did not accept the password' }), 'Calendar settings saved · 2 items in Apple Calendar · stopped: Apple did not accept the password — the rest goes within minutes',
  'a run that stopped says why')
eq(A.switchNeedsAttention({ ...res, problem: 'x' }), true, '…as a warning')
eq([A.switchNeedsAttention({ ...res, toApple: 2 }), A.switchNeedsAttention({ ...res, foreign: 1 }), A.switchNeedsAttention({ ...res, failed: 1 })], [false, true, true],
  'a result with something left behind is a warning, not a plain success')

console.log('\n== The browser asks before it makes a Google Calendar event (2b-2) ==')
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const linkBlock = read('src/features/calendar/api/linkBlockCalendarEvent.ts')
eq(/if \(block\.google_calendar_event_id\) return 'linked'\n[^\n]*\n\s*if \(await appleAreaOf\(slotAreaInput\(block\)\)\) return 'not_linked'\n/.test(linkBlock)
   && linkBlock.indexOf('appleAreaOf(') < linkBlock.indexOf('createCalendarEvent(token'), true, "a slot in an area on Apple never gets a Google Calendar event (asked before any create)")
const series = read('src/features/calendar/api/scheduleSeriesCalendar.ts')
const linkSeries = series.slice(series.indexOf('export async function linkScheduleSeries'), series.indexOf('export async function syncScheduleSeriesAfterSave'))
eq(/if \(await appleAreaOf\(\{ category: row\.category, domain: row\.domain \}\)\) return 'not_linked'/.test(linkSeries)
   && linkSeries.indexOf('appleAreaOf(') < linkSeries.indexOf('createSeriesEvent('), true, "…nor a repeating plan's series")
eq((series.match(/await createSeriesEvent\(/g) || []).length, 1, "the series is made in that one place only")
const settle = read('src/features/calendar/api/itemCalendar.ts')
const appleSettle = settle.slice(settle.indexOf('async function settleItemApple'), settle.indexOf('export async function settleItemGoogle'))
eq(appleSettle.indexOf('await drainTasks()') < appleSettle.indexOf('await drainICloudNow()') && /outcome\.calendar === 'linked' && google === 'calendar'/.test(appleSettle)
   && appleSettle.indexOf("outcome.calendar = now === side.area ? 'linked' : 'unknown'") < appleSettle.indexOf('google_sync_enabled: false'), true,
  'after a save in an Apple area: Google Tasks is sent first, then Apple; the Google Task goes only once the Apple copy is confirmed')
const move = read('src/features/calendar/areas/areaMoveApi.ts')
eq(/catch \(err\) \{\n\s*return putBack\(err\)\n\s*\}/.test(move) && /if \(toApple\.length && !toGoogle\.length && result\.toApple === 0 && !\(await anyInApple\(toApple\.map\(s => s\.area\)\)\)\) return putBack\(err\)/.test(move)
   && move.indexOf('saveCalendarPrefsChanges(next, previous)') > 0 && /if \(error \|\| \(data \?\? \[\]\)\.length\) return true/.test(move), true,
  'a move that fails before anything moved puts the settings back; one that stopped part-way (some already in Apple) keeps the switch')
eq(/if \(toApple\.length\) throw err\n\s*result\.problem = /.test(move), true, 'moving back to Google never waits on iCloud')
eq(/const why = sent\.problem/.test(appleSettle) && /Saved · not in Apple Calendar yet\$\{why\}/.test(appleSettle), true,
  'a save whose Apple copy is not confirmed says so, with the reason')
eq(/save\.mutate\(\{ base: prefs, next: readCalendarPrefs\(form\) \}/.test(read('src/features/settings/components/CalendarTab.tsx'))
   && /saveCalendarPrefsChanges\(previous, next\)/.test(move) && /saveCalendarPrefsChanges\(next, previous\)/.test(move), true,
  'Settings → Calendar saves only the fields changed, over the settings as they are now (a name from the iPhone is never put back)')
const onOpen = read('src/features/calendar/hooks/useICloudDrainOnOpen.ts')
eq(/const AGAIN_AFTER_MS = 30_000/.test(onOpen) && /void invalidate\(qc, 'taskGraph'\)\n\s*void qc\.invalidateQueries\(\{ queryKey: qk\.calendarPrefs \}\)/.test(onOpen), true,
  'coming back to the app reads Apple Calendar again (at most every 30 seconds) and redraws whatever the timer brought in')
const memory = read('src/security/accountState.ts')
eq(/forgetCalendarPrefs\(\)/.test(memory), true, 'sign-out forgets which areas are on Apple')

;(async () => {
  const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7 % 256)).toString('base64')
  const key = await F.sealKey(secret)
  const sealed = await F.sealSecret('abcd-efgh-ijkl-mnop', key, 'user-1')
  eq([F.isSealed(sealed), sealed.includes('abcd')], [true, false], 'a sealed password starts enc:v1: and never contains the password')
  eq(await F.openSecret(sealed, key, 'user-1'), 'abcd-efgh-ijkl-mnop', 'it opens with the same key and account')
  eq(await F.openSecret(sealed, key, 'user-2'), null, "it doesn't open as another account's (the account id is bound in)")
  eq(await F.openSecret(sealed, await F.sealKey(Buffer.alloc(32, 9).toString('base64')), 'user-1'), null, "it doesn't open with another key")
  eq(await F.openSecret(sealed, null, 'user-1'), null, "it doesn't open without the key")
  eq(await F.openSecret('abcd-efgh-ijkl-mnop', null, 'user-1'), 'abcd-efgh-ijkl-mnop', 'a password stored before sealing still reads (and is sealed on the next read with a key)')
  eq([await F.sealKey(null), await F.sealKey(''), await F.sealKey('c2hvcnQ='), await F.sealKey('not base64!!')], [null, null, null, null], 'a missing, short or broken key is no key')
  eq((await F.sealSecret('abcd-efgh-ijkl-mnop', key, 'user-1')) !== sealed, true, 'every seal uses a new IV')
  console.log(`\nverify-calendar-areas: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
