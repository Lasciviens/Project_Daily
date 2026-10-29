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

// <icloud-pure>
// Pure: no network, no Deno — scripts/verify-icloud-caldav.cjs runs this block.

/** Credentials go only to iCloud's own hosts, over HTTPS. */
export function isICloudUrl(u: string): boolean {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' && (x.hostname === 'icloud.com' || x.hostname.endsWith('.icloud.com'))
  } catch {
    return false
  }
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

/** The VEVENT's properties as iCloud stored them: name → raw lines (params included). */
export function eventProps(ics: string): Map<string, string[]> {
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const out = new Map<string, string[]>()
  let depth = 0
  let inEvent = false
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; continue }
    if (line === 'END:VEVENT') { inEvent = false; continue }
    if (!inEvent) continue
    if (/^BEGIN:/.test(line)) { depth++; if (line === 'BEGIN:VALARM') out.set('VALARM', [...(out.get('VALARM') ?? []), line]); continue }
    if (/^END:/.test(line)) { depth--; continue }
    if (depth > 0) continue
    const name = line.match(/^([A-Z0-9-]+)[;:]/)?.[1]
    if (name) out.set(name, [...(out.get(name) ?? []), line])
  }
  return out
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

/** A changed event, for "Check changes": its title and when it starts now ("29.10.2026 10:00", or the day for all-day). */
export function changeOf(props: Map<string, string[]>): { title: string; starts: string } {
  const title = (props.get('SUMMARY')?.[0] ?? '').replace(/^[^:]*:/, '').replace(/\\([\\;,])/g, '$1').replace(/\\n/gi, ' ')
  const raw = props.get('DTSTART')?.[0]?.replace(/^[^:]*:/, '') ?? ''
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/)
  const starts = m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}${/Z$/.test(raw) ? ' UTC' : ''}` : '–'
  return { title, starts }
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
async function ensureTestCalendar(c: Creds, home: string, stored: string | null, steps: Step[]): Promise<{ url: string; created: boolean } | null> {
  if (stored) {
    const r = await dav(c, 'PROPFIND', stored, `${XML}<d:propfind ${NS}><d:prop><d:displayname/></d:prop></d:propfind>`, { Depth: '0' })
    if (r.status === 207) { steps.push({ step: 'Test calendar', ok: true, detail: 'found from the last check' }); return { url: stored, created: stored.endsWith(`/${TEST_SLUG}`) } }
  }
  const url = new URL(TEST_SLUG, home).toString()
  const mk = await dav(c, 'MKCALENDAR', url,
    `${XML}<c:mkcalendar ${NS}><d:set><d:prop><d:displayname>${TEST_NAME}</d:displayname><a:calendar-color>#7C3AEDFF</a:calendar-color>`
    + '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>')
  if (mk.status === 201 || mk.status === 405) {
    steps.push({ step: 'Make a calendar', ok: true, detail: mk.status === 201 ? `"${TEST_NAME}" made by the app, in purple` : `"${TEST_NAME}" was already there` })
    return { url, created: true }
  }
  steps.push({ step: 'Make a calendar', ok: false, detail: `iCloud answered ${mk.status} — looking for one called "${TEST_NAME}" instead` })
  const list = await propfind(c, home, '<d:displayname/><d:resourcetype/>', '1')
  const found = list.responses.find(r => xmlText(r.props, 'displayname') === TEST_NAME && /calendar/.test(xmlText(r.props, 'resourcetype') ?? ''))
  if (!found) return null
  steps.push({ step: 'Test calendar', ok: true, detail: `found "${TEST_NAME}"` })
  return { url: new URL(found.href, list.url).toString(), created: false }
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
  const r = await propfind(c, calendar, '<d:sync-token/>', '0')
  return xmlText(r.responses[0]?.props ?? '', 'sync-token')
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

  const { data: row } = await db.from('icloud_credentials')
    .select('apple_id, app_password, calendar_home_url, test_calendar_url, test_sync_token, last_error, connected_at')
    .eq('user_id', user.id).maybeSingle()
  const status = (r: typeof row) => (r
    ? { connected: true, appleId: maskAppleId(r.apple_id), connectedAt: r.connected_at, lastError: r.last_error, hasTest: !!r.test_calendar_url }
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
        last_error: null, connected_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      if (error) throw new ICloudError('store', /icloud_credentials/.test(error.message) ? 'Connecting iCloud needs migration 171 — it runs with the next deploy' : 'The connection could not be saved')
      return answer(status({ apple_id: email, app_password: '', calendar_home_url: home, test_calendar_url: null, test_sync_token: null, last_error: null, connected_at: new Date().toISOString() }))
    }

    if (action === 'disconnect') {
      await db.from('icloud_credentials').delete().eq('user_id', user.id)
      return answer({ connected: false })
    }

    if (!row) return answer({ error: 'Connect iCloud first' }, 400)
    const creds = { email: row.apple_id, password: row.app_password }
    const home = row.calendar_home_url ?? (await discover(creds)).home

    if (action === 'check') {
      const steps: Step[] = []
      const cal = await ensureTestCalendar(creds, home, row.test_calendar_url, steps)
      if (!cal) {
        return answer({ steps, needsCalendar: true, message: `iCloud didn't let the app make a calendar. On your iPhone: Calendar → Calendars → Add Calendar → "${TEST_NAME}" (iCloud), then run the check again.` })
      }
      const events = checkEvents(osloTomorrow(new Date()), new Date(), APP_URL)
      const written: { ev: CheckEvent; href: string; ok: boolean; status: number }[] = []
      for (const ev of events) {
        const href = new URL(`${ev.uid.replace(/[^a-z0-9-]/gi, '-')}.ics`, cal.url).toString()
        const r = await dav(creds, 'PUT', href, ev.ics)
        written.push({ ev, href, ok: r.status === 201 || r.status === 204, status: r.status })
      }
      steps.push({ step: 'Write the test events', ok: written.every(w => w.ok), detail: `${written.filter(w => w.ok).length} of ${written.length} taken by iCloud` })
      const stored = await multiget(creds, cal.url, written.filter(w => w.ok).map(w => new URL(w.href).pathname))
      steps.push({ step: 'Read them back', ok: stored.size === written.filter(w => w.ok).length, detail: `${stored.size} read back` })
      const token = await syncToken(creds, cal.url)
      steps.push({ step: 'Changes since (sync token)', ok: !!token, detail: token ? 'iCloud gave a sync token — "Check changes" can follow your edits' : 'iCloud gave no sync token' })
      await db.from('icloud_credentials').update({ test_calendar_url: cal.url, test_sync_token: token, last_error: null }).eq('user_id', user.id)
      return answer({
        steps,
        calendar: TEST_NAME,
        day: osloTomorrow(new Date()),
        events: written.map(w => {
          const ics = stored.get(new URL(w.href).pathname)
          const kept = ics ? keptOf(eventProps(ics)) : null
          return { key: w.ev.key, label: w.ev.label, written: w.ok, status: w.status, kept: kept ? Object.fromEntries(w.ev.expect.map(k => [k, kept[k]])) : null }
        }),
      })
    }

    if (action === 'changes') {
      if (!row.test_calendar_url || !row.test_sync_token) return answer({ error: 'Run the Apple check first' }, 400)
      const r = await dav(creds, 'REPORT', row.test_calendar_url,
        `${XML}<d:sync-collection ${NS}><d:sync-token>${escapeXml(row.test_sync_token)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
        { Depth: '1' })
      if (r.status !== 207) return answer({ tokenWorked: false, message: `iCloud answered ${r.status} to "what changed since" — the check falls back to reading the calendar again`, changes: [] })
      const parsed = parseMultistatus(r.text)
      const changed = parsed.responses.filter(x => x.status !== 404 && x.href.endsWith('.ics'))
      const removed = parsed.responses.filter(x => x.status === 404)
      const stored = await multiget(creds, row.test_calendar_url, changed.map(x => new URL(x.href, r.url).pathname))
      const changes = [
        ...[...stored.values()].map(ics => ({ kind: 'changed' as const, ...changeOf(eventProps(ics)) })),
        ...removed.map(() => ({ kind: 'removed' as const, title: 'An event', starts: '–' })),
      ]
      if (parsed.syncToken) await db.from('icloud_credentials').update({ test_sync_token: parsed.syncToken }).eq('user_id', user.id)
      return answer({ tokenWorked: true, changes })
    }

    if (action === 'remove') {
      if (!row.test_calendar_url) return answer({ removed: false, message: 'No test calendar to remove' })
      // Only the calendar the app made goes whole; one the owner made keeps everything but the check's events.
      if (row.test_calendar_url.endsWith(`/${TEST_SLUG}`)) {
        const r = await dav(creds, 'DELETE', row.test_calendar_url)
        if (r.status >= 300 && r.status !== 404) return answer({ error: `iCloud answered ${r.status} — the test calendar is still there` }, 502)
      } else {
        for (const ev of checkEvents(osloTomorrow(new Date()), new Date(), APP_URL)) {
          await dav(creds, 'DELETE', new URL(`${ev.uid.replace(/[^a-z0-9-]/gi, '-')}.ics`, row.test_calendar_url).toString())
        }
      }
      await db.from('icloud_credentials').update({ test_calendar_url: null, test_sync_token: null }).eq('user_id', user.id)
      return answer({ removed: true })
    }

    return answer({ error: 'Unknown action' }, 400)
  } catch (e) {
    // The message names no password, header or account URL (ICloudError texts only).
    const message = e instanceof ICloudError ? e.message : 'Something went wrong talking to iCloud'
    if (row) await db.from('icloud_credentials').update({ last_error: message }).eq('user_id', user.id)
    console.error(`icloud-calendar ${action}: ${e instanceof ICloudError ? e.code : 'unexpected'}`)
    return answer({ error: message }, e instanceof ICloudError && e.code === 'auth' ? 401 : 502)
  }
})
