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
eq(A.AREA_KEYS, ['training', 'work', 'personal', 'media', 'football'], 'five areas (owner, 29.10.2026)')
eq(A.AREA_KEYS.map(k => d.areas[k].alertMinutes), [60, 10, null, null, 15], 'default alerts: Training 60, Work 10, Personal none, Media none, Football 15')
eq(A.AREA_KEYS.every(k => d.areas[k].emoji && d.areas[k].enabled && /^#[0-9A-F]{6}$/.test(d.areas[k].color)), true, 'every area has an emoji, a colour and is in use by default')
const saved = A.readCalendarPrefs({ areas: { training: { name: '  Gym  ', emoji: '💪', color: '#ff00aa', alertMinutes: 30, enabled: false }, work: { name: 'Jobb – æøå' } } })
eq(saved.areas.training, { name: 'Gym', emoji: '💪', color: '#FF00AA', alertMinutes: 30, enabled: false }, 'a saved area is read as saved (name trimmed, colour upper case)')
eq(saved.areas.work.name, 'Jobb – æøå', 'æøå in a name are kept')
eq(saved.areas.work.alertMinutes, 10, 'a value not saved keeps its default')
const bad = A.readCalendarPrefs({ areas: { media: { name: '', emoji: '😀'.repeat(13), color: 'purple', alertMinutes: 7, enabled: 'yes' }, football: { alertMinutes: null, emoji: '' } } })
eq(bad.areas.media, A.DEFAULT_AREAS.media, 'a wrong name, emoji, colour, alert or switch falls back to its default')
eq([bad.areas.football.alertMinutes, bad.areas.football.emoji], [null, ''], 'an alert of None and no emoji are real choices, kept')
eq(A.readCalendarPrefs({ areas: { training: { name: 'x'.repeat(61) } } }).areas.training.name, A.DEFAULT_AREAS.training.name, 'a name over 60 characters is not taken')
eq(A.readCalendarPrefs('nonsense').areas.personal, A.DEFAULT_AREAS.personal, 'a broken document reads as the defaults')
eq([A.areaSlug('football'), A.appleColor('#ff9500')], ['lasci-football/', '#FF9500FF'], "each area's fixed place in iCloud, and Apple's colour form")
eq([A.alertLabel(null), A.alertLabel(0), A.alertLabel(10), A.alertLabel(60), A.alertLabel(120), A.alertLabel(1440)],
  ['None', 'At the start', '10 min before', '1 h before', '2 h before', '1 day before'], 'alert labels')
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
const place = fnSrc.slice(fnSrc.indexOf('async function placeAreaCalendar'), fnSrc.indexOf('function osloTomorrow'))
eq(/'PROPPATCH'/.test(place) && /'MKCALENDAR'/.test(place) && !/'DELETE'/.test(place) && /mk\.status === 201[\s\S]{0,800}'PROPFIND'[\s\S]{0,400}calendar\[/.test(place), true,
  "a calendar is renamed/recoloured in place, made at its area's place, or — on any refusal — taken there only when it is a calendar")
eq(/notMade\.length \? `Not made in Apple Calendar/.test(setup) && /last_error: lastError/.test(setup), true, 'a calendar not made stays the last problem, so a reload still says why')
const connect = fnSrc.slice(fnSrc.indexOf("if (action === 'connect')"), fnSrc.indexOf("if (action === 'disconnect')"))
eq(/if \(!key\) return answer\(\{ error: NO_KEY \}/.test(connect) && /app_password: await sealSecret\(password, key, user\.id\)/.test(connect), true,
  'connect stores the password only sealed, and refuses without a key')
eq(/openSecret\(row\.app_password, key, user\.id\)/.test(fnSrc) && /!isSealed\(row\.app_password\)[\s\S]{0,200}sealSecret/.test(fnSrc), true,
  'a stored password is opened with the key, and one stored before sealing is sealed on the next read')

console.log('\n== Sealing the password ==')
const block = between(fnSrc, '// <icloud-pure>', '// </icloud-pure>')
const code = transform(block.replace(/^export /gm, ''), { transforms: ['typescript'] }).code
const F = new Function(`${code}\nreturn { sealKey, sealSecret, openSecret, isSealed }`)()
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
