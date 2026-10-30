#!/usr/bin/env node
/*
 * Verification — the iCloud Calendar function's pure parts (supabase/functions/
 * icloud-calendar, the block between <icloud-pure> markers; Phase 1, owner
 * 29.10.2026; docs/integrations/icloud-caldav.md): credentials only to iCloud
 * hosts, only an app-specific password, a 207 multistatus read with any
 * namespace prefix, iCalendar escaping and folding (never inside æøå or an
 * emoji), the check's events, what the read-back counts as kept, and the read
 * test (calendars found, any time zone onto the Oslo clock, repeats, the
 * week by day). Plus
 * static checks on the function: redirects by hand, nothing logged that could
 * hold the password, the owner lock.
 *
 *   Run:  node scripts/verify-icloud-caldav.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/icloud-calendar/index.ts'), 'utf8')
const block = src.slice(src.indexOf('// <icloud-pure>'), src.indexOf('// </icloud-pure>'))
const code = transform(block.replace(/^export /gm, ''), { transforms: ['typescript'] }).code
const I = new Function(`${code}; return { isICloudUrl, isTestCalendarName, isAppSpecificPassword, maskAppleId, xmlText, parseMultistatus, icsEscape, foldLine, checkEvents, eventProps, keptOf, changeOf, escapeXml, startOf, zonedToUtc, readWindow, calendarQuery, calendarsOf, listingKinds, readEventsOf, byDay }`)()

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}

console.log('\n== Where the password may go ==')
eq(['https://caldav.icloud.com/', 'https://p67-caldav.icloud.com:443/123/calendars/'].map(I.isICloudUrl), [true, true], "iCloud's CalDAV hosts over HTTPS")
eq(['https://icloud.com/', 'https://www.icloud.com/', 'https://p67-contacts.icloud.com/', 'https://ola:pw@caldav.icloud.com/'].map(I.isICloudUrl), [false, false, false, false],
  'other iCloud hosts and a URL carrying its own user name are refused')
eq(['http://caldav.icloud.com/', 'https://caldav.icloud.com.evil.example/', 'https://evilicloud.com/', 'https://example.com/?u=https://caldav.icloud.com', 'not a url'].map(I.isICloudUrl), [false, false, false, false, false],
  'never plain HTTP, a look-alike host or anything else')
eq(['abcd-efgh-ijkl-mnop', ' ABCD-EFGH-IJKL-MNOP '].map(I.isAppSpecificPassword), [true, true], 'an app-specific password (any case, spaces trimmed)')
eq(['MyApplePassword1!', 'abcd-efgh-ijkl', 'abcd-efgh-ijkl-mnop-qrst', 'abc1-efgh-ijkl-mnop'].map(I.isAppSpecificPassword), [false, false, false, false],
  'an Apple ID password (or anything else) is refused before it is stored')
eq(I.maskAppleId('ola.nordmann@example.com'), 'o…@example.com', 'the email shown back is masked')

console.log('\n== Reading iCloud\'s answers (207 multistatus) ==')
const discovery = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/123456/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`
eq(I.xmlText(I.parseMultistatus(discovery).responses[0].props, 'href'), '/123456/principal/', 'the principal, with no prefix (default namespace)')
const home = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123456/principal/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>https://p67-caldav.icloud.com:443/123456/calendars/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>`
const homeResp = I.parseMultistatus(home).responses[0]
eq(I.xmlText(homeResp.props, 'href'), 'https://p67-caldav.icloud.com:443/123456/calendars/', 'the calendar home, prefixed elements (d:, cal:)')
eq(homeResp.props.includes('displayname'), false, 'a 404 propstat is not read as a property')
const sync = `<multistatus xmlns="DAV:"><response><href>/123/calendars/lasci-test/a.ics</href><propstat><prop><getetag>"e1"</getetag></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123/calendars/lasci-test/b.ics</href><status>HTTP/1.1 404 Not Found</status></response><sync-token>https://example.icloud.com/sync/42</sync-token></multistatus>`
const s = I.parseMultistatus(sync)
eq(s.responses.map(r => [r.href.split('/').pop(), r.status]), [['a.ics', null], ['b.ics', 404]], 'a sync report: changed (props) and deleted (its own 404)')
eq(s.syncToken, 'https://example.icloud.com/sync/42', '…and the new sync token')
const data = `<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/x/a.ics</href><propstat><prop><C:calendar-data><![CDATA[BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:A &amp; B\r\nEND:VEVENT\r\nEND:VCALENDAR]]></C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`
eq(I.xmlText(I.parseMultistatus(data).responses[0].props, 'calendar-data').includes('SUMMARY:A &amp; B'), true, 'calendar-data in CDATA keeps its text as written')
const escaped = `<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/x/a.ics</href><propstat><prop><C:calendar-data>BEGIN:VEVENT&#13;\nSUMMARY:A &amp; B&#13;\nEND:VEVENT</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`
eq(I.xmlText(I.parseMultistatus(escaped).responses[0].props, 'calendar-data'), 'BEGIN:VEVENT\r\nSUMMARY:A & B\r\nEND:VEVENT', 'entity-escaped calendar-data is unescaped (&amp; last)')
eq(I.escapeXml('a&b<c>"'), 'a&amp;b&lt;c&gt;&quot;', 'a token or href going into a request body is escaped')

console.log('\n== iCalendar text ==')
eq(I.icsEscape('a;b,c\\d\nline'), 'a\\;b\\,c\\\\d\\nline', 'TEXT escaping (RFC 5545 §3.3.11)')
const long = 'DESCRIPTION:' + 'æøå🏋️'.repeat(20)
const folded = I.foldLine(long)
const enc = new TextEncoder()
eq(folded.split('\r\n ').every((l, i) => enc.encode(l).length <= (i ? 74 : 75)), true, 'folded at 75 octets (74 after the leading space)')
eq(folded.split('\r\n ').join(''), long, 'unfolding gives the line back — no æøå or emoji cut in half')

console.log('\n== The check\'s events ==')
const evs = I.checkEvents('2026-10-30', new Date('2026-10-29T10:00:00Z'), 'https://lasciviens.github.io/Project_Daily/#/daily')
eq(evs.map(e => e.key), ['alarm', 'notes', 'place', 'maybe', 'private', 'free', 'allday', 'repeat', 'emoji'], 'one event per feature')
eq(evs.every(e => e.ics.startsWith('BEGIN:VCALENDAR\r\n') && e.ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(e.ics)), true, 'CRLF line ends throughout')
eq(evs.every(e => e.ics.includes('BEGIN:VTIMEZONE\r\nTZID:Europe/Oslo')), true, 'Europe/Oslo is defined in every object that uses it')
eq(new Set(evs.map(e => e.uid)).size, evs.length, 'unique UIDs')
const round = Object.fromEntries(evs.map(e => [e.key, I.keptOf(I.eventProps(e.ics))]))
eq(evs.map(e => e.expect.every(k => round[e.key][k])), evs.map(() => true), 'reading our own events back finds every feature each one expects')
eq([round.alarm.private, round.maybe.free, round.notes.alarm], [false, false, false], 'a feature only shows where it was written')
eq(I.eventProps(evs[0].ics).get('DESCRIPTION'), undefined, "the alarm's own DESCRIPTION is not read as the event's")
eq(I.changeOf(I.eventProps(evs[7].ics)), { title: 'Lasci check · Every day ×4, the 2nd day left out', starts: '30.10.2026 18:00' }, 'a change reads its title and DD.MM.YYYY HH:MM start')
eq(I.changeOf(I.eventProps(evs[6].ics)).starts, '30.10.2026', 'an all-day change reads its day only')
eq(I.changeOf(new Map([['DTSTART', ['DTSTART:20261030T140000Z']], ['SUMMARY', ['SUMMARY:Moved']]])).starts, '30.10.2026 15:00', 'a UTC time reads as the Oslo clock (winter: +1)')
eq(I.changeOf(new Map([['DTSTART', ['DTSTART:20260630T140000Z']]])).starts, '30.06.2026 16:00', 'a UTC time reads as the Oslo clock (summer: +2)')
eq(['Lasci · Test', 'lasci test', 'Lasci-Test', 'LASCI TEST '].map(I.isTestCalendarName), [true, true, true, true], 'the test calendar is found by its name however it was typed on the iPhone')
eq(['Lasci', 'Test', 'Lasci Tests', null].map(I.isTestCalendarName), [false, false, false, false], 'another calendar is never taken for it')

console.log('\n== Read my calendars ==')
eq([
  'DTSTART;VALUE=DATE:20261030',
  'DTSTART:20261030T090000Z',
  'DTSTART;TZID=Europe/Oslo:20261030T100000',
  'DTSTART;TZID=America/New_York:20261030T100000',
  'DTSTART;TZID="Europe/London":20260630T090000',
  'DTSTART:20261030T100000',
  'DTSTART;TZID=W. Europe Standard Time:20261030T100000',
].map(I.startOf), [
  { day: '2026-10-30', time: null, zone: null },
  { day: '2026-10-30', time: '10:00', zone: null },
  { day: '2026-10-30', time: '10:00', zone: null },
  { day: '2026-10-30', time: '15:00', zone: null },
  { day: '2026-06-30', time: '10:00', zone: null },
  { day: '2026-10-30', time: '10:00', zone: null },
  { day: '2026-10-30', time: '10:00', zone: 'W. Europe Standard Time' },
], 'a start on the Oslo clock: all-day, UTC, Oslo, New York (still on summer time), London, floating, and a zone the runtime does not know (as written, named)')
eq(I.startOf('DTSTART;TZID=America/New_York:20261030T220000').day, '2026-10-31', 'a late evening in New York is the next day in Oslo')
eq([I.zonedToUtc(2026, 3, 29, 3, 30, 'Europe/Oslo').toISOString(), I.zonedToUtc(2026, 10, 25, 1, 30, 'Europe/Oslo').toISOString(), I.zonedToUtc(2026, 1, 15, 12, 0, 'Not/AZone')],
  ['2026-03-29T01:30:00.000Z', '2026-10-24T23:30:00.000Z', null], 'wall-clock → instant around both summer-time switches; an unknown zone is null')
eq(I.readWindow(new Date('2026-10-29T23:30:00Z')), { fromDay: '2026-10-30', toDay: '2026-11-05', start: '20261029T230000Z', end: '20261105T230000Z' },
  "the window: today on the Oslo clock (00:30 on the 30th is still the 29th in UTC) and the next 6 days")
eq(I.readWindow(new Date('2026-10-22T10:00:00Z')), { fromDay: '2026-10-22', toDay: '2026-10-28', start: '20261021T220000Z', end: '20261028T230000Z' },
  'a window across the end of summer time starts and ends at Oslo midnight')
const q = I.calendarQuery('20261029T230000Z', '20261105T230000Z')
eq(/<c:expand start="20261029T230000Z" end="20261105T230000Z"\/>/.test(q) && /<c:time-range start="20261029T230000Z" end="20261105T230000Z"\/>/.test(q) && /comp-filter name="VEVENT"/.test(q), true,
  'the query asks for events touching the window, repeats split into their days')
const homeXml = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
<response><href>/123/calendars/</href><propstat><prop><displayname/><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123/calendars/home/</href><propstat><prop><displayname>Home</displayname><resourcetype><collection/><C:calendar/></resourcetype><A:calendar-color>#FF2968FF</A:calendar-color><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123/calendars/tasks/</href><propstat><prop><displayname>Reminders</displayname><resourcetype><collection/><C:calendar/></resourcetype><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123/calendars/inbox/</href><propstat><prop><displayname>Inbox</displayname><resourcetype><collection/><C:schedule-inbox/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123/calendars/work/</href><propstat><prop><displayname>Work</displayname><resourcetype><collection/><C:calendar/></resourcetype><A:calendar-color>red</A:calendar-color></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`
eq(I.calendarsOf(I.parseMultistatus(homeXml).responses), [{ href: '/123/calendars/home/', name: 'Home', color: '#FF2968' }, { href: '/123/calendars/work/', name: 'Work', color: null }],
  'event calendars only (not the home, the inbox or a tasks-only list); a colour only when it is a real #RRGGBB')
// iCloud's own answer may quote attributes with ' (29.10.2026: the first live read found no calendar).
const singleQuoted = `<?xml version='1.0' encoding='UTF-8'?><multistatus xmlns='DAV:'><response><href>/123/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><displayname/><calendar-color xmlns='http://apple.com/ns/ical/'/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>
<response><href>/123/calendars/home/</href><propstat><prop><displayname>Home</displayname><resourcetype><collection/><calendar xmlns='urn:ietf:params:xml:ns:caldav'/></resourcetype><calendar-color xmlns='http://apple.com/ns/ical/' symbolic-color='red'>#FF2968FF</calendar-color><supported-calendar-component-set xmlns='urn:ietf:params:xml:ns:caldav'><comp name='VEVENT'/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123/calendars/tasks/</href><propstat><prop><displayname>Reminders</displayname><resourcetype><collection/><calendar xmlns='urn:ietf:params:xml:ns:caldav'/></resourcetype><supported-calendar-component-set xmlns='urn:ietf:params:xml:ns:caldav'><comp name='VTODO'/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123/calendars/inbox/</href><propstat><prop><resourcetype><collection/><schedule-inbox xmlns='urn:ietf:params:xml:ns:caldav'/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`
eq(I.calendarsOf(I.parseMultistatus(singleQuoted).responses).map(c => [c.name, c.color]), [['Home', '#FF2968']], "single-quoted XML ('VEVENT') is read the same as double-quoted")
eq(I.listingKinds(I.parseMultistatus(singleQuoted).responses), ['collection', 'collection calendar [VEVENT]', 'collection calendar [VTODO]', 'collection schedule-inbox'],
  'what the home listed, by kind only (element names, no calendar name or address)')
eq(I.listingKinds(I.parseMultistatus(homeXml).responses).join(' | ').includes('Home'), false, 'a calendar name never reaches the listing')
const obj = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTIMEZONE', 'TZID:Europe/Oslo', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'END:STANDARD', 'END:VTIMEZONE', ...lines, 'END:VCALENDAR'].join('\r\n')
const seriesObj = obj(['BEGIN:VEVENT', 'UID:a', 'SUMMARY:Gym', 'DTSTART;TZID=Europe/Oslo:20260105T070000', 'RRULE:FREQ=WEEKLY', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a', 'RECURRENCE-ID;TZID=Europe/Oslo:20261102T070000', 'SUMMARY:Gym (moved)', 'DTSTART;TZID=Europe/Oslo:20261102T090000', 'END:VEVENT'])
eq(I.readEventsOf(seriesObj).map(e => [e.day, e.time, e.title, e.repeats, e.series]), [['2026-01-05', '07:00', 'Gym', true, true], ['2026-11-02', '09:00', 'Gym (moved)', true, false]],
  'a series iCloud did not split: the series (where it began) and its moved day; the time-zone block and the alert are not events')
const expanded = obj(['BEGIN:VEVENT', 'UID:b', 'RECURRENCE-ID:20261030T060000Z', 'SUMMARY:Standup', 'DTSTART:20261030T060000Z', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:b', 'RECURRENCE-ID:20261102T070000Z', 'SUMMARY:Standup', 'DTSTART:20261102T070000Z', 'END:VEVENT'])
eq(I.readEventsOf(expanded).map(e => [e.day, e.time, e.repeats, e.series]), [['2026-10-30', '07:00', true, false], ['2026-11-02', '08:00', true, false]], 'days iCloud split out (expand) are each a row, on the Oslo clock')
eq(I.readEventsOf(obj(['BEGIN:VEVENT', 'UID:c', 'SUMMARY:Dinner\\, Ola', 'DTSTART:20261031T170000Z', 'ORGANIZER:mailto:ola@example.com', 'ATTENDEE:mailto:kari@example.com', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Called off', 'STATUS:CANCELLED', 'DTSTART:20261031T170000Z', 'END:VEVENT'])).map(e => [e.title, e.invitation]), [['Dinner, Ola', true]],
  'an invitation is marked; a cancelled event is left out; the title is unescaped')
const week = I.byDay([
  { name: 'Home', color: '#FF2968', events: [
    { day: '2026-10-31', time: '18:00', title: 'Dinner', repeats: false, series: false, invitation: true, zone: null },
    { day: '2026-10-31', time: null, title: 'Halloween', repeats: false, series: false, invitation: false, zone: null },
    { day: '2026-10-27', time: null, title: 'Trip', repeats: false, series: false, invitation: false, zone: null },
    { day: '2026-01-05', time: '07:00', title: 'Gym', repeats: true, series: true, invitation: false, zone: null },
  ] },
  { name: 'Work', color: null, events: [{ day: '2026-10-31', time: '09:00', title: 'Standup', repeats: true, series: false, invitation: false, zone: null }] },
], '2026-10-30', '2026-11-05')
eq(week.days.map(d => [d.day, d.events.map(e => `${e.time ?? 'all day'} ${e.title} (${e.calendar})${e.since ? ` since ${e.since}` : ''}`)]), [
  ['2026-10-30', ['all day Trip (Home) since 2026-10-27']],
  ['2026-10-31', ['all day Halloween (Home)', '09:00 Standup (Work)', '18:00 Dinner (Home)']],
], 'the week by day across calendars: all-day first, then by time; one that began earlier shows on the first day, with since')
eq(week.series.map(e => [e.title, e.since]), [['Gym', '2026-01-05']], 'a series iCloud did not split is listed apart, with where it began')

console.log('\n== The function ==')
eq(/redirect: 'manual'/.test(src) && /isICloudUrl\(current\)/.test(src), true, 'redirects are followed by hand, iCloud hosts only')
eq(/console\.(log|error|warn)\([^)]*(password|app_password|creds|authorization|Authorization)/i.test(src), false, 'nothing logged that could hold the password or the auth header')
eq(/\.select\([^)]*app_password[^)]*\)[\s\S]{0,400}answer\(\{[^}]*app_password/.test(src), false, 'the password is never answered back')
eq(/auth\.getUser\(/.test(src) && /isAppUser\(user\.id\)/.test(src), true, 'browser caller: getUser and the owner lock')
eq(/isAppSpecificPassword\(password\)/.test(src), true, 'connect refuses anything but an app-specific password')
const connectBlock = src.slice(src.indexOf("if (action === 'connect')"), src.indexOf("if (action === 'disconnect')"))
eq(/signedInAt\(authHeader\.replace\('Bearer ', ''\)\)\s*\n\s*if \(signedIn === null \|\| Date\.now\(\) - signedIn > FRESH_SIGN_IN_MS\)/.test(connectBlock)
  && connectBlock.indexOf('FRESH_SIGN_IN_MS') < connectBlock.indexOf('discover(creds)') && /const FRESH_SIGN_IN_MS = 10 \* 60_000/.test(src), true,
  'connect needs a sign-in from the last 10 minutes, checked before iCloud is called (a stolen, refreshed session can\'t)')
{
  // The sign-in time, run on sample tokens: only the password sign-in counts (a second factor a stolen session
  // verifies would be stamped "now").
  const fnText = src.match(/function signedInAt\(jwt: string\): number \| null \{[\s\S]*?\n\}\n/)?.[0] ?? ''
  const signedInAt = new Function(`${transform(fnText, { transforms: ['typescript'] }).code}\nreturn signedInAt`)()
  const tok = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
  const now = Math.floor(Date.now() / 1000)
  eq([signedInAt(tok({ amr: [{ method: 'password', timestamp: now - 60 }] })) === (now - 60) * 1000,
      signedInAt(tok({ amr: [{ method: 'password', timestamp: now - 86400 }, { method: 'totp', timestamp: now }] })) === (now - 86400) * 1000,
      signedInAt(tok({ amr: [{ method: 'totp', timestamp: now }] })), signedInAt(tok({ sub: 'x' })), signedInAt('nonsense')],
    [true, true, null, null, null], "connect's sign-in time: the password sign-in only — never a second factor's time, nothing for a token without one")
  const api = fs.readFileSync(path.join(__dirname, '../src/features/calendar/icloud/icloudApi.ts'), 'utf8')
  eq(/m\?\.method === 'password'/.test(api) && /export const FRESH_SIGN_IN_MS = 10 \* 60_000/.test(api), true,
    'the card asks for a fresh sign-in by the same rule as the server, before the owner makes an Apple password')
}
eq(/if \(row\) \{\n[^\n]*\n\s*const \{ error \} = await db\.from\('icloud_credentials'\)\n\s*\.update\(\{ app_password: sealed, principal_url: principal, calendar_home_url: home, last_error: null, connected_at: connectedAt \}\)/.test(connectBlock), true,
  'a new password for the same Apple ID keeps its calendars, test calendar and read-back (only the password and addresses change)')
eq(/if \(row && row\.apple_id\.toLowerCase\(\) !== email\.toLowerCase\(\)\)/.test(connectBlock) && connectBlock.indexOf('row.apple_id') < connectBlock.indexOf('.upsert('), true,
  'another Apple ID connects only after Disconnect (never a silent swap of where the calendars go)')
eq(/delete\(\)\.eq\('user_id', user\.id\)\s*\n\s*if \(error\) throw/.test(src), true, 'disconnect says so when the stored password could not be deleted')
eq(/mk\.status === 405[\s\S]{0,400}isTestCalendarName\(xmlText\(props, 'displayname'\)\)/.test(src), true, 'a 405 on MKCALENDAR counts only when the calendar there is the test calendar')
eq(/onlyOurs[\s\S]{0,300}lasci-check-\[a-z\]\+-lasciviens-github-io\\\.ics/.test(src) && /isAppsTestCalendar\(row\) && onlyOurs/.test(src), true,
  'Remove deletes the whole calendar only when the app made it and it holds nothing but the check events')
eq(/isAppsTestCalendar\(row\) && onlyOurs/.test(src) && /paths\.includes\(self\) && /.test(src) && !/endsWith\(`\/\$\{TEST_SLUG\}`\)/.test(src)
  && /test_calendar_url === new URL\(TEST_SLUG, r\.calendar_home_url\)\.toString\(\)/.test(src), true,
  'Remove compares the exact address the app built (never a suffix), and an empty listing proves nothing')
eq(/!READ_METHODS\.has\(method\) && res\.status !== 303 && next\.pathname !== new URL\(current\)\.pathname/.test(src), true,
  'a write follows a redirect to another iCloud server only, never to another path')
eq(/text: await readCapped\(res\)/.test(src) && !/text: await res\.text\(\)/.test(src) && /const MAX_ANSWER_BYTES = 10 \* 1024 \* 1024/.test(src), true,
  'an iCloud answer is read up to 10 MB, never without a limit')
eq(/const DRAIN_LEASE_MS = 150_000/.test(src), true, 'a drain\'s lease lasts as long as the function may run (never two drains side by side)')
eq(/sync-collection[\s\S]{0,300}Depth: '0'/.test(src), true, 'sync-collection asks with Depth 0 (RFC 6578)')
eq(/update\(\{ test_calendar_url: cal\.url[\s\S]{0,200}checkEvents\(/.test(src), true, 'the test calendar is saved before any event is written (Remove can always find them)')
eq(/if \(readError\)[\s\S]{0,500}502\)/.test(src), true, 'a failed read answers an error, never "not connected" (Apple shows a password only once)')
const readBlock = src.slice(src.indexOf("if (action === 'read')"), src.indexOf("if (action === 'remove')"))
eq(readBlock.length > 0 && !/'(PUT|DELETE|MKCALENDAR|PROPPATCH)'/.test(readBlock) && !/last_check|test_calendar_url:/.test(readBlock), true,
  'Read my calendars only reads: no write to iCloud, nothing of the calendars stored')
eq(/console\.(log|error|warn)\([^)]*(title|events|calendars)/i.test(src), false, 'no event or calendar is ever logged')
eq(/e\.code === 'auth' \? 400/.test(src), true, "Apple refusing the password answers 400, not the app's own 401")

console.log(`\nverify-icloud-caldav: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
