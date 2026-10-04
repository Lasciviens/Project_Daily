// kobo-sync — Send to Kobo, step 1 (docs/kobo/PLAN.md §8.2, roadmap Phase 2).
//
// Serves an OPDS 1.2 (Atom) catalogue that KOReader adds once as a catalogue
// with "Sync catalog" ticked; "Sync all catalogs" then downloads every new
// book uploaded on the Books page. Books sit in the private `kobo-inbox`
// bucket only until the Kobo downloads them (migration 125).
//
// Routes (JWT verification OFF — KOReader sends no Supabase header):
//   GET  /kobo-sync/opds/<token>/                      → the feed (Atom XML)
//   GET  /kobo-sync/opds/<token>/books/<id>/<name>     → 302 to a 5-minute signed
//   HEAD                                                  Storage URL; GET marks
//                                                         the row downloaded
//   POST /kobo-sync/sweep   (x-kobo-token header)      → the daily cleanup (cron)
//
// The Kobo plugin's routes (Phase 4; header x-kobo-secret == KOBO_SYNC_SECRET,
// a separate secret so rotating one never breaks the other):
//   POST /kobo-sync/sync                               → books + page events (§4.1)
//   GET  /kobo-sync/inbox                              → waiting books, 10-minute signed URLs
//   POST /kobo-sync/deliveries/<id>/ack                → the plugin saved the book
//
// Auth: the token in the path (or the cron's header) must equal the Edge
// Function secret KOBO_OPDS_TOKEN (compared in constant time); the caller acts
// as HEVY_USER_ID, the app's one user, via the service role. A path token
// rather than HTTP Basic, because KOReader forwards a Basic header on a
// same-host redirect to Storage (§8.2). Without the secret every route
// answers 503 — safe to deploy first.
//
// Every request sweeps too: files downloaded > 24 h ago or waiting > 7 days
// are deleted through the Storage API (never by deleting storage.objects
// rows, which leaves the file behind) and their rows set to `expired`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'kobo-inbox'

// <kobo-shared>
// GENERATED from src/features/books/ by scripts/sync-kobo-shared.mjs.
// Do not edit here — edit the source and re-run the script.

// ── opdsFeed.ts ──
// The Send to Kobo OPDS feed — pure and import-free, GENERATED into
// supabase/functions/kobo-sync by scripts/sync-kobo-shared.mjs and verified by
// scripts/verify-kobo-feed.cjs. Rules (docs/kobo/PLAN.md §8.2), read from
// KOReader's opdsparser.lua / opdsbrowser.lua:
// - Atom XML only (OPDS 1.2), double-quoted attributes, the five basic entities.
// - Every link absolute (KOReader drops a query string on relative links).
// - The download link is stable (`…/books/<id>/<name>`); the expiring signed
//   Storage URL is only ever the 302 target, never in the feed — KOReader's
//   catalogue sync remembers the first entry's link as "last seen".
// - `type="application/epub+zip"` on every EPUB acquisition link.

type DeliveryStatus = 'queued' | 'downloaded' | 'expired' | 'cancelled'

interface FeedDelivery {
  id: string
  filename: string
  mime: string
  size_bytes: number
  title: string | null
  author: string | null
  status: DeliveryStatus
  created_at: string
  downloaded_at: string | null
}

/** Downloaded files stay 24 h (a failed download can be retried); undelivered ones 7 days. */
const KEEP_AFTER_DOWNLOAD_MS = 24 * 3600 * 1000
const KEEP_UNDELIVERED_MS = 7 * 24 * 3600 * 1000

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** The book's title for the feed: its own, else the file name without extension(s). */
function displayTitle(d: Pick<FeedDelivery, 'title' | 'filename'>): string {
  const t = d.title?.trim()
  if (t) return t
  return d.filename.replace(/\.kepub\.epub$/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim() || d.filename
}

/** A file name safe in a URL path segment and on FAT32 (no / \ : * ? " < > |). */
function safeFileName(name: string): string {
  const cleaned = [...name.normalize('NFC')].map(ch => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('')
    .replace(/_+/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned.slice(-120) || 'book.epub'
}

/**
 * The object name inside the bucket. Supabase Storage refuses keys with
 * brackets or non-ASCII letters ("[Harry Potter _3] … Tutsağı.epub"), so the
 * stored object is always book.<ext>; the real name lives in `filename`.
 */
function storageFileName(name: string): string {
  const n = name.toLowerCase()
  if (n.endsWith('.kepub.epub')) return 'book.kepub.epub'
  if (n.endsWith('.pdf')) return 'book.pdf'
  return 'book.epub'
}

/** A Content-Disposition header that is valid for any name (HTTP headers are Latin-1 only). */
function contentDisposition(name: string): string {
  const ascii = [...name.normalize('NFKD')].map(ch => {
    const c = ch.charCodeAt(0)
    if (c >= 0x300 && c <= 0x36f) return ''
    return c >= 32 && c < 127 && ch !== '"' && ch !== '\\' ? ch : '_'
  }).join('').replace(/_+/g, '_') || 'book'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** The MIME type KOReader needs on the acquisition link. */
function acquisitionType(d: Pick<FeedDelivery, 'filename' | 'mime'>): string {
  if (/\.pdf$/i.test(d.filename)) return 'application/pdf'
  return 'application/epub+zip'
}

/** Rows the feed lists: waiting or downloaded within the keep window, newest first. */
function feedEntries(rows: readonly FeedDelivery[], nowMs: number): FeedDelivery[] {
  return rows
    .filter(r => r.status === 'queued' || (r.status === 'downloaded' && !!r.downloaded_at && nowMs - Date.parse(r.downloaded_at) < KEEP_AFTER_DOWNLOAD_MS))
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Rows whose file must go now: downloaded > 24 h ago, or queued > 7 days. */
function sweepTargets(rows: readonly FeedDelivery[], nowMs: number): FeedDelivery[] {
  return rows.filter(r =>
    (r.status === 'downloaded' && !!r.downloaded_at && nowMs - Date.parse(r.downloaded_at) >= KEEP_AFTER_DOWNLOAD_MS) ||
    (r.status === 'queued' && nowMs - Date.parse(r.created_at) >= KEEP_UNDELIVERED_MS))
}

/** A weak validator that changes whenever the listed entries change. */
function feedEtag(entries: readonly FeedDelivery[]): string {
  let h = 2166136261
  for (const e of entries) {
    for (const ch of `${e.id}|${e.status}|${e.created_at};`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  }
  return `W/"kobo-${entries.length}-${h.toString(16)}"`
}

function bookHref(base: string, token: string, d: Pick<FeedDelivery, 'id' | 'filename'>): string {
  return `${base}/opds/${encodeURIComponent(token)}/books/${d.id}/${encodeURIComponent(safeFileName(d.filename))}`
}

/** The whole Atom feed. `base` is the function's public URL (no trailing slash). */
function buildFeed(base: string, token: string, entries: readonly FeedDelivery[], updatedIso: string): string {
  const self = `${base}/opds/${encodeURIComponent(token)}/`
  const items = entries.map(e => {
    const title = xmlEscape(displayTitle(e))
    const author = e.author?.trim() ? `\n    <author><name>${xmlEscape(e.author.trim())}</name></author>` : ''
    return `  <entry>
    <title>${title}</title>${author}
    <id>urn:uuid:${e.id}</id>
    <updated>${e.created_at}</updated>
    <content type="text">${xmlEscape(`${(e.size_bytes / 1048576).toFixed(1)} MB · sent ${e.created_at.slice(8, 10)}.${e.created_at.slice(5, 7)}.${e.created_at.slice(0, 4)}`)}</content>
    <link rel="http://opds-spec.org/acquisition" href="${xmlEscape(bookHref(base, token, e))}" type="${acquisitionType(e)}"/>
  </entry>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:lascisboard:kobo-inbox</id>
  <title>Send to Kobo</title>
  <updated>${updatedIso}</updated>
  <author><name>Lasci's Board</name></author>
  <link rel="self" href="${xmlEscape(self)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="${xmlEscape(self)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
${items}
</feed>
`
}

type Route =
  | { kind: 'feed'; token: string }
  | { kind: 'book'; token: string; id: string }
  | { kind: 'sweep' }
  | { kind: 'sync' }
  | { kind: 'inbox' }
  | { kind: 'ack'; id: string }

/**
 * Splits the function path into a route: the OPDS feed and its book links
 * (`/opds/<token>/…`, path token), and the plugin's routes `/sync`, `/inbox`,
 * `/deliveries/<id>/ack` (x-kobo-secret header) plus the cron's `/sweep`.
 */
function parseRoute(pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean)
  const last = parts[parts.length - 1]
  if (last === 'sweep') return { kind: 'sweep' }
  if (last === 'sync' && parts[parts.length - 2] === 'kobo-sync') return { kind: 'sync' }
  if (last === 'inbox' && parts[parts.length - 2] === 'kobo-sync') return { kind: 'inbox' }
  if (last === 'ack' && parts[parts.length - 3] === 'deliveries' && parts[parts.length - 2]) return { kind: 'ack', id: parts[parts.length - 2] }
  const i = parts.indexOf('opds')
  if (i < 0 || !parts[i + 1]) return null
  const token = decodeURIComponent(parts[i + 1])
  if (parts[i + 2] === 'books' && parts[i + 3]) return { kind: 'book', token, id: parts[i + 3] }
  if (parts.length === i + 2) return { kind: 'feed', token }
  return null
}

// ── readingSync.ts ──
// The Kobo plugin's sync contract — pure and import-free, GENERATED into
// supabase/functions/kobo-sync by scripts/sync-kobo-shared.mjs and verified by
// scripts/verify-reading-sync.cjs (docs/kobo/PLAN.md §4.1, §4.2).
//
// A request carries the books it mentions (metadata from Nickel's database and
// KOReader's statistics/sidecars) and KOReader's page_stat_data rows grouped by
// book md5, unchanged in shape: [page, start_time (epoch s), duration (s), total_pages].
// Rows may be days old (an outbox drained late) and may repeat (lookback, full
// re-sync): the server stores each at its own time and ignores duplicates.

const MAX_BOOKS = 300
const MAX_EVENTS = 5000
const MD5 = /^[0-9a-f]{32}$/

type DeviceStatus = 'reading' | 'complete' | 'abandoned' | 'new'
type ReadStatus = 'want' | 'reading' | 'finished' | 'paused' | 'dropped'

interface SyncBook {
  md5: string
  title?: string | null
  authors?: string | null
  series?: string | null
  series_index?: string | number | null
  language?: string | null
  isbn?: string | null
  publisher?: string | null
  description?: string | null
  pages?: number | null
  path?: string | null
  content_id?: string | null
  status?: DeviceStatus | string | null   // KOReader sidecar summary.status
  rating?: number | null                  // KOReader 1–5 stars
  percent?: number | null                 // 0–1 (KOReader) or 0–100 (Nickel)
  last_open?: number | null               // epoch seconds
  read_time?: number | null               // seconds, KOReader's book.total_read_time
  read_pages?: number | null
}

interface SyncBody {
  v?: number
  device_id: string
  device_time: number
  plugin_version?: string
  final?: boolean          // this request finished a complete drain
  inventory?: boolean      // `books` is the complete list of books on the device
  books?: SyncBook[]
  stats?: Record<string, unknown[]>
}

interface EventRow { page: number; start: number; duration: number; total: number | null }

interface BookRowLike {
  title: string | null
  author: string | null
  series: string | null
  series_index: string | null
  language: string | null
  isbn: string | null
  publisher: string | null
  description: string | null
  page_count: number | null
  file_path: string | null
  kobo_content_id: string | null
  read_status: ReadStatus
  rating: number | null
  started_at: string | null
  finished_at: string | null
  progress_pct: number | null
  last_read_at: string | null
  read_seconds: number | null
  read_pages: number | null
  device_status: string | null
  device_rating: number | null
  on_device: boolean
}

const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}
const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
}

/** Checks the request shape; returns an error message or null. */
function validateSync(body: unknown, nowSec: number): string | null {
  const b = body as SyncBody
  if (!b || typeof b !== 'object') return 'Body must be a JSON object.'
  if (typeof b.device_id !== 'string' || !b.device_id.trim() || b.device_id.length > 100) return 'device_id is required.'
  if (typeof b.device_time !== 'number' || !Number.isFinite(b.device_time)) return 'device_time (epoch seconds) is required.'
  if (b.device_time > nowSec + 7 * 86400) return 'device_time is more than a week in the future — fix the Kobo clock.'
  if (b.books !== undefined && !Array.isArray(b.books)) return 'books must be an array.'
  if ((b.books?.length ?? 0) > MAX_BOOKS) return `At most ${MAX_BOOKS} books per request.`
  for (const book of b.books ?? []) if (!book || typeof book.md5 !== 'string' || !MD5.test(book.md5)) return 'Every book needs a lowercase 32-character md5.'
  if (b.stats !== undefined && (typeof b.stats !== 'object' || Array.isArray(b.stats))) return 'stats must be an object keyed by md5.'
  let n = 0
  for (const [md5, rows] of Object.entries(b.stats ?? {})) {
    if (!MD5.test(md5)) return `stats key ${md5.slice(0, 40)} is not an md5.`
    if (!Array.isArray(rows)) return 'stats values must be arrays.'
    n += rows.length
  }
  if (n > MAX_EVENTS) return `At most ${MAX_EVENTS} page events per request.`
  return null
}

/**
 * One page_stat_data row → an event, or null when it is unusable.
 * start_time must be a real time (after 2000-01-01) and not in the future
 * beyond a day of clock skew; duration 0–86400 s.
 */
function parseEvent(row: unknown, nowSec: number): EventRow | null {
  if (!Array.isArray(row) || row.length < 3) return null
  const page = int(row[0], 0, 1_000_000)
  const start = int(row[1], 946684800, nowSec + 86400)
  const duration = int(row[2], 0, 86400)
  if (page === null || start === null || duration === null) return null
  return { page, start, duration, total: int(row[3], 1, 1_000_000) }
}

/** KOReader's summary.status → our read_status (one way, device → app). */
function mapDeviceStatus(s: unknown): ReadStatus | null {
  if (s === 'reading') return 'reading'
  if (s === 'complete') return 'finished'
  if (s === 'abandoned') return 'dropped'
  return null
}

/** 0–1 (KOReader) or 0–100 (Nickel) → a percentage, 2 decimals. */
function toPercent(v: unknown): number | null {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < 0) return null
  const pct = n <= 1 ? n * 100 : n
  return pct > 100 ? null : Math.round(pct * 100) / 100
}

/** "Rowling, J. K." stays; a list "A & B" stays — only trims and caps. */
function cleanAuthors(v: unknown): string | null {
  const s = str(v, 300)
  return s ? s.replace(/\s*\n\s*/g, ', ') : null
}

/** A title from a file path when nothing better is known: "Author - Title.epub" → "Title". */
function titleFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const name = decodeURIComponent(path.replace(/^file:\/\//, '')).split('/').pop() ?? ''
  const base = name.replace(/\.kepub\.epub$/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').trim()
  return base || null
}

const epochIso = (sec: number | null | undefined): string | null =>
  typeof sec === 'number' && Number.isFinite(sec) && sec > 946684800 ? new Date(sec * 1000).toISOString() : null

/**
 * The row to insert for a book the server has never seen. Status starts from
 * the device: an explicit sidecar status wins, otherwise "reading" once it has
 * been opened with progress, else "want".
 */
function newBookRow(b: SyncBook): Omit<BookRowLike, never> & { title: string } {
  const pct = toPercent(b.percent)
  const mapped = mapDeviceStatus(b.status)
  const status: ReadStatus = mapped ?? (pct && pct > 0 ? 'reading' : 'want')
  const lastOpen = epochIso(b.last_open)
  const rating = int(b.rating, 1, 5)
  return {
    title: str(b.title) ?? titleFromPath(b.path ?? b.content_id) ?? 'Untitled',
    author: cleanAuthors(b.authors),
    series: str(b.series),
    series_index: str(b.series_index, 20),
    language: str(b.language, 20),
    isbn: str(b.isbn, 40),
    publisher: str(b.publisher),
    description: str(b.description, 5000),
    page_count: int(b.pages, 1, 1_000_000),
    file_path: str(b.path, 1000),
    kobo_content_id: str(b.content_id, 1000),
    read_status: status,
    rating: rating ? rating * 2 : null,
    started_at: status === 'reading' || status === 'finished' ? lastOpen : null,
    finished_at: status === 'finished' ? lastOpen : null,
    progress_pct: pct,
    last_read_at: lastOpen,
    read_seconds: int(b.read_time, 0, 1e9),
    read_pages: int(b.read_pages, 0, 1e7),
    device_status: str(b.status, 20),
    device_rating: rating,
    on_device: true,
  }
}

/**
 * The patch for a book the server already holds. Metadata only FILLS empty
 * fields (the owner may have corrected a title in the app). Progress, last
 * read and totals always follow the device. A device status or rating is
 * applied only when it CHANGED on the device since the last sync, so an edit
 * made in the app is not undone on every sync. Returns {} when nothing changes.
 */
function bookPatch(existing: BookRowLike, b: SyncBook): Partial<BookRowLike> {
  const next = newBookRow(b)
  const patch: Partial<BookRowLike> = {}
  const fill = <K extends keyof BookRowLike>(k: K) => {
    if ((existing[k] === null || existing[k] === '') && next[k] !== null) patch[k] = next[k]
  }
  fill('author'); fill('series'); fill('series_index'); fill('language'); fill('isbn')
  fill('publisher'); fill('description'); fill('page_count')
  if ((!existing.title || existing.title === 'Untitled') && next.title !== 'Untitled') patch.title = next.title
  if (next.file_path && next.file_path !== existing.file_path) patch.file_path = next.file_path
  if (next.kobo_content_id && next.kobo_content_id !== existing.kobo_content_id) patch.kobo_content_id = next.kobo_content_id
  if (next.progress_pct !== null && next.progress_pct !== existing.progress_pct) patch.progress_pct = next.progress_pct
  if (next.last_read_at && (!existing.last_read_at || next.last_read_at > existing.last_read_at)) patch.last_read_at = next.last_read_at
  if (next.read_seconds !== null && next.read_seconds !== existing.read_seconds) patch.read_seconds = next.read_seconds
  if (next.read_pages !== null && next.read_pages !== existing.read_pages) patch.read_pages = next.read_pages
  if (!existing.on_device) patch.on_device = true

  const incoming = str(b.status, 20)
  if (incoming && incoming !== existing.device_status) {
    patch.device_status = incoming
    const mapped = mapDeviceStatus(incoming)
    if (mapped && mapped !== existing.read_status) patch.read_status = mapped
  }
  const rating = int(b.rating, 1, 5)
  if (rating && rating !== existing.device_rating) {
    patch.device_rating = rating
    patch.rating = rating * 2
  }
  // Opening a "want" book with progress moves it to reading.
  const status = patch.read_status ?? existing.read_status
  if (status === 'want' && !patch.read_status && next.progress_pct && next.progress_pct > 0) patch.read_status = 'reading'
  const finalStatus = patch.read_status ?? existing.read_status
  if ((finalStatus === 'reading' || finalStatus === 'finished') && !existing.started_at && next.last_read_at) patch.started_at = next.last_read_at
  if (finalStatus === 'finished' && !existing.finished_at && next.last_read_at) patch.finished_at = next.last_read_at
  return patch
}

/** Server-side guard against a device clock far in the past/future when stamping last_seen. */
function lastSeenIso(deviceTime: number, nowSec: number): string {
  const t = Math.abs(deviceTime - nowSec) <= 86400 ? Math.min(deviceTime, nowSec) : nowSec
  return new Date(t * 1000).toISOString()
}

// </kobo-shared>


function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}

function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type Db = any

async function sweep(db: Db, userId: string): Promise<number> {
  const { data, error } = await db.from('book_deliveries')
    .select('id, filename, mime, size_bytes, title, author, status, created_at, downloaded_at, storage_path')
    .eq('user_id', userId).in('status', ['queued', 'downloaded'])
  if (error) throw error
  const due = sweepTargets(data ?? [], Date.now()) as (FeedDelivery & { storage_path: string })[]
  if (!due.length) return 0
  const { error: rmError } = await db.storage.from(BUCKET).remove(due.map(d => d.storage_path))
  if (rmError) throw rmError
  const { error: upError } = await db.from('book_deliveries').update({ status: 'expired' }).in('id', due.map(d => d.id))
  if (upError) throw upError
  return due.length
}

async function touchState(db: Db, userId: string, patch: Record<string, unknown>) {
  await db.from('kobo_feed_state').upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

const BOOK_COLUMNS = 'id, koreader_md5, title, author, series, series_index, language, isbn, publisher, description, page_count, file_path, kobo_content_id, read_status, rating, started_at, finished_at, progress_pct, last_read_at, read_seconds, read_pages, device_status, device_rating, on_device'

// ── The plugin's sync (docs/kobo/PLAN.md §4.1) ──────────────────────────────
async function handleSync(db: Db, userId: string, body: SyncBody) {
  const nowSec = Math.floor(Date.now() / 1000)
  const books = body.books ?? []
  const stats = body.stats ?? {}
  const md5s = [...new Set([...books.map(b => b.md5), ...Object.keys(stats)])]

  const byMd5 = new Map<string, BookRowLike & { id: string; koreader_md5: string }>()
  for (let i = 0; i < md5s.length; i += 200) {
    const { data, error } = await db.from('books').select(BOOK_COLUMNS).eq('user_id', userId).in('koreader_md5', md5s.slice(i, i + 200))
    if (error) throw error
    for (const row of data ?? []) byMd5.set(row.koreader_md5, row)
  }

  let created = 0, updated = 0
  const fresh = books.filter(b => !byMd5.has(b.md5))
  const seen = new Set<string>()
  const inserts = fresh.filter(b => !seen.has(b.md5) && seen.add(b.md5))
    .map(b => ({ ...newBookRow(b), user_id: userId, koreader_md5: b.md5, source: 'koreader' }))
  if (inserts.length) {
    const { data, error } = await db.from('books').insert(inserts).select(BOOK_COLUMNS)
    if (error) throw error
    for (const row of data ?? []) byMd5.set(row.koreader_md5, row)
    created = data?.length ?? 0
  }
  for (const b of books) {
    const existing = byMd5.get(b.md5)
    if (!existing || fresh.includes(b)) continue
    const patch = bookPatch(existing, b)
    if (!Object.keys(patch).length) continue
    const { error } = await db.from('books').update(patch).eq('id', existing.id)
    if (error) throw error
    updated++
  }

  if (body.inventory) {
    const present = new Set(books.map(b => b.md5))
    const { data, error } = await db.from('books').select('id, koreader_md5').eq('user_id', userId).eq('on_device', true).not('koreader_md5', 'is', null)
    if (error) throw error
    const gone = (data ?? []).filter((r: { koreader_md5: string }) => !present.has(r.koreader_md5)).map((r: { id: string }) => r.id)
    for (let i = 0; i < gone.length; i += 200) {
      const { error: e } = await db.from('books').update({ on_device: false }).in('id', gone.slice(i, i + 200))
      if (e) throw e
    }
  }

  const unmatched: string[] = []
  const rows: Record<string, unknown>[] = []
  let rejected = 0
  for (const [md5, list] of Object.entries(stats)) {
    const book = byMd5.get(md5)
    if (!book) { unmatched.push(md5); continue }
    for (const raw of list) {
      const e = parseEvent(raw, nowSec)
      if (!e) { rejected++; continue }
      rows.push({
        user_id: userId, book_id: book.id, page: e.page, started_at: new Date(e.start * 1000).toISOString(),
        duration_seconds: e.duration, total_pages: e.total, source: 'koreader', device_id: body.device_id,
      })
    }
  }
  let newEvents = 0
  for (let i = 0; i < rows.length; i += 1000) {
    const { data, error } = await db.from('reading_page_events')
      .upsert(rows.slice(i, i + 1000), { onConflict: 'user_id,book_id,page,started_at', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    newEvents += data?.length ?? 0
  }

  const result = { new_events: newEvents, events_received: rows.length, events_rejected: rejected, books_created: created, books_updated: updated, unmatched: unmatched.length, at: new Date().toISOString() }
  const nowIso = new Date().toISOString()
  await touchState(db, userId, {
    last_sync_at: nowIso,
    device_id: body.device_id.slice(0, 100),
    plugin_version: typeof body.plugin_version === 'string' ? body.plugin_version.slice(0, 40) : null,
    last_sync_result: result,
    ...(body.final ? { last_seen_at: lastSeenIso(body.device_time, nowSec) } : {}),
  })
  return { ok: true, ...result, unmatched, server_time: nowSec }
}

// ── Inbox for the plugin's automatic download (§8.2 step 2) ─────────────────
async function handleInbox(db: Db, userId: string) {
  await sweep(db, userId)
  const { data, error } = await db.from('book_deliveries')
    .select('id, storage_path, filename, mime, size_bytes, title, author, created_at')
    .eq('user_id', userId).eq('status', 'queued').order('created_at', { ascending: true }).limit(50)
  if (error) throw error
  const items = []
  for (const row of data ?? []) {
    const name = safeFileName(row.filename)
    const { data: signed, error: signError } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, 600, { download: name })
    if (signError || !signed?.signedUrl) continue
    items.push({ id: row.id, filename: name, title: displayTitle(row), author: row.author, size: row.size_bytes, mime: row.mime, url: signed.signedUrl })
  }
  return { items }
}

async function handleAck(db: Db, userId: string, id: string, deviceId: string | null) {
  const now = new Date().toISOString()
  const { data, error } = await db.from('book_deliveries')
    .update({ status: 'downloaded', downloaded_at: now, device_id: deviceId })
    .eq('id', id).eq('user_id', userId).eq('status', 'queued').select('id')
  if (error) throw error
  await touchState(db, userId, { last_download_at: now })
  return { ok: true, updated: data?.length ?? 0 }
}

Deno.serve(async req => {
  const userId = Deno.env.get('HEVY_USER_ID') ?? ''
  const url = new URL(req.url)
  const route = parseRoute(url.pathname)
  if (!route) return text('Not found', 404)

  // The plugin's write routes: their own secret, independent of the feed token.
  if (route.kind === 'sync' || route.kind === 'inbox' || route.kind === 'ack') {
    const deviceSecret = Deno.env.get('KOBO_SYNC_SECRET') ?? ''
    if (!deviceSecret || !userId) return json({ error: 'not_configured', message: 'KOBO_SYNC_SECRET / HEVY_USER_ID are not set.' }, 503)
    if (!sameToken(req.headers.get('x-kobo-secret') ?? '', deviceSecret)) return json({ error: 'forbidden' }, 403)
    const db = admin()
    try {
      if (route.kind === 'inbox') {
        if (req.method !== 'GET') return json({ error: 'method' }, 405)
        return json(await handleInbox(db, userId))
      }
      if (req.method !== 'POST') return json({ error: 'method' }, 405)
      if (route.kind === 'ack') return json(await handleAck(db, userId, route.id, req.headers.get('x-kobo-device')))
      let body: unknown
      try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
      const problem = validateSync(body, Math.floor(Date.now() / 1000))
      if (problem) return json({ error: 'invalid', message: problem }, 400)
      return json(await handleSync(db, userId, body as SyncBody))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
      console.error('kobo-sync', route.kind, msg)
      const missing = /reading_page_events|relation .*books|Could not find the table/i.test(msg)
      return json({ error: missing ? 'not_migrated' : 'server', message: missing ? 'Migration 126 (books) has not been applied.' : 'Something went wrong on the server.' }, 500)
    }
  }

  const secret = Deno.env.get('KOBO_OPDS_TOKEN') ?? ''
  if (!secret || !userId) return text('Send to Kobo is not configured (KOBO_OPDS_TOKEN / HEVY_USER_ID).', 503)
  const db = admin()

  try {
    if (route.kind === 'sweep') {
      if (req.method !== 'POST' || !sameToken(req.headers.get('x-kobo-token') ?? '', secret)) return text('Forbidden', 403)
      const removed = await sweep(db, userId)
      return json({ removed })
    }

    if (!sameToken(route.token, secret)) return text('Forbidden', 403)
    if (req.method !== 'GET' && req.method !== 'HEAD') return text('Method not allowed', 405)
    const base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/kobo-sync`

    if (route.kind === 'feed') {
      await sweep(db, userId)
      const { data, error } = await db.from('book_deliveries')
        .select('id, filename, mime, size_bytes, title, author, status, created_at, downloaded_at')
        .eq('user_id', userId).in('status', ['queued', 'downloaded'])
        .order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      const entries = feedEntries(data ?? [], Date.now())
      const etag = feedEtag(entries)
      await touchState(db, userId, { last_feed_at: new Date().toISOString() })
      const headers = {
        'Content-Type': 'application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8',
        'Cache-Control': 'no-cache',
        ETag: etag,
      }
      if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
      const updated = entries[0]?.created_at ?? new Date().toISOString()
      return new Response(req.method === 'HEAD' ? null : buildFeed(base, route.token, entries, updated), { status: 200, headers })
    }

    // A book: 302 to a short-lived signed URL; the feed link itself stays stable.
    const { data: row, error } = await db.from('book_deliveries')
      .select('id, storage_path, filename, status')
      .eq('id', route.id).eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (!row || (row.status !== 'queued' && row.status !== 'downloaded')) return text('This book is no longer in the Kobo inbox.', 410)
    const name = safeFileName(row.filename)
    const { data: signed, error: signError } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, 300, { download: name })
    if (signError || !signed?.signedUrl) throw signError ?? new Error('No signed URL')
    if (req.method === 'GET') {
      const now = new Date().toISOString()
      if (row.status === 'queued') {
        await db.from('book_deliveries').update({ status: 'downloaded', downloaded_at: now }).eq('id', row.id)
      }
      await touchState(db, userId, { last_download_at: now })
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed.signedUrl,
        'Content-Disposition': contentDisposition(name),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('kobo-sync', e instanceof Error ? e.message : e)
    return text('Something went wrong on the server.', 500)
  }
})
