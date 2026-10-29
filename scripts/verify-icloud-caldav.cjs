#!/usr/bin/env node
/*
 * Verification — the iCloud Calendar function's pure parts (supabase/functions/
 * icloud-calendar, the block between <icloud-pure> markers; Phase 1, owner
 * 29.10.2026; docs/integrations/icloud-caldav.md): credentials only to iCloud
 * hosts, only an app-specific password, a 207 multistatus read with any
 * namespace prefix, iCalendar escaping and folding (never inside æøå or an
 * emoji), the check's events, and what the read-back counts as kept. Plus
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
const I = new Function(`${code}; return { isICloudUrl, isAppSpecificPassword, maskAppleId, xmlText, parseMultistatus, icsEscape, foldLine, checkEvents, eventProps, keptOf, changeOf, escapeXml }`)()

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}

console.log('\n== Where the password may go ==')
eq(['https://caldav.icloud.com/', 'https://p67-caldav.icloud.com:443/123/calendars/', 'https://icloud.com/'].map(I.isICloudUrl), [true, true, true], 'iCloud hosts over HTTPS')
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

console.log('\n== The function ==')
eq(/redirect: 'manual'/.test(src) && /isICloudUrl\(current\)/.test(src), true, 'redirects are followed by hand, iCloud hosts only')
eq(/console\.(log|error|warn)\([^)]*(password|app_password|creds|authorization|Authorization)/i.test(src), false, 'nothing logged that could hold the password or the auth header')
eq(/\.select\([^)]*app_password[^)]*\)[\s\S]{0,400}answer\(\{[^}]*app_password/.test(src), false, 'the password is never answered back')
eq(/auth\.getUser\(/.test(src) && /isAppUser\(user\.id\)/.test(src), true, 'browser caller: getUser and the owner lock')
eq(/isAppSpecificPassword\(password\)/.test(src), true, 'connect refuses anything but an app-specific password')

console.log(`\nverify-icloud-caldav: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
