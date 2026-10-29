import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

// iCloud Calendar over CalDAV — Phase 1, the "Apple check" (owner, 29.10.2026:
// "I have to be sure that iCloud Calendar would work as good as Google
// Calendar"). Connect with an app-specific password, write one test event per
// feature into a "Lasci · Test" calendar, read back what iCloud kept, show
// what changed since (the iPhone → app direction), remove the test calendar.
// Everything about iCloud: docs/integrations/icloud-caldav.md.
//
// Browser caller: getUser + this function's own isAppUser. The password lives
// only in icloud_credentials (171, service role); it is sent only to iCloud's
// own hosts and never logged or returned.

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']
const APP_URL = 'https://lasciviens.github.io/Project_Daily/#/daily'
const ICLOUD_ROOT = 'https://caldav.icloud.com/'
const TEST_NAME = 'Lasci · Test'
const TEST_SLUG = 'lasci-test/'
// The read test's limits: a few requests to Apple, and an answer a phone can show.
const MAX_READ_CALENDARS = 20
const MAX_READ_PER_DAY = 40

// <icloud-pure>
// Pure: no network, no Deno — scripts/verify-icloud-caldav.cjs runs this block.

/** Credentials go only to iCloud's CalDAV hosts, over HTTPS: caldav.icloud.com and the account's pNN-caldav partition. */
export function isICloudUrl(u: string): boolean {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' && !x.username && !x.password
      && (x.hostname === 'caldav.icloud.com' || /^p\d+-caldav\.icloud\.com$/.test(x.hostname))
  } catch {
    return false
  }
}

/** "Lasci · Test", "lasci test", "Lasci-Test": the owner may type the test calendar's name on the iPhone. */
export function isTestCalendarName(name: string | null | undefined): boolean {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'lascitest'
}

/** Apple's app-specific passwords are four groups of four letters (abcd-efgh-ijkl-mnop). */
export function isAppSpecificPassword(p: string): boolean {
  return /^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(p.trim().toLowerCase())
}

/** "o…@example.com": enough to recognise the account, not to read it. */
export function maskAppleId(email: string): string {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 1)}…@${domain}` : '…'
}

/** Text going into an XML body (a sync token, an href iCloud gave). */
export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** XML text as written: a CDATA section is literal, the rest has its entities decoded (&amp; last). */
const unescapeXml = (s: string) => s.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map(part => (part.startsWith('<![CDATA[')
  ? part.slice(9, -3)
  : part.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#13;|&#xD;/gi, '\r').replace(/&#10;|&#xA;/gi, '\n').replace(/&amp;/g, '&'))).join('')

const P = '(?:[A-Za-z][\\w-]*:)?'
/** The inner text of the first <name> element (any namespace prefix); '' for <name/>; null when absent. */
export function xmlText(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${P}${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${P}${name}>)`))
  return m ? unescapeXml((m[1] ?? '').trim()) : null
}

export interface DavResponse { href: string; status: number | null; props: string }

/** A 207 multistatus: each response's href, its own status (a deleted item in a sync report) and its 200 props. */
export function parseMultistatus(xml: string): { responses: DavResponse[]; syncToken: string | null } {
  const responses: DavResponse[] = []
  const re = new RegExp(`<${P}response\\b[^>]*>([\\s\\S]*?)</${P}response>`, 'g')
  for (const m of xml.matchAll(re)) {
    const block = m[1]
    const ok: string[] = []
    for (const ps of block.matchAll(new RegExp(`<${P}propstat\\b[^>]*>([\\s\\S]*?)</${P}propstat>`, 'g'))) {
      if (/\b200\b/.test(xmlText(ps[1], 'status') ?? '')) ok.push(ps[1])
    }
    const outside = block.replace(new RegExp(`<${P}propstat\\b[^>]*>[\\s\\S]*?</${P}propstat>`, 'g'), '')
    const status = xmlText(outside, 'status')
    responses.push({ href: xmlText(block, 'href') ?? '', status: status ? Number(status.match(/\b(\d{3})\b/)?.[1] ?? NaN) || null : null, props: ok.join('\n') })
  }
  const rest = xml.replace(re, '')
  return { responses, syncToken: xmlText(rest, 'sync-token') }
}

/** iCalendar TEXT escaping (RFC 5545 §3.3.11). */
export function icsEscape(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds a content line at 75 octets, never inside a UTF-8 character (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

const VTIMEZONE_OSLO = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Oslo',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
]

const compact = (day: string) => day.replace(/-/g, '')
const nextDay = (day: string) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** What the read-back looks for. */
export type Kept = 'alarm' | 'description' | 'url' | 'location' | 'pin' | 'travel' | 'tentative' | 'private' | 'free' | 'allDay' | 'rrule' | 'exdate' | 'summary'

export interface CheckEvent { key: string; label: string; uid: string; ics: string; expect: Kept[] }

/** One VEVENT in its own VCALENDAR, CRLF lines, folded. */
function calendarObject(lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Lasci's Board//Apple check//EN", 'CALSCALE:GREGORIAN', ...VTIMEZONE_OSLO, ...lines, 'END:VCALENDAR']
    .map(foldLine).join('\r\n') + '\r\n'
}

/** The Apple check's events, on `day` (yyyy-MM-dd, Oslo): one per feature. */
export function checkEvents(day: string, now: Date, appUrl: string): CheckEvent[] {
  const d = compact(day)
  const at = (hhmm: string) => `${d}T${hhmm.replace(':', '')}00`
  const timed = (start: string, end: string) => [`DTSTART;TZID=Europe/Oslo:${at(start)}`, `DTEND;TZID=Europe/Oslo:${at(end)}`]
  const make = (key: string, label: string, body: string[], expect: Kept[]): CheckEvent => {
    const uid = `lasci-check-${key}@lasciviens.github.io`
    return {
      key, label, uid, expect: ['summary', ...expect],
      ics: calendarObject(['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `SUMMARY:${icsEscape(`Lasci check · ${label}`)}`, ...body, 'END:VEVENT']),
    }
  }
  return [
    make('alarm', 'Alert 10 min before', [...timed('10:00', '10:30'),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('Lasci check · Alert')}`, 'TRIGGER:-PT10M', 'END:VALARM'], ['alarm']),
    make('notes', 'Notes and a link', [...timed('10:45', '11:15'),
      `DESCRIPTION:${icsEscape('Line one: plain text notes.\nLine two: the link below opens the app.\nLine three — æøå 🏋️')}`, `URL;VALUE=URI:${appUrl}`], ['description', 'url']),
    make('place', 'Map pin: Oslo S', [...timed('12:00', '12:30'),
      `LOCATION:${icsEscape('Oslo S\nJernbanetorget, Oslo, Norway')}`,
      'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Jernbanetorget, Oslo, Norway";X-APPLE-RADIUS=70;X-TITLE="Oslo S":geo:59.910357,10.752245',
      'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC'], ['location', 'pin', 'travel']),
    make('maybe', 'Maybe', [...timed('13:00', '13:30'), 'STATUS:TENTATIVE'], ['tentative']),
    make('private', 'Private', [...timed('14:00', '14:30'), 'CLASS:PRIVATE'], ['private']),
    make('free', 'Free (does not block time)', [...timed('15:00', '15:30'), 'TRANSP:TRANSPARENT'], ['free']),
    make('allday', 'All day', [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${compact(nextDay(day))}`, 'TRANSP:TRANSPARENT'], ['allDay', 'free']),
    make('repeat', 'Every day ×4, the 2nd day left out', [...timed('18:00', '18:30'),
      'RRULE:FREQ=DAILY;COUNT=4', `EXDATE;TZID=Europe/Oslo:${compact(nextDay(day))}T180000`], ['rrule', 'exdate']),
    make('emoji', 'Emoji 🏋️ and æøå in a title', [...timed('19:00', '19:15')], []),
  ]
}

/** Every VEVENT in a calendar object (a series and its moved days, or the days iCloud expanded):
 *  name → raw lines (params included); an alarm inside one counts as its VALARM. */
export function allEventProps(ics: string): Map<string, string[]>[] {
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const events: Map<string, string[]>[] = []
  let out: Map<string, string[]> | null = null
  let depth = 0
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { out = new Map(); depth = 0; continue }
    if (line === 'END:VEVENT') { if (out) events.push(out); out = null; continue }
    if (!out) continue
    if (/^BEGIN:/.test(line)) { depth++; if (line === 'BEGIN:VALARM') out.set('VALARM', [...(out.get('VALARM') ?? []), line]); continue }
    if (/^END:/.test(line)) { depth--; continue }
    if (depth > 0) continue
    const name = line.match(/^([A-Z0-9-]+)[;:]/)?.[1]
    if (name) out.set(name, [...(out.get(name) ?? []), line])
  }
  return events
}

/** The first VEVENT's properties as iCloud stored them. */
export function eventProps(ics: string): Map<string, string[]> {
  return allEventProps(ics)[0] ?? new Map()
}

/** Which of the check's features iCloud kept on an event. */
export function keptOf(props: Map<string, string[]>): Record<Kept, boolean> {
  const has = (n: string) => (props.get(n)?.length ?? 0) > 0
  const value = (n: string) => props.get(n)?.[0]?.replace(/^[^:]*:/, '') ?? ''
  return {
    summary: has('SUMMARY'),
    alarm: has('VALARM'),
    description: has('DESCRIPTION'),
    url: has('URL'),
    location: has('LOCATION'),
    pin: has('X-APPLE-STRUCTURED-LOCATION'),
    travel: has('X-APPLE-TRAVEL-ADVISORY-BEHAVIOR'),
    tentative: value('STATUS') === 'TENTATIVE',
    private: value('CLASS') === 'PRIVATE',
    free: value('TRANSP') === 'TRANSPARENT',
    allDay: /VALUE=DATE[;:]/.test(props.get('DTSTART')?.[0] ?? ''),
    rrule: has('RRULE'),
    exdate: has('EXDATE'),
  }
}

/** A text property's value, unescaped (SUMMARY;LANGUAGE=en:A\, B → "A, B"). */
const textOf = (line: string | undefined) => (line ?? '').replace(/^[^:]*:/, '').replace(/\\n/gi, ' ').replace(/\\([\\;,])/g, '$1')
const dmy = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`

/** A changed event, for "Check changes": its title and when it starts now ("29.10.2026 10:00", or the day for all-day). */
export function changeOf(props: Map<string, string[]>): { title: string; starts: string } {
  const at = startOf(props.get('DTSTART')?.[0])
  return { title: textOf(props.get('SUMMARY')?.[0]), starts: at ? `${dmy(at.day)}${at.time ? ` ${at.time}` : ''}` : '–' }
}

const OSLO = 'Europe/Oslo'
const pad2 = (n: number) => String(n).padStart(2, '0')

function wallClock(t: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}

/** The instant a wall-clock time in an IANA zone names; null for a zone this runtime doesn't know. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date | null {
  try {
    const want = Date.UTC(y, mo - 1, d, h, mi)
    const offsetAt = (t: number) => { const w = wallClock(t, tz); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - t }
    return new Date(want - offsetAt(want - offsetAt(want)))
  } catch {
    return null
  }
}

/** An instant on the Oslo clock: its day (yyyy-MM-dd) and HH:MM. */
export function osloClock(at: Date): { day: string; time: string } {
  const w = wallClock(at.getTime(), OSLO)
  return { day: `${w.y}-${pad2(w.mo)}-${pad2(w.d)}`, time: `${pad2(w.h)}:${pad2(w.mi)}` }
}

/**
 * When an event starts, on the Oslo clock. All-day (VALUE=DATE): its date, no time. UTC (…Z) and a
 * known TZID: converted. Floating, or a zone this runtime doesn't know: as written, with the zone named.
 */
export function startOf(line: string | undefined): { day: string; time: string | null; zone: string | null } | null {
  const m = line?.match(/:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?\s*$/)
  if (!line || !m) return null
  const day = `${m[1]}-${m[2]}-${m[3]}`
  if (!m[4]) return { day, time: null, zone: null }
  const tz = line.match(/;TZID="?([^";:]+)"?/)?.[1] ?? null
  const at = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
    : tz ? zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz)
    : null
  return at ? { ...osloClock(at), zone: null } : { day, time: `${m[4]}:${m[5]}`, zone: tz }
}

/** The read test's days: today and the next 6 on the Oslo clock, and their edges as CalDAV UTC stamps. */
export function readWindow(now: Date): { fromDay: string; toDay: string; start: string; end: string } {
  const plus = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const midnight = (day: string) => zonedToUtc(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), 0, 0, OSLO)!
  const fromDay = osloClock(now).day
  return { fromDay, toDay: plus(fromDay, 6), start: stamp(midnight(fromDay)), end: stamp(midnight(plus(fromDay, 7))) }
}

/** The CalDAV query for the window: events that touch it, repeating ones split into their days (expand). */
export function calendarQuery(start: string, end: string): string {
  return '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
    + `<d:prop><d:getetag/><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>`
    + `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter>`
    + '</c:calendar-query>'
}

export interface ICloudCalendar { href: string; name: string; color: string | null }

/** The component names a calendar takes (VEVENT, VTODO), whichever quotes the XML uses. */
const compsOf = (set: string | null) => [...(set ?? '').matchAll(/name\s*=\s*["']?([A-Za-z]+)/g)].map(m => m[1].toUpperCase())

/** The event calendars in the calendar home (not the inbox, outbox, notifications or a tasks-only list). */
export function calendarsOf(responses: DavResponse[]): ICloudCalendar[] {
  return responses
    .filter(r => /<(?:[\w-]+:)?calendar[\s/>]/.test(xmlText(r.props, 'resourcetype') ?? ''))
    .filter(r => { const comps = compsOf(xmlText(r.props, 'supported-calendar-component-set')); return !comps.length || comps.includes('VEVENT') })
    .map(r => {
      const color = xmlText(r.props, 'calendar-color') ?? ''
      return { href: r.href, name: xmlText(r.props, 'displayname') || 'Untitled', color: /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color) ? color.slice(0, 7) : null }
    })
}

/**
 * What the calendar home listed, by kind only ("collection calendar [VEVENT] ×5") — element names,
 * never a calendar's name or address — so a read that found no calendar can say why.
 */
export function listingKinds(responses: DavResponse[]): string[] {
  const counts = new Map<string, number>()
  for (const r of responses) {
    const types = [...(xmlText(r.props, 'resourcetype') ?? '').matchAll(/<(?:[\w-]+:)?([\w-]+)/g)].map(m => m[1])
    const comps = compsOf(xmlText(r.props, 'supported-calendar-component-set'))
    const kind = `${types.join(' ') || 'no type'}${comps.length ? ` [${comps.join(' ')}]` : ''}`
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, n]) => (n > 1 ? `${kind} ×${n}` : kind))
}

export interface ReadEvent {
  /** yyyy-MM-dd on the Oslo clock */
  day:        string
  /** HH:MM on the Oslo clock; null = all day */
  time:       string | null
  title:      string
  /** A repeating event: a series (RRULE) or one of its days (RECURRENCE-ID). */
  repeats:    boolean
  /** The whole series in one piece (iCloud didn't split it into days); its day is where it began. */
  series:     boolean
  /** Someone else's event you were invited to, or one you invited people to. */
  invitation: boolean
  /** A zone this runtime doesn't know: the time is as written there. */
  zone:       string | null
}

/** One calendar object as rows (cancelled ones left out, as Apple Calendar leaves them out). */
export function readEventsOf(ics: string): ReadEvent[] {
  return allEventProps(ics).flatMap(p => {
    const at = startOf(p.get('DTSTART')?.[0])
    if (!at || textOf(p.get('STATUS')?.[0]) === 'CANCELLED') return []
    const series = (p.get('RRULE')?.length ?? 0) > 0
    return [{
      day: at.day, time: at.time, zone: at.zone, title: textOf(p.get('SUMMARY')?.[0]) || '(no title)',
      repeats: series || (p.get('RECURRENCE-ID')?.length ?? 0) > 0, series,
      invitation: (p.get('ORGANIZER')?.length ?? 0) > 0 || (p.get('ATTENDEE')?.length ?? 0) > 0,
    }]
  })
}

export interface ReadRow extends Omit<ReadEvent, 'day' | 'series'> { calendar: string; color: string | null; since: string | null }

/**
 * The window's events by day, all-day first, then by time. One that began before the window
 * (a trip, a multi-day event) shows on its first day with "since". A series iCloud didn't split
 * goes in `series`: its days aren't known without working out the repeat rule.
 */
export function byDay(calendars: { name: string; color: string | null; events: ReadEvent[] }[], fromDay: string, toDay: string):
  { days: { day: string; events: ReadRow[] }[]; series: ReadRow[] } {
  const days = new Map<string, ReadRow[]>()
  const series: ReadRow[] = []
  for (const cal of calendars) {
    for (const e of cal.events) {
      const row: ReadRow = { calendar: cal.name, color: cal.color, time: e.time, title: e.title, repeats: e.repeats, invitation: e.invitation, zone: e.zone, since: null }
      if (e.series && (e.day < fromDay || e.day > toDay)) { series.push({ ...row, since: e.day }); continue }
      if (e.day > toDay) continue
      const day = e.day < fromDay ? fromDay : e.day
      days.set(day, [...(days.get(day) ?? []), e.day < fromDay ? { ...row, since: e.day } : row])
    }
  }
  const order = (a: ReadRow, b: ReadRow) => (a.time ?? '') < (b.time ?? '') ? -1 : (a.time ?? '') > (b.time ?? '') ? 1 : a.title.localeCompare(b.title)
  return {
    days: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, events]) => ({ day, events: events.sort(order) })),
    series: series.sort((a, b) => a.title.localeCompare(b.title)),
  }
}
// </icloud-pure>

class ICloudError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

interface Creds { email: string; password: string }

function basic(c: Creds): string {
  const bytes = new TextEncoder().encode(`${c.email}:${c.password}`)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `Basic ${btoa(bin)}`
}

/** One CalDAV request to iCloud. Redirects are followed by hand, iCloud hosts only (fetch drops the
 *  Authorization header across hosts, and an unchecked Location could carry it elsewhere). */
async function dav(c: Creds, method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; url: string }> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!isICloudUrl(current)) throw new ICloudError('not_icloud', 'iCloud pointed to a place outside icloud.com — stopped')
    let res: Response
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        headers: {
          Authorization: basic(c),
          ...(body ? { 'Content-Type': method === 'PUT' ? 'text/calendar; charset=utf-8' : 'application/xml; charset=utf-8' } : {}),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ICloudError('unreachable', 'iCloud could not be reached')
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location')
      await res.body?.cancel()
      if (!loc) throw new ICloudError('redirect', `iCloud answered ${res.status} with nowhere to go`)
      current = new URL(loc, current).toString()
      // A 303 means "read it with GET" — never re-send a write there.
      if (res.status === 303) { method = 'GET'; body = undefined }
      continue
    }
    if (res.status === 401) { await res.body?.cancel(); throw new ICloudError('auth', 'Apple did not accept the Apple ID or app-specific password') }
    return { status: res.status, text: await res.text(), url: current }
  }
  throw new ICloudError('redirect', 'iCloud redirected too many times')
}

const XML = '<?xml version="1.0" encoding="utf-8"?>'
const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"'

async function propfind(c: Creds, url: string, props: string, depth: '0' | '1') {
  const r = await dav(c, 'PROPFIND', url, `${XML}<d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`, { Depth: depth })
  if (r.status !== 207) throw new ICloudError('propfind', `iCloud answered ${r.status} when asked for the calendars`)
  return { ...parseMultistatus(r.text), url: r.url }
}

/** Connect: the principal, then its calendar home (on the account's own pNN-caldav host). */
async function discover(c: Creds): Promise<{ principal: string; home: string }> {
  const a = await propfind(c, ICLOUD_ROOT, '<d:current-user-principal/>', '0')
  const href = xmlText(a.responses[0]?.props ?? '', 'href')
  if (!href) throw new ICloudError('discovery', 'iCloud did not say where the calendars are')
  const principal = new URL(href, a.url).toString()
  const b = await propfind(c, principal, '<c:calendar-home-set/>', '0')
  const homeHref = xmlText(b.responses[0]?.props ?? '', 'href')
  if (!homeHref) throw new ICloudError('discovery', 'iCloud did not give a calendar home')
  const home = new URL(homeHref, b.url).toString()
  if (!isICloudUrl(principal) || !isICloudUrl(home)) throw new ICloudError('not_icloud', 'iCloud pointed outside icloud.com — stopped')
  return { principal, home: home.endsWith('/') ? home : `${home}/` }
}

interface Step { step: string; ok: boolean; detail: string }

/** The test calendar: made by the app (MKCALENDAR), else one called "Lasci · Test" the owner made. */
async function ensureTestCalendar(c: Creds, home: string, stored: string | null, steps: Step[]): Promise<{ url: string; name: string } | null> {
  if (stored) {
    const r = await dav(c, 'PROPFIND', stored, `${XML}<d:propfind ${NS}><d:prop><d:displayname/></d:prop></d:propfind>`, { Depth: '0' })
    if (r.status === 207) {
      steps.push({ step: 'Test calendar', ok: true, detail: 'found from the last check' })
      return { url: stored, name: xmlText(parseMultistatus(r.text).responses[0]?.props ?? '', 'displayname') ?? TEST_NAME }
    }
  }
  const url = new URL(TEST_SLUG, home).toString()
  const mk = await dav(c, 'MKCALENDAR', url,
    `${XML}<c:mkcalendar ${NS}><d:set><d:prop><d:displayname>${TEST_NAME}</d:displayname><a:calendar-color>#7C3AEDFF</a:calendar-color>`
    + '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>')
  if (mk.status === 201) {
    steps.push({ step: 'Make a calendar', ok: true, detail: `"${TEST_NAME}" made by the app, in purple` })
    return { url, name: TEST_NAME }
  }
  // 405 may mean "already there" — only when it really is our test calendar.
  if (mk.status === 405) {
    const there = await dav(c, 'PROPFIND', url, `${XML}<d:propfind ${NS}><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`, { Depth: '0' })
    const props = there.status === 207 ? parseMultistatus(there.text).responses[0]?.props ?? '' : ''
    if (isTestCalendarName(xmlText(props, 'displayname')) && /calendar/.test(xmlText(props, 'resourcetype') ?? '')) {
      steps.push({ step: 'Make a calendar', ok: true, detail: `"${TEST_NAME}" was already there` })
      return { url, name: TEST_NAME }
    }
  }
  steps.push({ step: 'Make a calendar', ok: false, detail: `iCloud answered ${mk.status} — looking for one called "Lasci Test" instead` })
  const list = await propfind(c, home, '<d:displayname/><d:resourcetype/>', '1')
  const found = list.responses.find(r => isTestCalendarName(xmlText(r.props, 'displayname')) && /calendar/.test(xmlText(r.props, 'resourcetype') ?? ''))
  if (!found) return null
  steps.push({ step: 'Test calendar', ok: true, detail: `found "${xmlText(found.props, 'displayname')}"` })
  return { url: new URL(found.href, list.url).toString(), name: xmlText(found.props, 'displayname') ?? TEST_NAME }
}

/** What iCloud has for these hrefs (calendar-multiget): href → the stored iCalendar. */
async function multiget(c: Creds, calendar: string, hrefs: string[]): Promise<Map<string, string>> {
  if (!hrefs.length) return new Map()
  const r = await dav(c, 'REPORT', calendar,
    `${XML}<c:calendar-multiget ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs.map(h => `<d:href>${escapeXml(h)}</d:href>`).join('')}</c:calendar-multiget>`,
    { Depth: '1' })
  if (r.status !== 207) throw new ICloudError('read', `iCloud answered ${r.status} when the events were read back`)
  const out = new Map<string, string>()
  for (const resp of parseMultistatus(r.text).responses) {
    const data = xmlText(resp.props, 'calendar-data')
    if (data) out.set(new URL(resp.href, r.url).pathname, data)
  }
  return out
}

async function syncToken(c: Creds, calendar: string): Promise<string | null> {
  try {
    const r = await propfind(c, calendar, '<d:sync-token/>', '0')
    return xmlText(r.responses[0]?.props ?? '', 'sync-token')
  } catch (e) {
    if (e instanceof ICloudError && e.code === 'auth') throw e
    return null
  }
}

function osloTomorrow(now: Date): string {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })
  return nextDay(today)
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' }
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return answer({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return answer({ error: 'Missing authorization' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data: { user }, error: authError } = await db.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return answer({ error: 'Invalid token' }, 401)
  if (!(await isAppUser(user.id))) return answer({ error: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return answer({ error: 'Bad request' }, 400) }
  const action = String(body.action ?? '')

  // The password is read only for the actions that call iCloud.
  const needsPassword = action === 'check' || action === 'changes' || action === 'read' || action === 'remove'
  const { data: row, error: readError } = await db.from('icloud_credentials')
    .select(`apple_id, ${needsPassword ? 'app_password, ' : ''}calendar_home_url, test_calendar_url, test_sync_token, last_error, last_check, connected_at`)
    .eq('user_id', user.id).maybeSingle() as {
      data: { apple_id: string; app_password?: string; calendar_home_url: string | null; test_calendar_url: string | null; test_sync_token: string | null; last_error: string | null; last_check: unknown; connected_at: string } | null
      error: { message: string } | null
    }
  // A failed read is not "not connected": the card would offer Connect, and Apple shows a password only once.
  if (readError) {
    console.error(`icloud-calendar ${action}: read`)
    return answer({ error: /icloud_credentials|last_check/.test(readError.message) ? 'Apple Calendar needs migration 171 — it runs with the next deploy' : 'The iCloud connection could not be read — try again' }, 502)
  }
  const status = (r: typeof row) => (r
    ? {
        connected: true, appleId: maskAppleId(r.apple_id), connectedAt: r.connected_at, lastError: r.last_error,
        hasTest: !!r.test_calendar_url, testIsApps: !!r.test_calendar_url?.endsWith(`/${TEST_SLUG}`), lastCheck: r.last_check ?? null,
      }
    : { connected: false })

  try {
    if (action === 'status') return answer(status(row))

    if (action === 'connect') {
      const email = String(body.appleId ?? '').trim()
      const password = String(body.appPassword ?? '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return answer({ error: 'Write the Apple ID email' }, 400)
      if (!isAppSpecificPassword(password)) {
        return answer({ error: 'That is not an app-specific password (four groups of four letters, like abcd-efgh-ijkl-mnop). Never use your Apple ID password here.' }, 400)
      }
      const creds = { email, password }
      const { principal, home } = await discover(creds)
      const { error } = await db.from('icloud_credentials').upsert({
        user_id: user.id, apple_id: email, app_password: password, principal_url: principal, calendar_home_url: home,
        // Another Apple ID's test calendar is not this one's.
        test_calendar_url: null, test_sync_token: null, last_check: null, last_error: null, connected_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      if (error) throw new ICloudError('store', /icloud_credentials/.test(error.message) ? 'Connecting iCloud needs migration 171 — it runs with the next deploy' : 'The connection could not be saved')
      return answer(status({ apple_id: email, calendar_home_url: home, test_calendar_url: null, test_sync_token: null, last_error: null, last_check: null, connected_at: new Date().toISOString() }))
    }

    if (action === 'disconnect') {
      const { error } = await db.from('icloud_credentials').delete().eq('user_id', user.id)
      if (error) throw new ICloudError('store', 'The stored password could not be deleted — try again')
      return answer({ connected: false })
    }

    if (!row || !row.app_password) return answer({ error: 'Connect iCloud first' }, 400)
    const creds = { email: row.apple_id, password: row.app_password }
    const home = row.calendar_home_url ?? (await discover(creds)).home

    if (action === 'check') {
      const steps: Step[] = []
      const cal = await ensureTestCalendar(creds, home, row.test_calendar_url, steps)
      if (!cal) {
        return answer({ steps, needsCalendar: true, message: 'iCloud didn\'t let the app make a calendar. On your iPhone: Calendar → Calendars → Add Calendar → name it "Lasci Test" (in iCloud), then run the check again.' })
      }
      // Saved before any event is written: whatever fails next, Remove can still find them.
      await db.from('icloud_credentials').update({ test_calendar_url: cal.url, test_sync_token: null }).eq('user_id', user.id)
      const events = checkEvents(osloTomorrow(new Date()), new Date(), APP_URL)
      const written: { ev: CheckEvent; href: string; ok: boolean; status: number }[] = []
      for (const ev of events) {
        const href = new URL(`${ev.uid.replace(/[^a-z0-9-]/gi, '-')}.ics`, cal.url).toString()
        const r = await dav(creds, 'PUT', href, ev.ics)
        written.push({ ev, href, ok: r.status === 201 || r.status === 204, status: r.status })
      }
      steps.push({ step: 'Write the test events', ok: written.every(w => w.ok), detail: `${written.filter(w => w.ok).length} of ${written.length} taken by iCloud` })
      let stored = new Map<string, string>()
      try {
        stored = await multiget(creds, cal.url, written.filter(w => w.ok).map(w => new URL(w.href).pathname))
        steps.push({ step: 'Read them back', ok: stored.size === written.filter(w => w.ok).length, detail: `${stored.size} read back` })
      } catch (e) {
        if (e instanceof ICloudError && e.code === 'auth') throw e
        steps.push({ step: 'Read them back', ok: false, detail: e instanceof ICloudError ? e.message : 'iCloud did not answer' })
      }
      const token = await syncToken(creds, cal.url)
      steps.push({ step: 'Changes since (sync token)', ok: !!token, detail: token ? 'iCloud gave a sync token — "Check changes" can follow your edits' : 'iCloud gave no sync token' })
      const result = {
        steps,
        calendar: cal.name,
        day: osloTomorrow(new Date()),
        events: written.map(w => {
          const ics = stored.get(new URL(w.href).pathname)
          const kept = ics ? keptOf(eventProps(ics)) : null
          return { key: w.ev.key, label: w.ev.label, written: w.ok, status: w.status, kept: kept ? Object.fromEntries(w.ev.expect.map(k => [k, kept[k]])) : null }
        }),
      }
      // Kept so the card still shows what to look for after the trip to the Calendar app (no password or URL in it).
      await db.from('icloud_credentials').update({ test_sync_token: token, last_check: result, last_error: null }).eq('user_id', user.id)
      return answer(result)
    }

    if (action === 'changes') {
      if (!row.test_calendar_url || !row.test_sync_token) return answer({ error: 'Run the Apple check first' }, 400)
      const r = await dav(creds, 'REPORT', row.test_calendar_url,
        `${XML}<d:sync-collection ${NS}><d:sync-token>${escapeXml(row.test_sync_token)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
        { Depth: '0' })
      if (r.status !== 207) return answer({ tokenWorked: false, message: `iCloud doesn't report changes this way (it answered ${r.status}) — Phase 2 would read the whole calendar again instead`, changes: [] })
      const parsed = parseMultistatus(r.text)
      const changed = parsed.responses.filter(x => x.status !== 404 && x.href.endsWith('.ics'))
      const removed = parsed.responses.filter(x => x.status === 404)
      const stored = await multiget(creds, row.test_calendar_url, changed.map(x => new URL(x.href, r.url).pathname))
      const changes = [
        ...[...stored.values()].map(ics => ({ kind: 'changed' as const, ...changeOf(eventProps(ics)) })),
        ...removed.map(() => ({ kind: 'removed' as const, title: 'An event', starts: '–' })),
      ]
      await db.from('icloud_credentials').update({ ...(parsed.syncToken ? { test_sync_token: parsed.syncToken } : {}), last_error: null }).eq('user_id', user.id)
      return answer({ tokenWorked: true, changes })
    }

    // Read-only (owner, 29.10.2026: "Build that"): the owner's own calendars, today and the next 6 days,
    // to compare with the iPhone. Nothing is stored or logged — the titles go only to the owner's browser.
    if (action === 'read') {
      const win = readWindow(new Date())
      const list = await propfind(creds, home, '<d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/>', '1')
      const found = calendarsOf(list.responses)
      const calendars: { name: string; color: string | null; events: ReadEvent[]; problem: string | null }[] = []
      for (const cal of found.slice(0, MAX_READ_CALENDARS)) {
        const entry = { name: cal.name, color: cal.color, events: [] as ReadEvent[], problem: null as string | null }
        calendars.push(entry)
        try {
          const r = await dav(creds, 'REPORT', new URL(cal.href, list.url).toString(), calendarQuery(win.start, win.end), { Depth: '1' })
          if (r.status !== 207) { entry.problem = `iCloud answered ${r.status}`; continue }
          entry.events = parseMultistatus(r.text).responses.flatMap(x => { const d = xmlText(x.props, 'calendar-data'); return d ? readEventsOf(d) : [] })
        } catch (e) {
          if (e instanceof ICloudError && e.code === 'auth') throw e
          entry.problem = e instanceof ICloudError ? e.message : 'iCloud did not answer'
        }
      }
      const repeats = calendars.flatMap(c => c.events).filter(e => e.repeats)
      const { days, series } = byDay(calendars, win.fromDay, win.toDay)
      await db.from('icloud_credentials').update({ last_error: null }).eq('user_id', user.id)
      return answer({
        fromDay: win.fromDay, toDay: win.toDay,
        // Did iCloud split repeating events into their days (CalDAV expand)? null: nothing repeats this week.
        expanded: repeats.length ? !repeats.some(e => e.series) : null,
        calendars: calendars.map(c => ({ name: c.name, color: c.color, count: c.events.length, problem: c.problem })),
        skipped: Math.max(0, found.length - MAX_READ_CALENDARS),
        // No calendar found: what iCloud listed instead, by kind only (no names, no addresses).
        listing: found.length ? null : listingKinds(list.responses),
        days: days.map(d => ({ day: d.day, events: d.events.slice(0, MAX_READ_PER_DAY), more: Math.max(0, d.events.length - MAX_READ_PER_DAY) })),
        series,
      })
    }

    if (action === 'remove') {
      if (!row.test_calendar_url) return answer({ removed: null, message: 'No test calendar to remove' })
      // Only the calendar the app made, holding nothing but the check's events, goes whole; otherwise only the check's events go.
      const members = await propfind(creds, row.test_calendar_url, '<d:getetag/>', '1')
      const onlyOurs = members.responses
        .map(m => new URL(m.href, members.url).pathname)
        .filter(p => p !== new URL(row.test_calendar_url!).pathname)
        .every(p => /\/lasci-check-[a-z]+-lasciviens-github-io\.ics$/.test(p))
      let removed: 'calendar' | 'events'
      if (row.test_calendar_url.endsWith(`/${TEST_SLUG}`) && onlyOurs) {
        const r = await dav(creds, 'DELETE', row.test_calendar_url)
        if (r.status >= 300 && r.status !== 404) return answer({ error: `iCloud answered ${r.status} — the test calendar is still there` }, 502)
        removed = 'calendar'
      } else {
        for (const ev of checkEvents(osloTomorrow(new Date()), new Date(), APP_URL)) {
          const r = await dav(creds, 'DELETE', new URL(`${ev.uid.replace(/[^a-z0-9-]/gi, '-')}.ics`, row.test_calendar_url).toString())
          if (r.status >= 300 && r.status !== 404) return answer({ error: `iCloud answered ${r.status} — some test events are still there` }, 502)
        }
        removed = 'events'
      }
      await db.from('icloud_credentials').update({ test_calendar_url: null, test_sync_token: null, last_check: null, last_error: null }).eq('user_id', user.id)
      return answer({ removed })
    }

    return answer({ error: 'Unknown action' }, 400)
  } catch (e) {
    // The message names no password, header or account URL (ICloudError texts only).
    const message = e instanceof ICloudError ? e.message : 'Something went wrong talking to iCloud'
    if (row) await db.from('icloud_credentials').update({ last_error: message }).eq('user_id', user.id)
    console.error(`icloud-calendar ${action}: ${e instanceof ICloudError ? e.code : 'unexpected'}`)
    // Apple refusing the password is not this app's sign-in failing: 400, never 401.
    return answer({ error: message }, e instanceof ICloudError && e.code === 'auth' ? 400 : 502)
  }
})
