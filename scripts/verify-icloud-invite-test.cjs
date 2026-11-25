#!/usr/bin/env node
/*
 * Verification — the invite test (25.11.2026; docs/integrations/icloud-caldav.md → The invite test): the address
 * allow-list, the organizer read from iCloud's calendar-user-address-set, the fixed place of the event, the line
 * builder (exact lines), the last guard (what it refuses), the read-back of the event and the Rewrite / Remove guest
 * carry-over. Runs the real block between <icloud-pure> markers of supabase/functions/icloud-calendar/index.ts.
 * Plus static checks: the actions run only for a signed-in app user, never from the timer; the browser names only
 * guests; nothing logs an address; the drain and the read-back never take the test event for an item's; the
 * assistant has no path to it. The daily cap itself: verify-db-icloud-invite-test.mjs (migration 209).
 *
 *   Run:  node scripts/verify-icloud-invite-test.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

const root = path.join(__dirname, '..')
const src = fs.readFileSync(path.join(root, 'supabase/functions/icloud-calendar/index.ts'), 'utf8')
const block = src.slice(src.indexOf('// <icloud-pure>'), src.indexOf('// </icloud-pure>'))
const code = transform(block.replace(/^export /gm, ''), { transforms: ['typescript'] }).code
const I = new Function(`${code}; return { inviteEmail, inviteGuestsOf, inviteOwnGuest, calendarUserAddresses, inviteEventUrl, inviteLines, inviteObject, inviteGuard,
  inviteEventOf, inviteRewriteOf, scheduleTagOf, ownEventOfHref, INVITE_UID, INVITE_FILE, INVITE_GUARD, INVITE_DAY_CAP, INVITE_MAX_GUESTS }`)()

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}
const throwsGuard = fn => { try { fn(); return false } catch (e) { return e.message === I.INVITE_GUARD } }

console.log('\n== The address allow-list ==')
eq(['ola@example.com', ' Ola.Nordmann+test@Example.NET ', 'kari_n%1@mail.example'].map(I.inviteEmail),
  ['ola@example.com', 'ola.nordmann+test@example.net', 'kari_n%1@mail.example'], 'plain addresses, trimmed and lower-cased')
eq([
  'Ola <ola@example.com>', '"Ola" ola@example.com', 'ola@example.com;CN=Ola', 'ola@example.com:x', 'mailto:ola@example.com',
  'ola@example.com\r\nATTENDEE:mailto:x@example.com', 'ola@example.com\nX', 'øla@example.com', 'ola@exämple.com', 'oKla@example.com'.replace('K', 'K'),
  'ola@example', 'ola@@example.com', '@example.com', 'ola@', 'ola@-.', 'ola@example..com', 'o la@example.com', 'ola,kari@example.com',
  `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(250)}.no`, '', null, 42, ['ola@example.com'],
].map(I.inviteEmail), Array(24).fill(null), 'refused: display names, parameters, a second line, non-ASCII (a Kelvin sign too), no domain dot, spaces, commas, > 64 / > 254, not text')

console.log('\n== The guests a Send names ==')
eq(I.inviteGuestsOf(['ola@example.com']), { guests: ['ola@example.com'] }, 'one guest')
eq(I.inviteGuestsOf(['ola@example.com', 'KARI@example.com']), { guests: ['ola@example.com', 'kari@example.com'] }, 'two guests')
eq(['error' in I.inviteGuestsOf([]), 'error' in I.inviteGuestsOf(['a@example.com', 'b@example.com', 'c@example.com']), 'error' in I.inviteGuestsOf('a@example.com'),
  'error' in I.inviteGuestsOf(['a@example.com', 'A@example.com']), 'error' in I.inviteGuestsOf(['a@example.com', 'Ola <b@example.com>']), 'error' in I.inviteGuestsOf([{ email: 'a@example.com' }])],
  [true, true, true, true, true, true], 'refused: none, three, not a list, the same address twice, one not allowed, not text')
eq(I.inviteOwnGuest(['ola@example.org'], ['ola@example.org', 'ola@mail.example']), true, 'one of the account\'s own addresses is no guest')
eq(I.inviteOwnGuest(['kari@example.com'], ['ola@example.org']), false, '…another address is')

console.log('\n== The organizer: iCloud\'s calendar-user-address-set ==')
const set = (hrefs) => `<d:prop><C:calendar-user-address-set xmlns:C="urn:ietf:params:xml:ns:caldav">${hrefs}</C:calendar-user-address-set></d:prop>`
eq(I.calendarUserAddresses(set('<d:href>urn:uuid:1234</d:href><d:href>mailto:ola@mail.example</d:href><d:href preferred="1">mailto:Ola@Example.org</d:href><d:href>/123/principal/</d:href>')),
  { organizer: 'ola@example.org', own: ['ola@mail.example', 'ola@example.org'] }, 'the preferred mailto, lower-cased; every mailto is the account\'s own')
eq(I.calendarUserAddresses(set('<href xmlns="DAV:">mailto:ola@example.org</href><href xmlns="DAV:">mailto:ola@mail.example</href>')).organizer, 'ola@example.org', 'no preferred mark: the first mailto')
eq(I.calendarUserAddresses(set('<d:href preferred="1">mailto:Ola &lt;x@example.com&gt;</d:href><d:href>mailto:ola@mail.example</d:href>')).organizer, 'ola@mail.example', 'a preferred one the allow-list refuses is passed over')
eq(I.calendarUserAddresses(set('<d:href>urn:uuid:1234</d:href><d:href>/123/principal/</d:href>')).organizer, null, 'no mailto: no organizer (the Send is refused)')
eq(I.calendarUserAddresses('<d:prop><d:displayname>mailto:x@example.com</d:displayname></d:prop>').organizer, null, 'only inside calendar-user-address-set')

console.log('\n== Where the event lives ==')
const CAL = 'https://p67-caldav.icloud.com:443/123456/calendars/lasci-personal/'
eq(I.inviteEventUrl({ personal: { url: CAL } }), 'https://p67-caldav.icloud.com/123456/calendars/lasci-personal/lasci-invite-test.ics', 'the Personal area calendar + the fixed file name')
eq([I.inviteEventUrl({ work: { url: CAL } }), I.inviteEventUrl({}), I.inviteEventUrl(null), I.inviteEventUrl({ personal: { url: 'https://evil.example/cal/' } }),
  I.inviteEventUrl({ personal: { url: 'https://p67-caldav.icloud.com/123/calendars/lasci-personal' } }), I.inviteEventUrl({ personal: { url: 'https://ola:pw@caldav.icloud.com/x/' } }), I.inviteEventUrl({ personal: { url: `${CAL}?a=/` } })],
  [null, null, null, null, null, null, null], 'none: another area\'s calendar, none made, a host that isn\'t iCloud, a path without its closing slash, a user name in the URL, a query')
eq(I.ownEventOfHref('/123456/calendars/lasci-personal/lasci-invite-test.ics'), null, 'the drain\'s read-back does not take it for an item\'s event (ownEventOfHref)')

console.log('\n== The lines written (Send) ==')
const NOW = new Date('2026-11-25T09:15:00Z')
const send = { day: '2026-11-26', now: NOW, organizer: 'ola@example.org', guests: [{ email: 'kari@example.com', partstat: 'NEEDS-ACTION' }, { email: 'per@example.net', partstat: 'NEEDS-ACTION' }], sequence: 0 }
const SEND_EVENT = [
  'BEGIN:VEVENT',
  'UID:lasci-invite-test@lasciviens.github.io',
  'DTSTAMP:20261125T091500Z',
  'DTSTART;TZID=Europe/Oslo:20261126T120000',
  'DTEND;TZID=Europe/Oslo:20261126T123000',
  'SEQUENCE:0',
  'SUMMARY:Invite test',
  "DESCRIPTION:A one-off test invitation from Lasci's Board. Answer it or ignore it. It will be deleted.",
  'TRANSP:OPAQUE',
  'ORGANIZER:mailto:ola@example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=CHAIR;PARTSTAT=ACCEPTED:mailto:ola@example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:kari@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:per@example.net',
  'BEGIN:VALARM', 'ACTION:NONE', 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z', 'END:VALARM',
  'END:VEVENT',
]
const lines = I.inviteLines(send)
eq(lines.slice(0, 4), ['BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Lasci's Board//Invite test//EN", 'CALSCALE:GREGORIAN'], 'the calendar\'s head')
eq(lines.slice(4, 21)[1], 'TZID:Europe/Oslo', 'Europe/Oslo\'s VTIMEZONE (Phase 1\'s, live-checked)')
eq(lines.slice(lines.indexOf('BEGIN:VEVENT'), -1), SEND_EVENT, 'the event: exactly these lines')
eq(lines[lines.length - 1], 'END:VCALENDAR', '…and the end')
const ics = I.inviteObject(send)
eq(ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(ics), true, 'CRLF throughout')
eq(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), true, 'folded at 75 octets')
eq(ics.replace(/\r\n /g, '').split('\r\n').slice(0, -1), lines, 'unfolded, the very lines built')
eq(I.inviteObject({ ...send, guests: [send.guests[0]] }).includes('per@example.net'), false, 'one guest')

console.log('\n== The last guard ==')
const swap = (from, to) => lines.map(l => (l === from ? to : l))
const add = (after, extra) => lines.flatMap(l => (l === after ? [l, extra] : [l]))
eq(throwsGuard(() => I.inviteGuard(lines)), false, 'the builder\'s own lines pass')
const refused = {
  'an X- property': add('TRANSP:OPAQUE', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC'),
  'a URL': add('TRANSP:OPAQUE', 'URL:https://example.com/'),
  'another title': swap('SUMMARY:Invite test', 'SUMMARY:Pay now'),
  'other notes': swap(SEND_EVENT[7], 'DESCRIPTION:Click here'),
  'another UID': swap('UID:lasci-invite-test@lasciviens.github.io', 'UID:lasci-slot-00000000-0000-0000-0000-000000000001@lasciviens.github.io'),
  'a display name on a guest': swap(SEND_EVENT[11], 'ATTENDEE;CN=Kari;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:kari@example.com'),
  'a third guest': add(SEND_EVENT[12], 'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:x@example.com'),
  'a guest twice': swap(SEND_EVENT[12], SEND_EVENT[11]),
  'the organizer as a guest': swap(SEND_EVENT[12], 'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ola@example.org'),
  'a chair that isn\'t the organizer': swap(SEND_EVENT[10], 'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=CHAIR;PARTSTAT=ACCEPTED:mailto:x@example.com'),
  'two organizers': add(SEND_EVENT[9], 'ORGANIZER:mailto:x@example.com'),
  'guests without an organizer': lines.filter(l => l !== SEND_EVENT[9] && l !== SEND_EVENT[10]),
  'an organizer without guests': lines.filter(l => l !== SEND_EVENT[11] && l !== SEND_EVENT[12]),
  'another time': swap(SEND_EVENT[3], 'DTSTART;TZID=Europe/Oslo:20261126T130000'),
  'another zone': swap(SEND_EVENT[3], 'DTSTART;TZID=America/New_York:20261126T120000'),
  'an end on another day': swap(SEND_EVENT[4], 'DTEND;TZID=Europe/Oslo:20261127T123000'),
  'two starts': add(SEND_EVENT[3], 'DTSTART;TZID=Europe/Oslo:20261127T120000'),
  'two sequences': add('SEQUENCE:0', 'SEQUENCE:1'),
  'a sequence that is no number': swap('SEQUENCE:0', 'SEQUENCE:-1'),
  'an RRULE': add(SEND_EVENT[4], 'RRULE:FREQ=DAILY'),
  'a second event': add('END:VEVENT', 'BEGIN:VEVENT'),
  'an alert that rings': swap('ACTION:NONE', 'ACTION:EMAIL'),
  'an address over 254 characters': swap(SEND_EVENT[12], `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:a@${'b'.repeat(250)}.no`),
  'a line with a control character': swap(SEND_EVENT[12], `${SEND_EVENT[12]}\u0000`),
}
for (const [what, l] of Object.entries(refused)) eq(throwsGuard(() => I.inviteGuard(l)), true, `refused: ${what}`)
eq(throwsGuard(() => I.inviteObject({ ...send, guests: [{ email: 'kari@example.com\r\nATTENDEE:mailto:x@example.com', partstat: 'NEEDS-ACTION' }] })), true,
  'an address that slipped past the allow-list is refused at the last line (a second line)')
eq(throwsGuard(() => I.inviteObject({ ...send, organizer: 'Ola <ola@example.org>' })), true, '…an organizer with a display name')
eq(throwsGuard(() => I.inviteObject({ ...send, guests: [{ email: 'kari@example.com', partstat: 'DELEGATED' }] })), true, '…an answer the app doesn\'t write')
eq(throwsGuard(() => I.inviteObject({ ...send, day: '2026-11-26T12:00' })), true, '…a day that isn\'t yyyy-MM-dd')
eq(throwsGuard(() => I.inviteObject({ ...send, sequence: 1234567 })), true, '…a sequence past 6 digits')

console.log('\n== Reading the event back (Check) ==')
// The organizer's copy as iCloud keeps it after the guests answered: names and EMAIL added by iCloud, SCHEDULE-STATUS,
// a folded line, its own X- lines and alarm — read through the allow-lists only.
const fold = l => l.match(/.{1,74}/g).join('\r\n ')
const ICLOUD = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iCloud//EN', 'BEGIN:VTIMEZONE', 'TZID:Europe/Oslo', 'END:VTIMEZONE', 'BEGIN:VEVENT',
  'UID:lasci-invite-test@lasciviens.github.io', 'DTSTAMP:20261125T101500Z', 'DTSTART;TZID=Europe/Oslo:20261126T120000', 'DTEND;TZID=Europe/Oslo:20261126T123000',
  'SEQUENCE:0', 'SUMMARY:Invite test', 'ORGANIZER;CN="Ola Nordmann";EMAIL=ola@example.org:mailto:ola@example.org',
  fold('ATTENDEE;CN="Ola Nordmann";CUTYPE=INDIVIDUAL;EMAIL=ola@example.org;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:ola@example.org'),
  fold('ATTENDEE;CN="Kari; Nordmann";CUTYPE=INDIVIDUAL;EMAIL=kari@example.com;PARTSTAT=TENTATIVE;ROLE=REQ-PARTICIPANT;SCHEDULE-STATUS=2.0:mailto:kari@example.com'),
  'ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;SCHEDULE-STATUS=1.2:mailto:Per@Example.net', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
  'BEGIN:VALARM', 'ACTION:NONE', 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z', 'ATTENDEE:mailto:alarm@example.com', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
const read = I.inviteEventOf(ICLOUD)
eq(read, {
  ours: true, day: '2026-11-26', sequence: 0, organizer: 'ola@example.org',
  guests: [{ email: 'kari@example.com', partstat: 'TENTATIVE', scheduleStatus: '2.0' }, { email: 'per@example.net', partstat: 'ACCEPTED', scheduleStatus: '1.2' }],
}, 'each guest\'s answer and delivery code; the organizer\'s own line and the alarm\'s are no guests; a quoted ; in a name is no parameter')
const odd = I.inviteEventOf(ICLOUD.replace('SEQUENCE:0', 'SEQUENCE:x').replace('SCHEDULE-STATUS=2.0', 'SCHEDULE-STATUS="<b>hi</b>"')
  .replace('PARTSTAT=ACCEPTED;SCHEDULE', 'PARTSTAT=DELEGATED;SCHEDULE').replace('mailto:Per@Example.net', 'mailto:Per <per@example.net>')
  .replace('DTSTART;TZID=Europe/Oslo:20261126T120000', 'DTSTART;TZID=Europe/Oslo:20261126T140000'))
eq([odd.sequence, odd.day, odd.guests[0].scheduleStatus, odd.guests[1]], ['bad', null, null, { email: null, partstat: 'OTHER', scheduleStatus: '1.2' }],
  'what the app doesn\'t take reads as such: a bad sequence, a moved time, an odd code, an unknown answer, an address off the list')
eq(I.inviteEventOf(ICLOUD.replace('END:VEVENT', 'END:VEVENT\r\nBEGIN:VEVENT\r\nEND:VEVENT')), null, 'two events: not read')
eq(I.inviteEventOf(ICLOUD.replace('UID:lasci-invite-test@', 'UID:other@')).ours, false, 'another UID: not the test event')
eq([I.scheduleTagOf('"1234-5"'), I.scheduleTagOf('abc'), I.scheduleTagOf('"a b"'), I.scheduleTagOf(null)], ['"1234-5"', 'abc', null, null], 'a Schedule-Tag shown only when it is one plain value')

console.log('\n== Rewrite and Remove guest: carried over exactly ==')
const plan = I.inviteRewriteOf(read, 'ola@example.org', NOW)
eq(plan.guests, [{ email: 'kari@example.com', partstat: 'TENTATIVE' }, { email: 'per@example.net', partstat: 'ACCEPTED' }], 'each guest\'s PARTSTAT as read')
eq([plan.sequence, plan.day], [0, '2026-11-26'], 'the SEQUENCE and the day as read')
const again = I.inviteLines(plan)
eq(again.filter(l => /^(ORGANIZER|ATTENDEE|SEQUENCE|DTSTART;|DTEND;)/.test(l)), [
  'DTSTART;TZID=Europe/Oslo:20261126T120000', 'DTEND;TZID=Europe/Oslo:20261126T123000', 'SEQUENCE:0', 'ORGANIZER:mailto:ola@example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=CHAIR;PARTSTAT=ACCEPTED:mailto:ola@example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE:mailto:kari@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:per@example.net',
], 'the Rewrite\'s lines')
eq(throwsGuard(() => I.inviteObject(plan)), false, '…pass the guard')
const sent = I.inviteEventOf(I.inviteObject(send))
eq(I.inviteLines(I.inviteRewriteOf(sent, 'ola@example.org', NOW)), I.inviteLines(send), 'a Rewrite of an unanswered Send writes the very same lines')
const removed = I.inviteRewriteOf(read, 'ola@example.org', NOW, 'kari@example.com')
eq(removed.guests, [{ email: 'per@example.net', partstat: 'ACCEPTED' }], 'Remove guest: that guest goes, the other keeps its answer')
const last = I.inviteRewriteOf(I.inviteEventOf(I.inviteObject({ ...send, guests: [send.guests[0]] })), 'ola@example.org', NOW, 'kari@example.com')
const plain = I.inviteLines(last)
eq([last.guests.length, plain.some(l => /^(ORGANIZER|ATTENDEE)/.test(l)), throwsGuard(() => I.inviteObject(last))], [0, false, false], 'the last guest removed: a plain event, no ORGANIZER or ATTENDEE')
const refusedPlan = p => 'error' in p
eq([
  refusedPlan(I.inviteRewriteOf({ ...read, ours: false }, 'ola@example.org', NOW)),
  refusedPlan(I.inviteRewriteOf({ ...read, day: null }, 'ola@example.org', NOW)),
  refusedPlan(I.inviteRewriteOf({ ...read, sequence: 'bad' }, 'ola@example.org', NOW)),
  refusedPlan(I.inviteRewriteOf(read, 'ola@mail.example', NOW)),
  refusedPlan(I.inviteRewriteOf(odd, 'ola@example.org', NOW)),
  refusedPlan(I.inviteRewriteOf({ ...read, guests: [...read.guests, { email: 'x@example.com', partstat: 'ACCEPTED', scheduleStatus: null }] }, 'ola@example.org', NOW)),
  refusedPlan(I.inviteRewriteOf(read, 'ola@example.org', NOW, 'nobody@example.com')),
], [true, true, true, true, true, true, true], 'refused: not the test event, moved, a bad sequence, another organizer, a guest or answer the app doesn\'t take, three guests, removing someone who isn\'t a guest')

console.log('\n== The function (static) ==')
const serve = src.slice(src.indexOf('Deno.serve('))
const cronBranch = serve.slice(0, serve.indexOf("const authHeader = req.headers.get('authorization')"))
const appUserAt = serve.indexOf('if (!(await isAppUser(user.id))) return answer')
const inviteAt = serve.indexOf('if (isInviteAction(action))')
eq(appUserAt > 0 && inviteAt > appUserAt && serve.indexOf('auth.getUser(') < appUserAt, true, 'the invite actions run only after getUser and isAppUser')
eq(/invite/i.test(cronBranch), false, '…never from the timer\'s branch')
eq(serve.includes('await inviteTest(db, creds, user.id, row.area_calendars, action, body)'), true, 'the calendar comes from the server-only area calendars (icloud_credentials, service role)')
const inviteFn = src.slice(src.indexOf('async function inviteTest('), src.indexOf('function corsHeaders('))
const helpers = src.slice(src.indexOf('// ── The invite test\'s requests'), src.indexOf('function corsHeaders('))
eq([...helpers.matchAll(/body\.(\w+)/g)].map(m => m[1]).sort(), ['guest', 'guests'], 'the browser names only guests — never an organizer, UID, place or calendar')
eq((helpers.match(/inviteEventUrl\(/g) || []).length === 1 && inviteFn.includes('inviteEventUrl(areaCals)'), true, 'one place is built, from the area calendars')
eq(/console\.(log|error|warn|info)\([^)]*(guest|organizer|email|own|ics|body)/i.test(helpers), false, 'nothing logged with an address or the event (the error\'s kind only)')
eq(/\.text\b/.test(helpers.replace(/now\.ics|r\.text, etag/g, '')), false, 'iCloud\'s answer body never goes into an error')
eq(/'If-None-Match': '\*'/.test(helpers) && /'If-Match': match\.etag/.test(helpers), true, 'a Send only where none is; a Rewrite only over the version just read')
const reserveAt = (fnName) => { const t = helpers.slice(helpers.indexOf(fnName)); return t.indexOf('await reserveInvite(') < t.indexOf('await putInvite(') }
eq([reserveAt("if (action === 'inviteSend')"), reserveAt('async function rewriteInvite(')], [true, true], 'the cap is reserved before every PUT')
eq(/function eventNow[\s\S]*?\/\^\(ATTENDEE\|ORGANIZER\)\[;:\]\/im\.test\(r\.text\)/.test(src), true, 'the drain\'s INVITED guard is still there (never rewrites or removes an event with invitees)')

console.log('\n== No path from the assistant or ✨ ==')
const claudeParts = fs.readdirSync(path.join(root, 'supabase/claude-src')).map(f => fs.readFileSync(path.join(root, 'supabase/claude-src', f), 'utf8')).join('\n')
const claudeFn = fs.readFileSync(path.join(root, 'supabase/functions/claude/index.ts'), 'utf8')
eq([claudeParts, claudeFn].some(t => /icloud-calendar|invite(Send|Rewrite|RemoveGuest|Delete|Check)|icloud_invite_test/.test(t)), false, 'the claude function (Ask AI, ✨) never calls the invite test or its table')
const srcFiles = []
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(p) } }
walk(path.join(root, 'src'))
const callers = srcFiles.filter(f => /'invite(Send|Rewrite|RemoveGuest|Delete|Check)'/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(root, f))
eq(callers, ['src/features/calendar/icloud/inviteTestApi.ts'], 'in the app only the invite test api calls them (through the card\'s hooks)')
eq([...srcFiles].some(f => /features\/ai\//.test(f) && /inviteTest|InviteTest/.test(fs.readFileSync(f, 'utf8'))), false, 'no AI feature names the invite test')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
