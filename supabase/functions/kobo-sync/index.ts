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
const COVER_BUCKET = 'book-covers'
const SLEEP_BUCKET = 'kobo-sleep'
const COVER_MAX_BYTES = 400 * 1024
const COVER_BUDGET_BYTES = 20 * 1024 * 1024
const COVER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

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
  | { kind: 'applied' }
  | { kind: 'capture' }
  | { kind: 'ask' }
  | { kind: 'cover'; md5: string }

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
  if (last === 'applied' && parts[parts.length - 2] === 'kobo-sync') return { kind: 'applied' }
  if (last === 'capture' && parts[parts.length - 2] === 'kobo-sync') return { kind: 'capture' }
  if (last === 'ask' && parts[parts.length - 2] === 'kobo-sync') return { kind: 'ask' }
  if (parts[parts.length - 2] === 'cover' && parts[parts.length - 3] === 'kobo-sync' && /^[0-9a-f]{32}$/.test(last ?? '')) return { kind: 'cover', md5: last }
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
const MAX_INVENTORY = 20000
const MD5 = /^[0-9a-f]{32}$/

type DeviceStatus = 'reading' | 'complete' | 'abandoned' | 'new'
type ReadStatus = 'want' | 'reading' | 'finished' | 'paused' | 'dropped'
type BookKind = 'book' | 'news'

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
  /** Set only on library rows (the device listing what is on it); rows sent with page events leave it out. */
  on_device?: boolean
  /** 'news' for a News Downloader issue (the plugin knows its folder); books leave it out. */
  kind?: 'book' | 'news' | string | null
}

interface SyncBody {
  v?: number
  device_id: string
  device_time: number
  plugin_version?: string
  final?: boolean          // this request finished a complete drain
  /** The settings revision the device applied last (kobo_device_config.rev). */
  config_rev?: number
  /** false from a run inside a book: send nothing to apply (statuses, covers, settings) — it waits for the library. */
  apply?: boolean
  /**
   * Every md5 on the device, sent once the library's book rows have all been
   * posted (in earlier requests), and only when the plugin read the whole
   * library. Books the server holds that are missing here are marked off-device.
   */
  inventory_md5s?: string[]
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
  kind: BookKind
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
  if (b.inventory_md5s !== undefined) {
    if (!Array.isArray(b.inventory_md5s) || b.inventory_md5s.length > MAX_INVENTORY) return `inventory_md5s must be an array of at most ${MAX_INVENTORY} md5s.`
    if (!b.inventory_md5s.every(m => typeof m === 'string' && MD5.test(m))) return 'inventory_md5s must hold lowercase 32-character md5s.'
  }
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

/** The plugin sends 0–1 (KOReader's percent_finished; Nickel's 0–100 is divided first) → a percentage, 2 decimals. */
function toPercent(v: unknown): number | null {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return Math.round(n * 10000) / 100
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

const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

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
    // A book first seen through old reading statistics may be long gone from the Kobo.
    on_device: b.on_device === true,
    kind: b.kind === 'news' || isNewsPath(b.path) ? 'news' : 'book',
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
  // PostgREST returns numerics as numbers or strings and timestamps as
  // "…+00:00": compare values, not text, or every sync rewrites every row
  // (and fills the audit log).
  if (next.progress_pct !== null && next.progress_pct !== numOrNull(existing.progress_pct)) patch.progress_pct = next.progress_pct
  if (next.last_read_at && (!existing.last_read_at || Date.parse(next.last_read_at) > Date.parse(existing.last_read_at))) patch.last_read_at = next.last_read_at
  if (next.read_seconds !== null && next.read_seconds !== numOrNull(existing.read_seconds)) patch.read_seconds = next.read_seconds
  if (next.read_pages !== null && next.read_pages !== numOrNull(existing.read_pages)) patch.read_pages = next.read_pages
  if (!existing.on_device && b.on_device === true) patch.on_device = true
  // kind is set once, when the row is made: the owner may move a book out of News in the app.

  const incoming = str(b.status, 20)
  if (incoming && incoming !== existing.device_status) {
    patch.device_status = incoming
    const mapped = mapDeviceStatus(incoming)
    // KOReader's "on hold" holds both Paused and Dropped: a Paused book stays Paused.
    const sameHold = mapped === 'dropped' && existing.read_status === 'paused'
    if (mapped && mapped !== existing.read_status && !sameHold) patch.read_status = mapped
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

/** A file in KOReader's News Downloader folder (its default: <data dir>/news/). */
function isNewsPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && /\/\.adds\/koreader\/news\//i.test(path)
}

// ── App → Kobo: statuses and ratings set in the app ─────────────────────────
// KOReader keeps a book's status in its sidecar (summary.status: reading /
// complete / abandoned; no status = new) and a 1–5 star rating. The server
// lists what the app wants that the device has not reported yet; the plugin
// writes it and confirms, and the server then stores what the device now has
// (device_status / device_rating), so the next sync reads it back unchanged.
// Want-to-read stays in the app. "On hold" (abandoned) holds both Paused and Dropped; a device that reports
// abandoned for a Paused book is already in step.

/** What the device should hold for an app status. Want-to-read is "new" (no status). */
function deviceStatusFor(s: ReadStatus): DeviceStatus {
  if (s === 'reading') return 'reading'
  if (s === 'finished') return 'complete'
  if (s === 'paused' || s === 'dropped') return 'abandoned'
  return 'new'
}

/** The device's status, with "no status" spelled "new". */
function normalDeviceStatus(s: string | null | undefined): DeviceStatus | string {
  return !s || s === 'new' ? 'new' : s
}

/** 1–10 in the app → 1–5 stars on the device (half up). */
function starsFor(rating: number | null | undefined): number | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 1) return null
  return Math.min(5, Math.max(1, Math.round(rating / 2)))
}

interface PushSource {
  koreader_md5: string | null
  file_path: string | null
  on_device: boolean
  kind: BookKind
  read_status: ReadStatus
  rating: number | null
  device_status: string | null
  device_rating: number | null
}

interface StatusPush { md5: string; path: string; status?: DeviceStatus; rating?: number }

/** What the Kobo should change for one book, or null when it is already in step. */
function pushFor(b: PushSource): StatusPush | null {
  if (!b.on_device || b.kind === 'news' || !b.koreader_md5 || !b.file_path) return null
  const out: StatusPush = { md5: b.koreader_md5, path: b.file_path }
  // Want-to-read is never pushed: KOReader has no such status, and clearing a
  // status on the device would only make it report Nickel's again.
  const want = deviceStatusFor(b.read_status)
  if (b.read_status !== 'want' && normalDeviceStatus(b.device_status) !== want) out.status = want
  const stars = starsFor(b.rating)
  if (stars !== null && stars !== b.device_rating) out.rating = stars
  return out.status || out.rating ? out : null
}

/** The device confirmed it wrote these: the row stores them as the device's own values. */
function appliedPatch(push: { status?: string; rating?: number }): { device_status?: string; device_rating?: number } {
  const patch: { device_status?: string; device_rating?: number } = {}
  if (typeof push.status === 'string' && ['reading', 'complete', 'abandoned', 'new'].includes(push.status)) patch.device_status = push.status
  const r = int(push.rating, 1, 5)
  if (r !== null) patch.device_rating = r
  return patch
}

// ── koboSettingsCatalogue.ts ──
// GENERATED by scripts/kobo/gen-settings-catalogue.mjs from docs/kobo/koreader-settings.json —
// do not edit by hand. 457 settings in 23 groups, each read from KOReader
// v2026.07.1's source (`source` = file:line). Also GENERATED into supabase/functions/kobo-sync
// with koboSettings.ts. `absent` is what KOReader does when the key is not set at all.

interface SettingOption { value: string | number | boolean; label: string }

interface SettingDef {
  key: string
  label: string
  /** Where KOReader shows it, for "find it on the Kobo". */
  path: string
  type: 'bool' | 'enum' | 'int' | 'number' | 'string'
  absent: boolean | number | string | null
  options?: SettingOption[]
  min?: number
  max?: number
  step?: number
  unit?: string
  maxLength?: number
  /** When the Kobo starts using a new value. */
  effect: 'immediate' | 'next_sleep' | 'next_book' | 'restart'
  help?: string
  /** Set by the plugin itself (e.g. the sleep image folder), never from the app directly. */
  managed?: boolean
  source: string
}

interface SettingGroup { id: string; label: string; settings: SettingDef[] }

const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "sleep_screen", label: "Sleep screen",
    settings: [
      {"key":"screensaver_type","label":"What the sleep screen shows","path":"Settings → Screen → Sleep screen → Wallpaper","type":"enum","absent":"disable","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:51","options":[{"value":"cover","label":"Cover of the book you are reading"},{"value":"bookshelf","label":"Bookshelf (recent books as spines)"},{"value":"random_image","label":"My images (from the app)"},{"value":"document_cover","label":"One image I pick"},{"value":"readingprogress","label":"Reading progress"},{"value":"bookstatus","label":"Book status"},{"value":"disable","label":"Leave the screen as it is"}],"help":"The book cover needs a book opened in KOReader at least once; until then KOReader falls back to an image."},
      {"key":"screensaver_exclude_on_hold_books","label":"Ignore book cover → For books on hold","path":"Settings → Screen → Sleep screen → Wallpaper → Ignore book cover","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:74"},
      {"key":"screensaver_exclude_finished_books","label":"Ignore book cover → For finished books","path":"Settings → Screen → Sleep screen → Wallpaper → Ignore book cover","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:84"},
      {"key":"screensaver_hide_cover_in_filemanager","label":"Ignore book cover → When in file browser","path":"Settings → Screen → Sleep screen → Wallpaper → Ignore book cover","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:94"},
      {"key":"screensaver_img_background","label":"Border fill","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit","type":"enum","absent":"black","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:110","options":[{"value":"black","label":"Black fill"},{"value":"white","label":"White fill"},{"value":"none","label":"No fill"}],"help":"Default written at screensaver.lua:36-38."},
      {"key":"screensaver_stretch_images","label":"Stretch cover to fit screen","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:51","help":"Set via a spin dialog (screensaver.lua:257-283): 'Disable stretch' = false; 'Full stretch' = true and deletes screensaver_stretch_limit_percentage; 'Set' = true + a limit."},
      {"key":"screensaver_stretch_limit_percentage","label":"Stretch limit","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit → Stretch to fit screen","type":"int","absent":"unlimited (full stretch)","effect":"next_sleep","source":"frontend/ui/screensaver.lua:259","min":0,"max":25,"step":1,"unit":"%","help":"Only used when screensaver_stretch_images is true; delete the key for full stretch."},
      {"key":"screensaver_rotate_auto_for_best_fit","label":"Rotate cover for best fit","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:132"},
      {"key":"screensaver_delay","label":"Postpone screen update after wake-up","path":"Settings → Screen → Sleep screen → Wallpaper → Postpone screen update after wake-up","type":"enum","absent":"disable","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:143","options":[{"value":"disable","label":"Never"},{"value":"1","label":"1 second"},{"value":"3","label":"3 seconds"},{"value":"5","label":"5 seconds"},{"value":"tap","label":"Until a tap"},{"value":"gesture","label":"Until 'Exit sleep screen' gesture"}],"help":"Values are STRINGS, not numbers. 'gesture' keeps the sleep screen until the 'Exit sleep screen' gesture (set in Gestures) — if no such gesture is configured the user may think the device is stuck; prefer 'tap'."},
      {"key":"screensaver_show_exit_message","label":"Show 'Exit sleep screen' message","path":"Settings → Screen → Sleep screen → Wallpaper → Postpone screen update after wake-up","type":"bool","absent":true,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:156","help":"Only false is ever stored (flipFalse/hasNot): absent = shown. Write false to hide, delSetting to show. Only matters with screensaver_delay='gesture'."},
      {"key":"screensaver_exit_message","label":"Edit 'Exit sleep screen' message","path":"Settings → Screen → Sleep screen → Wallpaper → Postpone screen update after wake-up","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:216","maxLength":500,"help":"Default: built-in text."},
      {"key":"screensaver_document_cover","label":"Choose image or document cover","path":"Settings → Screen → Sleep screen → Wallpaper → Custom images","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:195","maxLength":500,"help":"Absolute path to an image or a document (its cover is used). Used when screensaver_type='document_cover'.","managed":true},
      {"key":"screensaver_dir","label":"Choose random image folder","path":"Settings → Screen → Sleep screen → Wallpaper → Custom images","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:182","maxLength":500,"help":"Absolute folder path, e.g. /mnt/onboard/.adds/screensavers. Used with 'random_image' (or 'cover' when the cover is excluded).","managed":true},
      {"key":"screensaver_cycle_images_alphabetically","label":"Cycle through images in order","path":"Settings → Screen → Sleep screen → Wallpaper → Custom images","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:201","help":"Natural-sort order, up to screensaver_max_files images. Position kept in screensaver_cycle_index (bookkeeping)."},
      {"key":"screensaver_show_message","label":"Add custom message to sleep screen","path":"Settings → Screen → Sleep screen → Sleep screen message","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:217","help":"First run sets it to true together with screensaver_type='disable' (screensaver.lua:32-35)."},
      {"key":"screensaver_message","label":"Edit sleep screen message","path":"Settings → Screen → Sleep screen → Sleep screen message","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:220","maxLength":500,"help":"Default: Sleeping. Multiline allowed. Supports %-tokens expanded by FileManagerBookInfo.expandString (the 'Info' button: e.g. %T title, %A author, %p percent read…). Empty string → delete the key."},
      {"key":"screensaver_message_container","label":"Container","path":"Settings → Screen → Sleep screen → Sleep screen message → Container and position","type":"enum","absent":"box","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:240","options":[{"value":"banner","label":"Banner"},{"value":"box","label":"Box"}]},
      {"key":"screensaver_message_vertical_position","label":"Vertical position","path":"Settings → Screen → Sleep screen → Sleep screen message → Container and position","type":"number","absent":50,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:290","min":0,"max":100,"step":5,"unit":"% from bottom (100=top, 50=middle, 0=bottom)"},
      {"key":"screensaver_message_alpha","label":"Message opacity","path":"Settings → Screen → Sleep screen → Sleep screen message → Container and position","type":"int","absent":100,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:310","min":0,"max":100,"step":5,"unit":"%"},
      {"key":"screensaver_msg_background","label":"Background fill","path":"Settings → Screen → Sleep screen → Sleep screen message → Background fill","type":"enum","absent":"none","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:283","options":[{"value":"black","label":"Black fill"},{"value":"white","label":"White fill"},{"value":"none","label":"No fill"}],"help":"Only used with screensaver_type='disable' and a message shown."},
      {"key":"screensaver_hide_fallback_msg","label":"Hide reboot/poweroff message","path":"Settings → Screen → Sleep screen → Sleep screen message","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:291","help":"Applies to the reboot / power-off screen, not to suspend."},
      {"key":"screensaver_extra_flash_count","label":"Sleep screen anti-ghosting redraws (count)","path":"Settings → Screen → E-ink settings → Sleep screen anti-ghosting redraws","type":"int","absent":0,"effect":"next_sleep","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:41","min":0,"max":4,"step":1,"help":"Recommended value offered by the dialog: 2 (with 1000 ms). 0 disables."},
      {"key":"screensaver_extra_flash_delay","label":"Sleep screen anti-ghosting redraws (delay)","path":"Settings → Screen → E-ink settings → Sleep screen anti-ghosting redraws","type":"int","absent":1000,"effect":"next_sleep","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:47","min":0,"max":2000,"step":50,"unit":"ms"},
    ],
  },
  {
    id: "bookshelf", label: "Bookshelf sleep screen",
    settings: [
      {"key":"bookshelf_screensaver_background_type","label":"Background type","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → Background type","type":"enum","absent":1,"effect":"next_sleep","source":"bookshelf.lua:134","options":[{"value":0,"label":"No background"},{"value":1,"label":"Dotted pattern"},{"value":2,"label":"Book cover"},{"value":3,"label":"Custom image (from koreader/resources/backgrounds/)"}]},
      {"key":"bookshelf_screensaver_progression_type","label":"Progression type","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → Progression type","type":"enum","absent":0,"effect":"next_sleep","source":"bookshelf.lua:135","options":[{"value":0,"label":"Progress bar"},{"value":1,"label":"Top to bottom"},{"value":2,"label":"Bottom to top"}]},
      {"key":"bookshelf_screensaver_show_standing_book","label":"Show standing book","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:136","help":"Absent = default true; the menu stores explicit true/false."},
      {"key":"bookshelf_screensaver_show_stack_decor","label":"Show stack decoration","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":false,"effect":"next_sleep","source":"bookshelf.lua:137","help":"Needs koreader/resources/bookshelf-screensaver-decor.png."},
      {"key":"bookshelf_screensaver_show_time_left","label":"Show time left","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:138"},
      {"key":"bookshelf_screensaver_show_percent","label":"Show percent completed","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":false,"effect":"next_sleep","source":"bookshelf.lua:139"},
      {"key":"bookshelf_screensaver_show_bands","label":"Show progress bands","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:140"},
      {"key":"bookshelf_screensaver_use_random_colors","label":"Use random colors","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":false,"effect":"next_sleep","source":"bookshelf.lua:141","help":"On a B/W screen colours render as greys."},
      {"key":"bookshelf_screensaver_use_misaligned_stack","label":"Use misaligned stack","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:142"},
      {"key":"bookshelf_screensaver_num_books","label":"Set number of books","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":5,"effect":"next_sleep","source":"bookshelf.lua:1228","min":1,"max":10,"step":1},
      {"key":"bookshelf_screensaver_finished_threshold","label":"Set 'finished' threshold (%)","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":97,"effect":"next_sleep","source":"bookshelf.lua:1229","min":90,"max":100,"step":1,"unit":"%"},
      {"key":"bookshelf_screensaver_minimum_pages","label":"Set minimum pages threshold","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":0,"effect":"next_sleep","source":"bookshelf.lua:1231","min":0,"max":999999,"step":5,"unit":"pages"},
      {"key":"bookshelf_screensaver_font_size","label":"Set font size","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":6,"effect":"next_sleep","source":"bookshelf.lua:1234","min":4,"max":10,"step":1},
    ],
  },
  {
    id: "project_title", label: "Library (Project: Title)",
    settings: [
      {"key":"pt:filemanager_display_mode","label":"Display mode (file browser)","path":"Project: Title → Settings","type":"enum","absent":"list_image_meta","effect":"restart","source":"projecttitle.koplugin/joshuacant_ProjectTitle/main.lua:163,225","options":[{"value":"list_image_meta","label":"Cover list"},{"value":"mosaic_image","label":"Cover grid"},{"value":"list_only_meta","label":"Details list"},{"value":"list_no_meta","label":"File names"}]},
      {"key":"pt:history_display_mode","label":"History display mode","path":"Project: Title → Settings","type":"enum","absent":"list_image_meta","effect":"restart","source":"projecttitle.koplugin/main.lua:226,434","options":[{"value":"list_image_meta","label":"Cover list"},{"value":"mosaic_image","label":"Cover grid"},{"value":"list_only_meta","label":"Details list"},{"value":"list_no_meta","label":"File names"}]},
      {"key":"pt:collection_display_mode","label":"Collections display mode","path":"Project: Title → Settings","type":"enum","absent":"list_image_meta","effect":"restart","source":"projecttitle.koplugin/main.lua:227,441","options":[{"value":"list_image_meta","label":"Cover list"},{"value":"mosaic_image","label":"Cover grid"},{"value":"list_only_meta","label":"Details list"},{"value":"list_no_meta","label":"File names"}]},
      {"key":"pt:unified_display_mode","label":"Use this mode everywhere","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:233,427"},
      {"key":"pt:nb_cols_portrait","label":"Portrait cover grid: columns","path":"Project: Title → Settings","type":"int","absent":3,"effect":"restart","source":"projecttitle.koplugin/main.lua:486; ptutil.lua:93-97","min":2,"max":4},
      {"key":"pt:nb_rows_portrait","label":"Portrait cover grid: rows","path":"Project: Title → Settings","type":"int","absent":3,"effect":"restart","source":"projecttitle.koplugin/main.lua:487","min":2,"max":4},
      {"key":"pt:nb_cols_landscape","label":"Landscape cover grid: columns","path":"Project: Title → Settings","type":"int","absent":null,"effect":"restart","source":"projecttitle.koplugin/main.lua:534","min":2,"max":4},
      {"key":"pt:nb_rows_landscape","label":"Landscape cover grid: rows","path":"Project: Title → Settings","type":"int","absent":null,"effect":"restart","source":"projecttitle.koplugin/main.lua:535","min":2,"max":4},
      {"key":"pt:files_per_page","label":"List modes: items per page","path":"Project: Title → Settings","type":"int","absent":7,"effect":"restart","source":"projecttitle.koplugin/main.lua:574; ptutil.lua:73-75","min":3,"max":10},
      {"key":"pt:disable_auto_foldercovers","label":"Auto-generate cover images from books (inverted)","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:600"},
      {"key":"pt:use_stacked_foldercovers","label":"Show auto-generated cover images as a stack","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:611"},
      {"key":"pt:show_name_grid_folders","label":"Overlay name and details in cover grid","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:619"},
      {"key":"pt:use_custom_sorts","label":"Use custom sort methods","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:627"},
      {"key":"pt:hide_file_info","label":"Show file info instead of pages or progress % (inverted)","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:640"},
      {"key":"pt:show_pages_read_as_progress","label":"Show pages read instead of progress %","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:653"},
      {"key":"pt:force_no_progressbars","label":"Show progress % instead of progress bars","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:667"},
      {"key":"pt:force_max_progressbars","label":"Always show maximum length progress bars","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:683"},
      {"key":"pt:show_tags","label":"Show calibre tags/keywords","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:705"},
      {"key":"pt:use_custom_bookstatus","label":"Use custom book status screen","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:713"},
      {"key":"pt:replace_footer_text","label":"Footer: replace folder name with device info","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:726"},
      {"key":"pt:reverse_footer","label":"Footer: show page controls in left corner","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:734"},
      {"key":"pt:autoscan_on_eject","label":"Scan home folder for new books automatically","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:747"},
      {"key":"pt:force_focus_indicator","label":"Show last item indicator on touchscreen devices","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:808"},
      {"key":"pt:show_progress_in_mosaic","label":"(no menu) progress in cover grid","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:234"},
      {"key":"pt:opened_at_top_of_library","label":"(no menu)","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:250"},
    ],
  },
  {
    id: "screen", label: "Screen, refresh and display",
    settings: [
      {"key":"night_mode","label":"Night mode","path":"Settings → Night mode","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:268","help":"Menu toggles via the ToggleNightMode event (devicelistener.lua:15-26). A raw saveSetting is only applied at the next start (device.lua:344); for a live change the plugin should broadcast Event:new('ToggleNightMode') instead of writing th…"},
      {"key":"full_refresh_count","label":"Full refresh rate (regular)","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"int","absent":6,"effect":"restart","source":"frontend/ui/uimanager.lua:810","options":[{"value":0,"label":"Never"},{"value":1,"label":"Every page"},{"value":6,"label":"Every 6 pages"},{"value":-1,"label":"Every chapter"}],"min":-1,"max":200,"step":1,"unit":"pages","help":"Any integer -1..200 allowed (custom). Read into UIManager.FULL_REFRESH_COUNT at load (uimanager.lua:27); live change only via Event SetRefreshRates/SetBothRefreshRates."},
      {"key":"night_full_refresh_count","label":"Full refresh rate (night mode)","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"int","absent":"same as full_refresh_count","effect":"restart","source":"frontend/ui/uimanager.lua:813","min":-1,"max":200,"step":1,"unit":"pages"},
      {"key":"refresh_rate_1","label":"Custom 1 refresh rate (regular)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 1 (long-press)","type":"int","absent":12,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"Preset value only; selecting the preset copies it into full_refresh_count."},
      {"key":"night_refresh_rate_1","label":"Custom 1 refresh rate (night)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 1 (long-press)","type":"int","absent":"same as refresh_rate_1","effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages"},
      {"key":"refresh_rate_2","label":"Custom 2 refresh rate (regular)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 2 (long-press)","type":"int","absent":22,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"Preset value only; selecting the preset copies it into full_refresh_count."},
      {"key":"night_refresh_rate_2","label":"Custom 2 refresh rate (night)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 2 (long-press)","type":"int","absent":"same as refresh_rate_2","effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages"},
      {"key":"refresh_rate_3","label":"Custom 3 refresh rate (regular)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 3 (long-press)","type":"int","absent":99,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"Preset value only; selecting the preset copies it into full_refresh_count."},
      {"key":"night_refresh_rate_3","label":"Custom 3 refresh rate (night)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 3 (long-press)","type":"int","absent":"same as refresh_rate_3","effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages"},
      {"key":"refresh_on_chapter_boundaries","label":"Always flash on chapter boundaries","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:110","help":"Read at each page turn (readertoc.lua:128)."},
      {"key":"no_refresh_on_second_chapter_page","label":"…except on the second page of a new chapter","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:116"},
      {"key":"refresh_on_pages_with_images","label":"Always flash on pages with images","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:121","help":"nilOrTrue: only false is stored (devicelistener.lua:333-341)."},
      {"key":"flash_ui","label":"Flash buttons and menu items","path":"Settings → Screen → E-ink settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/flash_ui.lua:6"},
      {"key":"flash_keyboard","label":"Flash keyboard","path":"Settings → Screen → E-ink settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/flash_keyboard.lua:6","help":"Read when a keyboard is created (virtualkeyboard.lua:317)."},
      {"key":"avoid_flashing_ui","label":"Avoid mandatory black flashes in UI","path":"Settings → Screen → E-ink settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:22"},
      {"key":"low_pan_rate","label":"Use smaller panning rate","path":"Settings → Screen → E-ink settings","type":"bool","absent":"device default","effect":"restart","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:15","help":"Only applied to Screen at Device init (device.lua:274-275)."},
      {"key":"custom_screen_dpi","label":"Custom DPI (hold to set)","path":"Settings → Screen → Screen DPI","type":"int","absent":"auto","effect":"immediate","source":"frontend/ui/elements/screen_dpi_menu_table.lua:35","min":90,"max":900,"step":10,"unit":"dpi","help":"Stored preset only; screen_dpi is what is applied."},
      {"key":"notification_sources_to_show_mask","label":"Notifications","path":"Settings → Screen → Notifications","type":"int","absent":60,"effect":"immediate","source":"frontend/ui/elements/screen_notification_menu_table.lua:17","help":"Bitmask: 0x01 bottom-menu icons, 0x02 bottom-menu toggles, 0x04 bottom-menu ± buttons, 0x08 bottom-menu ⋮ buttons, 0x10 bottom-menu progress bars, 0x20 gestures and profiles, 0x40 all other sources. Default 60 = 0x04|0x08|0x10|0x20 (noti…"},
    ],
  },
  {
    id: "rotation", label: "Rotation",
    settings: [
      {"key":"fm_rotation_mode","label":"Default file browser rotation (★)","path":"Settings → Screen → Rotation","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/elements/screen_rotation_menu_table.lua:22","options":[{"value":0,"label":"↑ 0° (upright)"},{"value":1,"label":"⤸ 90° (clockwise)"},{"value":2,"label":"↓ 180°"},{"value":3,"label":"⤹ 90° (counter-clockwise)"}],"help":"Applied when the file browser is (re)created (filemanager.lua:66), unless lock_rotation is on. Hold an entry to set ★ default."},
      {"key":"lock_rotation","label":"Keep current rotation across views","path":"Settings → Screen → Rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:71"},
      {"key":"imageviewer_rotation_portrait_invert","label":"Image viewer: invert default rotation in portrait mode","path":"Settings → Screen → Rotation → Image viewer rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:91"},
      {"key":"imageviewer_rotation_landscape_invert","label":"Image viewer: invert default rotation in landscape mode","path":"Settings → Screen → Rotation → Image viewer rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:100","help":"Also used for the sleep-screen auto-rotation direction (screensaver.lua:537)."},
      {"key":"imageviewer_rotate_auto_for_best_fit","label":"Image viewer: auto-rotate for best fit","path":"Settings → Screen → Rotation → Image viewer rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:111"},
    ],
  },
  {
    id: "frontlight", label: "Frontlight, warmth and auto-dim",
    settings: [
      {"key":"autodim_starttime_minutes","label":"Idle time for dimmer","path":"Settings → Screen → Automatic dimmer","type":"number","absent":-1,"effect":"next_book","source":"plugins/autodim.koplugin/main.lua:82","min":0.5,"max":60,"unit":"minutes","help":"-1 = disabled (menu 'Disable'). Menu default when enabling: 5. Read in plugin init (main.lua:35)."},
      {"key":"autodim_duration_seconds","label":"Dimmer duration","path":"Settings → Screen → Automatic dimmer","type":"int","absent":5,"effect":"next_book","source":"plugins/autodim.koplugin/main.lua:120","min":0,"max":300,"unit":"seconds"},
      {"key":"autodim_fraction","label":"Dim to % of the regular brightness","path":"Settings → Screen → Automatic dimmer","type":"int","absent":20,"effect":"next_book","source":"plugins/autodim.koplugin/main.lua:147","min":0,"max":100,"unit":"%"},
    ],
  },
  {
    id: "autowarmth", label: "AutoWarmth plugin",
    settings: [
      {"key":"autowarmth_activate","label":"Activate","path":"Settings → Screen → AutoWarmth and night mode → Activate","type":"enum","absent":0,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:79","options":[{"value":0,"label":"Off"},{"value":1,"label":"Sun position"},{"value":2,"label":"Fixed schedule"},{"value":3,"label":"Whatever is closer to noon"},{"value":4,"label":"Whatever is closer to midnight"}]},
      {"key":"autowarmth_easy_mode","label":"Expert mode (inverted)","path":"Settings → Screen → AutoWarmth and night mode → Expert mode","type":"bool","absent":true,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:78","help":"true = easy mode (civil twilight only); the checkbox 'Expert mode' is checked when this is false."},
      {"key":"autowarmth_location","label":"Location name","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Location","type":"string","absent":null,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:80","maxLength":500,"help":"Default: Geysir."},
      {"key":"autowarmth_latitude","label":"Latitude","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Coordinates","type":"number","absent":64.31,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:81","min":-90,"max":90,"unit":"° (north +)"},
      {"key":"autowarmth_longitude","label":"Longitude","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Coordinates","type":"number","absent":-20.3,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:82","min":-180,"max":180,"unit":"° (east +)"},
      {"key":"autowarmth_altitude","label":"Altitude","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Altitude","type":"int","absent":200,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:83","min":-100,"max":15000,"unit":"m"},
      {"key":"autowarmth_timezone","label":"Timezone offset","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Coordinates","type":"number","absent":0,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:84","unit":"hours from UTC","help":"Also recomputed and re-saved automatically (main.lua:315)."},
      {"key":"autowarmth_control_warmth","label":"Control: warmth","path":"Settings → Screen → AutoWarmth and night mode → Control","type":"bool","absent":true,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:96"},
      {"key":"autowarmth_control_nightmode","label":"Control: night mode","path":"Settings → Screen → AutoWarmth and night mode → Control","type":"bool","absent":true,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:97"},
      {"key":"autowarmth_hide_nightmode_warning","label":"Enable night mode warning (inverted)","path":"Settings → Screen → AutoWarmth and night mode → Enable night mode warning","type":"bool","absent":false,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:98"},
      {"key":"autowarmth_fl_off_during_day","label":"Frontlight off during day","path":"Settings → Screen → AutoWarmth and night mode → Frontlight off during day","type":"bool","absent":false,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:724"},
      {"key":"autowarmth_fl_off_during_day_offset_s","label":"Frontlight off during day: offset","path":"Settings → Screen → AutoWarmth and night mode → Frontlight off during day","type":"int","absent":0,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:746","min":-900,"max":1800,"step":60,"unit":"seconds (menu edits minutes -15…+30)"},
    ],
  },
  {
    id: "power", label: "Power, sleep and battery",
    settings: [
      {"key":"auto_suspend_timeout_seconds","label":"Autosuspend timeout","path":"Settings → Device → Autosuspend timeout","type":"int","absent":900,"effect":"next_book","source":"plugins/autosuspend.koplugin/main.lua:189","min":60,"max":86400,"unit":"seconds","help":"-1 = disabled ('Disable' button, main.lua:507). Menu range 1 min … 24 h. Read in plugin init; a menu change reschedules immediately."},
      {"key":"autoshutdown_timeout_seconds","label":"Autoshutdown timeout","path":"Settings → Device → Autoshutdown timeout","type":"int","absent":259200,"effect":"next_book","source":"plugins/autosuspend.koplugin/main.lua:187","min":300,"max":2419200,"unit":"seconds","help":"-1 = disabled. Default 3 days; range 5 min … 28 days."},
      {"key":"auto_standby_timeout_seconds","label":"Autostandby timeout","path":"Settings → Device → Autostandby timeout","type":"int","absent":-1,"effect":"next_book","source":"plugins/autosuspend.koplugin/main.lua:192","min":1,"max":900,"unit":"seconds","help":"Menu only when Device:canStandby() (detected at runtime via checkStandby). -1 = disabled. Recommended ≥4 s on Kobo."},
      {"key":"enable_charging_led","label":"Turn on the power LED when charging","path":"Settings → Device","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:59","help":"Kobo_spaBW has canToggleChargingLED = yes. Applied at next charge event (kobo/device.lua:601)."},
      {"key":"ignore_power_sleepcover","label":"Ignore all sleepcover events","path":"Settings → Device","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:221","help":"Mutually exclusive with ignore_open_sleepcover (menu sets the other false). Read at input setup (kobo/device.lua:1728)."},
      {"key":"ignore_open_sleepcover","label":"Ignore sleepcover wakeup events","path":"Settings → Device","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:233"},
      {"key":"device_status_battery_alarm","label":"Battery level alert","path":"Settings → Device → Device status alerts → Battery level","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:132"},
      {"key":"device_status_battery_interval_minutes","label":"Battery check interval","path":"Settings → Device → Device status alerts → Battery level","type":"int","absent":10,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:164","min":1,"max":60,"unit":"minutes"},
      {"key":"device_status_battery_threshold","label":"Battery low threshold","path":"Settings → Device → Device status alerts → Battery level → Thresholds","type":"int","absent":20,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:208","min":1,"max":100,"unit":"%"},
      {"key":"device_status_battery_threshold_high","label":"Battery high threshold","path":"Settings → Device → Device status alerts → Battery level → Thresholds","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:209","min":1,"max":100,"unit":"%","help":"Must be ≥ the low threshold."},
      {"key":"device_status_memory_alarm","label":"High memory usage alert","path":"Settings → Device → Device status alerts → High memory usage","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:224"},
      {"key":"device_status_memory_interval_minutes","label":"Memory check interval","path":"Settings → Device → Device status alerts → High memory usage","type":"int","absent":5,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:255","min":1,"max":60,"unit":"minutes"},
      {"key":"device_status_memory_threshold","label":"Memory alert threshold","path":"Settings → Device → Device status alerts → High memory usage","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:286","min":20,"max":500,"unit":"MB"},
      {"key":"device_status_memory_auto_restart","label":"Automatic restart (on high memory)","path":"Settings → Device → Device status alerts → High memory usage","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:299","help":"Restarts KOReader without asking when the threshold is crossed."},
    ],
  },
  {
    id: "network", label: "Network and Wi-Fi",
    settings: [
      {"key":"auto_disable_wifi","label":"Disable Wi-Fi connection when inactive","path":"Settings → Network","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/network/manager.lua:975"},
      {"key":"auto_restore_wifi","label":"Restore Wi-Fi connection on resume","path":"Settings → Network","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/network/manager.lua:989","help":"Turns Wi-Fi back on after sleep only if it was on before. The plugin syncs whenever Wi-Fi comes on."},
      {"key":"wifi_disable_action","label":"Action when done with Wi-Fi","path":"Settings → Network","type":"enum","absent":"prompt","effect":"immediate","source":"frontend/ui/network/manager.lua:1063","options":[{"value":"leave_on","label":"Leave on"},{"value":"turn_off","label":"Turn off"},{"value":"prompt","label":"Prompt"}]},
      {"key":"auto_dismiss_wifi_scan","label":"Dismiss Wi-Fi scan popup after connection","path":"Settings → Network","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/network/manager.lua:1084"},
      {"key":"SSH_force_kill_clients","label":"SSH server: kill open sessions when stopping","path":"Settings → Network → SSH server","type":"bool","absent":false,"effect":"next_book","source":"plugins/SSH.koplugin/main.lua:337"},
    ],
  },
  {
    id: "taps_gestures", label: "Taps, gestures and page turns",
    settings: [
      {"key":"disable_double_tap","label":"Disable double tap","path":"Settings → Taps and gestures","type":"bool","absent":true,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:302","help":"nilOrTrue: absent = double tap DISABLED. askForRestart."},
      {"key":"ignore_hold_corners","label":"Ignore long-press on corners","path":"Settings → Taps and gestures","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/common_settings_menu_table.lua:293","help":"Read in Gestures init (gestures main.lua:245)."},
      {"key":"activate_menu","label":"Activate menu","path":"Settings → Taps and gestures → Activate menu","type":"enum","absent":"swipe_tap","effect":"next_book","source":"frontend/ui/elements/menu_activate.lua:15","options":[{"value":"swipe_tap","label":"With a tap and with a swipe"},{"value":"tap","label":"With a tap only"},{"value":"swipe","label":"With a swipe only"}],"help":"Read when the menu module is created (filemanagermenu.lua:51, readermenu.lua:29)."},
      {"key":"show_bottom_menu","label":"Auto-show bottom menu","path":"Settings → Taps and gestures → Activate menu","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/menu_activate.lua:40"},
      {"key":"multiswipes_enabled","label":"Turn on multiswipes","path":"Settings → Taps and gestures → Gesture manager","type":"bool","absent":false,"effect":"next_book","source":"plugins/gestures.koplugin/main.lua:857"},
      {"key":"hold_pan_rate","label":"Text selection rate","path":"Settings → Taps and gestures → Gesture intervals","type":"number","absent":"5 (low pan rate) / 30","effect":"immediate","source":"plugins/gestures.koplugin/main.lua:674","min":1,"max":60,"unit":"Hz"},
      {"key":"ges_tap_interval_ms","label":"Tap interval","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":0,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:702","min":0,"max":2000,"unit":"ms"},
      {"key":"ges_tap_interval_on_keyboard_ms","label":"Tap interval on keyboard","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":0,"effect":"next_book","source":"plugins/gestures.koplugin/main.lua:729","min":0,"max":2000,"unit":"ms","help":"Read when a keyboard is shown (virtualkeyboard.lua:729)."},
      {"key":"ges_double_tap_interval_ms","label":"Double tap interval","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":300,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:755","min":100,"max":2000,"unit":"ms"},
      {"key":"ges_two_finger_tap_duration_ms","label":"Two finger tap duration","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":300,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:782","min":100,"max":2000,"unit":"ms"},
      {"key":"ges_hold_interval_ms","label":"Long-press interval","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":500,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:810","min":100,"max":3000,"unit":"ms","help":"Max = highlight_long_hold_threshold_s × 1000."},
      {"key":"ges_swipe_interval_ms","label":"Swipe interval","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":900,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:837","min":100,"max":2000,"unit":"ms"},
      {"key":"page_turns_swipe_always_active","label":"Swipes always active","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/page_turns.lua:117"},
      {"key":"page_turns_tap_zones","label":"Tap zones","path":"Reader → Settings → Taps and gestures → Page turns → Tap zones","type":"enum","absent":"default","effect":"next_book","source":"frontend/ui/elements/page_turns.lua:23","options":[{"value":"default","label":"Default"},{"value":"left_right","label":"Left / right"},{"value":"top_bottom","label":"Top / bottom"},{"value":"bottom_top","label":"Bottom / top"}],"help":"Applied by ReaderView:setupTouchZones() (book open / menu)."},
      {"key":"page_turns_tap_zone_forward_size_ratio","label":"Forward tap zone size","path":"Reader → Settings → Taps and gestures → Page turns → Tap zones → size","type":"number","absent":"DTAP_ZONE_FORWARD.w","effect":"next_book","source":"frontend/ui/elements/page_turns.lua:78","min":0,"max":1,"step":0.01,"unit":"fraction of screen (menu edits 0-100 %)"},
      {"key":"page_turns_tap_zone_backward_size_ratio","label":"Backward tap zone size","path":"Reader → Settings → Taps and gestures → Page turns → Tap zones → size","type":"number","absent":"DTAP_ZONE_BACKWARD.w","effect":"next_book","source":"frontend/ui/elements/page_turns.lua:77","min":0,"max":1,"step":0.01,"unit":"fraction of screen"},
      {"key":"inverse_reading_order","label":"Invert page turn taps and swipes (★ default)","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/page_turns.lua:146","help":"Global default only; per-book value in the book's sidecar wins (readerview.lua:984)."},
      {"key":"invert_ui_layout","label":"Invert document-related dialogs (★ default)","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/page_turns.lua:183","help":"Per-book value wins (readerview.lua:989)."},
      {"key":"swipe_animations","label":"Page turn animations","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/page_turns.lua:212","help":"Only offered when Device:canDoSwipeAnimation(); slow on e-ink."},
      {"key":"scroll_method","label":"Scrolling method","path":"Reader → Settings → Taps and gestures → Scrolling","type":"enum","absent":"classic","effect":"next_book","source":"frontend/apps/reader/modules/readerscrolling.lua:209","options":[{"value":"classic","label":"Classic scrolling"},{"value":"turbo","label":"Turbo scrolling"},{"value":"on_release","label":"On-release scrolling"}],"help":"Only for continuous view mode."},
      {"key":"inertial_scroll","label":"Allow inertial scrolling","path":"Reader → Settings → Taps and gestures → Scrolling","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerscrolling.lua:210"},
      {"key":"scroll_activation_delay","label":"Scroll activation delay","path":"Reader → Settings → Taps and gestures → Scrolling","type":"int","absent":0,"effect":"next_book","source":"frontend/apps/reader/modules/readerscrolling.lua:214","min":0,"max":2000,"unit":"ms"},
      {"key":"default_highlight_action","label":"Long-press on text: action","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"enum","absent":"ask","effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:2164","options":[{"value":"ask","label":"Ask with popup dialog"},{"value":"nothing","label":"Do nothing"},{"value":"highlight","label":"Highlight"},{"value":"select","label":"Select and highlight"},{"value":"note","label":"Add note"},{"value":"translate","label":"Translate"},{"value":"wikipedia","label":"Wikipedia"},{"value":"dictionary","label":"Dictionary"},{"value":"search","label":"Fulltext search"}]},
      {"key":"highlight_action_on_single_word","label":"Dictionary on single word selection (inverted)","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:775","help":"Checkbox is checked when this is false/absent."},
      {"key":"highlight_dialog_position","label":"Highlight dialog position","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"enum","absent":"center","effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:804","options":[{"value":"top","label":"Top"},{"value":"center","label":"Center"},{"value":"bottom","label":"Bottom"},{"value":"gesture","label":"Highlight position"}]},
      {"key":"highlight_prompt","label":"Highlight prompt","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"enum","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:829","options":[{"value":"style","label":"style"},{"value":"color","label":"color"},{"value":"all","label":"style, color"}]},
      {"key":"highlight_long_hold_threshold_s","label":"Highlight very-long-press interval","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"number","absent":3,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:869","min":0.5,"max":20,"step":0.1,"unit":"seconds"},
      {"key":"highlight_corner_scroll","label":"Auto-scroll when selection reaches a corner","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:892"},
      {"key":"tap_to_follow_links","label":"Tap to follow links","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:521"},
      {"key":"tap_ignore_external_links","label":"Ignore external links on tap","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:531"},
      {"key":"swipe_to_go_back","label":"Swipe to go back","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:543"},
      {"key":"swipe_to_follow_nearest_link","label":"Swipe to follow nearest link","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:552"},
      {"key":"swipe_ignore_external_links","label":"Ignore external links on swipe","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:562"},
      {"key":"swipe_to_jump_to_latest_bookmark","label":"Swipe to jump to latest bookmark","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:574"},
      {"key":"larger_tap_area_to_follow_links","label":"Allow larger tap area around links","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:596"},
      {"key":"footnote_link_in_popup","label":"Show footnotes in popup","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:317"},
      {"key":"link_prefer_footnote","label":"Show more links as footnotes","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:340"},
      {"key":"footnote_popup_use_book_font","label":"Use book font in popups","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:356"},
      {"key":"footnote_popup_relative_font_size","label":"Footnote popup font size (relative)","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings → Footnote popup font size","type":"int","absent":-2,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:411","min":-10,"max":5,"unit":"pt relative to book font","help":"Mutually exclusive with footnote_popup_absolute_font_size (setting one deletes the other)."},
      {"key":"footnote_popup_absolute_font_size","label":"Footnote popup font size (absolute)","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings → Footnote popup font size","type":"int","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:386","min":12,"max":255},
      {"key":"footnote_popup_justify","label":"Justify text in popups","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:442"},
    ],
  },
  {
    id: "navigation", label: "Navigation and end of document",
    settings: [
      {"key":"back_to_exit","label":"Back to exit","path":"Settings → Navigation → Back to exit","type":"enum","absent":"prompt","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:418","options":[{"value":"prompt","label":"Prompt"},{"value":"always","label":"Always"},{"value":"disable","label":"Disable"}],"help":"Only meaningful with a Back key; Clara BW has none (gesture-only)."},
      {"key":"back_in_filemanager","label":"Back in file browser","path":"Settings → Navigation → Back in file browser","type":"enum","absent":"default","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:449","options":[{"value":"default","label":"Back to exit"},{"value":"parent_folder","label":"Go to parent folder"}]},
      {"key":"back_in_reader","label":"Back in reader","path":"Settings → Navigation → Back in reader","type":"enum","absent":"previous_location","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:459","options":[{"value":"default","label":"Back to exit"},{"value":"filebrowser","label":"Go to file browser"},{"value":"previous_location","label":"Go to previous location"},{"value":"previous_read_page","label":"Go to previous read page"}]},
      {"key":"opening_page_location_stack","label":"Add opening page to location history","path":"Settings → Navigation","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/common_settings_menu_table.lua:507"},
      {"key":"skim_dialog_position","label":"Skim dialog position","path":"Settings → Navigation → Skim dialog position","type":"enum","absent":"center","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:521","options":[{"value":"top","label":"Top"},{"value":"bottom","label":"Bottom"}],"help":"Center is stored as nil — delete the key for center."},
      {"key":"end_document_auto_mark","label":"Always mark as finished","path":"Settings → Document → End of document action","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:771"},
      {"key":"hide_nonlinear_flows","label":"Hide non-linear fragments (★ default)","path":"Reader → Navigation tab (bookmark icon) → Hide non-linear fragments","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerrolling.lua:438","help":"EPUB only; per-book value wins."},
      {"key":"autoturn_enabled","label":"Autoturn (on/off)","path":"Reader → Navigation tab (bookmark icon) → Autoturn","type":"bool","absent":false,"effect":"next_book","source":"plugins/autoturn.koplugin/main.lua:163","help":"Read in plugin init (main.lua:90)."},
      {"key":"autoturn_timeout_seconds","label":"Autoturn time","path":"Reader → Navigation tab (bookmark icon) → Autoturn","type":"int","absent":0,"effect":"next_book","source":"plugins/autoturn.koplugin/main.lua:161","min":1,"max":86400,"unit":"seconds","help":"Menu proposes 30 s when unset."},
      {"key":"autoturn_distance","label":"Autoturn scrolling distance","path":"Reader → Navigation tab (bookmark icon) → Autoturn (long-press)","type":"number","absent":1,"effect":"next_book","source":"plugins/autoturn.koplugin/main.lua:186","min":-20,"max":20,"unit":"pages (fractional = % of page in scroll mode)"},
    ],
  },
  {
    id: "document", label: "Document metadata and history",
    settings: [
      {"key":"auto_save_settings_interval_minutes","label":"Save book metadata","path":"Settings → Document → Save book metadata","type":"enum","absent":15,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:568","options":[{"value":false,"label":"Only on close and suspend"},{"value":5,"label":"Every 5 minutes"},{"value":15,"label":"Every 15 minutes"},{"value":30,"label":"Every 30 minutes"},{"value":60,"label":"Every 60 minutes"}],"help":"Written as 15 on first start if absent (line 532-535). Checked at page turns (readerview.lua:1284)."},
      {"key":"document_metadata_arc_folder","label":"Book metadata archive: Archive location","path":"Settings → Document → Book metadata archive","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:732","maxLength":500,"help":"Absolute folder. Menu moves existing archive .lua files when changed; a raw write does not."},
      {"key":"document_metadata_arc_on_closing","label":"Save metadata to archive on book closing","path":"Settings → Document → Book metadata archive","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:748"},
      {"key":"document_metadata_arc_on_deletion","label":"Save book metadata to archive (on delete)","path":"File browser → long-press file → Delete → checkbox","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanager.lua:1164"},
      {"key":"history_datetime_short","label":"Shorten date/time","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:267"},
      {"key":"history_freeze_finished_books","label":"Freeze last read date of finished books","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:277"},
      {"key":"autoremove_deleted_items_from_history","label":"Auto-remove deleted or purged items from history","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:299"},
      {"key":"open_last_menu_show_filename","label":"Show filename in Open previous menu items","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:309"},
      {"key":"annotations_export_on_closing","label":"Export annotations on book closing","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:256"},
      {"key":"annotations_export_keep_all_on_import","label":"Keep all annotations on import","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:257"},
      {"key":"annotations_export_folder","label":"Export / import folder","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:272","maxLength":500,"help":"Default: book metadata folder."},
      {"key":"notebook_file","label":"Default notebook file","path":"Book information → Notebook → Set as default","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/filemanager/filemanagerbookinfo.lua:859","maxLength":500},
    ],
  },
  {
    id: "file_browser", label: "File browser",
    settings: [
      {"key":"shorten_home_dir","label":"Shorten home folder","path":"File browser → File browser settings tab (folder icon) → Settings → Home folder settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:337"},
      {"key":"lock_home_folder","label":"Lock home folder","path":"File browser → File browser settings tab (folder icon) → Settings → Home folder settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:359"},
      {"key":"file_ask_to_open","label":"Ask to open files","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:372"},
      {"key":"show_parent_folder","label":"Show parent folder","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:381"},
      {"key":"collection_show_mark","label":"Show collection mark","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:391"},
      {"key":"show_flat_view","label":"Show all files from subfolders","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/widget/filechooser.lua:23","help":"FileChooser class field read at module load; menu also refreshes it live (filechooser.lua:418)."},
      {"key":"show_hidden","label":"Show hidden files","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/widget/filechooser.lua:24"},
      {"key":"show_unsupported","label":"Show unsupported files","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/widget/filechooser.lua:25"},
      {"key":"collate","label":"Sort by","path":"File browser → File browser settings tab (folder icon) → Sort by","type":"enum","absent":"strcoll","effect":"immediate","source":"frontend/ui/widget/filechooser.lua:207","options":[{"value":"strcoll","label":"name"},{"value":"natural","label":"name (natural sorting)"},{"value":"access","label":"last read date"},{"value":"date","label":"date modified"},{"value":"size","label":"size"},{"value":"type","label":"type"},{"value":"percent_unopened_first","label":"percent - unopened first"},{"value":"percent_unopened_last","label":"percent - unopened last"},{"value":"percent_natural","label":"percent – unopened – finished last"},{"value":"title","label":"Title"},{"value":"authors","label":"Authors"},{"value":"series","label":"Series"},{"value":"keywords","label":"Keywords"},{"value":"rating","label":"rating"}],"help":"Applied at the next folder refresh. Project: Title adds its own collate ids (use_custom_sorts)."},
      {"key":"reverse_collate","label":"Reverse sorting","path":"File browser → File browser settings tab (folder icon)","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:458"},
      {"key":"collate_mixed","label":"Folders and files mixed","path":"File browser → File browser settings tab (folder icon)","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:473"},
      {"key":"items_per_page","label":"Classic mode: items per page","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"int","absent":14,"effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:179","min":6,"max":30},
      {"key":"items_font_size","label":"Classic mode: item font size","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"int","absent":"derived from items per page","effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:211","min":10,"max":72},
      {"key":"items_multilines_show_more_text","label":"Shrink item font size to fit more text","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:226"},
      {"key":"show_file_in_bold","label":"Show opened / new files in bold","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"enum","absent":"new (not yet opened) files in bold","effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:240","options":[{"value":"opened","label":"Opened files in bold"},{"value":false,"label":"Nothing in bold"}]},
      {"key":"keyvalues_per_page","label":"Info lists items per page (portrait)","path":"File browser → File browser settings tab (folder icon) → Settings","type":"int","absent":"DPI-derived","effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:434","min":10,"max":30},
      {"key":"keyvalues_per_page_landscape","label":"Info lists items per page (landscape)","path":"File browser → File browser settings tab (folder icon) → Settings","type":"int","absent":"DPI-derived","effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:439","min":10,"max":30},
      {"key":"download_dir","label":"Default download folder (OPDS)","path":"Folder shortcuts / OPDS → Set download folder","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/filemanager/filemanagershortcuts.lua:53","maxLength":500,"help":"Default: last folder."},
      {"key":"inbox_dir","label":"Calibre inbox folder","path":"Tools tab (🔧) → Calibre → Wireless settings → Set inbox folder","type":"string","absent":null,"effect":"immediate","source":"plugins/calibre.koplugin/wireless.lua:229","maxLength":500},
      {"key":"screenshot_dir","label":"Screenshot folder","path":"Settings → Device → Screenshot folder","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/widget/screenshoter.lua:149","maxLength":500,"help":"Default: koreader/screenshots."},
    ],
  },
  {
    id: "defaults_reflowable", label: "Defaults for new EPUB books",
    settings: [
      {"key":"copt_rotation_mode","label":"Rotation","path":"Reader → bottom menu (config dialog) → Rotation tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:55","options":[{"value":0,"label":"↑ 0°"},{"value":1,"label":"⤸ 90°"},{"value":2,"label":"↓ 180°"},{"value":3,"label":"⤹ 90°"}]},
      {"key":"copt_visible_pages","label":"Two Columns","path":"Reader → bottom menu (config dialog) → Rotation tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:103","options":[{"value":1,"label":"off"},{"value":2,"label":"on"}],"help":"Landscape only."},
      {"key":"copt_sync_t_b_page_margins","label":"Sync T/B Margins","path":"Reader → bottom menu (config dialog) → Margins tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:179","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"copt_t_page_margin","label":"Top Margin","path":"Reader → bottom menu (config dialog) → Margins tab","type":"int","absent":15,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:195","min":0,"max":140,"step":1,"unit":"px at 160 dpi","help":"Presets 5,10,15,20,30,50,70,100,140."},
      {"key":"copt_b_page_margin","label":"Bottom Margin","path":"Reader → bottom menu (config dialog) → Margins tab","type":"int","absent":15,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:248","min":0,"max":140,"step":1,"unit":"px at 160 dpi"},
      {"key":"copt_view_mode","label":"View Mode","path":"Reader → bottom menu (config dialog) → Page tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:305","options":[{"value":0,"label":"page"},{"value":1,"label":"continuous"}]},
      {"key":"copt_block_rendering_mode","label":"Render Mode","path":"Reader → bottom menu (config dialog) → Page tab","type":"enum","absent":2,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:317","options":[{"value":0,"label":"legacy"},{"value":1,"label":"flat"},{"value":2,"label":"book"},{"value":3,"label":"web"}]},
      {"key":"copt_render_dpi","label":"Zoom (dpi)","path":"Reader → bottom menu (config dialog) → Page tab","type":"enum","absent":96,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:332","options":[{"value":0,"label":"off"},{"value":48,"label":"48"},{"value":96,"label":"96"},{"value":167,"label":"167"},{"value":212,"label":"212"},{"value":300,"label":"300"}]},
      {"key":"copt_line_spacing","label":"Line Spacing","path":"Reader → bottom menu (config dialog) → Page tab","type":"int","absent":100,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:361","min":50,"max":200,"step":1,"unit":"%","help":"Presets 70,75,80,85,90,95,100,105,110,115,120,125,130."},
      {"key":"copt_font_size","label":"Font Size","path":"Reader → bottom menu (config dialog) → Font tab","type":"number","absent":22,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:416","min":12,"max":255,"step":0.5,"unit":"px at 160 dpi (menu also shows pt)","help":"Presets 12,16,20,22,24,26,28,30,34,38,44."},
      {"key":"copt_word_expansion","label":"Word Expansion","path":"Reader → bottom menu (config dialog) → Font tab","type":"int","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:500","min":0,"max":20,"unit":"%","help":"Presets none 0, some 5, more 15."},
      {"key":"copt_cjk_width_scaling","label":"CJK width scaling","path":"Reader → bottom menu (config dialog) → Font tab → Word Expansion → CJK scaling","type":"int","absent":100,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:544","min":100,"max":150,"unit":"%"},
      {"key":"copt_font_gamma","label":"Contrast","path":"Reader → bottom menu (config dialog) → Font tab","type":"enum","absent":15,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:571","options":[{"value":10,"label":"0.8"},{"value":15,"label":"1.0"},{"value":25,"label":"1.45"},{"value":30,"label":"1.9"},{"value":36,"label":"2.5"},{"value":43,"label":"4.0"},{"value":49,"label":"8.0"},{"value":56,"label":"15.0"}]},
      {"key":"copt_font_base_weight","label":"Font Weight","path":"Reader → bottom menu (config dialog) → Font tab","type":"number","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:596","min":-3,"max":5.5,"step":0.25,"help":"Presets -1,-0.5,0,0.5,1,1.5,3."},
      {"key":"copt_font_hinting","label":"Font Hinting","path":"Reader → bottom menu (config dialog) → Font tab","type":"enum","absent":2,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:630","options":[{"value":0,"label":"off"},{"value":1,"label":"native"},{"value":2,"label":"auto"}]},
      {"key":"copt_font_kerning","label":"Font Kerning","path":"Reader → bottom menu (config dialog) → Font tab","type":"enum","absent":3,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:645","options":[{"value":0,"label":"off"},{"value":1,"label":"fast"},{"value":2,"label":"good"},{"value":3,"label":"best"}]},
      {"key":"copt_status_line","label":"Alt Status Bar","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:668","options":[{"value":1,"label":"off"},{"value":0,"label":"on"}],"help":"Inverted: 0 = alt status bar shown."},
      {"key":"copt_embedded_css","label":"Embedded Style","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:681","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"copt_embedded_fonts","label":"Embedded Fonts","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:693","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"copt_smooth_scaling","label":"Image Scaling","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:720","options":[{"value":0,"label":"fast"},{"value":1,"label":"best"}]},
      {"key":"copt_nightmode_images","label":"Invert Images (night mode)","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:732","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"copt_overlap_lines","label":"Number of overlapped lines","path":"Reader → Typeset tab (document icon) → Page overlap","type":"int","absent":1,"effect":"next_book","source":"frontend/ui/elements/page_overlap.lua:61","min":1,"max":10},
      {"key":"copt_css","label":"Default style sheet (★)","path":"Reader → Typeset tab (document icon) → Style → long-press a CSS","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypeset.lua:470","maxLength":500,"help":"Default: epub.css. Path like './data/epub.css'. Used for books without a saved style."},
      {"key":"copt_fb2_css","label":"Default FB2 style sheet (★)","path":"Reader → Typeset tab (document icon) → Style → long-press a CSS (in an FB2)","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypeset.lua:468","maxLength":500,"help":"Default: fb2.css."},
      {"key":"txt_preformatted","label":"Auto-detect TXT files layout (★)","path":"Reader → Typeset tab (document icon) → Style","type":"enum","absent":"auto-detect","effect":"next_book","source":"frontend/apps/reader/modules/readertypeset.lua:343","options":[{"value":0,"label":"disabled"}]},
    ],
  },
  {
    id: "fonts_typography", label: "Fonts and typography (new EPUB books)",
    settings: [
      {"key":"cre_font","label":"Default font (★)","path":"Reader → Typeset tab (document icon) → Font → long-press a font → Default","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:329","maxLength":500,"help":"Default: Noto Serif. Font face NAME as listed in the font menu (e.g. 'Noto Serif', 'Literata')."},
      {"key":"fallback_font","label":"Fallback font","path":"Reader → Typeset tab (document icon) → Font → long-press a font → Fallback","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:353","maxLength":500,"help":"Default: Noto Sans CJK SC."},
      {"key":"monospace_font","label":"Default monospace font (🄼)","path":"Reader → Typeset tab (document icon) → Font → long-press a font → Monospace","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:334","maxLength":500,"help":"Default: Droid Sans Mono."},
      {"key":"cre_font_family_ignore_font_names","label":"Ignore publisher font names when font-family is set","path":"Reader → Typeset tab (document icon) → Font → Font settings → Font-family fonts","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:482"},
      {"key":"font_menu_use_font_face","label":"Display font names with their own font","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerfont.lua:697"},
      {"key":"font_menu_sort_by_recently_selected","label":"Sort fonts by recently selected","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:708"},
      {"key":"additional_fallback_fonts","label":"Use additional fallback fonts","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:738"},
      {"key":"cre_adjusted_fallback_font_sizes","label":"Adjust fallback font sizes","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:758"},
      {"key":"cre_monospace_scaling","label":"Monospace fonts scaling","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:788","min":30,"max":150,"unit":"%"},
      {"key":"hyphenation","label":"Enable hyphenation (★ default, long-press)","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:334"},
      {"key":"hyph_left_hyphen_min","label":"Hyphenation: left minimal size","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation → Left/right minimal sizes","type":"int","absent":"language default","effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:393","min":1,"max":10,"unit":"characters","help":"Global only. nil = language default."},
      {"key":"hyph_right_hyphen_min","label":"Hyphenation: right minimal size","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation → Left/right minimal sizes","type":"int","absent":"language default","effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:394","min":1,"max":10,"unit":"characters"},
      {"key":"hyph_trust_soft_hyphens","label":"Trust soft hyphens (★ default)","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:429"},
      {"key":"hyph_force_algorithmic","label":"Algorithmic hyphenation (★ default)","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:487"},
      {"key":"hyph_soft_hyphens_only","label":"Soft hyphens only (★ default)","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:525"},
      {"key":"hyph_user_dict","label":"Custom hyphenation rules","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readeruserhyph.lua:96"},
      {"key":"floating_punctuation","label":"Hanging punctuation (★ default)","path":"Reader → Typeset tab (document icon) → Typography rules","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:632"},
      {"key":"text_lang_embedded_langs","label":"Respect embedded lang tags (★ default)","path":"Reader → Typeset tab (document icon) → Typography rules","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:307"},
      {"key":"text_lang_default","label":"Typography language: default (★)","path":"Reader → Typeset tab (document icon) → Typography rules → long-press a language → Default","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:261","maxLength":500,"help":"Default: book language, else English. Language tag such as 'en-US', 'nb', 'tr'. Overrides the book's own language. Mutually exclusive with text_lang_fallback."},
      {"key":"text_lang_fallback","label":"Typography language: fallback","path":"Reader → Typeset tab (document icon) → Typography rules → long-press a language → Fallback","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:267","maxLength":500,"help":"Used only when the book declares no language."},
      {"key":"cre_partial_rerendering","label":"Enable partial renderings","path":"Settings → Document (reader) → Enable partial renderings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerrolling.lua:491"},
      {"key":"page_overlap_enable","label":"Page overlap (★ default)","path":"Reader → Typeset tab (document icon) → Page overlap (long-press)","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/page_overlap.lua:35"},
      {"key":"page_overlap_style","label":"Page overlap indicator (★ default)","path":"Reader → Typeset tab (document icon) → Page overlap","type":"enum","absent":"dim","effect":"next_book","source":"frontend/ui/elements/page_overlap.lua:93","options":[{"value":"none","label":"No indicator"},{"value":"dim","label":"Gray out"},{"value":"arrow","label":"Arrow"},{"value":"line","label":"Solid line"},{"value":"dashed_line","label":"Dashed line"}]},
    ],
  },
  {
    id: "defaults_fixed", label: "Defaults for new PDFs and comics",
    settings: [
      {"key":"kopt_rotation_mode","label":"Rotation","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:45","options":[{"value":0,"label":"↑ 0°"},{"value":1,"label":"⤸ 90°"},{"value":2,"label":"↓ 180°"},{"value":3,"label":"⤹ 90°"}]},
      {"key":"kopt_trim_page","label":"Page Crop","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:99","options":[{"value":3,"label":"none"},{"value":1,"label":"auto"},{"value":2,"label":"semi-auto"},{"value":0,"label":"manual"}]},
      {"key":"kopt_page_margin","label":"Margin","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":0.1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:123","min":0,"max":1.5,"step":0.05},
      {"key":"kopt_auto_straighten","label":"Auto Straighten","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:140","options":[{"value":0,"label":"0°"},{"value":5,"label":"5°"},{"value":10,"label":"10°"},{"value":15,"label":"15°"},{"value":25,"label":"25°"}]},
      {"key":"kopt_zoom_overlap_h","label":"Horizontal overlap","path":"Reader (PDF/DjVu) → bottom menu","type":"int","absent":36,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:161","min":0,"max":84,"step":12,"unit":"%"},
      {"key":"kopt_zoom_overlap_v","label":"Vertical overlap","path":"Reader (PDF/DjVu) → bottom menu","type":"int","absent":36,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:182","min":0,"max":84,"step":12,"unit":"%"},
      {"key":"kopt_zoom_mode_type","label":"Fit","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:203","options":[{"value":2,"label":"full"},{"value":1,"label":"width"},{"value":0,"label":"height"}]},
      {"key":"kopt_zoom_factor","label":"Zoom factor","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":1.5,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:252","min":0.1,"max":20,"step":0.1},
      {"key":"kopt_zoom_mode_genus","label":"Zoom to","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":4,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:280","options":[{"value":4,"label":"page"},{"value":3,"label":"content"},{"value":2,"label":"columns"},{"value":1,"label":"rows"},{"value":0,"label":"manual"}]},
      {"key":"kopt_zoom_direction","label":"Direction","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":7,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:302","options":[{"value":7,"label":"Left to Right, Top to Bottom"},{"value":6,"label":"Top to Bottom, Left to Right"},{"value":5,"label":"Left to Right, Bottom to Top"},{"value":4,"label":"Bottom to Top, Left to Right"},{"value":3,"label":"Bottom to Top, Right to Left"},{"value":2,"label":"Right to Left, Bottom to Top"},{"value":1,"label":"Top to Bottom, Right to Left"},{"value":0,"label":"Right to Left, Top to Bottom"}]},
      {"key":"kopt_page_scroll","label":"View Mode","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:343","options":[{"value":0,"label":"page"},{"value":1,"label":"continuous"}]},
      {"key":"kopt_page_gap_height","label":"Page Gap","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":8,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:355","min":0,"max":256,"unit":"px"},
      {"key":"kopt_line_spacing","label":"Line Spacing (reflow)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1.2,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:377","options":[{"value":1,"label":"small"},{"value":1.2,"label":"medium"},{"value":1.4,"label":"large"}]},
      {"key":"kopt_justification","label":"Alignment (reflow)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":3,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:391","options":[{"value":-1,"label":"auto"},{"value":0,"label":"left"},{"value":1,"label":"center"},{"value":2,"label":"right"},{"value":3,"label":"justify"}]},
      {"key":"kopt_font_size","label":"Font Size (reflow)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:424","options":[{"value":0.2,"label":"0.2"},{"value":0.4,"label":"0.4"},{"value":0.5,"label":"0.5"},{"value":0.6,"label":"0.6"},{"value":0.7,"label":"0.7"},{"value":0.8,"label":"0.8"},{"value":0.9,"label":"0.9"},{"value":1,"label":"1.0"},{"value":1.1,"label":"1.1"},{"value":1.3,"label":"1.3"},{"value":1.6,"label":"1.6"},{"value":2,"label":"2.0"}]},
      {"key":"kopt_word_spacing","label":"Word Gap (reflow)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":-0.2,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:460","options":[{"value":0.05,"label":"small"},{"value":-0.2,"label":"auto"},{"value":0.375,"label":"large"}]},
      {"key":"kopt_text_wrap","label":"Reflow","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:472","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"kopt_contrast","label":"Contrast","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:489","min":0.8,"max":50,"step":0.1,"help":"Presets 0.8,1,1.5,2,4,6,10,50."},
      {"key":"kopt_white_threshold","label":"White Threshold","path":"Reader (PDF/DjVu) → bottom menu","type":"int","absent":255,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:534","min":0,"max":255},
      {"key":"kopt_page_opt","label":"Dewatermark","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:552","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"kopt_background_cleanup","label":"Background Cleanup","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:565","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"kopt_hw_dithering","label":"Dithering (HW)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:579","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}],"help":"Only when the device can HW-dither."},
      {"key":"kopt_sw_dithering","label":"Dithering (SW)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:592","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"kopt_quality","label":"Render Quality (reflow)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:605","options":[{"value":0.5,"label":"low"},{"value":1,"label":"default"},{"value":1.5,"label":"high"}]},
      {"key":"kopt_doc_language","label":"Document Language (OCR)","path":"Reader (PDF/DjVu) → bottom menu","type":"string","absent":null,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:623","maxLength":500,"help":"Default: eng. Tesseract language code."},
      {"key":"kopt_forced_ocr","label":"Forced OCR","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:637","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"kopt_writing_direction","label":"Writing Direction (reflow)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:648","options":[{"value":0,"label":"LTR"},{"value":1,"label":"RTL"},{"value":2,"label":"TBRTL"}]},
      {"key":"kopt_defect_size","label":"Reflow Speckle Ignore Size","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:667","options":[{"value":1,"label":"small"},{"value":3,"label":"medium"},{"value":5,"label":"large"}]},
      {"key":"kopt_detect_indent","label":"Indentation (reflow)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:681","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"kopt_nightmode_document","label":"Invert Document (night mode)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:693","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"kopt_max_columns","label":"Document Columns","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":2,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:703","options":[{"value":1,"label":"1"},{"value":2,"label":"2"},{"value":3,"label":"3"}]},
    ],
  },
  {
    id: "status_bar", label: "Bottom status bar",
    settings: [
      {"key":"footer.disabled","label":"Status bar completely disabled","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:475"},
      {"key":"footer.all_at_once","label":"Show all selected items at once","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1025"},
      {"key":"footer.reclaim_height","label":"Overlap status bar","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1026"},
      {"key":"footer.page_progress","label":"Item: Current page","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:480"},
      {"key":"footer.pages_left_book","label":"Item: Pages left in book","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:481"},
      {"key":"footer.time","label":"Item: Current time","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:482"},
      {"key":"footer.pages_left","label":"Item: Pages left in chapter","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:483"},
      {"key":"footer.battery","label":"Item: Battery percentage","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:484"},
      {"key":"footer.percentage","label":"Item: Progress percentage","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:486"},
      {"key":"footer.book_time_to_read","label":"Item: Time left to finish book","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:487"},
      {"key":"footer.chapter_time_to_read","label":"Item: Time left to finish chapter","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:488"},
      {"key":"footer.frontlight","label":"Item: Brightness level","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:489"},
      {"key":"footer.frontlight_warmth","label":"Item: Warmth level","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1041"},
      {"key":"footer.mem_usage","label":"Item: KOReader memory usage","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:490"},
      {"key":"footer.wifi_status","label":"Item: Wi-Fi status","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:491"},
      {"key":"footer.page_turning_inverted","label":"Item: Page turning inverted","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:492"},
      {"key":"footer.book_author","label":"Item: Book author","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:493"},
      {"key":"footer.book_title","label":"Item: Book title","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:494"},
      {"key":"footer.book_chapter","label":"Item: Chapter title","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:495"},
      {"key":"footer.bookmark_count","label":"Item: Bookmark count","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:496"},
      {"key":"footer.chapter_progress","label":"Item: Current page in chapter","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:497"},
      {"key":"footer.custom_text","label":"Item: Custom text","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1048"},
      {"key":"footer.disable_progress_bar","label":"Show progress bar (inverted)","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1167","help":"true hides the bar."},
      {"key":"footer.chapter_progress_bar","label":"Show chapter-progress bar instead","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:475"},
      {"key":"footer.progress_bar_position","label":"Progress bar position","path":"Reader → Settings → Status bar → Progress bar","type":"enum","absent":"alongside","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1833","options":[{"value":"above","label":"Above items"},{"value":"alongside","label":"Alongside items"},{"value":"below","label":"Below items"}]},
      {"key":"footer.progress_style_thin","label":"Progress bar style thin","path":"Reader → Settings → Status bar → Progress bar → Style","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1240"},
      {"key":"footer.progress_style_thin_height","label":"Thin bar height","path":"Reader → Settings → Status bar → Progress bar → Height","type":"int","absent":3,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1277","min":1,"max":12},
      {"key":"footer.progress_style_thick_height","label":"Thick bar height","path":"Reader → Settings → Status bar → Progress bar → Height","type":"int","absent":7,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1279","min":5,"max":28},
      {"key":"footer.progress_margin_width","label":"Progress bar margins","path":"Reader → Settings → Status bar → Progress bar → Margins","type":"int","absent":10,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1311","min":0,"max":140},
      {"key":"footer.progress_margin","label":"Progress bar margins same as book margins","path":"Reader → Settings → Status bar → Progress bar → Margins","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1321"},
      {"key":"footer.progress_bar_min_width_pct","label":"Minimum progress bar width","path":"Reader → Settings → Status bar → Progress bar","type":"int","absent":20,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1352","min":5,"max":90,"unit":"%"},
      {"key":"footer.initial_marker","label":"Show initial-position marker","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1386"},
      {"key":"footer.toc_markers","label":"Show chapter markers","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1401"},
      {"key":"footer.toc_markers_width","label":"Chapter marker width","path":"Reader → Settings → Status bar → Progress bar","type":"enum","absent":2,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1855","options":[{"value":1,"label":"Thin"},{"value":2,"label":"Medium"},{"value":3,"label":"Thick"}]},
      {"key":"footer.auto_refresh_time","label":"Auto refresh items","path":"Reader → Settings → Status bar → Configure items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1510"},
      {"key":"footer.hide_empty_generators","label":"Hide inactive items","path":"Reader → Settings → Status bar → Configure items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1524"},
      {"key":"footer.pages_left_includes_current_page","label":"Include current page in pages left","path":"Reader → Settings → Status bar → Configure items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1540"},
      {"key":"footer.progress_pct_format","label":"Progress percentage format","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"0","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1889","options":[{"value":"0","label":"No decimal places"},{"value":"1","label":"1 decimal place"},{"value":"2","label":"2 decimal places"}],"help":"String values."},
      {"key":"footer.text_font_size","label":"Item font size","path":"Reader → Settings → Status bar → Configure items → Item font","type":"int","absent":14,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1580","min":8,"max":36},
      {"key":"footer.text_font_face","label":"Item font","path":"Reader → Settings → Status bar → Configure items → Item font","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1603","maxLength":500,"help":"Default: ./fonts/noto/NotoSans-Regular.ttf. Font FILE path; reset to default if not registered."},
      {"key":"footer.text_font_bold","label":"Items in bold","path":"Reader → Settings → Status bar → Configure items → Item font","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1626"},
      {"key":"footer.item_prefix","label":"Item symbols","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"icons","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1917","options":[{"value":"icons","label":"Icons"},{"value":"letters","label":"Letters"},{"value":"compact_items","label":"Compact"}]},
      {"key":"footer.items_separator","label":"Item separator","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"bar","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1940","options":[{"value":"bar","label":"Vertical bar (|)"},{"value":"bullet","label":"Bullet (•)"},{"value":"dot","label":"Dot (·)"},{"value":"none","label":"No separator"}]},
      {"key":"footer.book_title_max_width_pct","label":"Book title max width","path":"Reader → Settings → Status bar → Configure items → Item max width","type":"int","absent":30,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:509","min":10,"max":100,"step":5,"unit":"%"},
      {"key":"footer.book_author_max_width_pct","label":"Book author max width","path":"Reader → Settings → Status bar → Configure items → Item max width","type":"int","absent":30,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:508","min":10,"max":100,"step":5,"unit":"%"},
      {"key":"footer.book_chapter_max_width_pct","label":"Chapter title max width","path":"Reader → Settings → Status bar → Configure items → Item max width","type":"int","absent":30,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:510","min":10,"max":100,"step":5,"unit":"%"},
      {"key":"footer.align","label":"Alignment","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"center","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1991","options":[{"value":"left","label":"Left"},{"value":"center","label":"Center"},{"value":"right","label":"Right"}],"help":"Forced to center when the progress bar is alongside."},
      {"key":"footer.container_height","label":"Items container height","path":"Reader → Settings → Status bar → Configure items → Height","type":"int","absent":7,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1691","min":7,"max":98,"help":"Default = DMINIBAR_CONTAINER_HEIGHT from defaults.lua."},
      {"key":"footer.container_bottom_padding","label":"Container bottom margin","path":"Reader → Settings → Status bar → Configure items → Bottom margin","type":"int","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1714","min":0,"max":49},
      {"key":"footer.battery_hide_threshold","label":"Hide battery item when higher than","path":"Reader → Settings → Status bar → Configure items","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1753","min":0,"max":100,"unit":"%","help":"max+1 (101) = never hide."},
      {"key":"footer.bottom_horizontal_separator","label":"Show status bar separator","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1784"},
      {"key":"footer.lock_tap","label":"Lock status bar","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1796"},
      {"key":"footer.skim_widget_on_hold","label":"Long-press on status bar to skim","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1805"},
      {"key":"reader_footer_mode","label":"Status bar current mode","path":"Reader → Settings → Status bar","type":"int","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:600","help":"Index of the item shown when 'all at once' is off (0 = off, 1 = page_progress …; see MODE table readerfooter.lua:35-59). Also changed by tapping the status bar."},
      {"key":"reader_footer_custom_text","label":"Custom text (long-press to edit)","path":"Reader → Settings → Status bar → Status bar items → Custom text","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:718","maxLength":500,"help":"Default: KOReader. Supports book-info %-tokens."},
      {"key":"reader_footer_custom_text_repetitions","label":"Custom text repetitions","path":"Reader → Settings → Status bar → Status bar items → Custom text","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:727","maxLength":500,"help":"Default: 1. Stored as a numeric string."},
      {"key":"duration_format","label":"Duration format","path":"Settings → Device → Time and date → Duration format","type":"enum","absent":"classic","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:113","options":[{"value":"classic","label":"Classic (1:23:45)"},{"value":"modern","label":"Modern (1h23'45\")"},{"value":"letters","label":"Letters (1h 23m 45s)"}]},
      {"key":"twelve_hour_clock","label":"12-hour clock","path":"Settings → Device → Time and date","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:83"},
    ],
  },
  {
    id: "alt_status_bar", label: "Top status bar (EPUB)",
    settings: [
      {"key":"cre_header_title","label":"Book title","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:28","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_author","label":"Book author","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:29","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_clock","label":"Current time","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:30","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_auto_refresh","label":"Auto refresh","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:31","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_page_number","label":"Current page","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:32","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_page_count","label":"Total pages","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:33","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_reading_percent","label":"Progress percentage","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":0,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:34","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_battery","label":"Battery icon","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:35","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_battery_percent","label":"Battery percentage","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":0,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:36","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_chapter_marks","label":"Chapter marks","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:37","options":[{"value":0,"label":"off"},{"value":1,"label":"on"}]},
      {"key":"cre_header_status_font_size","label":"Alt status bar font size","path":"Reader → Settings → Status bar → Alt status bar","type":"int","absent":20,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:529","min":8,"max":36,"help":"readSetting default 20; the spin's reset value is 14."},
    ],
  },
  {
    id: "highlights_bookmarks", label: "Highlights, bookmarks, ToC, page map",
    settings: [
      {"key":"highlight_drawing_style","label":"Default highlight style (★, long-press)","path":"Reader → Typeset tab (document icon) → Highlights","type":"enum","absent":"lighten","effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:442","options":[{"value":"lighten","label":"Lighten"},{"value":"underscore","label":"Underline"},{"value":"strikeout","label":"Strikethrough"},{"value":"invert","label":"Invert"}]},
      {"key":"highlight_color","label":"Default highlight color (★, long-press)","path":"Reader → Typeset tab (document icon) → Highlights","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:465","maxLength":500,"help":"Default: gray. Colour name (red, orange, yellow, green, olive, cyan, blue, purple, gray). On the B/W Clara the default is 'gray' and every colour renders as grey."},
      {"key":"highlight_lighten_factor","label":"Gray highlight opacity","path":"Reader → Typeset tab (document icon) → Highlights","type":"number","absent":0.2,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:489","min":0,"max":1,"step":0.1},
      {"key":"highlight_selection_invert_highlight_color","label":"Invert highlight color in night mode","path":"Reader → Typeset tab (document icon) → Highlights","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:506"},
      {"key":"highlight_selection_use_highlight_color","label":"Use highlight color for selection","path":"Reader → Typeset tab (document icon) → Highlights","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:519"},
      {"key":"highlight_selection_lighten_factor","label":"Gray selection opacity","path":"Reader → Typeset tab (document icon) → Highlights","type":"number","absent":0.2,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:541","min":0,"max":1,"step":0.1},
      {"key":"highlight_height_pct","label":"Highlight line height","path":"Reader → Typeset tab (document icon) → Highlights","type":"int","absent":100,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:570","min":0,"max":100,"unit":"%"},
      {"key":"highlight_note_marker","label":"Note marker","path":"Reader → Typeset tab (document icon) → Highlights","type":"enum","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:593","options":[{"value":"underline","label":"Underline"},{"value":"sideline","label":"Side line"},{"value":"sidemark","label":"Side mark"}]},
      {"key":"highlight_write_into_pdf_notify","label":"Show reminder on book opening","path":"Reader → Typeset tab (document icon) → Highlights → Write highlights into PDF","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:693"},
      {"key":"bookmarks_items_per_page","label":"Bookmarks per page","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"int","absent":14,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:169","min":6,"max":24,"help":"Initialised from items_per_page on first run (line 46-51)."},
      {"key":"bookmarks_items_font_size","label":"Bookmark font size","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"int","absent":"derived from per page","effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:194","min":10,"max":72},
      {"key":"bookmarks_items_max_lines","label":"Max lines per bookmark","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"int","absent":"disabled","effect":"next_book","source":"frontend/apps/reader/modules/readerbookmark.lua:137","min":1,"max":10,"help":"Delete key = disabled (fixed heights)."},
      {"key":"bookmarks_items_multilines_show_more_text","label":"Shrink bookmark font size to fit more text","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:209"},
      {"key":"bookmarks_items_text_type","label":"Show in items","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"enum","absent":"note","effect":"next_book","source":"frontend/apps/reader/modules/readerbookmark.lua:310","options":[{"value":"text","label":"highlighted text"},{"value":"all","label":"highlighted text and note"},{"value":"note","label":"note if set, otherwise highlighted text"}]},
      {"key":"bookmarks_items_show_separator","label":"Show separator between items","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:224"},
      {"key":"bookmarks_items_show_color","label":"Show highlight colors","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:226"},
      {"key":"bookmarks_items_show_color_default","label":"Also show default highlight color","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:237"},
      {"key":"bookmarks_items_sorting","label":"Sort by","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks → Sort by","type":"enum","absent":"page","effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:339","options":[{"value":"date","label":"date"}]},
      {"key":"bookmarks_items_reverse_sorting","label":"Reverse sorting","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks → Sort by","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:250"},
      {"key":"bookmark_prompt","label":"Prompt to add note to page bookmark","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:254"},
      {"key":"toc_items_per_page","label":"ToC entries per page","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"int","absent":14,"effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1422","min":6,"max":24},
      {"key":"toc_items_font_size","label":"ToC entry font size","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"int","absent":"derived","effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1447","min":10,"max":72},
      {"key":"toc_items_show_chapter_length","label":"Show chapter length","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1460"},
      {"key":"toc_items_with_dots","label":"Dot leaders","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1471"},
      {"key":"pagemap_chars_per_synthetic_page","label":"Characters per page (synthetic page numbers)","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"int","absent":"disabled","effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:603","min":500,"max":3000,"help":"Menu default when enabling: 1500. Delete = disabled."},
      {"key":"pagemap_synthetic_overrides","label":"Override publisher page numbers","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:624"},
      {"key":"pagemap_notify_document_provided","label":"Prompt when publisher page numbers available","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:633"},
      {"key":"pagemap_use_page_labels","label":"Use stable page numbers","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:643"},
      {"key":"pagemap_show_page_labels","label":"Show stable page numbers in margin","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:652"},
      {"key":"pagemap_label_font_size","label":"Page numbers font size","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"int","absent":14,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:670","min":8,"max":20},
      {"key":"book_map_alt_theme","label":"Book map / page browser alternative theme","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1368"},
      {"key":"book_map_tap_to_page_browser","label":"Book map: tap opens page browser","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1357"},
      {"key":"book_map_overview_tap_to_page_browser","label":"Book map overview: tap opens page browser","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1355"},
      {"key":"book_map_ten_pages_markers","label":"Book map: 10-page markers","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"int","absent":0,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1468"},
      {"key":"page_browser_nb_rows","label":"Page browser rows","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"int","absent":"automatic","effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:1265"},
      {"key":"page_browser_nb_cols","label":"Page browser columns","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"int","absent":"automatic","effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:1266"},
      {"key":"page_browser_thumbnails_pagenums","label":"Page browser page numbers","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"int","absent":2,"effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:1267"},
      {"key":"page_browser_preload_thumbnails","label":"Preload next/prev pages thumbnails","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:998"},
    ],
  },
  {
    id: "lookup", label: "Dictionary, Wikipedia, translation, fulltext search",
    settings: [
      {"key":"disable_fuzzy_search","label":"Enable fuzzy search (inverted)","path":"Search tab (🔍) → Settings → Dictionary settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdictionary.lua:1964","help":"true = fuzzy search OFF."},
      {"key":"disable_lookup_history","label":"Enable dictionary lookup history (inverted)","path":"Search tab (🔍) → Settings → Dictionary settings → Dictionary lookup history","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdictionary.lua:367"},
      {"key":"dict_largewindow","label":"Large window","path":"Search tab (🔍) → Settings → Dictionary settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerdictionary.lua:397"},
      {"key":"dict_justify","label":"Justify text","path":"Search tab (🔍) → Settings → Dictionary settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerdictionary.lua:406"},
      {"key":"dict_font_size","label":"Font size","path":"Search tab (🔍) → Settings → Dictionary settings","type":"int","absent":20,"effect":"immediate","source":"frontend/apps/reader/modules/readerdictionary.lua:424","min":8,"max":32},
      {"key":"wikipedia_use_keyboard_language","label":"Use keyboard language","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:218"},
      {"key":"wikipedia_save_dir","label":"Set Wikipedia 'Save as EPUB' folder","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:235","maxLength":500,"help":"Default: home/Wikipedia."},
      {"key":"wikipedia_save_in_book_dir","label":"Save Wikipedia EPUB in current book folder","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:249"},
      {"key":"wikipedia_epub_include_images","label":"Include images in EPUB","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"enum","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:263","options":[{"value":true,"label":"Include images"},{"value":false,"label":"Don't include images"}]},
      {"key":"wikipedia_epub_highres_images","label":"Images quality in EPUB","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"enum","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:282","options":[{"value":false,"label":"Standard quality"},{"value":true,"label":"Higher quality"}]},
      {"key":"wikipedia_disable_history","label":"Enable Wikipedia history (inverted)","path":"Search tab (🔍) → Settings → Wikipedia settings → Wikipedia lookup history","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerwikipedia.lua:301"},
      {"key":"wikipedia_show_image","label":"Show image in search results","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:331"},
      {"key":"wikipedia_show_more_images","label":"Show more images in full article","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:343"},
      {"key":"translator_from_doc_lang","label":"Translate from book language","path":"Reader → long-press text → Translate → Translation settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/translator.lua:385"},
      {"key":"translator_from_auto_detect","label":"Auto-detect source language","path":"Reader → long-press text → Translate → Translation settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/translator.lua:399"},
      {"key":"translator_with_romanizations","label":"Show romanizations","path":"Reader → long-press text → Translate → Translation settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/translator.lua:409"},
      {"key":"translator_from_language","label":"Translate from","path":"Reader → long-press text → Translate → Translation settings","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/translator.lua:472","maxLength":500,"help":"Google Translate language code, used only when auto-detect is off."},
      {"key":"translator_to_language","label":"Translate to","path":"Reader → long-press text → Translate → Translation settings","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/translator.lua:478","maxLength":500,"help":"Default: UI language. Language code; falls back to 'language'."},
      {"key":"fulltext_search_find_all","label":"Show all results on text selection","path":"Search tab (🔍) → Fulltext search settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readersearch.lua:132"},
      {"key":"fulltext_search_nb_context_words","label":"Words in context","path":"Search tab (🔍) → Fulltext search settings","type":"int","absent":5,"effect":"next_book","source":"frontend/apps/reader/modules/readersearch.lua:151","min":1,"max":50},
      {"key":"fulltext_search_results_max_lines","label":"Max lines per result","path":"Search tab (🔍) → Fulltext search settings","type":"int","absent":"disabled","effect":"next_book","source":"frontend/apps/reader/modules/readersearch.lua:174","min":1,"max":10},
      {"key":"fulltext_search_results_per_page","label":"Results per page","path":"Search tab (🔍) → Fulltext search settings","type":"int","absent":10,"effect":"next_book","source":"frontend/apps/reader/modules/readersearch.lua:208","min":2,"max":24},
      {"key":"fulltext_search_zoom_to_page","label":"Zoom fixed layout documents to full page","path":"Search tab (🔍) → Fulltext search settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readersearch.lua:223"},
      {"key":"language_japanese_text_scan_length","label":"Japanese: text scan length","path":"Search tab (🔍) → Japanese support","type":"int","absent":"plugin default","effect":"next_book","source":"plugins/japanese.koplugin/main.lua:230","min":0,"max":1000},
    ],
  },
  {
    id: "language_ui", label: "Language, keyboard and UI",
    settings: [
      {"key":"dimension_units","label":"Dimension units","path":"Settings → Device → Dimension units","type":"enum","absent":"mm","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:835","options":[{"value":"mm","label":"Metric system"},{"value":"in","label":"Imperial system"},{"value":"px","label":"Pixels"}]},
      {"key":"dimension_units_append_px","label":"Also show values in pixels","path":"Settings → Device → Dimension units","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:831"},
      {"key":"keyboard_layout_default","label":"Default keyboard layout (★)","path":"Settings → Device → Keyboard → Keyboard layouts (long-press)","type":"string","absent":null,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:80","maxLength":500},
      {"key":"keyboard_remember_layout","label":"Remember last layout","path":"Settings → Device → Keyboard","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:156"},
      {"key":"keyboard_swipes_enabled","label":"Swipe to input additional characters","path":"Settings → Device → Keyboard","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:263"},
      {"key":"keyboard_key_font_size","label":"Keyboard key font size","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"int","absent":22,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:191"},
      {"key":"keyboard_key_bold","label":"Keys in bold","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:192"},
      {"key":"keyboard_key_border","label":"Keys with border","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:193"},
      {"key":"keyboard_key_compact","label":"Compact keys","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:194"},
      {"key":"mass_storage_confirmation_disabled","label":"USB mass storage: disable confirmation popup","path":"Settings → Device → USB mass storage","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/mass_storage.lua:26","help":"Inverted helper (requireConfirmation)."},
    ],
  },
  {
    id: "plugin_tables", label: "Plugins: statistics, read timer, vocabulary",
    settings: [
      {"key":"statistics.min_sec","label":"Read page duration limits: min","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":5,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1097","min":0,"max":120,"unit":"seconds"},
      {"key":"statistics.max_sec","label":"Read page duration limits: max","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":120,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1098","min":10,"max":7200,"unit":"seconds"},
      {"key":"statistics.freeze_finished_books","label":"Freeze statistics of finished books","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1110"},
      {"key":"statistics.calendar_start_day_of_week","label":"Calendar: start of week","path":"Tools tab (🔧) → Reading statistics → Settings","type":"enum","absent":2,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1124","options":[{"value":6,"label":"Friday"},{"value":7,"label":"Saturday"},{"value":1,"label":"Sunday"},{"value":2,"label":"Monday"}]},
      {"key":"statistics.calendar_nb_book_spans","label":"Books per calendar day","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":3,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1163","min":1,"max":5},
      {"key":"statistics.calendar_show_histogram","label":"Show hourly histogram in calendar days","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1174"},
      {"key":"statistics.calendar_browse_future_months","label":"Allow browsing coming months","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1181"},
      {"key":"statistics.calendar_day_start_hour","label":"Daily timeline starts at (hour)","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":0,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1210","min":0,"max":23},
      {"key":"statistics.calendar_day_start_minute","label":"Daily timeline starts at (minute)","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":0,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1211","min":0,"max":59},
      {"key":"statistics.calendar_use_day_time_shift","label":"Also use in calendar view","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1223"},
      {"key":"readtimer.show_on_expiry","label":"Show on timer expiry","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"enum","absent":null,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:403","options":[{"value":"notification","label":"notification"},{"value":"nothing","label":"nothing"}]},
      {"key":"readtimer.snooze_minutes","label":"Snooze time","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"int","absent":5,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:375","min":1,"max":60,"unit":"minutes"},
      {"key":"readtimer.auto_reschedule_interval","label":"Auto-reschedule","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"bool","absent":false,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:276"},
      {"key":"readtimer.show_value_in_header","label":"Show timer in alt status bar","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"bool","absent":false,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:285"},
      {"key":"readtimer.show_value_in_footer","label":"Show timer in status bar","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"bool","absent":false,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:298"},
      {"key":"readtimer.expiry_message_text","label":"Expiry message text","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"string","absent":null,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:420","maxLength":500,"help":"Default: Time is up."},
      {"key":"vocabulary_builder.enabled","label":"Vocabulary builder: save looked-up words","path":"Search tab (🔍) → Vocabulary builder → settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/vocabbuilder.koplugin/main.lua:463"},
      {"key":"vocabulary_builder.with_context","label":"Vocabulary builder: save context","path":"Search tab (🔍) → Vocabulary builder → settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/vocabbuilder.koplugin/main.lua:459"},
      {"key":"cover_image_enabled","label":"Cover image: Save cover image","path":"Settings → Screen → Cover image","type":"bool","absent":false,"effect":"next_book","source":"plugins/coverimage.koplugin/main.lua:782","help":"Writes the book cover to a file (cover_image_path) for an OS sleep screen; Nickel does not use it on Kobo, so of little value here."},
      {"key":"calibre_wireless","label":"Calibre: Enable wireless client","path":"Tools tab (🔧) → Calibre → Wireless settings","type":"bool","absent":true,"effect":"restart","source":"plugins/calibre.koplugin/main.lua:264"},
      {"key":"calibre_search_from_reader","label":"Calibre: enable searches in the reader","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"restart","source":"plugins/calibre.koplugin/main.lua:174"},
      {"key":"calibre_search_case_insensitive","label":"Calibre: case sensitive search (inverted)","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:195"},
      {"key":"calibre_search_find_by_title","label":"Calibre: search by title","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:204"},
      {"key":"calibre_search_find_by_authors","label":"Calibre: search by authors","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:213"},
      {"key":"calibre_search_find_by_series","label":"Calibre: search by series","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:222"},
      {"key":"calibre_search_find_by_tag","label":"Calibre: search by tag","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:231"},
      {"key":"calibre_search_find_by_path","label":"Calibre: search by path","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:240"},
      {"key":"calibre_search_cache_metadata","label":"Calibre: store metadata in cache","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:186"},
      {"key":"terminal_font_size","label":"Terminal: font size","path":"Tools tab (🔧) → More tools → Terminal emulator","type":"int","absent":14,"effect":"next_book","source":"plugins/terminal.koplugin/main.lua:594","min":8,"max":30},
      {"key":"terminal_buffer_size","label":"Terminal: buffer size","path":"Tools tab (🔧) → More tools → Terminal emulator","type":"int","absent":16,"effect":"next_book","source":"plugins/terminal.koplugin/main.lua:618","min":10,"max":30,"unit":"kB"},
    ],
  },
  {
    id: "hidden_tunables", label: "Advanced",
    settings: [
      {"key":"screensaver_max_files","label":"Max images scanned for random/cycled sleep screen","path":"(no menu)","type":"int","absent":256,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:93"},
      {"key":"followed_link_marker","label":"Followed-link marker","path":"(no menu)","type":"number","absent":1,"effect":"immediate","source":"frontend/apps/reader/modules/readerrolling.lua:794","help":"false = none, true = shown and kept, n = removed after n seconds."},
      {"key":"history_size","label":"History size","path":"(no menu)","type":"int","absent":500,"effect":"restart","source":"frontend/readhistory.lua:82"},
      {"key":"page_gap_color","label":"Page gap colour (continuous PDF)","path":"(no menu)","type":"int","absent":8,"effect":"next_book","source":"frontend/apps/reader/modules/readerview.lua:107","min":0,"max":15,"unit":"grey level /15"},
      {"key":"legacy_image_scaling","label":"Legacy image scaling","path":"(no menu)","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/renderimage.lua:317"},
      {"key":"cre_disk_cache_max_size","label":"crengine disk cache max size","path":"(no menu)","type":"int","absent":"default","effect":"restart","source":"frontend/document/credocument.lua:97","unit":"MB"},
    ],
  },
]

// ── koboSettings.ts ──
// KOReader settings and menu order chosen in the app — pure and import-free
// apart from the catalogue, GENERATED into supabase/functions/kobo-sync by
// scripts/sync-kobo-shared.mjs and verified by scripts/verify-kobo-settings.cjs.
//
// The app stores only what the owner changed (kobo_device_config.settings:
// { key: value }, or { key: null } for "back to KOReader's default"). The
// server sends a key only when the catalogue lists it and the value has the
// catalogue's type; the plugin checks the same again before it writes
// G_reader_settings. So a typo or an old key can never reach the device.



type SettingValue = boolean | number | string | null

/** Every catalogue entry by key. */
function settingIndex(): Map<string, SettingDef> {
  const m = new Map<string, SettingDef>()
  for (const g of SETTING_GROUPS) for (const s of g.settings) m.set(s.key, s)
  return m
}

/** The value if the definition accepts it (null = reset to default), else undefined. */
function cleanValue(def: SettingDef, v: unknown): SettingValue | undefined {
  if (v === null) return null
  if (def.type === 'bool') return typeof v === 'boolean' ? v : undefined
  if (def.type === 'enum') return (def.options ?? []).some(o => o.value === v) ? v as string | number : undefined
  if (def.type === 'int' || def.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
    if (def.type === 'int' && !Number.isInteger(v)) return undefined
    if (def.min !== undefined && v < def.min) return undefined
    if (def.max !== undefined && v > def.max) return undefined
    return v
  }
  if (def.type === 'string') {
    if (typeof v !== 'string') return undefined
    return v.length <= (def.maxLength ?? 500) ? v : undefined
  }
  return undefined
}

/** Keeps only catalogue keys with valid values; reports the rest. */
function cleanSettings(raw: unknown): { settings: Record<string, SettingValue>; refused: string[] } {
  const settings: Record<string, SettingValue> = {}
  const refused: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings, refused }
  const index = settingIndex()
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = index.get(k)
    const clean = def && !def.managed ? cleanValue(def, v) : undefined
    if (clean === undefined) refused.push(k)
    else settings[k] = clean
  }
  return { settings, refused }
}

// ── Menu order ───────────────────────────────────────────────────────────────
// KOReader builds each menu from an order table: list id → item ids (a list
// id that is also an item is a submenu; "----------------------------" is a
// separator). A user file settings/<side>_menu_order.lua overrides whole lists.
// The app stores only the lists the owner changed, per side.

const MENU_SIDES = ['filemanager', 'reader'] as const
type MenuSide = typeof MENU_SIDES[number]
const MENU_SEPARATOR = '----------------------------'
const MENU_ID = /^[A-Za-z0-9_:.-]{1,80}$/

type MenuOrder = Partial<Record<MenuSide, Record<string, string[]>>>

/** Valid ids only, no duplicates within a list, at most 200 items a list and 80 lists a side. */
function cleanMenuOrder(raw: unknown): MenuOrder {
  const out: MenuOrder = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const side of MENU_SIDES) {
    const lists = (raw as Record<string, unknown>)[side]
    if (!lists || typeof lists !== 'object' || Array.isArray(lists)) continue
    const clean: Record<string, string[]> = {}
    for (const [id, items] of Object.entries(lists as Record<string, unknown>).slice(0, 80)) {
      if (!MENU_ID.test(id) || !Array.isArray(items)) continue
      const seen = new Set<string>()
      const list: string[] = []
      for (const it of items.slice(0, 200)) {
        if (typeof it !== 'string') continue
        if (it === MENU_SEPARATOR) { if (list[list.length - 1] !== MENU_SEPARATOR) list.push(it); continue }
        if (!MENU_ID.test(it) || seen.has(it)) continue
        seen.add(it)
        list.push(it)
      }
      clean[id] = list
    }
    if (Object.keys(clean).length) out[side] = clean
  }
  return out
}

interface MenuReport {
  /** The order KOReader uses now: list id → item ids (defaults merged with the user file). */
  order: Record<string, string[]>
  /** Item id → the text the menu shows. */
  labels: Record<string, string>
}

/** The ids of a side's tab bar, in order. */
function menuTabs(report: MenuReport): string[] {
  return report.order['KOMenu:menu_buttons'] ?? []
}

/**
 * Moves an item to another list (or another place in the same list) and
 * returns the lists that changed, so the caller stores whole lists — KOReader
 * replaces a list wholesale when the user file names it.
 */
function moveMenuItem(order: Record<string, string[]>, item: string, toList: string, toIndex: number): Record<string, string[]> {
  const changed: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(order)) {
    if (list.includes(item) && id !== toList) changed[id] = list.filter(x => x !== item)
  }
  const target = (order[toList] ?? []).filter(x => x !== item)
  const at = Math.max(0, Math.min(toIndex, target.length))
  target.splice(at, 0, item)
  changed[toList] = target
  return changed
}

/** True when an item id is a submenu (it has its own list). */
function isSubmenu(order: Record<string, string[]>, id: string): boolean {
  return Array.isArray(order[id]) && id !== 'KOMenu:menu_buttons'
}

// ── koboDevice.ts ──
// What the Kobo sends besides reading rows — captures and passage questions.
// Pure and import-free, GENERATED into supabase/functions/kobo-sync by
// scripts/sync-kobo-shared.mjs and verified by scripts/verify-kobo-settings.cjs.

// ── Capture: a note typed on the Kobo becomes a task, a wish or a book ──────

type CaptureKind = 'task' | 'wish' | 'book'
interface Capture { id: string; kind: CaptureKind; text: string; note: string | null; book: string | null }

const CAPTURE_ID = /^[A-Za-z0-9-]{8,64}$/

/** The usable captures of a request (at most 50), each trimmed and capped. */
function cleanCaptures(raw: unknown): Capture[] {
  if (!Array.isArray(raw)) return []
  const out: Capture[] = []
  const seen = new Set<string>()
  for (const r of raw.slice(0, 50)) {
    const x = r as Record<string, unknown>
    if (!x || typeof x.id !== 'string' || !CAPTURE_ID.test(x.id) || seen.has(x.id)) continue
    if (x.kind !== 'task' && x.kind !== 'wish' && x.kind !== 'book') continue
    const text = typeof x.text === 'string' ? x.text.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
    if (!text) continue
    const note = typeof x.note === 'string' && x.note.trim() ? x.note.trim().slice(0, 2000) : null
    const book = typeof x.book === 'string' && x.book.trim() ? x.book.trim().slice(0, 200) : null
    seen.add(x.id)
    out.push({ id: x.id, kind: x.kind, text, note, book })
  }
  return out
}

/** The note a captured row carries: the passage (if any) and where it came from. */
function captureNote(c: Capture): string {
  const from = c.book ? `Captured on the Kobo while reading “${c.book}”.` : 'Captured on the Kobo.'
  return c.note ? `“${c.note}”\n\n${from}` : from
}

/** "Title — Author" or "Title by Author" typed for a book capture → title and author. */
function splitBookCapture(text: string): { title: string; author: string | null } {
  const m = text.match(/^(.+?)\s+(?:—|–|-|by)\s+(.+)$/i)
  if (m && m[1].trim() && m[2].trim()) return { title: m[1].trim(), author: m[2].trim() }
  return { title: text.trim(), author: null }
}

// ── Ask about a passage ─────────────────────────────────────────────────────

type AskKind = 'explain' | 'translate' | 'word' | 'character' | 'free'
const ASK_KINDS: AskKind[] = ['explain', 'translate', 'word', 'character', 'free']

interface AskInput {
  ask: AskKind
  selection: string
  before: string
  after: string
  question: string | null
  title: string | null
  author: string | null
  language: string | null
  percent: number | null
  answer_language: string
}

const LANGUAGES = ['English', 'Turkish', 'Norwegian']

/** The question as the server accepts it, or an error message. */
function cleanAsk(raw: unknown): AskInput | string {
  const x = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const ask = ASK_KINDS.includes(x.ask as AskKind) ? x.ask as AskKind : null
  if (!ask) return 'Unknown question type.'
  const selection = s(x.selection, 1500)
  if (!selection) return 'Select some text first.'
  const question = s(x.question, 500) || null
  if (ask === 'free' && !question) return 'Type a question.'
  const pct = typeof x.percent === 'number' && Number.isFinite(x.percent) ? Math.min(100, Math.max(0, x.percent)) : null
  const lang = LANGUAGES.includes(x.answer_language as string) ? x.answer_language as string : 'English'
  return {
    ask, selection, question,
    before: s(x.before, 600), after: s(x.after, 600),
    title: s(x.title, 200) || null, author: s(x.author, 200) || null, language: s(x.language, 20) || null,
    percent: pct, answer_language: lang,
  }
}

const TASK: Record<AskKind, string> = {
  explain: 'Explain what the selected passage means in plain words: what happens, what is implied, any idiom or reference.',
  translate: 'Translate the selected passage. Keep the tone. Add one short line on any phrase that does not translate literally.',
  word: 'Explain the selected word or phrase as used here: meaning in this context, base form, and one short example.',
  character: 'Say who or what the selected name is, using only what the book has shown so far.',
  free: 'Answer the reader’s question about the selected passage.',
}

/** The system instruction and the user turn for Gemini. Stable wording keeps answers consistent. */
function buildAskPrompt(a: AskInput): { system: string; user: string } {
  const where = a.percent !== null ? `The reader is ${Math.round(a.percent)}% through the book.` : ''
  const system = [
    'You help someone reading a book on an e-reader. Answers appear on a small e-ink screen.',
    `Answer in ${a.answer_language}. Be brief: at most 120 words, plain text, no markdown, no lists unless needed.`,
    'Never reveal anything that happens later in the book than where the reader is. If you are not sure whether something is a spoiler, leave it out.',
    'If the passage alone is not enough to answer, say so in one sentence.',
  ].join(' ')
  const book = [a.title && `Book: ${a.title}`, a.author && `Author: ${a.author}`, a.language && `Book language: ${a.language}`, where].filter(Boolean).join('\n')
  const user = [
    book,
    `Task: ${TASK[a.ask]}`,
    a.question ? `Reader’s question: ${a.question}` : '',
    `Text before: …${a.before}`,
    `Selected: «${a.selection}»`,
    `Text after: ${a.after}…`,
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

/** Gemini's text, trimmed to what an e-ink box shows well. */
function cleanAnswer(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
  return t ? t.slice(0, 2500) : null
}

// ── Device facts sent with a sync ───────────────────────────────────────────

function cleanDeviceFacts(raw: Record<string, unknown>): { battery?: number; charging?: boolean; koreader_version?: string } {
  const out: { battery?: number; charging?: boolean; koreader_version?: string } = {}
  if (typeof raw.battery === 'number' && Number.isFinite(raw.battery) && raw.battery >= 0 && raw.battery <= 100) out.battery = Math.round(raw.battery)
  if (typeof raw.charging === 'boolean') out.charging = raw.charging
  if (typeof raw.koreader_version === 'string' && raw.koreader_version.trim()) out.koreader_version = raw.koreader_version.trim().slice(0, 40)
  return out
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

const BOOK_COLUMNS = 'id, koreader_md5, title, author, series, series_index, language, isbn, publisher, description, page_count, file_path, kobo_content_id, read_status, rating, started_at, finished_at, progress_pct, last_read_at, read_seconds, read_pages, device_status, device_rating, on_device, kind'

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

  if (body.inventory_md5s) {
    const present = new Set(body.inventory_md5s)
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
    ...cleanDeviceFacts(body as unknown as Record<string, unknown>),
    last_sync_at: nowIso,
    device_id: body.device_id.slice(0, 100),
    plugin_version: typeof body.plugin_version === 'string' ? body.plugin_version.slice(0, 40) : null,
    last_sync_result: result,
    ...(body.final ? { last_seen_at: lastSeenIso(body.device_time, nowSec) } : {}),
  })
  const extras = body.final ? await deviceExtras(db, userId, body) : {}
  // The rev the device has applied arrives with every sync, so the app's
  // "waiting for the Kobo" clears even if an /applied call was lost.
  if (body.final && typeof body.config_rev === 'number' && Number.isInteger(body.config_rev)) {
    const { data: st } = await db.from('kobo_device_state').select('applied_rev').eq('user_id', userId).maybeSingle()
    if (st?.applied_rev !== body.config_rev) {
      await db.from('kobo_device_state').upsert({ user_id: userId, applied_rev: body.config_rev, applied_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    }
  }
  return { ok: true, ...result, unmatched, server_time: nowSec, ...extras }
}

// ── What the Kobo should do next (sent with the last request of a sync) ─────
// Statuses/ratings changed in the app, books whose cover the app is missing,
// and the settings/menu/sleep images when the app's revision is newer than the
// one the device applied. Any failure here only skips the extras: the reading
// rows above are already stored.
async function deviceExtras(db: Db, userId: string, body: SyncBody) {
  const out: Record<string, unknown> = {}
  try {
    const { data } = await db.from('reading_settings').select('daily_minutes_goal, streak_min_minutes').eq('user_id', userId).maybeSingle()
    out.reading = { goal_minutes: data?.daily_minutes_goal ?? 20, min_minutes: data?.streak_min_minutes ?? 1 }
  } catch (e) { console.error('kobo-sync extras reading', errText(e)) }
  // Inside a book the plugin applies nothing: no statuses, covers or settings (and no signed links).
  if (body.apply === false) return out
  out.report_keys = [...settingIndex().keys()]
  try {
    const rows: PushSource[] = []
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await db.from('books')
        .select('koreader_md5, file_path, on_device, kind, read_status, rating, device_status, device_rating')
        .eq('user_id', userId).eq('on_device', true).not('koreader_md5', 'is', null).range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    out.push = rows.map(pushFor).filter(Boolean).slice(0, 200)
  } catch (e) { console.error('kobo-sync extras push', errText(e)) }

  try {
    const { data: used } = await db.rpc('kobo_bucket_usage', { p_bucket: COVER_BUCKET })
    if (typeof used === 'number' && used < COVER_BUDGET_BYTES - COVER_MAX_BYTES) {
      const stale = new Date(Date.now() - 30 * 86400 * 1000).toISOString()
      const { data, error } = await db.from('books').select('koreader_md5')
        .eq('user_id', userId).eq('on_device', true).eq('kind', 'book').is('cover_url', null).not('koreader_md5', 'is', null)
        .or(`device_cover_at.is.null,device_cover_at.lt.${stale}`).limit(15)
      if (error) throw error
      out.needs_cover = (data ?? []).map((r: { koreader_md5: string }) => r.koreader_md5)
    }
  } catch (e) { console.error('kobo-sync extras covers', errText(e)) }

  try {
    const { data: cfg, error } = await db.from('kobo_device_config').select('settings, menu_order, sleep_image_id, rev').eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (cfg && cfg.rev !== body.config_rev) {
      const { data: imgs, error: e2 } = await db.from('kobo_sleep_images').select('id, storage_path, mime, size_bytes').eq('user_id', userId).order('created_at')
      if (e2) throw e2
      const images = []
      for (const img of imgs ?? []) {
        const { data: signed } = await db.storage.from(SLEEP_BUCKET).createSignedUrl(img.storage_path, 900)
        if (signed?.signedUrl) images.push({ id: img.id, ext: img.mime === 'image/png' ? 'png' : 'jpg', size: img.size_bytes, url: signed.signedUrl })
      }
      out.config = {
        rev: cfg.rev,
        settings: cleanSettings(cfg.settings).settings,
        menu_order: cleanMenuOrder(cfg.menu_order),
        sleep: { images, selected: cfg.sleep_image_id ?? null },
      }
    }
  } catch (e) { console.error('kobo-sync extras config', errText(e)) }
  return out
}

const errText = (e: unknown) => e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)

// ── The plugin confirms what it wrote ───────────────────────────────────────
interface AppliedBody {
  pushes?: { md5?: unknown; status?: unknown; rating?: unknown }[]
  config_rev?: unknown
  config_result?: { applied?: unknown; refused?: unknown; note?: unknown }
  report?: unknown
}

async function handleApplied(db: Db, userId: string, body: AppliedBody) {
  let books = 0
  for (const p of (Array.isArray(body.pushes) ? body.pushes : []).slice(0, 500)) {
    if (typeof p?.md5 !== 'string' || !MD5.test(p.md5)) continue
    const patch = appliedPatch({ status: typeof p.status === 'string' ? p.status : undefined, rating: typeof p.rating === 'number' ? p.rating : undefined })
    if (!Object.keys(patch).length) continue
    const { data, error } = await db.from('books').update(patch).eq('user_id', userId).eq('koreader_md5', p.md5).select('id')
    if (error) throw error
    books += data?.length ?? 0
  }
  const now = new Date().toISOString()
  const state: Record<string, unknown> = { user_id: userId, updated_at: now }
  if (typeof body.config_rev === 'number' && Number.isInteger(body.config_rev)) {
    state.applied_rev = body.config_rev
    state.applied_at = now
    state.apply_result = sizeCapped(body.config_result ?? {}, 20000)
  }
  if (body.report && typeof body.report === 'object') {
    // Each side (file browser, reader) reports its own menus: merge, never drop the other.
    const { data: prev } = await db.from('kobo_device_state').select('report').eq('user_id', userId).maybeSingle()
    const merged = { ...(prev?.report ?? {}), ...(body.report as Record<string, unknown>) }
    const prevMenus = (prev?.report as { menus?: Record<string, unknown> } | null)?.menus ?? {}
    const nextMenus = (body.report as { menus?: Record<string, unknown> }).menus
    if (nextMenus) merged.menus = { ...prevMenus, ...nextMenus }
    state.report = sizeCapped(merged, 400000)
    state.reported_at = now
  }
  const { error } = await db.from('kobo_device_state').upsert(state, { onConflict: 'user_id' })
  if (error) throw error
  return { ok: true, books }
}

/** A JSON value, or a note that it was too big (never store megabytes from a device). */
function sizeCapped(v: unknown, max: number): unknown {
  const text = JSON.stringify(v ?? null)
  return text.length <= max ? v : { truncated: true, bytes: text.length }
}

// ── Notes captured on the Kobo ──────────────────────────────────────────────
// The capture row is claimed first (its id is the device's own), so a retried
// send finds it and makes nothing twice.
async function handleCapture(db: Db, userId: string, raw: unknown) {
  const done: string[] = []
  const failed: string[] = []
  for (const c of cleanCaptures(raw)) {
    const { data: claimed, error: claimError } = await db.from('kobo_captures')
      .upsert({ id: c.id, user_id: userId, kind: c.kind }, { onConflict: 'id', ignoreDuplicates: true }).select('id')
    if (claimError) { failed.push(c.id); continue }
    if (!claimed?.length) {
      // Seen before: done if its row was made, otherwise make it now.
      const { data: prev } = await db.from('kobo_captures').select('target_id').eq('id', c.id).eq('user_id', userId).maybeSingle()
      if (prev?.target_id) { done.push(c.id); continue }
    }
    let target: { data: { id: string } | null; error: unknown }
    const note = captureNote(c)
    if (c.kind === 'task') {
      target = await db.from('tasks').insert({ user_id: userId, title: c.text, description: note, section: 'inbox', domain: 'personal', source_type: 'manual' }).select('id').single()
    } else if (c.kind === 'wish') {
      target = await db.from('wish_items').insert({ user_id: userId, title: c.text, notes: note }).select('id').single()
    } else {
      const { title, author } = splitBookCapture(c.text)
      target = await db.from('books').insert({ user_id: userId, title, author, read_status: 'want', source: 'manual', on_device: false, notes: note }).select('id').single()
    }
    if (target.error || !target.data) { console.error('kobo-sync capture', errText(target.error)); failed.push(c.id); continue }
    // The row exists now: done either way. A failed link is only logged — reporting
    // it as failed would make the Kobo send it again and create a second one.
    const { error: linkError } = await db.from('kobo_captures').update({ target_id: target.data.id }).eq('id', c.id).eq('user_id', userId)
    if (linkError) console.error('kobo-sync capture link', errText(linkError))
    done.push(c.id)
  }
  return { ok: true, done, failed }
}

// ── A question about a passage (the Gemini key stays here) ──────────────────
const ASK_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash'] as const
/** A leaked device secret can cost at most this many answers a day. */
const ASK_DAILY_CAP = 100
/** Thinking stays minimal so it never eats the answer's token budget (the ai-proxy rule: 3.x takes a level, 2.5 a budget). */
const thinkingFor = (model: string) => model.startsWith('gemini-3') ? { thinking_config: { thinking_level: 'MINIMAL' } } : { thinkingConfig: { thinkingBudget: 0 } }

async function handleAsk(db: Db, userId: string, raw: unknown) {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set.' }, 503)
  const input = cleanAsk(raw)
  if (typeof input === 'string') return json({ error: 'invalid', message: input }, 400)
  const dayStart = new Date(Date.now() - 86400 * 1000).toISOString()
  const { count } = await db.from('book_ai_notes').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', dayStart)
  if ((count ?? 0) >= ASK_DAILY_CAP) return json({ error: 'rate_limited', message: `That is ${ASK_DAILY_CAP} questions in a day — try again tomorrow.` }, 429)
  const { system, user } = buildAskPrompt(input)
  const deadline = Date.now() + 20000
  let answer: string | null = null
  let model: string | null = null
  for (const m of ASK_MODELS) {
    const left = deadline - Date.now()
    if (left < 2000) break
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), left)
    try {
      // The key goes in a header, never the URL (a fetch error message carries the URL into the logs).
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 800, temperature: 0.3, ...thinkingFor(m) },
        }),
      })
      if (r.ok) {
        const j = await r.json()
        answer = cleanAnswer(j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join(''))
        if (answer) { model = m; break }
      } else if (r.status === 429) {
        return json({ error: 'rate_limited', message: 'The AI is busy — try again in a minute.' }, 429)
      }
    } catch (e) {
      console.error('kobo-sync ask', m, errText(e))
    } finally { clearTimeout(timer) }
  }
  if (!answer) return json({ error: 'no_answer', message: 'No answer this time — try again.' }, 502)
  const md5 = (raw as { md5?: unknown })?.md5
  let bookId: string | null = null
  if (typeof md5 === 'string' && MD5.test(md5)) {
    const { data } = await db.from('books').select('id').eq('user_id', userId).eq('koreader_md5', md5).maybeSingle()
    bookId = data?.id ?? null
  }
  const { error } = await db.from('book_ai_notes').insert({
    user_id: userId, book_id: bookId, book_title: input.title, ask: input.ask, question: input.question,
    selection: input.selection, answer, model, percent: input.percent,
  })
  if (error) console.error('kobo-sync ask save', errText(error))
  return json({ ok: true, answer, model, saved: !error })
}

// ── A book's own cover, sent by the plugin from the EPUB ────────────────────
async function handleCover(db: Db, userId: string, md5: string, req: Request) {
  const { data: book, error } = await db.from('books').select('id, cover_url, cover_source')
    .eq('user_id', userId).eq('koreader_md5', md5).maybeSingle()
  if (error) throw error
  if (!book) return json({ error: 'unknown_book' }, 404)
  const now = new Date().toISOString()
  // "None": the book has no cover the plugin can read — do not ask again for 30 days.
  if (new URL(req.url).searchParams.get('none') === '1') {
    await db.from('books').update({ device_cover_at: now }).eq('id', book.id)
    return json({ ok: true, stored: false })
  }
  // A cover chosen in the app always wins.
  if (book.cover_url && book.cover_source !== 'device') return json({ ok: true, stored: false, reason: 'has_cover' })
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const ext = COVER_TYPES[type]
  if (!ext) return json({ error: 'type', message: 'JPEG, PNG, WebP or GIF only.' }, 415)
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.length || bytes.length > COVER_MAX_BYTES) {
    await db.from('books').update({ device_cover_at: now }).eq('id', book.id)
    return json({ error: 'too_large', message: 'Covers over 400 KB are left to the online lookup.' }, 413)
  }
  const { data: used } = await db.rpc('kobo_bucket_usage', { p_bucket: COVER_BUCKET })
  if (typeof used !== 'number' || used + bytes.length > COVER_BUDGET_BYTES) return json({ error: 'storage_full' }, 413)
  const path = `${userId}/${book.id}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const { error: upError } = await db.storage.from(COVER_BUCKET).upload(path, bytes, { contentType: type, upsert: false })
  if (upError) throw upError
  const url = db.storage.from(COVER_BUCKET).getPublicUrl(path).data.publicUrl
  const { error: e2 } = await db.from('books').update({ cover_url: url, cover_source: 'device', device_cover_at: now }).eq('id', book.id)
  if (e2) { await db.storage.from(COVER_BUCKET).remove([path]); throw e2 }
  // The previous device cover (if any) is no longer used.
  const old = typeof book.cover_url === 'string' ? book.cover_url.split(`/object/public/${COVER_BUCKET}/`)[1] : null
  if (old && book.cover_source === 'device') await db.storage.from(COVER_BUCKET).remove([decodeURIComponent(old)])
  return json({ ok: true, stored: true })
}

// ── Inbox for the plugin's automatic download (§8.2 step 2) ─────────────────
async function handleInbox(db: Db, userId: string) {
  await sweep(db, userId)
  const { data, error } = await db.from('book_deliveries')
    .select('id, storage_path, filename, mime, size_bytes, title, author, created_at')
    .eq('user_id', userId).eq('status', 'queued').order('created_at', { ascending: true }).limit(20)
  if (error) throw error
  const items = []
  for (const row of data ?? []) {
    if (items.length >= 5) break
    const name = safeFileName(row.filename)
    const { data: signed, error: signError } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, 600, { download: name })
    if (signError || !signed?.signedUrl) {
      // The file is gone (or never arrived): retire the row so it cannot block the queue.
      await db.from('book_deliveries').update({ status: 'expired' }).eq('id', row.id)
      continue
    }
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
  if (route.kind === 'sync' || route.kind === 'inbox' || route.kind === 'ack' || route.kind === 'applied' || route.kind === 'cover' || route.kind === 'capture' || route.kind === 'ask') {
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
      if (route.kind === 'ack') return json(await handleAck(db, userId, route.id, req.headers.get('x-kobo-device') || 'kobo-plugin'))
      if (route.kind === 'cover') return await handleCover(db, userId, route.md5, req)
      if (route.kind === 'capture' || route.kind === 'ask') {
        let payload: unknown
        try { payload = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
        if (route.kind === 'capture') return json(await handleCapture(db, userId, (payload as { items?: unknown })?.items))
        return await handleAsk(db, userId, payload)
      }
      if (route.kind === 'applied') {
        let applied: unknown
        try { applied = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
        if (!applied || typeof applied !== 'object') return json({ error: 'invalid' }, 400)
        return json(await handleApplied(db, userId, applied as AppliedBody))
      }
      let body: unknown
      try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
      const problem = validateSync(body, Math.floor(Date.now() / 1000))
      if (problem) return json({ error: 'invalid', message: problem }, 400)
      return json(await handleSync(db, userId, body as SyncBody))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
      console.error('kobo-sync', route.kind, msg)
      const missing = /reading_page_events|relation .*books|Could not find the table|column .* does not exist|kobo_device_state/i.test(msg)
      return json({ error: missing ? 'not_migrated' : 'server', message: missing ? 'Migrations 126 and 127 (books, Kobo control) must be applied.' : 'Something went wrong on the server.' }, 500)
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
        .select('id, filename, mime, size_bytes, title, author, status, created_at, downloaded_at, device_id')
        .eq('user_id', userId).in('status', ['queued', 'downloaded'])
        .order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      // A book the plugin already saved is not offered again (no second copy).
      const rows = (data ?? []).filter((r: { status: string; device_id: string | null }) => !(r.status === 'downloaded' && r.device_id != null))
      const entries = feedEntries(rows, Date.now())
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
