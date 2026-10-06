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
  /** File size in bytes (plugin 1.2). */
  size?: number | null
  /** The file's subjects/keywords, newline- or comma-separated (plugin 1.2, from KOReader's book info). */
  keywords?: string | null
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
  /** null for news (migration 128's trigger enforces it too). */
  read_status: ReadStatus | null
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
  file_size: number | null
  subjects: string[]
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

/** "Fantasy\nMagic; Fiction" → ["Fantasy", "Magic", "Fiction"]: trimmed, deduplicated, at most 12. */
function splitKeywords(v: unknown): string[] {
  if (typeof v !== 'string') return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of v.split(/[\n;,]+/)) {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 60)
    const k = t.toLowerCase()
    if (!t || seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= 12) break
  }
  return out
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
  const news = b.kind === 'news' || isNewsPath(b.path)
  const mapped = mapDeviceStatus(b.status)
  // News never has a status, rating or read dates — it is only news.
  const status: ReadStatus | null = news ? null : mapped ?? (pct && pct > 0 ? 'reading' : 'want')
  const lastOpen = epochIso(b.last_open)
  const rating = news ? null : int(b.rating, 1, 5)
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
    kind: news ? 'news' : 'book',
    file_size: int(b.size, 0, 1e11),
    subjects: splitKeywords(b.keywords),
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
  if (next.file_size !== null && next.file_size !== numOrNull(existing.file_size)) patch.file_size = next.file_size
  if ((!existing.subjects || existing.subjects.length === 0) && next.subjects.length > 0) patch.subjects = next.subjects
  // kind is set once, when the row is made: the owner may move a book out of News in the app.
  // News never takes a status or rating from the device.
  if (existing.kind === 'news') return patch

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
// do not edit by hand. 456 settings in 23 groups, each read from KOReader
// v2026.07.1's source (`source` = file:line). Also GENERATED into supabase/functions/kobo-sync
// with koboSettings.ts. `absent` is what KOReader does when the key is not set at all.

interface SettingOption { value: string | number | boolean; label: string }

/** A fixed-length array of numbers (a Lua table on the Kobo). */
interface ListSpec {
  length: number
  /** An item may be missing (null here, a hole in the Lua table). */
  nullable: boolean
  integer: boolean
  /** Which editor the app shows. */
  editor: 'schedule' | 'warmth' | 'pair'
  /** One name per item. */
  labels: string[]
  /** Every item must lie in one of these [min, max] ranges… */
  ranges?: [number, number][]
  /** …or item i in positions[i]. */
  positions?: [number, number][]
  /** The items that are set never go down. */
  ascending?: boolean
  /** Item i equals item length-1-i (AutoWarmth's warmth: dawn and dusk share a value). */
  mirrored?: boolean
}

interface SettingDef {
  key: string
  label: string
  /** Where KOReader shows it, for "find it on the Kobo". */
  path: string
  type: 'bool' | 'enum' | 'int' | 'number' | 'string' | 'list'
  absent: boolean | number | string | (number | null)[] | null
  options?: SettingOption[]
  min?: number
  max?: number
  step?: number
  unit?: string
  maxLength?: number
  /** The value that turns the feature off (e.g. -1), allowed outside min…max. */
  off?: number
  /** A font: a face name (crengine's font menu) or a font file path (the status bar). */
  font?: 'face' | 'file'
  /** type 'list' only. */
  list?: ListSpec
  /** When the Kobo starts using a new value. */
  effect: 'immediate' | 'next_sleep' | 'next_book' | 'restart'
  /** What it does, in everyday words (docs/kobo/settings-help). */
  help: string
  /** A concrete everyday example, when one helps. */
  example?: string
  /** basic = an ordinary reader may want it; advanced = niche or technical. */
  level: 'basic' | 'advanced'
  /** Set by the plugin itself (e.g. the sleep image folder), never from the app directly. */
  managed?: boolean
  source: string
}

interface SettingGroup {
  id: string
  label: string
  /** What the section is about. */
  summary: string
  /** What you notice on the Kobo when you change something here. */
  affects: string
  settings: SettingDef[]
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "sleep_screen", label: "Sleep screen",
    summary: "What the Kobo shows on its screen while it is asleep, and the optional message on top of it.",
    affects: "The next time the Kobo goes to sleep (cover closed or power button pressed), the picture and text on the sleeping screen change.",
    settings: [
      {"key":"screensaver_type","label":"What the sleep screen shows","path":"Settings → Screen → Sleep screen → Wallpaper","type":"enum","absent":"disable","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:51","options":[{"value":"cover","label":"Cover of the book you are reading"},{"value":"bookshelf","label":"Bookshelf (recent books as spines)"},{"value":"random_image","label":"My images (from the app)"},{"value":"document_cover","label":"One image I pick"},{"value":"readingprogress","label":"Reading progress"},{"value":"bookstatus","label":"Book status"},{"value":"disable","label":"Leave the screen as it is"}],"help":"Chooses the picture the Kobo shows while it sleeps. The book cover option only works for a book you have opened at least once; until then a fallback image is shown.","example":"Pick 'Cover of the book you are reading' and the cover of your current book stays on the screen while the Kobo sleeps.","level":"basic"},
      {"key":"screensaver_exclude_on_hold_books","label":"No cover for books on hold","path":"Settings → Screen → Sleep screen → Wallpaper → Ignore book cover","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:74","help":"When on, a book you have marked as on hold does not get its cover on the sleep screen; one of your own images is shown instead.","level":"advanced"},
      {"key":"screensaver_exclude_finished_books","label":"No cover for finished books","path":"Settings → Screen → Sleep screen → Wallpaper → Ignore book cover","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:84","help":"When on, a book you have marked as finished does not get its cover on the sleep screen; one of your own images is shown instead.","example":"Finish a novel, and the next sleep screen shows one of your pictures instead of that novel's cover.","level":"advanced"},
      {"key":"screensaver_hide_cover_in_filemanager","label":"No cover when sleeping from the library","path":"Settings → Screen → Sleep screen → Wallpaper → Ignore book cover","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:94","help":"When on, putting the Kobo to sleep while you are in the library (not inside a book) does not show the last book's cover or message.","level":"advanced"},
      {"key":"screensaver_img_background","label":"Colour around the sleep picture","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit","type":"enum","absent":"black","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:110","options":[{"value":"black","label":"Black"},{"value":"white","label":"White"},{"value":"none","label":"Leave as it was"}],"help":"If the sleep picture does not fill the whole screen, this is the colour of the empty edges around it.","example":"Choose White fill and a wide image gets white bars above and below it instead of black.","level":"basic"},
      {"key":"screensaver_stretch_images","label":"Stretch picture to fill the screen","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:51","help":"When on, the sleep picture is stretched to fill the whole screen, even if that squeezes it a little. When off, it keeps its shape and may have empty edges.","level":"basic"},
      {"key":"screensaver_stretch_limit_percentage","label":"Maximum stretch","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit → Stretch to fit screen","type":"int","absent":"unlimited (full stretch)","effect":"next_sleep","source":"frontend/ui/screensaver.lua:259","min":0,"max":25,"step":1,"unit":"%","help":"Only used when stretching is on. The picture is stretched only if that distorts it by no more than this much; otherwise it keeps its shape. Leave it unset for unlimited stretching.","example":"Set it to 8%: a cover that is nearly the screen's shape fills the screen, but a very wide picture is not squashed.","level":"advanced"},
      {"key":"screensaver_rotate_auto_for_best_fit","label":"Turn picture sideways to fit","path":"Settings → Screen → Sleep screen → Wallpaper → Border fill, rotation, and fit","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:132","help":"When on, a wide (landscape) sleep picture is turned sideways so it fills more of the tall screen.","level":"advanced"},
      {"key":"screensaver_delay","label":"Keep sleep screen after waking","path":"Settings → Screen → Sleep screen → Wallpaper → Postpone screen update after wake-up","type":"enum","absent":"disable","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:143","options":[{"value":"disable","label":"No, show the page at once"},{"value":"1","label":"1 second"},{"value":"3","label":"3 seconds"},{"value":"5","label":"5 seconds"},{"value":"tap","label":"Until I tap the screen"},{"value":"gesture","label":"Until a set-up gesture (advanced)"}],"help":"After you wake the Kobo, the sleep picture can stay on screen for a moment, or until you tap, before your page comes back. 'Until gesture' needs a special gesture set up first, otherwise the Kobo can look stuck, so 'Until a tap' is the safer choice.","example":"Choose 3 seconds: you open the cover and still see the sleep picture for 3 seconds before your book appears.","level":"advanced"},
      {"key":"screensaver_show_exit_message","label":"Show 'how to leave' hint","path":"Settings → Screen → Sleep screen → Wallpaper → Postpone screen update after wake-up","type":"bool","absent":true,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:156","help":"Shows a short hint on the sleep screen explaining how to get back to your book. Only matters when the sleep screen stays until a special gesture.","level":"advanced"},
      {"key":"screensaver_exit_message","label":"Text of the 'how to leave' hint","path":"Settings → Screen → Sleep screen → Wallpaper → Postpone screen update after wake-up","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:216","maxLength":500,"help":"Your own wording for that hint. Leave empty to use the built-in text. Only shown when the sleep screen stays until a special gesture.","level":"advanced"},
      {"key":"screensaver_document_cover","label":"The one fixed sleep image","path":"Settings → Screen → Sleep screen → Wallpaper → Custom images","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:195","maxLength":500,"managed":true,"help":"The single picture (or the cover of a chosen book) shown when the sleep screen is set to 'One fixed image'. Lasci's Board fills this in for you when you pick one of your images.","level":"advanced"},
      {"key":"screensaver_dir","label":"Folder of sleep images","path":"Settings → Screen → Sleep screen → Wallpaper → Custom images","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:182","maxLength":500,"managed":true,"help":"The folder on the Kobo the random sleep images come from. Lasci's Board sets this to the images you upload, so you normally do not need to change it.","level":"advanced"},
      {"key":"screensaver_cycle_images_alphabetically","label":"Show my images in order","path":"Settings → Screen → Sleep screen → Wallpaper → Custom images","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:201","help":"When on, your sleep images are shown one after another in name order instead of at random.","example":"With three images uploaded, each time the Kobo sleeps it shows the next one: first, second, third, then back to the first.","level":"basic"},
      {"key":"screensaver_show_message","label":"Show a message on the sleep screen","path":"Settings → Screen → Sleep screen → Sleep screen message","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:217","help":"When on, a short text of your choice is written on top of the sleep screen.","example":"Turn it on and write 'If found, call 123 45 678' so anyone who finds your Kobo knows how to return it.","level":"basic"},
      {"key":"screensaver_message","label":"Sleep screen message","path":"Settings → Screen → Sleep screen → Sleep screen message","type":"string","absent":null,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:220","maxLength":500,"help":"The text written on the sleep screen when the message is turned on. It can span several lines and can include book details such as the title or how far you have read.","example":"Write 'Sleeping - see you soon' to replace the default 'Sleeping'.","level":"basic"},
      {"key":"screensaver_message_container","label":"Message style","path":"Settings → Screen → Sleep screen → Sleep screen message → Container and position","type":"enum","absent":"box","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:240","options":[{"value":"banner","label":"Band across the screen"},{"value":"box","label":"Small box"}],"help":"How the sleep screen message is framed: a small box around the text, or a band across the full width of the screen.","level":"advanced"},
      {"key":"screensaver_message_vertical_position","label":"Message height on screen","path":"Settings → Screen → Sleep screen → Sleep screen message → Container and position","type":"number","absent":50,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:290","min":0,"max":100,"step":5,"unit":"% from bottom (100=top, 50=middle, 0=bottom)","help":"Where the sleep message sits from bottom to top: 0 is the very bottom, 50 is the middle and 100 is the top.","example":"Set it to 10 to put the message near the bottom so it does not cover the book title on the cover.","level":"basic"},
      {"key":"screensaver_message_alpha","label":"Message see-through","path":"Settings → Screen → Sleep screen → Sleep screen message → Container and position","type":"int","absent":100,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:310","min":0,"max":100,"step":5,"unit":"%","help":"How solid the message box is. 100% is fully solid; lower values let the picture behind show through.","example":"Set it to 70% so the cover is still faintly visible behind your message.","level":"advanced"},
      {"key":"screensaver_msg_background","label":"Background behind the message","path":"Settings → Screen → Sleep screen → Sleep screen message → Background fill","type":"enum","absent":"none","effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:283","options":[{"value":"black","label":"Black screen"},{"value":"white","label":"White screen"},{"value":"none","label":"Keep the page behind it"}],"help":"Only used when the sleep screen keeps the last page and a message is shown: whether the page behind the message is wiped to black or white, or left as it was.","level":"advanced"},
      {"key":"screensaver_hide_fallback_msg","label":"Hide restart and power-off message","path":"Settings → Screen → Sleep screen → Sleep screen message","type":"bool","absent":false,"effect":"next_sleep","source":"frontend/ui/elements/screensaver_menu.lua:291","help":"When on, the short message shown while the Kobo restarts or powers off is left out. It does not affect normal sleep.","level":"advanced"},
      {"key":"screensaver_extra_flash_count","label":"Extra cleaning flashes on sleep","path":"Settings → Screen → E-ink settings → Sleep screen anti-ghosting redraws","type":"int","absent":0,"effect":"next_sleep","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:41","min":0,"max":4,"step":1,"help":"After the sleep picture appears, the screen can flash black and redraw it a few more times to remove faint leftovers (ghosting) of the page you were reading. 0 turns this off; 2 is the usual choice.","example":"Set it to 2: when the Kobo sleeps the screen blinks twice and the cover looks crisp, with no traces of your last page.","level":"advanced"},
      {"key":"screensaver_extra_flash_delay","label":"Pause between cleaning flashes","path":"Settings → Screen → E-ink settings → Sleep screen anti-ghosting redraws","type":"int","absent":1000,"effect":"next_sleep","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:47","min":0,"max":2000,"step":50,"unit":"ms","help":"How long the Kobo waits between those extra cleaning flashes, in milliseconds (1000 ms is one second). Only matters when the extra flashes are on.","example":"1000 ms means one flash per second.","level":"advanced"},
    ],
  },
  {
    id: "bookshelf", label: "Bookshelf sleep screen",
    summary: "Fine-tuning for the sleep screen that draws your recently read books as a stack of book spines.",
    affects: "Only matters when the sleep screen is set to Bookshelf; the stack of books you see while the Kobo sleeps looks different.",
    settings: [
      {"key":"bookshelf_screensaver_background_type","label":"Background behind the books","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → Background type","type":"enum","absent":1,"effect":"next_sleep","source":"bookshelf.lua:134","options":[{"value":0,"label":"Plain (nothing)"},{"value":1,"label":"Dotted pattern"},{"value":2,"label":"Cover of the latest book"},{"value":3,"label":"A custom image on the Kobo"}],"help":"What is drawn behind the stack of book spines.","level":"basic"},
      {"key":"bookshelf_screensaver_progression_type","label":"How progress fills each spine","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → Progression type","type":"enum","absent":0,"effect":"next_sleep","source":"bookshelf.lua:135","options":[{"value":0,"label":"Left to right, like a bar"},{"value":1,"label":"From the top down"},{"value":2,"label":"From the bottom up"}],"help":"Each spine is shaded to show how much of that book you have read. This chooses whether the shading grows from left to right like a bar, from the top down, or from the bottom up.","level":"advanced"},
      {"key":"bookshelf_screensaver_show_standing_book","label":"Show standing book","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:136","help":"When on, your most recent book is drawn standing upright on top of the stack instead of lying flat with the others.","level":"basic"},
      {"key":"bookshelf_screensaver_show_stack_decor","label":"Show decoration beside the stack","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":false,"effect":"next_sleep","source":"bookshelf.lua:137","help":"Adds a small decorative picture next to the stack. It only appears when the standing book is turned off and a decoration image has been put on the Kobo.","level":"advanced"},
      {"key":"bookshelf_screensaver_show_time_left","label":"Show reading time left","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:138","help":"Writes an estimate of how long it will take to finish each unfinished book on its spine.","example":"A spine might read '3h 20m left' next to the author's name.","level":"basic"},
      {"key":"bookshelf_screensaver_show_percent","label":"Show percent read","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":false,"effect":"next_sleep","source":"bookshelf.lua:139","help":"Writes how far you are in each unfinished book on its spine.","example":"A spine might read '42%' next to the author's name.","level":"basic"},
      {"key":"bookshelf_screensaver_show_bands","label":"Show quarter marks on spines","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:140","help":"Draws thin stripes on each spine, one for every quarter of the book you have read, so you can see your progress at a glance.","example":"A book you are halfway through gets two stripes; a book three quarters done gets three.","level":"advanced"},
      {"key":"bookshelf_screensaver_use_random_colors","label":"Different shade per book","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":false,"effect":"next_sleep","source":"bookshelf.lua:141","help":"Gives each spine its own random shade. On this black-and-white screen the colours show up as different greys.","level":"advanced"},
      {"key":"bookshelf_screensaver_use_misaligned_stack","label":"Slightly uneven stack","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings","type":"bool","absent":true,"effect":"next_sleep","source":"bookshelf.lua:142","help":"When on, the books are shifted a little left and right so the stack looks natural; when off, they line up neatly.","level":"advanced"},
      {"key":"bookshelf_screensaver_num_books","label":"Number of books in the stack","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":5,"effect":"next_sleep","source":"bookshelf.lua:1228","min":1,"max":10,"step":1,"help":"How many of your recently read books are drawn. If they do not all fit on the screen, the extra ones are left out.","example":"Set it to 3 to see only the three books you read most recently.","level":"basic"},
      {"key":"bookshelf_screensaver_finished_threshold","label":"Counts as finished at","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":97,"effect":"next_sleep","source":"bookshelf.lua:1229","min":90,"max":100,"step":1,"unit":"%","help":"Once you have read this much of a book, its spine is drawn as complete and no longer shows time left or percent.","example":"Set it to 95%: a book you stopped at 96% (because of the notes at the end) shows as finished.","level":"advanced"},
      {"key":"bookshelf_screensaver_minimum_pages","label":"Leave out short books under","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":0,"effect":"next_sleep","source":"bookshelf.lua:1231","min":0,"max":999999,"step":5,"unit":"pages","help":"Books with fewer pages than this are not shown in the stack. 0 shows every book.","example":"Set it to 50 pages so short articles and newspaper issues stay out of the stack.","level":"advanced"},
      {"key":"bookshelf_screensaver_font_size","label":"Text size on spines","path":"Settings → Screen → Sleep screen → Wallpaper → Bookshelf Settings → ── Books ──","type":"int","absent":6,"effect":"next_sleep","source":"bookshelf.lua:1234","min":4,"max":10,"step":1,"help":"How large the titles and details on the spines are written. Thicker books get slightly bigger text automatically.","example":"Raise it from 6 to 8 if the titles are hard to read.","level":"basic"},
    ],
  },
  {
    id: "project_title", label: "Library look",
    summary: "How your library of books looks on the Kobo: covers or lists, how many per page, and what is written under each book.",
    affects: "The book list you see when no book is open changes; most of these need KOReader to restart before you see them.",
    settings: [
      {"key":"pt:filemanager_display_mode","label":"Library layout","path":"Project: Title → Settings","type":"enum","absent":"list_image_meta","effect":"restart","source":"projecttitle.koplugin/joshuacant_ProjectTitle/main.lua:163,225","options":[{"value":"list_image_meta","label":"List with covers"},{"value":"mosaic_image","label":"Grid of covers"},{"value":"list_only_meta","label":"List without covers"},{"value":"list_no_meta","label":"File names only"}],"help":"How your books are listed in the library: covers with details in a list, a grid of covers, a list with details but no covers, or plain file names.","example":"Choose Cover grid to see your books as a wall of covers, like a bookshop shelf.","level":"basic"},
      {"key":"pt:history_display_mode","label":"History layout","path":"Project: Title → Settings","type":"enum","absent":"list_image_meta","effect":"restart","source":"projecttitle.koplugin/main.lua:226,434","options":[{"value":"list_image_meta","label":"List with covers"},{"value":"mosaic_image","label":"Grid of covers"},{"value":"list_only_meta","label":"List without covers"},{"value":"list_no_meta","label":"File names only"}],"help":"The same choice, but for the list of books you opened recently. Only used when 'Use this layout everywhere' is off.","level":"advanced"},
      {"key":"pt:collection_display_mode","label":"Collections layout","path":"Project: Title → Settings","type":"enum","absent":"list_image_meta","effect":"restart","source":"projecttitle.koplugin/main.lua:227,441","options":[{"value":"list_image_meta","label":"List with covers"},{"value":"mosaic_image","label":"Grid of covers"},{"value":"list_only_meta","label":"List without covers"},{"value":"list_no_meta","label":"File names only"}],"help":"The same choice, but for your collections (such as Favorites). Only used when 'Use this layout everywhere' is off.","level":"advanced"},
      {"key":"pt:unified_display_mode","label":"Use this layout everywhere","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:233,427","help":"When on, the history and collections lists use the same layout as the library. Turn it off to give them their own layout.","level":"advanced"},
      {"key":"pt:nb_cols_portrait","label":"Covers per row","path":"Project: Title → Settings","type":"int","absent":3,"effect":"restart","source":"projecttitle.koplugin/main.lua:486; ptutil.lua:93-97","min":2,"max":4,"help":"How many covers sit side by side in the cover grid. Fewer means bigger covers.","example":"Set it to 2 for large, easy-to-see covers; 4 fits more books on each page.","level":"basic"},
      {"key":"pt:nb_rows_portrait","label":"Rows of covers per page","path":"Project: Title → Settings","type":"int","absent":3,"effect":"restart","source":"projecttitle.koplugin/main.lua:487","min":2,"max":4,"help":"How many rows of covers fit on one page of the cover grid.","example":"3 columns and 3 rows show 9 books per page.","level":"basic"},
      {"key":"pt:nb_cols_landscape","label":"Covers per row (sideways)","path":"Project: Title → Settings","type":"int","absent":null,"effect":"restart","source":"projecttitle.koplugin/main.lua:534","min":2,"max":4,"help":"Covers per row in the cover grid when the screen is turned sideways. You will rarely see this, as the Kobo is normally held upright.","level":"advanced"},
      {"key":"pt:nb_rows_landscape","label":"Rows of covers (sideways)","path":"Project: Title → Settings","type":"int","absent":null,"effect":"restart","source":"projecttitle.koplugin/main.lua:535","min":2,"max":4,"help":"Rows of covers in the grid when the screen is turned sideways. You will rarely see this, as the Kobo is normally held upright.","level":"advanced"},
      {"key":"pt:files_per_page","label":"Books per page in lists","path":"Project: Title → Settings","type":"int","absent":7,"effect":"restart","source":"projecttitle.koplugin/main.lua:574; ptutil.lua:73-75","min":3,"max":10,"help":"How many books fit on one page in the list layouts. Fewer means bigger rows and covers.","example":"Set it to 5 for large, easy-to-tap rows; 10 fits more books on each page.","level":"basic"},
      {"key":"pt:disable_auto_foldercovers","label":"No automatic folder covers","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:600","help":"Normally a folder shows covers of the books inside it. When this is on, folders show a plain folder picture instead.","level":"advanced"},
      {"key":"pt:use_stacked_foldercovers","label":"Folder covers as a stack","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:611","help":"When on, a folder shows several of its book covers stacked on top of each other instead of side by side.","level":"advanced"},
      {"key":"pt:show_name_grid_folders","label":"Folder names in the cover grid","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:619","help":"When on, folder names and how many books they hold are written over the folder pictures in the cover grid.","level":"advanced"},
      {"key":"pt:use_custom_sorts","label":"Extra sorting options","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:627","help":"When on, the library's sort menu gets extra ways of ordering books added by the library add-on.","level":"advanced"},
      {"key":"pt:hide_file_info","label":"Show progress instead of file details","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:640","help":"When on, each book shows how far you have read. When off, it shows file details such as the file type and size instead.","level":"basic"},
      {"key":"pt:show_pages_read_as_progress","label":"Show pages read","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:653","help":"Shows your progress as pages read out of total pages instead of a percentage. Only works when progress is shown (the setting above is on).","example":"A book shows '120 / 340' instead of '35%'.","level":"basic"},
      {"key":"pt:force_no_progressbars","label":"Percent instead of progress bars","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:667","help":"Shows a plain number such as '35%' under each book instead of a small progress bar.","level":"basic"},
      {"key":"pt:force_max_progressbars","label":"Same-length progress bars","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:683","help":"Normally a thicker book gets a longer progress bar. When on, every book's bar is full length so they are easy to compare.","level":"advanced"},
      {"key":"pt:show_tags","label":"Show book tags","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:705","help":"Shows the tags or keywords stored inside the book file (for example genres added in calibre) under each book.","level":"advanced"},
      {"key":"pt:use_custom_bookstatus","label":"Nicer book summary page","path":"Project: Title → Settings","type":"bool","absent":true,"effect":"restart","source":"projecttitle.koplugin/main.lua:713","help":"When on, the page that shows a book's details, rating and progress uses the library add-on's own, cleaner design instead of KOReader's standard one.","level":"advanced"},
      {"key":"pt:replace_footer_text","label":"Battery and time in library footer","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:726","help":"When on, the bottom line of the library shows device information such as the time and battery instead of the current folder's name.","level":"basic"},
      {"key":"pt:reverse_footer","label":"Page arrows on the left","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:734","help":"Moves the library's next and previous page buttons to the bottom left corner instead of the right.","level":"advanced"},
      {"key":"pt:autoscan_on_eject","label":"Look for new books at start-up","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:747","help":"When on, KOReader checks your book folder each time it starts and prepares covers and details for any new books, so they show up right away.","level":"advanced"},
      {"key":"pt:force_focus_indicator","label":"Mark the last book you opened","path":"Project: Title → Settings","type":"bool","absent":false,"effect":"restart","source":"projecttitle.koplugin/main.lua:808","help":"When on, the book you opened last is highlighted in the library so you can find your place quickly.","level":"advanced"},
    ],
  },
  {
    id: "screen", label: "Screen and flashing",
    summary: "Night mode and how often the e-ink screen does a full black flash to clean away leftover traces of earlier pages.",
    affects: "You will see more or fewer black flashes when you turn pages or tap buttons, and white text on black in night mode.",
    settings: [
      {"key":"night_mode","label":"Night mode","path":"Settings → Night mode","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:268","help":"Turns the screen into white text on a black background, which can be easier on the eyes in the dark. A change made from here shows the next time KOReader starts.","level":"basic"},
      {"key":"full_refresh_count","label":"Full screen flash every","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"int","absent":6,"effect":"restart","source":"frontend/ui/uimanager.lua:810","options":[{"value":0,"label":"Never"},{"value":1,"label":"Every page"},{"value":6,"label":"Every 6 pages"},{"value":-1,"label":"Every chapter"}],"min":-1,"max":200,"step":1,"unit":"pages","help":"E-ink screens keep faint traces of earlier pages (ghosting). A full refresh flashes the screen black for a moment to wipe them. Lower numbers mean a cleaner page but more flashing. A change shows the next time KOReader starts.","example":"6 pages means the screen flashes once every 6 page turns. 0 never flashes, 1 flashes on every page, -1 flashes only at each new chapter.","level":"basic"},
      {"key":"night_full_refresh_count","label":"Full screen flash every (night mode)","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"int","absent":"same as full_refresh_count","effect":"restart","source":"frontend/ui/uimanager.lua:813","min":-1,"max":200,"step":1,"unit":"pages","help":"The same as above, but used while night mode is on. If unset it follows the normal setting.","example":"Set it to 1 if white text on black leaves more traces than normal pages.","level":"advanced"},
      {"key":"refresh_rate_1","label":"Flash preset 1","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 1 (long-press)","type":"int","absent":12,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"A saved choice for the full-flash interval that you can pick from KOReader's refresh menu. Changing it here does not change the current interval by itself.","level":"advanced"},
      {"key":"night_refresh_rate_1","label":"Flash preset 1 (night mode)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 1 (long-press)","type":"int","absent":"same as refresh_rate_1","effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"The night mode value of saved flash preset 1. Changing it here does not change the current interval by itself.","level":"advanced"},
      {"key":"refresh_rate_2","label":"Flash preset 2","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 2 (long-press)","type":"int","absent":22,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"A second saved choice for the full-flash interval that you can pick from KOReader's refresh menu. Changing it here does not change the current interval by itself.","level":"advanced"},
      {"key":"night_refresh_rate_2","label":"Flash preset 2 (night mode)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 2 (long-press)","type":"int","absent":"same as refresh_rate_2","effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"The night mode value of saved flash preset 2. Changing it here does not change the current interval by itself.","level":"advanced"},
      {"key":"refresh_rate_3","label":"Flash preset 3","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 3 (long-press)","type":"int","absent":99,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"A third saved choice for the full-flash interval that you can pick from KOReader's refresh menu. Changing it here does not change the current interval by itself.","level":"advanced"},
      {"key":"night_refresh_rate_3","label":"Flash preset 3 (night mode)","path":"Settings → Screen → E-ink settings → Full refresh rate → Custom 3 (long-press)","type":"int","absent":"same as refresh_rate_3","effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:15","min":-1,"max":200,"step":1,"unit":"pages","help":"The night mode value of saved flash preset 3. Changing it here does not change the current interval by itself.","level":"advanced"},
      {"key":"refresh_on_chapter_boundaries","label":"Flash at each new chapter","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:110","help":"When on, the screen always does a full cleaning flash when you turn to the first page of a new chapter, on top of the regular interval.","level":"advanced"},
      {"key":"no_refresh_on_second_chapter_page","label":"Skip flash on a chapter's 2nd page","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:116","help":"Only matters when flashing at new chapters is on: it avoids a second flash on the page right after the chapter start.","level":"advanced"},
      {"key":"refresh_on_pages_with_images","label":"Flash on pages with pictures","path":"Settings → Screen → E-ink settings → Full refresh rate","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/refresh_menu_table.lua:121","help":"When on, a page with a picture always gets a full cleaning flash so the image looks sharp and leaves no traces on the next page.","level":"advanced"},
      {"key":"flash_ui","label":"Flash buttons when tapped","path":"Settings → Screen → E-ink settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/flash_ui.lua:6","help":"When on, a button or menu item briefly turns black when you tap it, so you can see the tap was noticed. Turn it off for calmer, less flashy menus.","level":"basic"},
      {"key":"flash_keyboard","label":"Flash keys when typing","path":"Settings → Screen → E-ink settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/flash_keyboard.lua:6","help":"When on, each key on the on-screen keyboard briefly turns black when tapped. Turning it off makes typing look calmer and can feel a bit faster.","level":"basic"},
      {"key":"avoid_flashing_ui","label":"Fewer black flashes in menus","path":"Settings → Screen → E-ink settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:22","help":"When on, menus and pop-ups open without the black flash the screen normally uses to draw them cleanly. Calmer, but faint traces may stay behind.","level":"advanced"},
      {"key":"low_pan_rate","label":"Slower screen updates when dragging","path":"Settings → Screen → E-ink settings","type":"bool","absent":"device default","effect":"restart","source":"frontend/ui/elements/screen_eink_opt_menu_table.lua:15","help":"When on, the screen redraws less often while you drag a slider or scroll (for example the light slider), which saves battery and looks less jittery on e-ink. Takes effect after KOReader restarts.","level":"advanced"},
    ],
  },
  {
    id: "rotation", label: "Screen rotation",
    summary: "Which way up the library and pictures are shown, since the Kobo has no sensor to turn the screen by itself.",
    affects: "The library or the picture viewer opens turned sideways or upside down instead of upright.",
    settings: [
      {"key":"fm_rotation_mode","label":"Library orientation","path":"Settings → Screen → Rotation","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/elements/screen_rotation_menu_table.lua:22","options":[{"value":0,"label":"Upright (normal)"},{"value":1,"label":"Sideways, turned right"},{"value":2,"label":"Upside down"},{"value":3,"label":"Sideways, turned left"}],"help":"Which way up the library is shown when it opens. The Kobo has no sensor to turn the screen by itself, so this decides it. Not used when 'Keep current rotation' is on.","level":"advanced"},
      {"key":"lock_rotation","label":"Keep current rotation","path":"Settings → Screen → Rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:71","help":"When on, the screen stays the way it is turned when you move between the library and a book, instead of each using its own default.","level":"advanced"},
      {"key":"imageviewer_rotation_portrait_invert","label":"Flip picture viewer turn (upright)","path":"Settings → Screen → Rotation → Image viewer rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:91","help":"When a picture is turned sideways to fit while you hold the Kobo upright, this makes it turn the other way.","level":"advanced"},
      {"key":"imageviewer_rotation_landscape_invert","label":"Flip picture viewer turn (sideways)","path":"Settings → Screen → Rotation → Image viewer rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:100","help":"Makes a picture that is turned to fit turn the other way when the screen is sideways. It also changes which way a turned sleep picture faces.","level":"advanced"},
      {"key":"imageviewer_rotate_auto_for_best_fit","label":"Turn pictures to fit","path":"Settings → Screen → Rotation → Image viewer rotation","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/screen_rotation_menu_table.lua:111","help":"When on, opening a wide picture (for example from a book) turns it sideways automatically so it fills more of the screen.","level":"advanced"},
    ],
  },
  {
    id: "frontlight", label: "Auto-dim light",
    summary: "Lets the front light dim by itself when you have not touched the Kobo for a while.",
    affects: "When you leave the Kobo untouched, the light slowly gets dimmer; any touch brings it back.",
    settings: [
      {"key":"autodim_starttime_minutes","label":"Dim the light after","path":"Settings → Screen → Automatic dimmer","type":"number","absent":-1,"effect":"next_book","source":"plugins/autodim.koplugin/main.lua:82","min":0.5,"max":60,"unit":"minutes","off":-1,"help":"If you do not touch the Kobo for this many minutes, the front light starts to dim. -1 (or unset) turns auto-dimming off. Any touch brings the light back.","example":"Set it to 5 minutes: if you fall asleep while reading, the light dims after 5 minutes instead of staying bright.","level":"basic"},
      {"key":"autodim_duration_seconds","label":"How slowly it dims","path":"Settings → Screen → Automatic dimmer","type":"int","absent":5,"effect":"next_book","source":"plugins/autodim.koplugin/main.lua:120","min":0,"max":300,"unit":"seconds","help":"How many seconds the light takes to fade down to its dimmed level. 0 dims at once.","example":"Set it to 10 seconds for a gentle fade you barely notice.","level":"advanced"},
      {"key":"autodim_fraction","label":"Dim down to","path":"Settings → Screen → Automatic dimmer","type":"int","absent":20,"effect":"next_book","source":"plugins/autodim.koplugin/main.lua:147","min":0,"max":100,"unit":"%","help":"How bright the light stays once dimmed, as a share of your normal brightness. 0% turns it fully off.","example":"20% means a light normally at 50 dims to 10.","level":"basic"},
    ],
  },
  {
    id: "autowarmth", label: "Warm light by time",
    summary: "Makes the front light warmer (more orange) in the evening and cooler in the day, by sunrise and sunset or by fixed times.",
    affects: "The colour of the front light changes through the day on its own, and optionally night mode switches on at night.",
    settings: [
      {"key":"autowarmth_activate","label":"Change light warmth by time","path":"Settings → Screen → AutoWarmth and night mode → Activate","type":"enum","absent":0,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:79","options":[{"value":0,"label":"Off"},{"value":1,"label":"By sunrise and sunset"},{"value":2,"label":"By fixed times"},{"value":3,"label":"Mix: whichever is nearer midday"},{"value":4,"label":"Mix: whichever is nearer midnight"}],"help":"Turns on automatic warmth and chooses what drives it: real sunrise and sunset for your location, fixed times you set, or a mix of the two.","example":"Choose 'By sunrise and sunset' and the light turns warmer by itself as the evening gets darker.","level":"basic"},
      {"key":"autowarmth_easy_mode","label":"Simple mode","path":"Settings → Screen → AutoWarmth and night mode → Expert mode","type":"bool","absent":true,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:78","help":"When on, warmth changes at just a few simple points around sunrise and sunset. Turn it off (expert mode) to fine-tune every step of twilight and the daytime light-off offset.","level":"advanced"},
      {"key":"autowarmth_location","label":"Place name","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Location","type":"string","absent":null,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:80","maxLength":500,"help":"Just a name for your location so you recognise it; the times come from the latitude and longitude below.","example":"Oslo","level":"basic"},
      {"key":"autowarmth_latitude","label":"Latitude (north-south)","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Coordinates","type":"number","absent":64.31,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:81","min":-90,"max":90,"unit":"° (north +)","help":"How far north you are, used to work out sunrise and sunset. North is positive. The default is a place in Iceland, so set your own.","example":"Oslo is about 59.9.","level":"basic"},
      {"key":"autowarmth_longitude","label":"Longitude (east-west)","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Coordinates","type":"number","absent":-20.3,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:82","min":-180,"max":180,"unit":"° (east +)","help":"How far east you are, used to work out sunrise and sunset. East is positive, west is negative.","example":"Oslo is about 10.75.","level":"basic"},
      {"key":"autowarmth_altitude","label":"Height above sea level","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Altitude","type":"int","absent":200,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:83","min":-100,"max":15000,"unit":"m","help":"Your height above the sea in metres. It changes the sunrise and sunset times only very slightly, so a rough guess is fine.","example":"Oslo city centre is about 20 m.","level":"advanced"},
      {"key":"autowarmth_timezone","label":"Time zone (hours from UTC)","path":"Settings → Screen → AutoWarmth and night mode → Location settings → Coordinates","type":"number","absent":0,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:84","unit":"hours from UTC","help":"How many hours your clock is ahead of UTC. The Kobo usually works this out and saves it itself.","example":"Norway is +1 in winter and +2 in summer.","level":"advanced"},
      {"key":"autowarmth_scheduler_times","label":"Fixed times","path":"Settings → Screen → AutoWarmth and night mode → Fixed schedule settings","type":"list","absent":[0,5.5,6,6.5,7,13,21.5,22,22.5,23,24],"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:85","list":{"length":11,"nullable":true,"integer":false,"editor":"schedule","labels":["Solar midnight (previous day)","Astronomical dawn","Nautical dawn","Civil dawn","Sunrise","Solar noon","Sunset","Civil dusk","Nautical dusk","Astronomical dusk","Solar midnight"],"ranges":[[-1,24.99]],"ascending":true},"help":"The clock times the light follows when warmth changes by fixed times (or by a mix of fixed times and the sun). Each time marks one moment of the day, such as sunrise or sunset; between two moments the warmth moves step by step from one level to the next. Simple mode uses four moments (civil dawn, sunrise, sunset, civil dusk); turn Simple mode off to set every twilight step. A moment can be left out, and the times must go forward through the day.","example":"Sunrise 07:00 and sunset 21:30: the light is warm until 07:00, cool through the day and warm again from 21:30.","level":"basic"},
      {"key":"autowarmth_warmth","label":"Warmth through the day","path":"Settings → Screen → AutoWarmth and night mode → Warmth and night mode settings","type":"list","absent":[90,90,80,60,20,20,20,60,80,90,90],"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:87","list":{"length":11,"nullable":false,"integer":true,"editor":"warmth","labels":["Solar midnight (previous day)","Astronomical dawn","Nautical dawn","Civil dawn","Sunrise","Solar noon","Sunset","Civil dusk","Nautical dusk","Astronomical dusk","Solar midnight"],"ranges":[[0,100],[1000,1100]],"mirrored":true},"help":"How warm the light is at each moment of the day, from 0 % (cool, blue-white) to 100 % (warm, orange), and whether night mode (white text on black) is on then. Dawn and dusk share a value: setting the warmth for sunrise also sets it for sunset. Night mode can only be chosen while 'Switch night mode automatically' is on.","example":"Midday 20 %, sunrise and sunset 60 %, darkest twilight 90 % with night mode on.","level":"basic"},
      {"key":"autowarmth_control_warmth","label":"Change light colour","path":"Settings → Screen → AutoWarmth and night mode → Control","type":"bool","absent":true,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:96","help":"When on, the automatic schedule makes the front light warmer at night and cooler during the day.","level":"basic"},
      {"key":"autowarmth_control_nightmode","label":"Switch night mode automatically","path":"Settings → Screen → AutoWarmth and night mode → Control","type":"bool","absent":true,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:97","help":"When on, the schedule also turns night mode (white text on black) on late at night and off again in the morning.","level":"basic"},
      {"key":"autowarmth_hide_nightmode_warning","label":"Hide night mode warning","path":"Settings → Screen → AutoWarmth and night mode → Enable night mode warning","type":"bool","absent":false,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:98","help":"When you switch night mode by hand while the schedule controls it, KOReader warns that the schedule may switch it back. Turn this on to stop that warning.","level":"advanced"},
      {"key":"autowarmth_fl_off_during_day","label":"Light off in daytime","path":"Settings → Screen → AutoWarmth and night mode → Frontlight off during day","type":"bool","absent":false,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:724","help":"When on, the front light switches off by itself between sunrise and sunset, when you usually do not need it, and comes back on in the evening.","example":"Read on the train in the morning with the light off automatically, saving battery.","level":"basic"},
      {"key":"autowarmth_fl_off_during_day_offset_s","label":"Light-off time shift","path":"Settings → Screen → AutoWarmth and night mode → Frontlight off during day","type":"int","absent":0,"effect":"next_book","source":"plugins/autowarmth.koplugin/main.lua:746","min":-900,"max":1800,"step":60,"unit":"seconds (menu edits minutes -15…+30)","help":"Moves the daytime light-off period a little: a positive value keeps the light on for longer after sunrise and switches it on earlier before sunset. Stored in seconds; only used in expert mode.","example":"1800 seconds (30 minutes) keeps the light on until half an hour after sunrise.","level":"advanced"},
    ],
  },
  {
    id: "power", label: "Sleep and battery",
    summary: "When the Kobo goes to sleep or switches itself off, and warnings about battery and memory.",
    affects: "The Kobo falls asleep or turns off sooner or later, and may show pop-up warnings about the battery.",
    settings: [
      {"key":"auto_suspend_timeout_seconds","label":"Go to sleep after","path":"Settings → Device → Autosuspend timeout","type":"int","absent":900,"effect":"next_book","source":"plugins/autosuspend.koplugin/main.lua:189","min":60,"max":86400,"unit":"seconds","off":-1,"help":"How long the Kobo waits without being touched before it goes to sleep and shows the sleep screen. A shorter time saves battery; a longer time lets you pause reading without the Kobo dozing off.","example":"Set it to 600 seconds (10 minutes): if you put the Kobo down and forget it, it goes to sleep after 10 minutes.","level":"basic"},
      {"key":"autoshutdown_timeout_seconds","label":"Switch off after sleeping for","path":"Settings → Device → Autoshutdown timeout","type":"int","absent":259200,"effect":"next_book","source":"plugins/autosuspend.koplugin/main.lua:187","min":300,"max":2419200,"unit":"seconds","off":-1,"help":"How long the Kobo stays asleep before it switches itself off completely. Switched off it uses almost no battery, but waking it then takes longer, like a fresh start.","example":"The default is 259200 seconds (3 days): if you don't pick up the Kobo for 3 days, it turns itself off.","level":"basic"},
      {"key":"auto_standby_timeout_seconds","label":"Light power saving after","path":"Settings → Device → Autostandby timeout","type":"int","absent":-1,"effect":"next_book","source":"plugins/autosuspend.koplugin/main.lua:192","min":1,"max":900,"unit":"seconds","off":-1,"help":"Standby is a light power-saving state between page turns: the screen stays as it is and the Kobo wakes the moment you touch it. It saves some battery, but the first tap after a pause can feel a little slow, and it does not work while Wi-Fi is on. Off unless you set a time.","example":"Set it to 4 seconds: after 4 seconds without a touch the Kobo quietly saves power until your next tap.","level":"advanced"},
      {"key":"enable_charging_led","label":"Charging light","path":"Settings → Device","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:59","help":"Turns the small power light on while the Kobo is charging. Switch it off if the light bothers you, for example when charging at night next to your bed.","level":"basic"},
      {"key":"ignore_power_sleepcover","label":"Ignore the cover completely","path":"Settings → Device","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:221","help":"Only matters if you use a magnetic sleep cover. When on, closing or opening the cover does nothing: the Kobo will not sleep or wake with the cover. Takes effect after KOReader restarts.","level":"advanced"},
      {"key":"ignore_open_sleepcover","label":"Don't wake when cover opens","path":"Settings → Device","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:233","help":"Only matters if you use a magnetic sleep cover. When on, closing the cover still puts the Kobo to sleep, but opening it does not wake it; you wake it with the power button instead. Useful if the cover sometimes opens in your bag. Takes effect after KOReader restarts.","level":"advanced"},
      {"key":"device_status_battery_alarm","label":"Warn about battery level","path":"Settings → Device → Device status alerts → Battery level","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:132","help":"Shows a pop-up warning when the battery runs low (or reaches a high level while charging). The levels and how often it checks are set below.","level":"basic"},
      {"key":"device_status_battery_interval_minutes","label":"Check battery every","path":"Settings → Device → Device status alerts → Battery level","type":"int","absent":10,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:164","min":1,"max":60,"unit":"minutes","help":"How often the Kobo checks the battery for the warning above. Only used when the battery warning is on.","example":"Set it to 10 minutes: the battery level is checked every 10 minutes.","level":"advanced"},
      {"key":"device_status_battery_threshold","label":"Low battery warning at","path":"Settings → Device → Device status alerts → Battery level → Thresholds","type":"int","absent":20,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:208","min":1,"max":100,"unit":"%","help":"The battery level that counts as low: below it you get a warning (when the battery warning is on).","example":"Set it to 20%: when the battery drops under 20%, a message tells you to charge soon.","level":"basic"},
      {"key":"device_status_battery_threshold_high","label":"Full battery warning at","path":"Settings → Device → Device status alerts → Battery level → Thresholds","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:209","min":1,"max":100,"unit":"%","help":"The battery level that counts as high: above it you get a message, which can remind you to unplug the charger. Must be the same as or higher than the low level. At 100% you are only told when it is fully charged.","example":"Set it to 90%: when charging passes 90%, a message tells you so.","level":"advanced"},
      {"key":"device_status_memory_alarm","label":"Warn when memory runs high","path":"Settings → Device → Device status alerts → High memory usage","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:224","help":"Shows a warning when KOReader is using a lot of the Kobo's memory, which can make it slow or unstable after very long use. Rarely needed.","level":"advanced"},
      {"key":"device_status_memory_interval_minutes","label":"Check memory every","path":"Settings → Device → Device status alerts → High memory usage","type":"int","absent":5,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:255","min":1,"max":60,"unit":"minutes","help":"How often memory use is checked for the memory warning. Only used when that warning is on.","example":"Set it to 5 minutes: memory use is checked every 5 minutes.","level":"advanced"},
      {"key":"device_status_memory_threshold","label":"Memory warning above","path":"Settings → Device → Device status alerts → High memory usage","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:286","min":20,"max":500,"unit":"MB","help":"How much memory KOReader may use before you get a warning (or an automatic restart, if that is on).","example":"Set it to 100 MB: if KOReader uses more than 100 MB, you are warned.","level":"advanced"},
      {"key":"device_status_memory_auto_restart","label":"Restart by itself on high memory","path":"Settings → Device → Device status alerts → High memory usage","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdevicestatus.lua:299","help":"When memory use goes over the limit, KOReader restarts on its own instead of asking you. Your place in the book is kept, but the screen briefly goes back to the start.","level":"advanced"},
    ],
  },
  {
    id: "network", label: "Wi-Fi",
    summary: "How the Kobo handles its Wi-Fi connection.",
    affects: "Wi-Fi turns itself off or back on at different times, and fewer or more Wi-Fi questions pop up.",
    settings: [
      {"key":"auto_disable_wifi","label":"Turn Wi-Fi off when idle","path":"Settings → Network","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/network/manager.lua:975","help":"Turns Wi-Fi off by itself after a long while with no internet activity, so you can keep reading without Wi-Fi draining the battery. Takes effect after KOReader restarts.","level":"basic"},
      {"key":"auto_restore_wifi","label":"Reconnect Wi-Fi on wake","path":"Settings → Network","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/network/manager.lua:989","help":"When the Kobo wakes up or starts, it quietly reconnects to Wi-Fi, but only if Wi-Fi was on last time and you did not turn it off yourself. Handy because Lasci's Board syncs whenever Wi-Fi comes on, but it uses a little more battery.","level":"basic"},
      {"key":"wifi_disable_action","label":"When a task is done with Wi-Fi","path":"Settings → Network","type":"enum","absent":"prompt","effect":"immediate","source":"frontend/ui/network/manager.lua:1063","options":[{"value":"leave_on","label":"Keep Wi-Fi on"},{"value":"turn_off","label":"Turn Wi-Fi off"},{"value":"prompt","label":"Ask me each time"}],"help":"What happens after something that needed Wi-Fi (for example downloading news) has finished: keep Wi-Fi on, turn it off, or ask you each time.","level":"basic"},
      {"key":"auto_dismiss_wifi_scan","label":"Close Wi-Fi list once connected","path":"Settings → Network","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/network/manager.lua:1084","help":"When on, the list of Wi-Fi networks closes by itself as soon as the Kobo is connected. When off, it stays open until you close it.","level":"advanced"},
      {"key":"SSH_force_kill_clients","label":"Cut remote connections when stopping SSH","path":"Settings → Network → SSH server","type":"bool","absent":false,"effect":"next_book","source":"plugins/SSH.koplugin/main.lua:337","help":"SSH is a way to reach the Kobo from a computer over Wi-Fi (used for setting up Lasci's Board). When on, stopping SSH also cuts any computer that is still connected. Leave this alone unless you use SSH.","level":"advanced"},
    ],
  },
  {
    id: "taps_gestures", label: "Taps and page turns",
    summary: "How taps, swipes and long-presses on the screen are understood, including page turns, text selection and links.",
    affects: "Tapping, swiping and pressing on the screen does different things, or reacts faster or slower.",
    settings: [
      {"key":"disable_double_tap","label":"Turn off double tap","path":"Settings → Taps and gestures","type":"bool","absent":true,"effect":"restart","source":"frontend/ui/elements/common_settings_menu_table.lua:302","help":"When on (the usual setting), double tap does nothing and single taps react straight away. When off, you can give double taps their own actions, but every single tap waits a moment to see if a second tap follows, so page turns feel slower. Takes effect after KOReader restarts.","level":"advanced"},
      {"key":"ignore_hold_corners","label":"Ignore long-press in corners","path":"Settings → Taps and gestures","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/common_settings_menu_table.lua:293","help":"When on, pressing and holding in a corner of the screen does nothing, even if a shortcut is assigned to it. Useful if you trigger corner shortcuts by accident while holding the Kobo.","level":"advanced"},
      {"key":"activate_menu","label":"Open the menu by","path":"Settings → Taps and gestures → Activate menu","type":"enum","absent":"swipe_tap","effect":"next_book","source":"frontend/ui/elements/menu_activate.lua:15","options":[{"value":"swipe_tap","label":"Tap or swipe down"},{"value":"tap","label":"Tap only"},{"value":"swipe","label":"Swipe down only"}],"help":"How you open the top menu while reading: by tapping the top of the screen, by swiping down from the top, or both.","example":"Choose swipe only if you keep opening the menu by accident when tapping near the top.","level":"basic"},
      {"key":"show_bottom_menu","label":"Show bottom menu with top menu","path":"Settings → Taps and gestures → Activate menu","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/elements/menu_activate.lua:40","help":"When on, opening the top menu also opens the bottom menu (font, spacing and display settings) at the same time. When off, only the top menu appears and you open the bottom one separately.","level":"basic"},
      {"key":"multiswipes_enabled","label":"Allow multi-direction swipes","path":"Settings → Taps and gestures → Gesture manager","type":"bool","absent":false,"effect":"next_book","source":"plugins/gestures.koplugin/main.lua:857","help":"Lets you use special gestures made of several swipe directions without lifting your finger (for example down then right), each of which can be given its own action. Off by default; only useful if you set such gestures up.","level":"advanced"},
      {"key":"hold_pan_rate","label":"Screen updates while selecting","path":"Settings → Taps and gestures → Gesture intervals","type":"number","absent":"5 (low pan rate) / 30","effect":"immediate","source":"plugins/gestures.koplugin/main.lua:674","min":1,"max":60,"unit":"Hz","help":"How many times per second the screen redraws while you drag your finger to select text. Higher feels smoother but uses more battery and can make e-ink flicker more.","example":"Set it to 5 Hz: the selection updates 5 times a second as you drag.","level":"advanced"},
      {"key":"ges_tap_interval_ms","label":"Ignore repeat taps within","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":0,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:702","min":0,"max":2000,"unit":"ms","help":"Any extra tap made within this time after a tap is treated as accidental and ignored. 0 means every tap counts. Helps if the Kobo sometimes turns two pages when you meant one. Takes effect after KOReader restarts.","example":"Set it to 300 ms: a second tap less than a third of a second after the first is ignored.","level":"advanced"},
      {"key":"ges_tap_interval_on_keyboard_ms","label":"Ignore repeat key taps within","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":0,"effect":"next_book","source":"plugins/gestures.koplugin/main.lua:729","min":0,"max":2000,"unit":"ms","help":"The same as above, but only for the on-screen keyboard: a second tap this soon after a key press is ignored, which stops accidental double letters. 0 means every tap counts.","example":"Set it to 150 ms if you often get doubled letters when typing.","level":"advanced"},
      {"key":"ges_double_tap_interval_ms","label":"Double tap speed","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":300,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:755","min":100,"max":2000,"unit":"ms","help":"Only matters if double tap is turned on: how long the Kobo waits for a second tap. A single tap then takes at least this long to react. Takes effect after KOReader restarts.","example":"Set it to 300 ms: two taps within about a third of a second count as a double tap.","level":"advanced"},
      {"key":"ges_two_finger_tap_duration_ms","label":"Two-finger tap length","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":300,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:782","min":100,"max":2000,"unit":"ms","help":"The longest time two fingers can stay on the screen and still count as a two-finger tap. Takes effect after KOReader restarts.","example":"Set it to 300 ms: two fingers touching and lifting within a third of a second count as a two-finger tap.","level":"advanced"},
      {"key":"ges_hold_interval_ms","label":"Long-press time","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":500,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:810","min":100,"max":3000,"unit":"ms","help":"How long you must keep your finger down before it counts as a long-press (for example to select a word). Shorter makes selecting quicker; longer avoids selecting by accident. Takes effect after KOReader restarts.","example":"Set it to 500 ms: hold your finger for half a second to select a word.","level":"basic"},
      {"key":"ges_swipe_interval_ms","label":"Swipe speed limit","path":"Settings → Taps and gestures → Gesture intervals","type":"int","absent":900,"effect":"restart","source":"plugins/gestures.koplugin/main.lua:837","min":100,"max":2000,"unit":"ms","help":"How quick a finger movement must be to count as a swipe; anything slower counts as dragging. Raise it if your slow swipes are not recognised. Takes effect after KOReader restarts.","example":"Set it to 900 ms: a movement finished within 0.9 seconds counts as a swipe.","level":"advanced"},
      {"key":"page_turns_swipe_always_active","label":"Swipe always turns pages","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/page_turns.lua:117","help":"When on, swiping left or right always turns the page, even when another swipe action (such as following a link) would normally take over.","level":"advanced"},
      {"key":"page_turns_tap_zones","label":"Where to tap to turn pages","path":"Reader → Settings → Taps and gestures → Page turns → Tap zones","type":"enum","absent":"default","effect":"next_book","source":"frontend/ui/elements/page_turns.lua:23","options":[{"value":"default","label":"Usual (right = next, left = back)"},{"value":"left_right","label":"Left half back, right half next"},{"value":"top_bottom","label":"Top half back, bottom half next"},{"value":"bottom_top","label":"Bottom half back, top half next"}],"help":"Which parts of the screen turn the page when tapped. The usual layout uses the right side for next and the left side for back; you can also use the top and bottom halves instead.","level":"basic"},
      {"key":"page_turns_tap_zone_forward_size_ratio","label":"Size of the next-page area","path":"Reader → Settings → Taps and gestures → Page turns → Tap zones → size","type":"number","absent":"DTAP_ZONE_FORWARD.w","effect":"next_book","source":"frontend/ui/elements/page_turns.lua:78","min":0,"max":1,"step":0.01,"unit":"fraction of screen (menu edits 0-100 %)","help":"How much of the screen width (as a share, 0 to 1) turns to the next page when tapped. A bigger area makes it easier to turn forward with one hand.","example":"Set it to 0.7: tapping anywhere in the right 70% of the screen turns to the next page.","level":"basic"},
      {"key":"page_turns_tap_zone_backward_size_ratio","label":"Size of the previous-page area","path":"Reader → Settings → Taps and gestures → Page turns → Tap zones → size","type":"number","absent":"DTAP_ZONE_BACKWARD.w","effect":"next_book","source":"frontend/ui/elements/page_turns.lua:77","min":0,"max":1,"step":0.01,"unit":"fraction of screen","help":"How much of the screen width (as a share, 0 to 1) goes back a page when tapped.","example":"Set it to 0.25: only the left quarter of the screen goes back a page.","level":"basic"},
      {"key":"inverse_reading_order","label":"Reverse page turn direction","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/page_turns.lua:146","help":"Swaps the direction of page-turn taps and swipes, as for right-to-left books such as manga or Arabic. This is the starting choice for books you open for the first time; books already opened keep their own choice.","level":"advanced"},
      {"key":"invert_ui_layout","label":"Mirror contents and page views","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/page_turns.lua:183","help":"Mirrors the table of contents, book map and page browser so they read right to left. Meant to go together with reversed page turns. Only for books opened for the first time; others keep their own choice.","level":"advanced"},
      {"key":"swipe_animations","label":"Animated page turns","path":"Reader → Settings → Taps and gestures → Page turns","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/page_turns.lua:212","help":"Shows a sliding animation when you swipe to turn a page. On e-ink this is slow and can look jerky, so most people leave it off.","level":"advanced"},
      {"key":"scroll_method","label":"How scrolling follows your finger","path":"Reader → Settings → Taps and gestures → Scrolling","type":"enum","absent":"classic","effect":"next_book","source":"frontend/apps/reader/modules/readerscrolling.lua:209","options":[{"value":"classic","label":"Normal (follows your finger)"},{"value":"turbo","label":"Turbo (scrolls further, faster)"},{"value":"on_release","label":"Move only when you let go"}],"help":"Only used in continuous (scrolling) view, mostly for PDFs and comics. Normal follows your finger; turbo scrolls further for the same movement; on release moves the page only when you lift your finger, which is easier on e-ink.","level":"advanced"},
      {"key":"inertial_scroll","label":"Keep scrolling after a flick","path":"Reader → Settings → Taps and gestures → Scrolling","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerscrolling.lua:210","help":"In continuous (scrolling) view, a quick flick keeps the page moving for a moment after you lift your finger. Only works with the normal scrolling method.","level":"advanced"},
      {"key":"scroll_activation_delay","label":"Wait before scrolling starts","path":"Reader → Settings → Taps and gestures → Scrolling","type":"int","absent":0,"effect":"next_book","source":"frontend/apps/reader/modules/readerscrolling.lua:214","min":0,"max":2000,"unit":"ms","help":"In continuous (scrolling) view, a short wait before a finger movement starts scrolling, so swipe gestures are not mistaken for scrolling. 0 starts at once.","example":"Set it to 200 ms: the page only starts to scroll after your finger has moved for a fifth of a second.","level":"advanced"},
      {"key":"default_highlight_action","label":"What a long-press on text does","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"enum","absent":"ask","effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:2164","options":[{"value":"ask","label":"Show a menu of choices"},{"value":"nothing","label":"Do nothing"},{"value":"highlight","label":"Highlight it"},{"value":"select","label":"Select (adjust), then highlight"},{"value":"note","label":"Add a note"},{"value":"translate","label":"Translate"},{"value":"wikipedia","label":"Look up on Wikipedia"},{"value":"dictionary","label":"Look up in the dictionary"},{"value":"search","label":"Search the whole book"}],"help":"What happens after you press and hold to select text in a book: show a menu of choices, or go straight to one action such as highlighting or looking it up.","example":"Choose Highlight if you mostly mark passages: the selected text is highlighted at once without a menu.","level":"basic"},
      {"key":"highlight_action_on_single_word","label":"Single word: skip the dictionary","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:775","help":"Normally a long-press on one word opens the dictionary straight away, and the action above is used only for longer selections. Turn this on to use that action for single words too, instead of the dictionary.","level":"basic"},
      {"key":"highlight_dialog_position","label":"Where the text menu appears","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"enum","absent":"center","effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:804","options":[{"value":"top","label":"Top of the screen"},{"value":"center","label":"Middle of the screen"},{"value":"bottom","label":"Bottom of the screen"},{"value":"gesture","label":"Next to the selected text"}],"help":"Where the menu with highlight, note, dictionary and so on appears on the screen after you select text.","level":"advanced"},
      {"key":"highlight_prompt","label":"Ask for highlight style","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"enum","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:829","options":[{"value":"style","label":"Ask for the style"},{"value":"color","label":"Ask for the colour"},{"value":"all","label":"Ask for style and colour"}],"help":"Whether the Kobo asks you to pick a highlight style (for example underline or marker) each time you highlight. Not set means it never asks and uses your usual style. Colour choices are pointless on this black-and-white screen.","level":"advanced"},
      {"key":"highlight_long_hold_threshold_s","label":"Extra-long press time","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"number","absent":3,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:869","min":0.5,"max":20,"step":0.1,"unit":"seconds","help":"If you keep pressing longer than this, it counts as an extra-long press: instead of picking a single word, you can drag to select a longer passage. Must be longer than the normal long-press time.","example":"Set it to 3 seconds: hold for 3 seconds before dragging to select several lines.","level":"advanced"},
      {"key":"highlight_corner_scroll","label":"Select across pages","path":"Reader → Settings → Taps and gestures → Long-press on text","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:892","help":"While selecting text, dragging into the bottom-right corner shows part of the next page (or the top-left corner, part of the previous page), so you can highlight a passage that runs over a page break.","level":"advanced"},
      {"key":"tap_to_follow_links","label":"Tap links to follow them","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:521","help":"Tapping a link in a book (such as a footnote number or a chapter link) takes you there. Turn off if you keep hitting links when you just want to turn the page.","level":"basic"},
      {"key":"tap_ignore_external_links","label":"Ignore web links on tap","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:531","help":"Tapping a link to a website does nothing; links inside the book still work. Makes page turning easier in books full of web links. You can still open them with a long-press.","level":"advanced"},
      {"key":"swipe_to_go_back","label":"Swipe right to go back","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:543","help":"After following a link, swiping to the right brings you back to where you were. With nowhere to go back to, it goes to the previous page.","level":"basic"},
      {"key":"swipe_to_follow_nearest_link","label":"Swipe left to follow a link","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:552","help":"Swiping to the left follows the link nearest to where your swipe started. Handy when links are too small to tap easily.","level":"advanced"},
      {"key":"swipe_ignore_external_links","label":"Ignore web links on swipe","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:562","help":"Only used with swipe-to-follow-link: swipes skip links to websites and only follow links inside the book, such as footnotes.","level":"advanced"},
      {"key":"swipe_to_jump_to_latest_bookmark","label":"Swipe left to latest bookmark","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:574","help":"Swiping to the left jumps to the page you bookmarked most recently. Useful for flipping back and forth to a map, a list of characters or notes. If a swipe-to-follow-link option is on, this only works on pages without links.","level":"advanced"},
      {"key":"larger_tap_area_to_follow_links","label":"Easier-to-hit links","path":"Reader → Settings → Taps and gestures → Links","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:596","help":"Makes the tap area around links inside the book bigger, so tiny footnote numbers are easier to hit with a finger.","level":"advanced"},
      {"key":"footnote_link_in_popup","label":"Show footnotes in a pop-up","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:317","help":"When you tap a footnote link, the footnote text appears in a small pop-up over the page instead of jumping to the end of the book. Depending on the book, this does not always find the footnote correctly.","level":"basic"},
      {"key":"link_prefer_footnote","label":"Treat more links as footnotes","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:340","help":"Uses looser rules to decide what is a footnote, so more links open in the pop-up. Only used when footnote pop-ups are on.","level":"advanced"},
      {"key":"footnote_popup_use_book_font","label":"Book font in footnote pop-ups","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:356","help":"Shows footnote pop-ups in the same font you chose for the book, instead of the Kobo's menu font.","level":"advanced"},
      {"key":"footnote_popup_relative_font_size","label":"Footnote text size (vs book)","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings → Footnote popup font size","type":"int","absent":-2,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:411","min":-10,"max":5,"unit":"pt relative to book font","help":"How much smaller or larger footnote pop-up text is than the book text, in points. Setting this replaces a fixed footnote size.","example":"Set it to -2: footnotes appear 2 points smaller than the book text.","level":"advanced"},
      {"key":"footnote_popup_absolute_font_size","label":"Footnote text size (fixed)","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings → Footnote popup font size","type":"int","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:386","min":12,"max":255,"help":"A fixed text size for footnote pop-ups, whatever size the book text is. Setting this replaces the relative size above.","example":"Set it to 14: footnotes are always shown at size 14.","level":"advanced"},
      {"key":"footnote_popup_justify","label":"Even edges in footnote pop-ups","path":"Reader → Settings → Taps and gestures → Links → Footnote popup settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerlink.lua:442","help":"Lines up footnote text evenly on both the left and right edges (justified), like most book text. Off gives a ragged right edge.","level":"advanced"},
    ],
  },
  {
    id: "navigation", label: "Moving around a book",
    summary: "Going back, jumping around in a book, automatic page turning and what happens at the end of a book.",
    affects: "Going back, the end of a book and automatic page turning behave differently while you read.",
    settings: [
      {"key":"back_to_exit","label":"Back button exits KOReader","path":"Settings → Navigation → Back to exit","type":"enum","absent":"prompt","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:418","options":[{"value":"prompt","label":"Ask first"},{"value":"always","label":"Exit without asking"},{"value":"disable","label":"Never exit"}],"help":"Only for devices with a physical Back button, which the Clara BW does not have, so this has no effect on your Kobo.","level":"advanced"},
      {"key":"back_in_filemanager","label":"Back in the library","path":"Settings → Navigation → Back in file browser","type":"enum","absent":"default","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:449","options":[{"value":"default","label":"Exit"},{"value":"parent_folder","label":"Go up one folder"}],"help":"What a Back action does in the file browser (on this Kobo only through a gesture, as there is no Back button): leave KOReader, or go up one folder.","level":"advanced"},
      {"key":"back_in_reader","label":"Back while reading","path":"Settings → Navigation → Back in reader","type":"enum","absent":"previous_location","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:459","options":[{"value":"default","label":"Exit"},{"value":"filebrowser","label":"Return to the library"},{"value":"previous_location","label":"Back to where you jumped from"},{"value":"previous_read_page","label":"Back to the previous page you read"}],"help":"What a Back action does while reading (on this Kobo only through a gesture): go back to where you were before following a link, go to the previous page you read, return to the library, or leave KOReader.","level":"advanced"},
      {"key":"opening_page_location_stack","label":"Remember the opening page for Back","path":"Settings → Navigation","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/common_settings_menu_table.lua:507","help":"Adds the page where you opened the book to the list of places Back can return to. Then, after jumping somewhere through the contents, Back can bring you to where you started reading.","level":"advanced"},
      {"key":"skim_dialog_position","label":"Where the skim panel appears","path":"Settings → Navigation → Skim dialog position","type":"enum","absent":"center","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:521","options":[{"value":"top","label":"Top of the screen"},{"value":"bottom","label":"Bottom of the screen"}],"help":"Where the panel for quickly skimming through a book shows up on the screen. Leave it unset for the middle.","level":"advanced"},
      {"key":"end_document_auto_mark","label":"Mark book finished at the end","path":"Settings → Document → End of document action","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:771","help":"When you reach the last page, the book is marked as finished automatically. Lasci's Board then sees it as Finished on the next sync.","level":"basic"},
      {"key":"hide_nonlinear_flows","label":"Skip side sections","path":"Reader → Navigation tab (bookmark icon) → Hide non-linear fragments","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerrolling.lua:438","help":"Some EPUB books contain side sections (like answers or extra notes) that are meant to be reached only through links. When on, these are left out of normal page turning but still open through links and the contents. Only for EPUBs, only for books opened for the first time, and only in single-page view.","level":"advanced"},
      {"key":"autoturn_enabled","label":"Turn pages automatically","path":"Reader → Navigation tab (bookmark icon) → Autoturn","type":"bool","absent":false,"effect":"next_book","source":"plugins/autoturn.koplugin/main.lua:163","help":"Turns to the next page by itself after a set time, so you can read hands-free. The time is set below.","level":"basic"},
      {"key":"autoturn_timeout_seconds","label":"Automatic page turn every","path":"Reader → Navigation tab (bookmark icon) → Autoturn","type":"int","absent":0,"effect":"next_book","source":"plugins/autoturn.koplugin/main.lua:161","min":1,"max":86400,"unit":"seconds","help":"How long each page stays on screen before it turns by itself, when automatic page turning is on.","example":"Set it to 60 seconds: the next page appears every minute.","level":"basic"},
      {"key":"autoturn_distance","label":"Pages per automatic turn","path":"Reader → Navigation tab (bookmark icon) → Autoturn (long-press)","type":"number","absent":1,"effect":"next_book","source":"plugins/autoturn.koplugin/main.lua:186","min":-20,"max":20,"unit":"pages (fractional = % of page in scroll mode)","help":"How far each automatic turn moves: 1 is one page forward, a negative number goes backward. In scrolling view a fraction scrolls part of a page.","example":"Set it to 0.5 in scrolling view: each automatic turn scrolls half a screen.","level":"advanced"},
    ],
  },
  {
    id: "document", label: "Reading history and notes",
    summary: "How the Kobo saves your place, your reading history and your highlights and notes.",
    affects: "Your history list, saved reading position and exported highlights are kept in a different way.",
    settings: [
      {"key":"auto_save_settings_interval_minutes","label":"Save reading position","path":"Settings → Document → Save book metadata","type":"enum","absent":15,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:568","options":[{"value":false,"label":"Only when closing or sleeping"},{"value":5,"label":"Every 5 minutes"},{"value":15,"label":"Every 15 minutes"},{"value":30,"label":"Every 30 minutes"},{"value":60,"label":"Every hour"}],"help":"How often your place in the book, highlights and book settings are saved while you read. They are always saved when you close the book or the Kobo goes to sleep; saving more often protects you if the Kobo crashes or the battery dies.","level":"advanced"},
      {"key":"document_metadata_arc_folder","label":"Archive folder","path":"Settings → Document → Book metadata archive","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:732","maxLength":500,"help":"The folder where saved copies of a book's reading data (position, highlights, notes) are kept, so they can be restored if you put the book back later. Changing it here does not move archives already made.","level":"advanced"},
      {"key":"document_metadata_arc_on_closing","label":"Archive reading data on close","path":"Settings → Document → Book metadata archive","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:748","help":"Every time you close a book, a copy of its reading data (position, highlights, notes) is saved in the archive folder.","level":"advanced"},
      {"key":"document_metadata_arc_on_deletion","label":"Archive reading data on delete","path":"File browser → long-press file → Delete → checkbox","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanager.lua:1164","help":"When you delete a book on the Kobo, a copy of its reading data (position, highlights, notes) is kept in the archive folder first, so nothing is lost if you add the book again.","level":"advanced"},
      {"key":"history_datetime_short","label":"Short dates in history","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:267","help":"Shows shorter dates and times next to books in the reading history list, leaving more room for titles.","level":"advanced"},
      {"key":"history_freeze_finished_books","label":"Keep finished books in place","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:277","help":"Opening a book you have already finished does not move it to the top of the history list; its last-read date stays as it was and it is shown greyed out.","level":"advanced"},
      {"key":"autoremove_deleted_items_from_history","label":"Remove deleted books from history","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:299","help":"When a book is deleted from the Kobo, it is also taken off the history list automatically, instead of staying there greyed out.","level":"advanced"},
      {"key":"open_last_menu_show_filename","label":"File name in Open previous","path":"File browser → File browser settings tab (folder icon) → Settings → History settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:309","help":"The menu item for opening the previous book shows the book's file name instead of its title.","level":"advanced"},
      {"key":"annotations_export_on_closing","label":"Export highlights on close","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:256","help":"Every time you close a book, its highlights and notes are saved to a separate file, so they can be copied to another reader or kept as a backup.","level":"advanced"},
      {"key":"annotations_export_keep_all_on_import","label":"Keep all highlights when importing","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:257","help":"When highlights are imported from another device's export, highlights here that are not in that export are kept. When off, older ones that were left out of the export are removed.","level":"advanced"},
      {"key":"annotations_export_folder","label":"Highlights export folder","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:272","maxLength":500,"help":"The folder where exported highlights and notes are saved and looked for on import. Not set means next to each book's own reading data.","level":"advanced"},
      {"key":"notebook_file","label":"Default notebook file","path":"Book information → Notebook → Set as default","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/filemanager/filemanagerbookinfo.lua:859","maxLength":500,"help":"The text file used as your notebook for books that don't have their own. Not set means each book gets its own notebook file next to the book.","example":"Set it to one file in your home folder to keep notes from all your books in a single notebook.","level":"advanced"},
    ],
  },
  {
    id: "file_browser", label: "Library screen",
    summary: "How the Kobo's list of books and folders looks and behaves, and where certain files are saved.",
    affects: "You will see the change on the Kobo's home screen with your books and folders, usually the next time the list refreshes.",
    settings: [
      {"key":"shorten_home_dir","label":"Show home folder as \"Home\"","path":"File browser → File browser settings tab (folder icon) → Settings → Home folder settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:337","help":"When on, the top of the library screen shows your home folder simply as \"Home\" instead of its full storage path. Purely cosmetic.","example":"On: the title bar reads \"Home\" instead of \"/mnt/onboard\".","level":"advanced"},
      {"key":"lock_home_folder","label":"Lock home folder","path":"File browser → File browser settings tab (folder icon) → Settings → Home folder settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:359","help":"When on, you cannot go up out of your home folder in the library screen, so you stay among your books and never wander into system folders.","example":"Turn it on if you keep ending up in strange system folders by tapping \"..\" by accident.","level":"basic"},
      {"key":"file_ask_to_open","label":"Ask before opening a book","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:372","help":"When on, tapping a book first asks \"Open this file?\" with Open and Cancel, instead of opening it straight away.","example":"Useful if you often open books by accident while scrolling.","level":"basic"},
      {"key":"show_parent_folder","label":"Show \"go up\" entry in folders","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:381","help":"When on, each folder starts with a \"..\" entry you can tap to go back up one folder. When off, that entry is hidden and you go back another way.","level":"advanced"},
      {"key":"collection_show_mark","label":"Mark books that are in a collection","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:391","help":"When on, books that you have added to a collection (such as Favorites) get a small mark in the library list.","level":"basic"},
      {"key":"show_flat_view","label":"Show all books in one list","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/widget/filechooser.lua:23","help":"When on, a folder shows every book from all its subfolders together in one long list, without the folders. May need a restart of the reader app to take effect.","example":"On: if your books are split into author folders, you see all of them at once on the home screen.","level":"basic"},
      {"key":"show_hidden","label":"Show hidden files","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/widget/filechooser.lua:24","help":"When on, the library also shows hidden files and folders (names starting with a dot), which are normally system files. Best left off. May need a restart to take effect.","level":"advanced"},
      {"key":"show_unsupported","label":"Show files that cannot be opened","path":"File browser → File browser settings tab (folder icon) → Settings","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/widget/filechooser.lua:25","help":"When on, the library also lists files the Kobo cannot read (for example .txt notes from other apps or random downloads). When off, only readable books are shown. May need a restart to take effect.","level":"advanced"},
      {"key":"collate","label":"Sort books by","path":"File browser → File browser settings tab (folder icon) → Sort by","type":"enum","absent":"strcoll","effect":"immediate","source":"frontend/ui/widget/filechooser.lua:207","options":[{"value":"strcoll","label":"Name"},{"value":"natural","label":"Name (numbers in order, so 2 before 10)"},{"value":"access","label":"Last read"},{"value":"date","label":"Date the file changed"},{"value":"size","label":"File size"},{"value":"type","label":"File type"},{"value":"percent_unopened_first","label":"Progress, unread first"},{"value":"percent_unopened_last","label":"Progress, unread last"},{"value":"percent_natural","label":"Progress, unread and finished last"},{"value":"title","label":"Title"},{"value":"authors","label":"Author"},{"value":"series","label":"Series"},{"value":"keywords","label":"Keywords"},{"value":"rating","label":"Your rating"}],"help":"Chooses the order of books in the library list. The new order shows the next time the list refreshes.","example":"Choose \"Last read\" to keep the books you are reading now at the top.","level":"basic"},
      {"key":"reverse_collate","label":"Reverse sort order","path":"File browser → File browser settings tab (folder icon)","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:458","help":"Flips the library order upside down, for example Z to A, or oldest read first.","level":"basic"},
      {"key":"collate_mixed","label":"Mix folders in with books","path":"File browser → File browser settings tab (folder icon)","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:473","help":"When off, folders are always listed first and books after them. When on, folders and books are sorted together in one list.","level":"advanced"},
      {"key":"items_per_page","label":"Books per page (list view)","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"int","absent":14,"effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:179","min":6,"max":30,"help":"How many lines the library list shows on one page when it is in the plain list view (without covers). More lines means smaller text per line. Does not change the cover view.","example":"Set it to 10: fewer, larger entries per page, easier to tap.","level":"basic"},
      {"key":"items_font_size","label":"Text size in list view","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"int","absent":"derived from items per page","effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:211","min":10,"max":72,"help":"Text size of book names in the plain list view (without covers). If not set, the Kobo picks a size to fit the number of books per page.","level":"advanced"},
      {"key":"items_multilines_show_more_text","label":"Shrink text to fit long names","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:226","help":"When on, long book names in the plain list view use a smaller text so more of the name fits, instead of being cut off.","level":"advanced"},
      {"key":"show_file_in_bold","label":"Which books are shown in bold","path":"File browser → File browser settings tab (folder icon) → Settings → Classic mode settings","type":"enum","absent":"new (not yet opened) files in bold","effect":"next_book","source":"frontend/apps/filemanager/filemanagermenu.lua:240","options":[{"value":"opened","label":"Books you have opened"},{"value":false,"label":"No books in bold"}],"help":"In the plain list view, chooses which books are highlighted in bold. If not set, books you have never opened are shown in bold, so new arrivals stand out.","level":"advanced"},
      {"key":"keyvalues_per_page","label":"Lines per page in info screens","path":"File browser → File browser settings tab (folder icon) → Settings","type":"int","absent":"DPI-derived","effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:434","min":10,"max":30,"help":"How many lines fit on one page in information screens such as book details and some settings lists, when the Kobo is held upright. Higher means smaller text. If not set, the Kobo picks a size for its screen.","level":"advanced"},
      {"key":"keyvalues_per_page_landscape","label":"Lines per page in info screens (sideways)","path":"File browser → File browser settings tab (folder icon) → Settings","type":"int","absent":"DPI-derived","effect":"immediate","source":"frontend/apps/filemanager/filemanagermenu.lua:439","min":10,"max":30,"help":"Same as the line above, but for when the screen is turned sideways. Your Kobo has no rotation sensor, so this only matters if you rotate the screen by hand.","level":"advanced"},
      {"key":"download_dir","label":"Folder for downloaded books","path":"Folder shortcuts / OPDS → Set download folder","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/filemanager/filemanagershortcuts.lua:53","maxLength":500,"help":"The folder where books downloaded from an online catalogue are saved. If not set, the Kobo uses the last folder you picked. Must be a folder path on the Kobo.","level":"advanced"},
      {"key":"inbox_dir","label":"Folder for books from Calibre","path":"Tools tab (🔧) → Calibre → Wireless settings → Set inbox folder","type":"string","absent":null,"effect":"immediate","source":"plugins/calibre.koplugin/wireless.lua:229","maxLength":500,"help":"The folder where books sent wirelessly from the Calibre program on a computer are saved. Only matters if you use Calibre's wireless sending.","level":"advanced"},
      {"key":"screenshot_dir","label":"Screenshot folder","path":"Settings → Device → Screenshot folder","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/widget/screenshoter.lua:149","maxLength":500,"help":"The folder where screenshots you take on the Kobo are saved. If not set, they go into a screenshots folder inside the reader app's own folder.","level":"advanced"},
    ],
  },
  {
    id: "defaults_reflowable", label: "Page layout for new books",
    summary: "Starting page layout (margins, text size, spacing, contrast) for normal ebooks such as EPUB.",
    affects: "Only books you open for the first time after the change start with these values; books you have already opened keep their own layout.",
    settings: [
      {"key":"copt_rotation_mode","label":"Screen rotation","path":"Reader → bottom menu (config dialog) → Rotation tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:55","options":[{"value":0,"label":"Upright (normal)"},{"value":1,"label":"Sideways, turned right"},{"value":2,"label":"Upside down"},{"value":3,"label":"Sideways, turned left"}],"help":"Which way new books are shown on the screen. Your Kobo has no rotation sensor, so this is the only way to read sideways or upside down.","example":"Choose 90 degrees to read a new book with the Kobo held sideways.","level":"advanced"},
      {"key":"copt_visible_pages","label":"Two pages side by side","path":"Reader → bottom menu (config dialog) → Rotation tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:103","options":[{"value":1,"label":"Off"},{"value":2,"label":"On"}],"help":"When on, the text is shown as two pages next to each other, like an open book. Only works when the screen is turned sideways and in page mode.","level":"advanced"},
      {"key":"copt_h_page_margins","label":"Left and right margins","path":"Reader → bottom menu (config dialog) → Margins tab","type":"list","absent":[10,10],"effect":"next_book","source":"frontend/ui/data/creoptions.lua:134","unit":"px at 160 dpi","list":{"length":2,"nullable":false,"integer":true,"editor":"pair","labels":["Left","Right"],"ranges":[[0,140]]},"help":"Empty space on the left and right of the text, for books you open from now on. Bigger numbers give narrower lines of text. Each side can be set on its own (0 to 140).","example":"15 and 15: a little more white space than the standard 10 and 10.","level":"basic"},
      {"key":"copt_sync_t_b_page_margins","label":"Same top and bottom margin","path":"Reader → bottom menu (config dialog) → Margins tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:179","options":[{"value":0,"label":"Off (set separately)"},{"value":1,"label":"On (kept equal)"}],"help":"When on, the top and bottom margins are kept equal, so changing one changes the other and the text sits centred on the page.","level":"basic"},
      {"key":"copt_t_page_margin","label":"Top Margin","path":"Reader → bottom menu (config dialog) → Margins tab","type":"int","absent":15,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:195","min":0,"max":140,"step":1,"unit":"px at 160 dpi","help":"Empty space above the text on each page. Higher values give a wider white strip at the top and fewer lines per page.","example":"Set it to 30: a calmer page with more space at the top.","level":"basic"},
      {"key":"copt_b_page_margin","label":"Bottom Margin","path":"Reader → bottom menu (config dialog) → Margins tab","type":"int","absent":15,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:248","min":0,"max":140,"step":1,"unit":"px at 160 dpi","help":"Empty space below the text on each page. Higher values give a wider white strip at the bottom and fewer lines per page.","level":"basic"},
      {"key":"copt_view_mode","label":"Pages or scrolling","path":"Reader → bottom menu (config dialog) → Page tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:305","options":[{"value":0,"label":"Pages"},{"value":1,"label":"Continuous scrolling"}],"help":"Page splits the book into separate pages you turn one by one, like paper. Continuous lets you scroll the text up and down like a web page.","level":"basic"},
      {"key":"copt_block_rendering_mode","label":"How closely to follow the book's design","path":"Reader → bottom menu (config dialog) → Page tab","type":"enum","absent":2,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:317","options":[{"value":0,"label":"Legacy (oldest, simplest)"},{"value":1,"label":"Flat (simple, tidy pages)"},{"value":2,"label":"Book (recommended)"},{"value":3,"label":"Web (closest to the design)"}],"help":"Controls how much of the publisher's page design is used. \"Book\" is a safe middle ground; \"Web\" follows the design most closely but can leave odd gaps or cut-off text; \"Flat\" and \"Legacy\" are simpler and plainer.","level":"advanced"},
      {"key":"copt_render_dpi","label":"Size of pictures and fixed sizes","path":"Reader → bottom menu (config dialog) → Page tab","type":"enum","absent":96,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:332","options":[{"value":0,"label":"off"},{"value":48,"label":"48"},{"value":96,"label":"96"},{"value":167,"label":"167"},{"value":212,"label":"212"},{"value":300,"label":"300"}],"help":"Scales pictures and anything the book sets to a fixed size (in centimetres or pixels). Higher values make pictures and such elements larger; \"off\" ignores fixed sizes. Normal text size is set separately.","example":"Set 167 if pictures in your books look tiny.","level":"advanced"},
      {"key":"copt_line_spacing","label":"Line Spacing","path":"Reader → bottom menu (config dialog) → Page tab","type":"int","absent":100,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:361","min":50,"max":200,"step":1,"unit":"%","help":"Space between lines of text, as a percentage. Above 100% spreads the lines apart; below 100% packs them closer together.","example":"Set line spacing to 120%: lines sit a little further apart, easier on tired eyes.","level":"basic"},
      {"key":"copt_font_size","label":"Text size","path":"Reader → bottom menu (config dialog) → Font tab","type":"number","absent":22,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:416","min":12,"max":255,"step":0.5,"unit":"px at 160 dpi (menu also shows pt)","help":"The starting text size for new books. Higher numbers mean bigger letters and fewer words per page.","example":"Set 26 instead of 22 for noticeably larger, easier-to-read text.","level":"basic"},
      {"key":"copt_word_spacing","label":"Word spacing","path":"Reader → bottom menu (config dialog) → Font tab","type":"list","absent":[95,75],"effect":"next_book","source":"frontend/ui/data/creoptions.lua:457","unit":"%","list":{"length":2,"nullable":false,"integer":true,"editor":"pair","labels":["Scaling","Reduction"],"positions":[[10,500],[25,100]]},"help":"Two numbers for the space between words, for books you open from now on. Scaling makes every space wider or narrower than normal (100 % = normal). Reduction is how far spaces may then shrink to fit more words on a line (100 % = never shrink).","example":"Small 75 / 50, medium 95 / 75 (the standard), large 100 / 90.","level":"advanced"},
      {"key":"copt_word_expansion","label":"Letter spacing to fill lines","path":"Reader → bottom menu (config dialog) → Font tab","type":"int","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:500","min":0,"max":20,"unit":"%","help":"When a line is stretched to reach both edges and the gaps between words get too wide, this allows a little extra space between letters instead. 0 means never; higher values allow more.","example":"Set 5%: fewer big holes between words on narrow lines.","level":"advanced"},
      {"key":"copt_cjk_width_scaling","label":"Width of Chinese/Japanese/Korean characters","path":"Reader → bottom menu (config dialog) → Font tab → Word Expansion → CJK scaling","type":"int","absent":100,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:544","min":100,"max":150,"unit":"%","help":"Makes Chinese, Japanese and Korean characters a bit wider, as a percentage. Has no effect on books in other languages.","level":"advanced"},
      {"key":"copt_font_gamma","label":"Text darkness","path":"Reader → bottom menu (config dialog) → Font tab","type":"enum","absent":15,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:571","options":[{"value":10,"label":"0.8"},{"value":15,"label":"1.0"},{"value":25,"label":"1.45"},{"value":30,"label":"1.9"},{"value":36,"label":"2.5"},{"value":43,"label":"4.0"},{"value":49,"label":"8.0"},{"value":56,"label":"15.0"}],"help":"How dark and crisp the text looks. Higher values make letters darker and bolder-looking; lower values make them lighter and greyer.","example":"Choose 1.45 if text looks a bit faint in daylight.","level":"basic"},
      {"key":"copt_font_base_weight","label":"Text thickness","path":"Reader → bottom menu (config dialog) → Font tab","type":"number","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:596","min":-3,"max":5.5,"step":0.25,"help":"Makes all letters thinner or thicker. 0 is normal; positive values thicken the letters (up to bold), negative values make them thinner. Works best with fonts that come in several weights.","example":"Set +0.5: slightly heavier letters that are easier to read on e-ink.","level":"basic"},
      {"key":"copt_font_hinting","label":"Letter sharpening","path":"Reader → bottom menu (config dialog) → Font tab","type":"enum","absent":2,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:630","options":[{"value":0,"label":"Off"},{"value":1,"label":"Use the font's own sharpening"},{"value":2,"label":"Automatic (recommended)"}],"help":"Adjusts letter shapes slightly so they line up with the screen's dots and look sharper. \"Auto\" usually looks best; differences are small.","level":"advanced"},
      {"key":"copt_font_kerning","label":"Spacing between letter pairs","path":"Reader → bottom menu (config dialog) → Font tab","type":"enum","absent":3,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:645","options":[{"value":0,"label":"Off"},{"value":1,"label":"Fast"},{"value":2,"label":"Good"},{"value":3,"label":"Best (recommended)"}],"help":"Kerning is fine-tuning the gap between certain letter pairs (like \"AV\") so words look even. \"Best\" looks nicest and joins letters like \"fi\" together; \"off\" is plainest.","level":"advanced"},
      {"key":"copt_status_line","label":"Extra status line at the top","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:668","options":[{"value":1,"label":"Off"},{"value":0,"label":"On"}],"help":"When on, a thin line with information such as page and time is shown at the top of the page. The normal status bar at the bottom is separate and not affected.","level":"advanced"},
      {"key":"copt_embedded_css","label":"Use the publisher's styling","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:681","options":[{"value":0,"label":"Off (plain look)"},{"value":1,"label":"On (publisher's design)"}],"help":"When on, the book's own design (indents, headings, spacing chosen by the publisher) is used. When off, books get a plain, uniform look.","example":"Turn it off if a publisher's layout has tiny text or strange spacing you cannot fix otherwise.","level":"basic"},
      {"key":"copt_embedded_fonts","label":"Use the book's own fonts","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:693","options":[{"value":0,"label":"Off (always my font)"},{"value":1,"label":"On (book's fonts)"}],"help":"When on, fonts that come inside the book are used. When off, your chosen font is used for everything.","example":"Turn it off if you want every book in the same font you like.","level":"basic"},
      {"key":"copt_smooth_scaling","label":"Picture quality","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:720","options":[{"value":0,"label":"Fast"},{"value":1,"label":"Best"}],"help":"How pictures inside the book are resized. \"Best\" looks smoother but is a little slower; \"Fast\" is quicker but pictures can look rough.","level":"advanced"},
      {"key":"copt_nightmode_images","label":"Invert pictures in night mode","path":"Reader → bottom menu (config dialog) → Contrast/other tab","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/creoptions.lua:732","options":[{"value":0,"label":"Off (keep pictures as they are)"},{"value":1,"label":"On (invert pictures)"}],"help":"Only matters when night mode (white text on black) is on. When on, pictures are inverted too so they match the dark page; turn it off if pictures look wrong, such as photos or diagrams.","level":"advanced"},
      {"key":"copt_overlap_lines","label":"Lines repeated when scrolling","path":"Reader → Typeset tab (document icon) → Page overlap","type":"int","absent":1,"effect":"next_book","source":"frontend/ui/elements/page_overlap.lua:61","min":1,"max":10,"help":"Only in continuous scrolling with page overlap turned on: how many lines from the previous screen are repeated at the top of the next one, so you do not lose your place.","level":"advanced"},
      {"key":"copt_css","label":"Default book style","path":"Reader → Typeset tab (document icon) → Style → long-press a CSS","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypeset.lua:470","maxLength":500,"help":"The basic style sheet (a set of layout rules) used for books that have no style of their own chosen yet. Leave it empty unless you know which style you want.","level":"advanced"},
      {"key":"copt_fb2_css","label":"Default style for FB2 books","path":"Reader → Typeset tab (document icon) → Style → long-press a CSS (in an FB2)","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypeset.lua:468","maxLength":500,"help":"Same as the default book style, but only for books in the FB2 format, which is common for Russian ebooks. Not relevant for EPUB books.","level":"advanced"},
      {"key":"txt_preformatted","label":"Plain text files: auto-detect layout","path":"Reader → Typeset tab (document icon) → Style","type":"enum","absent":"lines as written","effect":"next_book","source":"frontend/apps/reader/modules/readertypeset.lua:343","options":[{"value":0,"label":"Auto-detect layout on"}],"help":"Only for plain .txt files. If not set, each line of the file is shown exactly as written. When auto-detect is on, the Kobo tries to find paragraphs and headings to make the text read like a book.","level":"advanced"},
    ],
  },
  {
    id: "fonts_typography", label: "Fonts and word breaking",
    summary: "Which fonts new ebooks use and how words are split and lined up at the ends of lines.",
    affects: "Most of these only change books opened for the first time after the change; books you have already opened keep their own settings.",
    settings: [
      {"key":"cre_font","label":"Default font","path":"Reader → Typeset tab (document icon) → Font → long-press a font → Default","type":"string","absent":"Noto Serif","effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:329","maxLength":500,"font":"face","help":"The font new books start with. Pick one of the fonts the Kobo has: the list comes from the Kobo itself after its next sync (until then, the fonts that come with KOReader). Your own fonts go in the \"fonts\" folder on the Kobo. Default: Noto Serif.","example":"Pick \"Noto Sans\" to read every new book in a font without serifs.","level":"basic"},
      {"key":"fallback_font","label":"Fallback font","path":"Reader → Typeset tab (document icon) → Font → long-press a font → Fallback","type":"string","absent":"Noto Sans CJK SC","effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:353","maxLength":500,"font":"face","help":"The font used for characters your main font does not have, for example Chinese or rare symbols. Usually best left as it is. Default: Noto Sans CJK SC.","level":"advanced"},
      {"key":"monospace_font","label":"Font for computer code","path":"Reader → Typeset tab (document icon) → Font → long-press a font → Monospace","type":"string","absent":"Droid Sans Mono","effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:334","maxLength":500,"font":"face","help":"The fixed-width font (every letter the same width) used for computer code or typewriter-style text in books. Default: Droid Sans Mono.","level":"advanced"},
      {"key":"cre_font_family_ignore_font_names","label":"Prefer my fonts over publisher font names","path":"Reader → Typeset tab (document icon) → Font → Font settings → Font-family fonts","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:482","help":"Some books ask for a specific named font before a general font type. When on, those names are ignored so the fonts you assigned to each font type are always used.","level":"advanced"},
      {"key":"font_menu_use_font_face","label":"Show font names in their own font","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerfont.lua:697","help":"When on, each font in the font menu is written in that font, so you can preview how it looks. Changes the menu only, not the book.","level":"basic"},
      {"key":"font_menu_sort_by_recently_selected","label":"Recently used fonts first","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:708","help":"When on, the font menu lists the fonts you picked most recently at the top instead of alphabetically.","level":"basic"},
      {"key":"additional_fallback_fonts","label":"Use extra backup fonts","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:738","help":"When on, the Kobo also tries other installed fonts for characters missing from your main and fallback font, so fewer empty boxes appear in unusual text.","level":"advanced"},
      {"key":"cre_adjusted_fallback_font_sizes","label":"Match size of backup fonts","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:758","help":"When on, characters drawn with a backup font are resized to match the main text, so they do not look too big or too small.","level":"advanced"},
      {"key":"cre_monospace_scaling","label":"Size of computer-code text","path":"Reader → Typeset tab (document icon) → Font → Font settings","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerfont.lua:788","min":30,"max":150,"unit":"%","help":"Makes fixed-width text (such as computer code) larger or smaller compared to the rest, as a percentage.","level":"advanced"},
      {"key":"hyphenation","label":"Split long words at line ends","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:334","help":"Hyphenation means breaking a word with a hyphen at the end of a line. When on, lines are more even with fewer big gaps between words; when off, words are never split.","example":"On: \"reading\" may become \"read-\" / \"ing\" across two lines.","level":"basic"},
      {"key":"hyph_left_hyphen_min","label":"Minimum letters before a break","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation → Left/right minimal sizes","type":"int","absent":"language default","effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:393","min":1,"max":10,"unit":"characters","help":"Only when splitting words is on: the fewest letters that must stay on the first line before the hyphen. Higher values mean fewer, longer splits. If not set, the book language's usual rule is used.","example":"Set 3: \"a-bout\" will never happen, only splits like \"abo-ut\" or later.","level":"advanced"},
      {"key":"hyph_right_hyphen_min","label":"Minimum letters after a break","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation → Left/right minimal sizes","type":"int","absent":"language default","effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:394","min":1,"max":10,"unit":"characters","help":"Only when splitting words is on: the fewest letters that must move to the next line after the hyphen. Higher values avoid short leftovers. If not set, the book language's usual rule is used.","level":"advanced"},
      {"key":"hyph_trust_soft_hyphens","label":"Use the book's own split points","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:429","help":"Some books mark exactly where words may be split. When on, those marks are used first, and the Kobo's own rules only for words without marks.","level":"advanced"},
      {"key":"hyph_force_algorithmic","label":"Split words by general rules","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:487","help":"When on, words are split using simple general rules instead of the language's dictionary of split points. Useful only when no dictionary exists for the book's language.","level":"advanced"},
      {"key":"hyph_soft_hyphens_only","label":"Only use the book's own split points","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:525","help":"When on, words are split only where the book itself marks it, never by the Kobo's rules. Books without such marks will then have no split words.","level":"advanced"},
      {"key":"hyph_user_dict","label":"Use my own word-split list","path":"Reader → Typeset tab (document icon) → Typography rules → Hyphenation","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readeruserhyph.lua:96","help":"When on, your own list of how specific words should be split is used before the normal rules. Only useful if you have made such a list on the Kobo.","level":"advanced"},
      {"key":"floating_punctuation","label":"Let punctuation hang in the margin","path":"Reader → Typeset tab (document icon) → Typography rules","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:632","help":"When on, commas, full stops and quote marks at the edge of a line are pushed slightly into the margin, so the text edge looks straighter, as in fine printed books.","level":"advanced"},
      {"key":"text_lang_embedded_langs","label":"Follow language marks inside the book","path":"Reader → Typeset tab (document icon) → Typography rules","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:307","help":"When on, if a book marks some passages as another language (say, a French quote in an English novel), word splitting and other language rules follow that mark for those passages.","level":"advanced"},
      {"key":"text_lang_default","label":"Always use this language for text rules","path":"Reader → Typeset tab (document icon) → Typography rules → long-press a language → Default","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:261","maxLength":500,"help":"Forces one language for word splitting and similar rules in every new book, ignoring the language the book says it is in. Use a short code such as en-US, nb or tr. If empty, the book's own language is used, else English.","example":"Set \"nb\" if you only read Norwegian books and some are wrongly marked as English.","level":"advanced"},
      {"key":"text_lang_fallback","label":"Language when the book has none","path":"Reader → Typeset tab (document icon) → Typography rules → long-press a language → Fallback","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readertypography.lua:267","maxLength":500,"help":"The language used for word splitting and similar rules only when a book does not say which language it is in. Use a short code such as en-US, nb or tr.","example":"Set \"tr\" so unlabelled Turkish books still get proper word splitting.","level":"advanced"},
      {"key":"cre_partial_rerendering","label":"Faster re-layout after changes","path":"Settings → Document (reader) → Enable partial renderings","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerrolling.lua:491","help":"When on, after you change font or size the Kobo only re-lays out the part of the book you are reading first, so you can keep reading sooner. Turn it off only if you see layout glitches.","level":"advanced"},
      {"key":"page_overlap_enable","label":"Repeat lines when scrolling","path":"Reader → Typeset tab (document icon) → Page overlap (long-press)","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/page_overlap.lua:35","help":"Only in continuous scrolling: when on, a few lines from the previous screen stay visible at the top of the next, so you do not lose your place.","level":"advanced"},
      {"key":"page_overlap_style","label":"How repeated lines are marked","path":"Reader → Typeset tab (document icon) → Page overlap","type":"enum","absent":"dim","effect":"next_book","source":"frontend/ui/elements/page_overlap.lua:93","options":[{"value":"none","label":"No mark"},{"value":"dim","label":"Greyed out"},{"value":"arrow","label":"Arrow"},{"value":"line","label":"Solid line"},{"value":"dashed_line","label":"Dashed line"}],"help":"Only when repeating lines while scrolling is on: how the repeated lines from the previous screen are marked so you can tell where new text starts.","level":"advanced"},
    ],
  },
  {
    id: "defaults_fixed", label: "PDFs and comics",
    summary: "Starting view for PDFs, scanned books and comics, whose pages have a fixed layout.",
    affects: "Only PDFs and comics opened for the first time after the change start this way; normal ebooks are not affected, and files you have already opened keep their own view.",
    settings: [
      {"key":"kopt_rotation_mode","label":"Screen rotation (PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:45","options":[{"value":0,"label":"Upright (normal)"},{"value":1,"label":"Sideways, turned right"},{"value":2,"label":"Upside down"},{"value":3,"label":"Sideways, turned left"}],"help":"Which way new PDFs and comics are shown. Your Kobo has no rotation sensor; sideways can help with wide pages.","level":"advanced"},
      {"key":"kopt_trim_page","label":"Cut off empty page edges","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:99","options":[{"value":3,"label":"None (keep whole page)"},{"value":1,"label":"Automatic"},{"value":2,"label":"Automatic within an area you choose"},{"value":0,"label":"Manual"}],"help":"Only for PDFs and comics: removes blank white borders around the page so the content fills more of the screen. \"Auto\" finds the content by itself.","example":"Auto: a PDF with wide white margins shows bigger, easier-to-read text.","level":"basic"},
      {"key":"kopt_page_margin","label":"Margin around PDF pages","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":0.1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:123","min":0,"max":1.5,"step":0.05,"help":"Only for PDFs and comics: white space added around the page after trimming and zooming. Higher values give more space at the edges.","level":"advanced"},
      {"key":"kopt_auto_straighten","label":"Straighten tilted scans","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:140","options":[{"value":0,"label":"0°"},{"value":5,"label":"5°"},{"value":10,"label":"10°"},{"value":15,"label":"15°"},{"value":25,"label":"25°"}],"help":"Only for scanned PDFs: tries to rotate pages that were scanned at a slant, by up to the chosen angle. 0 means off.","level":"advanced"},
      {"key":"kopt_zoom_overlap_h","label":"Overlap when moving sideways","path":"Reader (PDF/DjVu) → bottom menu","type":"int","absent":36,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:161","min":0,"max":84,"step":12,"unit":"%","help":"Only for zoomed-in PDFs read piece by piece: how much of the previous piece is still visible when you move left or right, so you do not lose your place.","level":"advanced"},
      {"key":"kopt_zoom_overlap_v","label":"Overlap when moving down","path":"Reader (PDF/DjVu) → bottom menu","type":"int","absent":36,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:182","min":0,"max":84,"step":12,"unit":"%","help":"Only for zoomed-in PDFs read piece by piece: how much of the previous piece is still visible when you move up or down, so you do not lose your place.","level":"advanced"},
      {"key":"kopt_zoom_mode_type","label":"Fit page to screen","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:203","options":[{"value":2,"label":"Whole page"},{"value":1,"label":"Screen width"},{"value":0,"label":"Screen height"}],"help":"Only for PDFs and comics: whether the page is sized to show it whole, to fill the screen width, or to fill the screen height.","example":"Width: text is bigger, and you scroll down within each page.","level":"basic"},
      {"key":"kopt_zoom_factor","label":"Manual zoom amount","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":1.5,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:252","min":0.1,"max":20,"step":0.1,"help":"Only for PDFs and comics when \"Zoom to\" is set to manual: how much the page is enlarged. 1.5 means one and a half times bigger.","level":"advanced"},
      {"key":"kopt_zoom_mode_genus","label":"Zoom to","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":4,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:280","options":[{"value":4,"label":"Whole page"},{"value":3,"label":"Content (skip blank edges)"},{"value":2,"label":"Columns"},{"value":1,"label":"Rows"},{"value":0,"label":"Manual"}],"help":"Only for PDFs and comics: what the Kobo zooms in on. \"Page\" shows the page; \"Content\" ignores blank edges; \"Columns\" or \"Rows\" splits the page into parts you read one at a time.","example":"Columns: a two-column scientific PDF is shown one column at a time, much larger.","level":"basic"},
      {"key":"kopt_zoom_direction","label":"Reading order when zoomed","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":7,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:302","options":[{"value":7,"label":"Left to right, then top to bottom"},{"value":6,"label":"Top to bottom, then left to right"},{"value":5,"label":"Left to right, then bottom to top"},{"value":4,"label":"Bottom to top, then left to right"},{"value":3,"label":"Bottom to top, then right to left"},{"value":2,"label":"Right to left, then bottom to top"},{"value":1,"label":"Top to bottom, then right to left"},{"value":0,"label":"Right to left, then top to bottom"}],"help":"Only for zoomed-in PDFs and comics read piece by piece: the order in which the pieces are shown. Normal books are left to right, top to bottom; manga is usually right to left.","example":"Choose \"Right to left, top to bottom\" for Japanese manga.","level":"advanced"},
      {"key":"kopt_page_scroll","label":"Pages or scrolling (PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:343","options":[{"value":0,"label":"One page at a time"},{"value":1,"label":"Continuous scrolling"}],"help":"Only for PDFs and comics: \"Pages\" shows one page at a time; \"Continuous\" lets you scroll through pages like a web page.","level":"basic"},
      {"key":"kopt_page_gap_height","label":"Gap between pages when scrolling","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":8,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:355","min":0,"max":256,"unit":"px","help":"Only for PDFs in continuous scrolling: the thickness of the gap between one page and the next.","level":"advanced"},
      {"key":"kopt_line_spacing","label":"Line spacing (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1.2,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:377","options":[{"value":1,"label":"Small"},{"value":1.2,"label":"Medium"},{"value":1.4,"label":"Large"}],"help":"Only when re-flow is on for a PDF: space between lines of the re-arranged text.","level":"advanced"},
      {"key":"kopt_justification","label":"Text alignment (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":3,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:391","options":[{"value":-1,"label":"Auto (like the original)"},{"value":0,"label":"Left"},{"value":1,"label":"Centre"},{"value":2,"label":"Right"},{"value":3,"label":"Both edges straight"}],"help":"Only when re-flow is on for a PDF: how lines are lined up. \"Justify\" makes both edges straight; \"Auto\" tries to copy the original document.","level":"advanced"},
      {"key":"kopt_font_size","label":"Text size (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:424","options":[{"value":0.2,"label":"0.2"},{"value":0.4,"label":"0.4"},{"value":0.5,"label":"0.5"},{"value":0.6,"label":"0.6"},{"value":0.7,"label":"0.7"},{"value":0.8,"label":"0.8"},{"value":0.9,"label":"0.9"},{"value":1,"label":"1.0"},{"value":1.1,"label":"1.1"},{"value":1.3,"label":"1.3"},{"value":1.6,"label":"1.6"},{"value":2,"label":"2.0"}],"help":"Only when re-flow is on for a PDF: enlarges or shrinks the text compared with the original. 1.0 is the original size, 1.3 is 30% bigger.","level":"advanced"},
      {"key":"kopt_word_spacing","label":"Word gap (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":-0.2,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:460","options":[{"value":0.05,"label":"Small"},{"value":-0.2,"label":"Automatic"},{"value":0.375,"label":"Large"}],"help":"Only when re-flow is on for a PDF: how much space is left between words.","level":"advanced"},
      {"key":"kopt_text_wrap","label":"Re-flow PDF text","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:472","options":[{"value":0,"label":"Off (original pages)"},{"value":1,"label":"On (re-arrange text)"}],"help":"Re-flow means pulling the text out of a PDF and re-arranging it to fit the Kobo's screen, like a normal ebook. Makes small PDF text readable, but tables, pictures and formatting can come out messy.","example":"On: an A4 PDF becomes readable without zooming, but a page of formulas may look jumbled.","level":"basic"},
      {"key":"kopt_contrast","label":"Darkness (PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"number","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:489","min":0.8,"max":50,"step":0.1,"help":"Only for PDFs and comics: makes the page darker. 1 is unchanged; higher values make faint or grey text darker and easier to read.","example":"Set 1.5 for an old scan with pale grey text.","level":"basic"},
      {"key":"kopt_white_threshold","label":"Turn light grey into white","path":"Reader (PDF/DjVu) → bottom menu","type":"int","absent":255,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:534","min":0,"max":255,"help":"Only for PDFs and comics: anything lighter than this level is shown as pure white. 255 means off; lower values clean up grey backgrounds but can wash out light details.","level":"advanced"},
      {"key":"kopt_page_opt","label":"Remove watermarks and grey backgrounds","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:552","options":[{"value":0,"label":"Off"},{"value":1,"label":"On"}],"help":"Only for PDFs and comics: tries to remove faint watermarks and grey backgrounds, making the page plain black and white with more contrast.","level":"advanced"},
      {"key":"kopt_background_cleanup","label":"Black and white cleanup","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:565","options":[{"value":0,"label":"Off"},{"value":1,"label":"On"}],"help":"Only for PDFs: shows just the essentials in black and white and skips extra layers, for better contrast and faster page turns. Especially useful for scanned books from the Internet Archive.","level":"advanced"},
      {"key":"kopt_hw_dithering","label":"Smoother greys (screen)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:579","options":[{"value":0,"label":"Off"},{"value":1,"label":"On"}],"help":"Only for PDFs and comics: dithering means drawing shades of grey as fine dot patterns, so pictures look smoother on e-ink. This version uses the screen's own built-in method, if it has one.","level":"advanced"},
      {"key":"kopt_sw_dithering","label":"Smoother greys (software)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:592","options":[{"value":0,"label":"Off"},{"value":1,"label":"On"}],"help":"Only for PDFs and comics: draws shades of grey as fine dot patterns, calculated by the reader app, so photos and drawings show less banding. Can slow page turns slightly.","level":"advanced"},
      {"key":"kopt_quality","label":"Quality (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:605","options":[{"value":0.5,"label":"Low (faster)"},{"value":1,"label":"Normal"},{"value":1.5,"label":"High (slower)"}],"help":"Only when re-flow is on for a PDF: how carefully text and pictures are extracted. Higher gives sharper results but pages take longer to prepare.","level":"advanced"},
      {"key":"kopt_doc_language","label":"Language for text recognition","path":"Reader (PDF/DjVu) → bottom menu","type":"string","absent":null,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:623","maxLength":500,"help":"Only for scanned PDFs: the language the Kobo assumes when it reads text from page images (text recognition), for example when you select words. Uses a three-letter code such as eng, nor or tur. If empty, English is used.","level":"advanced"},
      {"key":"kopt_forced_ocr","label":"Always read text from the image","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:637","options":[{"value":0,"label":"Off"},{"value":1,"label":"On"}],"help":"Only for PDFs: when on, selecting text always uses text recognition on the page image, even if the PDF already contains text. Turn on only if selecting text in a PDF gives garbled words.","level":"advanced"},
      {"key":"kopt_writing_direction","label":"Writing direction (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:648","options":[{"value":0,"label":"Left to right"},{"value":1,"label":"Right to left"},{"value":2,"label":"Top to bottom, columns right to left"}],"help":"Only when re-flow is on for a PDF: the direction the original text is written in. Set to right-to-left for Arabic or Hebrew so the text is re-arranged correctly.","level":"advanced"},
      {"key":"kopt_defect_size","label":"Ignore specks (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":1,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:667","options":[{"value":1,"label":"Small"},{"value":3,"label":"Medium"},{"value":5,"label":"Large"}],"help":"Only when re-flow is on for a scanned PDF: how big a dust spot or ink speck may be before it is treated as a real character. Larger ignores bigger specks but may drop small dots like full stops.","level":"advanced"},
      {"key":"kopt_nightmode_document","label":"Invert pages in night mode","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":0,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:693","options":[{"value":0,"label":"Off (keep pages as they are)"},{"value":1,"label":"On (invert pages)"}],"help":"Only for PDFs and comics, and only when night mode (white on black) is on: whether the pages are inverted too. Off keeps pages as they are, which usually suits picture-heavy comics.","level":"advanced"},
      {"key":"kopt_max_columns","label":"Columns to look for (re-flowed PDFs)","path":"Reader (PDF/DjVu) → bottom menu","type":"enum","absent":2,"effect":"next_book","source":"frontend/ui/data/koptoptions.lua:703","options":[{"value":1,"label":"1"},{"value":2,"label":"2"},{"value":3,"label":"3"}],"help":"Only when re-flow is on for a PDF: the most text columns the Kobo looks for on a page. Set to 1 if normal full-width text gets wrongly split into columns.","level":"advanced"},
    ],
  },
  {
    id: "status_bar", label: "Bottom status bar",
    summary: "The thin line of information under the text of a book: page numbers, time, battery, reading progress and more.",
    affects: "The bar at the bottom of every page shows, hides or rearranges these details the next time you open a book.",
    settings: [
      {"key":"footer.disabled","label":"Turn off the status bar completely","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:475","help":"Removes the bottom status bar entirely, so the text can use the whole screen. None of the other status bar settings matter while this is on.","level":"advanced"},
      {"key":"footer.all_at_once","label":"Show all chosen items together","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1025","help":"When on, every item you switched on appears side by side in the status bar. When off, the bar shows one item at a time and tapping the bar steps to the next one.","example":"On: 41 / 312 | 14:05 | 78%. Off: just 41 / 312, then 14:05 after a tap.","level":"basic"},
      {"key":"footer.reclaim_height","label":"Let the text use the bar's space","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1026","help":"When the status bar is hidden, the book text stretches into the space the bar used. Showing the bar again then draws it on top of the bottom line of text.","level":"advanced"},
      {"key":"footer.page_progress","label":"Show page number","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:480","help":"Shows the page you are on and the total number of pages.","example":"41 / 312","level":"basic"},
      {"key":"footer.pages_left_book","label":"Show pages left in book","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:481","help":"Shows how many pages remain until the end of the book, with an arrow in front.","example":"271 / 312","level":"basic"},
      {"key":"footer.time","label":"Show the time","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:482","help":"Shows the current clock time in the status bar.","example":"14:05","level":"basic"},
      {"key":"footer.pages_left","label":"Show pages left in chapter","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:483","help":"Shows how many pages remain until the end of the current chapter.","example":"12","level":"basic"},
      {"key":"footer.battery","label":"Show battery level","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:484","help":"Shows how much battery is left, as a battery symbol with a percentage.","example":"78%","level":"basic"},
      {"key":"footer.percentage","label":"Show percentage read","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:486","help":"Shows how far through the book you are, as a percentage.","example":"13%","level":"basic"},
      {"key":"footer.book_time_to_read","label":"Show time left in book","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:487","help":"Estimates how long it will take you to finish the book, based on your own reading speed. It needs the reading statistics to be on, otherwise it shows N/A.","example":"5:42","level":"basic"},
      {"key":"footer.chapter_time_to_read","label":"Show time left in chapter","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:488","help":"Estimates how long it will take you to finish the current chapter, based on your own reading speed.","example":"0:18","level":"basic"},
      {"key":"footer.frontlight","label":"Show light brightness","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:489","help":"Shows how bright the front light is set, as a percentage, or Off when the light is off.","example":"35%","level":"basic"},
      {"key":"footer.frontlight_warmth","label":"Show light warmth","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1041","help":"Shows how warm (orange) the front light is set, as a percentage, or Off when the light is off.","example":"60%","level":"basic"},
      {"key":"footer.mem_usage","label":"Show memory used","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:490","help":"Shows how much of the Kobo's memory the reading app is using, in megabytes. Only useful for troubleshooting.","example":"M 112","level":"advanced"},
      {"key":"footer.wifi_status","label":"Show Wi-Fi on or off","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:491","help":"Shows a small symbol telling you whether Wi-Fi is currently on or off.","level":"basic"},
      {"key":"footer.page_turning_inverted","label":"Show page-turn direction","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:492","help":"Shows a small arrow symbol telling you whether page turning is reversed (tapping the left side goes forward). Rarely needed.","level":"advanced"},
      {"key":"footer.book_author","label":"Show author","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:493","help":"Shows the book's author in the status bar, shortened if it is too long.","example":"Jo Nesbø","level":"basic"},
      {"key":"footer.book_title","label":"Show book title","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:494","help":"Shows the book's title in the status bar, shortened if it is too long.","example":"The Snowman","level":"basic"},
      {"key":"footer.book_chapter","label":"Show chapter title","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:495","help":"Shows the name of the chapter you are reading, shortened if it is too long.","example":"Chapter 4: The Visit","level":"basic"},
      {"key":"footer.bookmark_count","label":"Show number of bookmarks","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:496","help":"Shows how many bookmarks, highlights and notes you have in this book.","example":"7","level":"advanced"},
      {"key":"footer.chapter_progress","label":"Show page within chapter","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:497","help":"Shows which page of the current chapter you are on, out of the chapter's total.","example":"3 / 15","level":"basic"},
      {"key":"footer.custom_text","label":"Show your own text","path":"Reader → Settings → Status bar → Status bar items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1048","help":"Adds a piece of text of your choice to the status bar. What it says is set under Custom text below.","level":"advanced"},
      {"key":"footer.disable_progress_bar","label":"Hide the progress bar","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1167","help":"When on, the thin line that fills up as you read the book is removed from the status bar. When off, the line is shown.","level":"basic"},
      {"key":"footer.chapter_progress_bar","label":"Progress bar for chapter only","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:475","help":"Makes the progress line show how far you are in the current chapter instead of in the whole book.","level":"basic"},
      {"key":"footer.progress_bar_position","label":"Where the progress bar sits","path":"Reader → Settings → Status bar → Progress bar","type":"enum","absent":"alongside","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1833","options":[{"value":"above","label":"Above the items"},{"value":"alongside","label":"On the same line as the items"},{"value":"below","label":"Below the items"}],"help":"Places the progress line above the other status bar items, next to them on the same line, or below them.","level":"advanced"},
      {"key":"footer.progress_style_thin","label":"Thin progress bar","path":"Reader → Settings → Status bar → Progress bar → Style","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1240","help":"Draws the progress line as a thin line instead of a thicker bar. A thin bar cannot show chapter markers.","level":"advanced"},
      {"key":"footer.progress_style_thin_height","label":"Thin bar thickness","path":"Reader → Settings → Status bar → Progress bar → Height","type":"int","absent":3,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1277","min":1,"max":12,"help":"How thick the progress line is when the thin style is used. Higher numbers draw a thicker line.","level":"advanced"},
      {"key":"footer.progress_style_thick_height","label":"Thick bar thickness","path":"Reader → Settings → Status bar → Progress bar → Height","type":"int","absent":7,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1279","min":5,"max":28,"help":"How thick the progress bar is when the normal (thick) style is used. Higher numbers draw a thicker bar.","level":"advanced"},
      {"key":"footer.progress_margin_width","label":"Progress bar side margins","path":"Reader → Settings → Status bar → Progress bar → Margins","type":"int","absent":10,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1311","min":0,"max":140,"help":"How much empty space is left on the left and right of the progress bar. Higher numbers make the bar shorter.","level":"advanced"},
      {"key":"footer.progress_margin","label":"Match the book's side margins","path":"Reader → Settings → Status bar → Progress bar → Margins","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1321","help":"Lines the ends of the progress bar up with the left and right margins of the book text, instead of using its own margin.","level":"advanced"},
      {"key":"footer.progress_bar_min_width_pct","label":"Smallest progress bar width","path":"Reader → Settings → Status bar → Progress bar","type":"int","absent":20,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1352","min":5,"max":90,"unit":"%","help":"When the progress bar sits on the same line as the items, this keeps it at least this share of the screen width. Only used when all items are shown together.","level":"advanced"},
      {"key":"footer.initial_marker","label":"Mark where you started","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1386","help":"Puts a small marker on the progress bar at the point where you were when you opened the book, so you can see how far you read in this sitting.","level":"advanced"},
      {"key":"footer.toc_markers","label":"Show chapter ticks","path":"Reader → Settings → Status bar → Progress bar","type":"bool","absent":true,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1401","help":"Draws small ticks on the progress bar where each chapter begins. Only works with the thick bar style.","level":"basic"},
      {"key":"footer.toc_markers_width","label":"Chapter tick thickness","path":"Reader → Settings → Status bar → Progress bar","type":"enum","absent":2,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1855","options":[{"value":1,"label":"Thin"},{"value":2,"label":"Medium"},{"value":3,"label":"Thick"}],"help":"How thick the chapter ticks on the progress bar are.","level":"advanced"},
      {"key":"footer.auto_refresh_time","label":"Keep the clock up to date","path":"Reader → Settings → Status bar → Configure items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1510","help":"Updates items such as the time and battery every minute, even when you are not turning pages. When off, they only update when the page changes.","level":"basic"},
      {"key":"footer.hide_empty_generators","label":"Hide items with nothing to show","path":"Reader → Settings → Status bar → Configure items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1524","help":"Leaves out items that have nothing useful to say right now, for example the light level when the light is off or the bookmark count when there are none. Only used when all items are shown together.","level":"advanced"},
      {"key":"footer.pages_left_includes_current_page","label":"Count this page as left","path":"Reader → Settings → Status bar → Configure items","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1540","help":"Adds the page you are on to the pages-left numbers, so the last page reads 1 instead of 0.","level":"advanced"},
      {"key":"footer.progress_pct_format","label":"Decimals in percentage read","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"0","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1889","options":[{"value":"0","label":"Whole number (13%)"},{"value":"1","label":"One decimal (13.4%)"},{"value":"2","label":"Two decimals (13.42%)"}],"help":"How many decimal places the percentage read shows.","example":"0: 13%, 1: 13.4%, 2: 13.42%","level":"advanced"},
      {"key":"footer.text_font_size","label":"Status bar text size","path":"Reader → Settings → Status bar → Configure items → Item font","type":"int","absent":14,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1580","min":8,"max":36,"help":"How big the text in the status bar is. Higher numbers make it larger.","level":"basic"},
      {"key":"footer.text_font_face","label":"Status bar font","path":"Reader → Settings → Status bar → Configure items → Item font","type":"string","absent":"./fonts/noto/NotoSans-Regular.ttf","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1603","maxLength":500,"font":"file","help":"Which font file the status bar text uses. The list comes from the Kobo after its next sync; until then it shows the fonts that come with KOReader. Default: Noto Sans.","level":"advanced"},
      {"key":"footer.text_font_bold","label":"Bold status bar text","path":"Reader → Settings → Status bar → Configure items → Item font","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1626","help":"Makes the text in the status bar bold, which can be easier to read.","level":"basic"},
      {"key":"footer.item_prefix","label":"Labels in front of items","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"icons","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1917","options":[{"value":"icons","label":"Symbols"},{"value":"letters","label":"Short letters (B:, R:)"},{"value":"compact_items","label":"Compact (fewest symbols)"}],"help":"Chooses what goes in front of each item: small symbols, short letters, or a compact style with as few symbols as possible.","example":"Letters: B:78% R:13%. Compact: 78% 13%.","level":"advanced"},
      {"key":"footer.items_separator","label":"Separator between items","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"bar","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1940","options":[{"value":"bar","label":"Vertical bar (|)"},{"value":"bullet","label":"Bullet (•)"},{"value":"dot","label":"Dot (·)"},{"value":"none","label":"No separator"}],"help":"The mark placed between items in the status bar.","example":"41 / 312 | 14:05 or 41 / 312 · 14:05","level":"advanced"},
      {"key":"footer.book_title_max_width_pct","label":"Longest book title","path":"Reader → Settings → Status bar → Configure items → Item max width","type":"int","absent":30,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:509","min":10,"max":100,"step":5,"unit":"%","help":"The largest share of the screen width the book title may take before it is shortened with dots.","level":"advanced"},
      {"key":"footer.book_author_max_width_pct","label":"Longest author name","path":"Reader → Settings → Status bar → Configure items → Item max width","type":"int","absent":30,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:508","min":10,"max":100,"step":5,"unit":"%","help":"The largest share of the screen width the author's name may take before it is shortened with dots.","level":"advanced"},
      {"key":"footer.book_chapter_max_width_pct","label":"Longest chapter title","path":"Reader → Settings → Status bar → Configure items → Item max width","type":"int","absent":30,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:510","min":10,"max":100,"step":5,"unit":"%","help":"The largest share of the screen width the chapter title may take before it is shortened with dots.","level":"advanced"},
      {"key":"footer.align","label":"Item alignment","path":"Reader → Settings → Status bar → Configure items","type":"enum","absent":"center","effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1991","options":[{"value":"left","label":"Left"},{"value":"center","label":"Center"},{"value":"right","label":"Right"}],"help":"Puts the status bar items on the left, in the middle or on the right. Items are always centred when the progress bar sits on the same line.","level":"advanced"},
      {"key":"footer.container_height","label":"Status bar height","path":"Reader → Settings → Status bar → Configure items → Height","type":"int","absent":7,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1691","min":7,"max":98,"help":"How tall the status bar area is. Higher numbers give the bar more room and leave a little less for the text.","level":"advanced"},
      {"key":"footer.container_bottom_padding","label":"Space under the status bar","path":"Reader → Settings → Status bar → Configure items → Bottom margin","type":"int","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1714","min":0,"max":49,"help":"How much empty space is left between the status bar and the bottom edge of the screen.","level":"advanced"},
      {"key":"footer.battery_hide_threshold","label":"Hide battery when above","path":"Reader → Settings → Status bar → Configure items","type":"int","absent":100,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1753","min":0,"max":100,"unit":"%","help":"Hides the battery item while the battery is above this level, so it only appears when it is getting low. Set to 100% to always show it. Only used when all items are shown together.","example":"At 30%, the battery only appears once it drops to 30% or less.","level":"basic"},
      {"key":"footer.bottom_horizontal_separator","label":"Line above the status bar","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1784","help":"Draws a thin line between the book text and the status bar.","level":"advanced"},
      {"key":"footer.lock_tap","label":"Ignore taps on the status bar","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1796","help":"Stops a tap on the status bar from switching or hiding it, so an accidental tap leaves it as it is.","level":"basic"},
      {"key":"footer.skim_widget_on_hold","label":"Hold the bar to jump around","path":"Reader → Settings → Status bar","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:1805","help":"Pressing and holding the status bar opens a slider to skim quickly through the book.","level":"advanced"},
      {"key":"reader_footer_mode","label":"Which item the bar shows","path":"Reader → Settings → Status bar","type":"int","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:600","help":"When items are shown one at a time, this decides which one is on screen (0 hides the bar). It also changes whenever you tap the status bar.","example":"0 = hidden, 1 = page number, 2 = pages left in book, 3 = time, 4 = pages left in chapter, 5 = battery, 6 = percentage read.","level":"advanced"},
      {"key":"reader_footer_custom_text","label":"Your own text","path":"Reader → Settings → Status bar → Status bar items → Custom text","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:718","maxLength":500,"help":"The text shown by the Your own text item. You can include book details with codes such as %T for the title, %A for the author, %c for the page and %b for the battery level.","example":"Reading %T reads as: Reading The Snowman","level":"advanced"},
      {"key":"reader_footer_custom_text_repetitions","label":"Repeat your own text","path":"Reader → Settings → Status bar → Status bar items → Custom text","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerfooter.lua:727","maxLength":500,"help":"How many times your own text is repeated side by side, for example to fill the bar with a pattern.","level":"advanced"},
      {"key":"duration_format","label":"How times are written","path":"Settings → Device → Time and date → Duration format","type":"enum","absent":"classic","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:113","options":[{"value":"classic","label":"1:23:45"},{"value":"modern","label":"1h23'45\""},{"value":"letters","label":"1h 23m 45s"}],"help":"Chooses how lengths of time are written, for example the time left in a book or chapter.","level":"basic"},
      {"key":"twelve_hour_clock","label":"12-hour clock","path":"Settings → Device → Time and date","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:83","help":"Shows the time with AM and PM instead of the 24-hour clock.","example":"2:05 PM instead of 14:05","level":"basic"},
    ],
  },
  {
    id: "alt_status_bar", label: "Top bar (EPUB books)",
    summary: "The optional line printed above the text of EPUB books, with the title, time, page and battery.",
    affects: "When the top bar is turned on, the line above the text shows or hides these details the next time you open a book.",
    settings: [
      {"key":"cre_header_title","label":"Show book title","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:28","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows the book's title in the top bar.","level":"basic"},
      {"key":"cre_header_author","label":"Show author","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:29","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows the author's name in the top bar.","level":"basic"},
      {"key":"cre_header_clock","label":"Show the time","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:30","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows the current time in the top bar.","level":"basic"},
      {"key":"cre_header_auto_refresh","label":"Keep the clock up to date","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:31","options":[{"value":0,"label":"Off"},{"value":1,"label":"On"}],"help":"Updates the time and battery in the top bar every minute, even when you are not turning pages.","level":"basic"},
      {"key":"cre_header_page_number","label":"Show page number","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:32","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows the page you are on in the top bar.","example":"41","level":"basic"},
      {"key":"cre_header_page_count","label":"Show total pages","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:33","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows the total number of pages next to the page number in the top bar.","example":"41 / 312","level":"basic"},
      {"key":"cre_header_reading_percent","label":"Show percentage read","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":0,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:34","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows how far through the book you are, as a percentage, in the top bar.","example":"13%","level":"basic"},
      {"key":"cre_header_battery","label":"Show battery symbol","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:35","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows a small battery symbol in the top bar.","level":"basic"},
      {"key":"cre_header_battery_percent","label":"Show battery percentage","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":0,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:36","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Shows the battery level as a number in the top bar.","example":"78%","level":"basic"},
      {"key":"cre_header_chapter_marks","label":"Show chapter ticks","path":"Reader → Settings → Status bar → Alt status bar","type":"enum","absent":1,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:37","options":[{"value":0,"label":"Hide"},{"value":1,"label":"Show"}],"help":"Draws small ticks on the top bar's progress line where each chapter begins.","level":"advanced"},
      {"key":"cre_header_status_font_size","label":"Top bar text size","path":"Reader → Settings → Status bar → Alt status bar","type":"int","absent":20,"effect":"next_book","source":"frontend/apps/reader/modules/readercoptlistener.lua:529","min":8,"max":36,"help":"How big the text in the top bar is. Higher numbers make it larger.","level":"basic"},
    ],
  },
  {
    id: "highlights_bookmarks", label: "Highlights and bookmarks",
    summary: "How highlights look, and how your bookmarks, table of contents, page numbers and page overviews are listed.",
    affects: "Highlighted passages, the bookmarks list, the table of contents list and the book map screens look different.",
    settings: [
      {"key":"highlight_drawing_style","label":"Highlight style","path":"Reader → Typeset tab (document icon) → Highlights","type":"enum","absent":"lighten","effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:442","options":[{"value":"lighten","label":"Grey background"},{"value":"underscore","label":"Underline"},{"value":"strikeout","label":"Strike through"},{"value":"invert","label":"White text on black"}],"help":"How a new highlight is drawn on the page.","example":"Underline: highlighted text gets a line under it instead of a grey background.","level":"basic"},
      {"key":"highlight_color","label":"Highlight colour","path":"Reader → Typeset tab (document icon) → Highlights","type":"string","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:465","maxLength":500,"help":"The colour used for new highlights. Your Kobo screen is black and white, so every colour shows as grey; leave it as gray.","level":"advanced"},
      {"key":"highlight_lighten_factor","label":"Highlight darkness","path":"Reader → Typeset tab (document icon) → Highlights","type":"number","absent":0.2,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:489","min":0,"max":1,"step":0.1,"help":"How dark the grey background of a highlight is, from 0 (invisible) to 1 (black). Only for the grey background style.","example":"0.4 makes highlights clearly darker than the default 0.2.","level":"basic"},
      {"key":"highlight_selection_invert_highlight_color","label":"Invert highlights in night mode","path":"Reader → Typeset tab (document icon) → Highlights","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:506","help":"In night mode (white text on black), shows highlights inverted so they stay visible. Has no effect with the white-on-black highlight style.","level":"advanced"},
      {"key":"highlight_selection_use_highlight_color","label":"Show selection like a highlight","path":"Reader → Typeset tab (document icon) → Highlights","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:519","help":"While you drag your finger to select text, the selection is shown in your highlight style instead of the usual grey.","level":"advanced"},
      {"key":"highlight_selection_lighten_factor","label":"Selection darkness","path":"Reader → Typeset tab (document icon) → Highlights","type":"number","absent":0.2,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:541","min":0,"max":1,"step":0.1,"help":"How dark the grey shading is while you are selecting text, from 0 (invisible) to 1 (black).","level":"advanced"},
      {"key":"highlight_height_pct","label":"Highlight band height","path":"Reader → Typeset tab (document icon) → Highlights","type":"int","absent":100,"effect":"immediate","source":"frontend/apps/reader/modules/readerhighlight.lua:570","min":0,"max":100,"unit":"%","help":"How tall the highlight band is compared with the text line. Only for the grey background and white-on-black styles.","example":"60%: the grey band covers only the middle of each line, so lines don't touch.","level":"advanced"},
      {"key":"highlight_note_marker","label":"Mark highlights with notes","path":"Reader → Typeset tab (document icon) → Highlights","type":"enum","absent":null,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:593","options":[{"value":"underline","label":"Underline the text"},{"value":"sideline","label":"Line in the margin"},{"value":"sidemark","label":"Small mark in the margin"}],"help":"How the page shows that a highlight has a note attached. Not set means no marker.","level":"basic"},
      {"key":"highlight_write_into_pdf_notify","label":"Remind about saving highlights in PDFs","path":"Reader → Typeset tab (document icon) → Highlights → Write highlights into PDF","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerhighlight.lua:693","help":"When a PDF opens and highlights are being saved into the PDF file itself, shows a reminder. Only matters for PDFs.","level":"advanced"},
      {"key":"bookmarks_items_per_page","label":"Bookmarks per page","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"int","absent":14,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:169","min":6,"max":24,"help":"How many entries fit on one page of the bookmarks and highlights list.","example":"20 shows more entries at once with smaller text.","level":"basic"},
      {"key":"bookmarks_items_font_size","label":"Bookmark font size","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"int","absent":"derived from per page","effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:194","min":10,"max":72,"help":"Text size in the bookmarks and highlights list. If not set, it follows the number of entries per page.","level":"basic"},
      {"key":"bookmarks_items_max_lines","label":"Max lines per bookmark","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"int","absent":"disabled","effect":"next_book","source":"frontend/apps/reader/modules/readerbookmark.lua:137","min":1,"max":10,"help":"Lets each entry in the bookmarks list grow up to this many lines so you can read more of the highlight. Not set means every entry is one fixed-height line.","example":"3: a long highlight shows its first three lines in the list.","level":"basic"},
      {"key":"bookmarks_items_multilines_show_more_text","label":"Smaller text to fit more","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:209","help":"When entries can use several lines, makes the text a bit smaller so more of each highlight fits.","level":"advanced"},
      {"key":"bookmarks_items_text_type","label":"What the list shows","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"enum","absent":"note","effect":"next_book","source":"frontend/apps/reader/modules/readerbookmark.lua:310","options":[{"value":"text","label":"Highlighted text only"},{"value":"all","label":"Highlighted text and note"},{"value":"note","label":"Note if there is one, otherwise the text"}],"help":"What each entry in the bookmarks list shows.","level":"basic"},
      {"key":"bookmarks_items_show_separator","label":"Lines between entries","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:224","help":"Draws a thin line between entries in the bookmarks list.","level":"basic"},
      {"key":"bookmarks_items_show_color","label":"Show highlight colours","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:226","help":"Shows each highlight's colour in the bookmarks list. On your black and white screen this is just shades of grey.","level":"advanced"},
      {"key":"bookmarks_items_show_color_default","label":"Also show default colour","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:237","help":"When highlight colours are shown in the list, also shows highlights that use the default colour. Only works with the setting above turned on.","level":"advanced"},
      {"key":"bookmarks_items_sorting","label":"Sort bookmarks by","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks → Sort by","type":"enum","absent":"page","effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:339","options":[{"value":"date","label":"Date added"}],"help":"Sorts the bookmarks list by when you made each one instead of by page. Not set means by page.","level":"basic"},
      {"key":"bookmarks_items_reverse_sorting","label":"Reverse sorting","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks → Sort by","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:250","help":"Turns the bookmarks list order around, so the last page (or newest) comes first.","level":"basic"},
      {"key":"bookmark_prompt","label":"Ask for a note on new bookmarks","path":"Reader → Navigation tab (bookmark icon) → Settings → Bookmarks","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerbookmark.lua:254","help":"When you bookmark a page by tapping the top corner, asks if you want to add a note to it.","level":"basic"},
      {"key":"toc_items_per_page","label":"Chapters per page","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"int","absent":14,"effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1422","min":6,"max":24,"help":"How many chapters fit on one page of the table of contents.","level":"basic"},
      {"key":"toc_items_font_size","label":"Table of contents text size","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"int","absent":"derived","effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1447","min":10,"max":72,"help":"Text size in the table of contents. If not set, it follows the number of chapters per page.","level":"basic"},
      {"key":"toc_items_show_chapter_length","label":"Show chapter length","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1460","help":"Shows how many pages each chapter has next to its name in the table of contents.","example":"On: 'Chapter 3 .... 45' also shows that the chapter is 12 pages long.","level":"basic"},
      {"key":"toc_items_with_dots","label":"Dots before page numbers","path":"Reader → Navigation tab (bookmark icon) → Settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readertoc.lua:1471","help":"Draws a row of dots between a chapter name and its page number in the table of contents.","level":"basic"},
      {"key":"pagemap_chars_per_synthetic_page","label":"Fixed page numbers: letters per page","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"int","absent":"disabled","effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:603","min":500,"max":3000,"help":"For new books, makes up page numbers that never change, counting this many letters as one page, so the page count stays the same whatever font size you use. Not set means turned off.","example":"1500: a page number is about one printed paperback page, and stays the same when you make the text bigger.","level":"advanced"},
      {"key":"pagemap_synthetic_overrides","label":"Prefer made-up page numbers","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:624","help":"Uses the made-up fixed page numbers even when the book comes with the printed edition's page numbers. Only works when letters-per-page above is set.","level":"advanced"},
      {"key":"pagemap_notify_document_provided","label":"Ask when printed page numbers exist","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:633","help":"When you open a new book that contains the printed edition's page numbers, asks whether to use them.","level":"advanced"},
      {"key":"pagemap_use_page_labels","label":"Use printed page numbers","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:643","help":"For new books, shows the printed edition's page numbers (or the made-up fixed ones) instead of the Kobo's own screen pages.","example":"On: the status bar says page 112, matching the paperback, not screen page 287.","level":"basic"},
      {"key":"pagemap_show_page_labels","label":"Printed page numbers in margin","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:652","help":"For new books, writes the printed page numbers in the page margin where each printed page starts.","level":"advanced"},
      {"key":"pagemap_label_font_size","label":"Margin page number size","path":"Reader → Navigation tab (bookmark icon) → Settings → Stable page numbers → Default settings for new books","type":"int","absent":14,"effect":"next_book","source":"frontend/apps/reader/modules/readerpagemap.lua:670","min":8,"max":20,"help":"Text size of the printed page numbers shown in the margin.","level":"advanced"},
      {"key":"book_map_alt_theme","label":"Alternative look for book map","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1368","help":"Uses a different look for the book map and page browser (the screens that give an overview of the whole book).","level":"advanced"},
      {"key":"book_map_tap_to_page_browser","label":"Book map tap shows page pictures","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1357","help":"On the book map, tapping a spot opens a grid of page pictures around it. Off: tapping jumps straight to that page.","level":"advanced"},
      {"key":"book_map_overview_tap_to_page_browser","label":"Overview tap shows page pictures","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1355","help":"Same as above but for the compact overview version of the book map.","level":"advanced"},
      {"key":"book_map_ten_pages_markers","label":"10-page markers on book map","path":"Reader → Navigation tab (bookmark icon) → Book map → ⋮ menu","type":"int","absent":0,"effect":"immediate","source":"frontend/ui/widget/bookmapwidget.lua:1468","help":"Adds small markers every 10 pages on the book map, from 0 (none) to 3 (most visible).","level":"advanced"},
      {"key":"page_browser_nb_rows","label":"Page browser rows","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"int","absent":"automatic","effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:1265","help":"How many rows of page pictures the page browser shows. Not set means it decides by screen size.","level":"advanced"},
      {"key":"page_browser_nb_cols","label":"Page browser columns","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"int","absent":"automatic","effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:1266","help":"How many columns of page pictures the page browser shows. Not set means it decides by screen size.","level":"advanced"},
      {"key":"page_browser_thumbnails_pagenums","label":"Page browser page numbers","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"int","absent":2,"effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:1267","help":"Where page numbers appear in the page browser: 0 none, 1 only on the first picture of each row, 2 on every picture.","level":"advanced"},
      {"key":"page_browser_preload_thumbnails","label":"Prepare page pictures in advance","path":"Reader → Navigation tab (bookmark icon) → Page browser → ⋮ menu","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/widget/pagebrowserwidget.lua:998","help":"Prepares the next and previous screens of page pictures in advance, so paging through the page browser is quicker but uses a little more battery.","level":"advanced"},
    ],
  },
  {
    id: "lookup", label: "Dictionary and search",
    summary: "How word lookups, Wikipedia, translation and searching inside a book behave.",
    affects: "Dictionary pop-ups, Wikipedia and translation results, and in-book search results look or behave differently.",
    settings: [
      {"key":"disable_fuzzy_search","label":"Turn off fuzzy dictionary matching","path":"Search tab (🔍) → Settings → Dictionary settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdictionary.lua:1964","help":"Turns off approximate matching in the dictionary. On means only exact words are looked up; off means similar spellings are also tried. Needs a dictionary installed.","example":"On: looking up a misspelled word finds nothing instead of the closest word.","level":"advanced"},
      {"key":"disable_lookup_history","label":"Don't keep word lookup history","path":"Search tab (🔍) → Settings → Dictionary settings → Dictionary lookup history","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerdictionary.lua:367","help":"On means the Kobo stops keeping a list of words you have looked up in the dictionary.","level":"basic"},
      {"key":"dict_largewindow","label":"Large dictionary window","path":"Search tab (🔍) → Settings → Dictionary settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerdictionary.lua:397","help":"Opens dictionary results in a big, almost full-screen window instead of a small pop-up.","level":"basic"},
      {"key":"dict_justify","label":"Justify dictionary text","path":"Search tab (🔍) → Settings → Dictionary settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerdictionary.lua:406","help":"Lines up dictionary text evenly on both left and right edges, like a book page.","level":"advanced"},
      {"key":"dict_font_size","label":"Dictionary text size","path":"Search tab (🔍) → Settings → Dictionary settings","type":"int","absent":20,"effect":"immediate","source":"frontend/apps/reader/modules/readerdictionary.lua:424","min":8,"max":32,"help":"Text size in the dictionary pop-up.","level":"basic"},
      {"key":"wikipedia_use_keyboard_language","label":"Use keyboard language","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:218","help":"When you type a word to look up on Wikipedia, searches the Wikipedia in your current keyboard's language. Needs Wi-Fi; does not affect looking up selected text.","level":"advanced"},
      {"key":"wikipedia_save_dir","label":"Folder for saved Wikipedia articles","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"string","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:235","maxLength":500,"help":"The folder where Wikipedia articles you save as e-books are stored. If not set, a Wikipedia folder in your home folder is used.","level":"advanced"},
      {"key":"wikipedia_save_in_book_dir","label":"Save articles next to the book","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:249","help":"Saves Wikipedia articles you save as e-books into the same folder as the book you are reading.","level":"advanced"},
      {"key":"wikipedia_epub_include_images","label":"Pictures in saved articles","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"enum","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:263","options":[{"value":true,"label":"Include pictures"},{"value":false,"label":"No pictures"}],"help":"Whether pictures are included when you save a Wikipedia article as an e-book. Not set means it asks each time.","level":"advanced"},
      {"key":"wikipedia_epub_highres_images","label":"Picture quality in saved articles","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"enum","absent":null,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:282","options":[{"value":false,"label":"Standard"},{"value":true,"label":"Higher (bigger file)"}],"help":"Picture quality when saving a Wikipedia article as an e-book. Higher quality means bigger files. Not set means it asks each time.","level":"advanced"},
      {"key":"wikipedia_disable_history","label":"Don't keep Wikipedia history","path":"Search tab (🔍) → Settings → Wikipedia settings → Wikipedia lookup history","type":"bool","absent":false,"effect":"next_book","source":"frontend/apps/reader/modules/readerwikipedia.lua:301","help":"On means the Kobo stops keeping a list of things you looked up on Wikipedia.","level":"basic"},
      {"key":"wikipedia_show_image","label":"Show image in search results","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:331","help":"Shows a small picture next to Wikipedia results when there is one. Needs Wi-Fi.","level":"basic"},
      {"key":"wikipedia_show_more_images","label":"Show more images in full article","path":"Search tab (🔍) → Settings → Wikipedia settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/apps/reader/modules/readerwikipedia.lua:343","help":"Shows extra pictures when you open a full Wikipedia article. Needs Wi-Fi and takes a bit longer to load.","level":"advanced"},
      {"key":"translator_from_doc_lang","label":"Translate from book language","path":"Reader → long-press text → Translate → Translation settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/translator.lua:385","help":"When you translate selected text, assumes it is in the book's own language. Needs Wi-Fi.","example":"Reading a Norwegian book: translations always treat the text as Norwegian.","level":"basic"},
      {"key":"translator_from_auto_detect","label":"Auto-detect source language","path":"Reader → long-press text → Translate → Translation settings","type":"bool","absent":true,"effect":"immediate","source":"frontend/ui/translator.lua:399","help":"Lets the translator guess what language the selected text is in. Best for foreign words inside a book in your own language. Ignored when translating from the book's language is on.","level":"basic"},
      {"key":"translator_with_romanizations","label":"Show pronunciation in Latin letters","path":"Reader → long-press text → Translate → Translation settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/translator.lua:409","help":"Also shows foreign scripts written in Latin letters, so you can see how they sound.","example":"Translating Japanese also shows 'konnichiwa' next to the original.","level":"advanced"},
      {"key":"translator_from_language","label":"Translate from","path":"Reader → long-press text → Translate → Translation settings","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/translator.lua:472","maxLength":500,"help":"The language to translate from, as a short code such as en, no or tr. Only used when automatic detection is off.","level":"advanced"},
      {"key":"translator_to_language","label":"Translate to","path":"Reader → long-press text → Translate → Translation settings","type":"string","absent":null,"effect":"immediate","source":"frontend/ui/translator.lua:478","maxLength":500,"help":"The language translations are shown in, as a short code such as en, no or tr. If not set, KOReader's own menu language is used.","example":"tr: selected English text is translated into Turkish.","level":"basic"},
      {"key":"fulltext_search_find_all","label":"List all search results","path":"Search tab (🔍) → Fulltext search settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readersearch.lua:132","help":"When you search for selected text, shows a list of every place it appears instead of jumping through matches in the pages.","level":"basic"},
      {"key":"fulltext_search_nb_context_words","label":"Words around each result","path":"Search tab (🔍) → Fulltext search settings","type":"int","absent":5,"effect":"next_book","source":"frontend/apps/reader/modules/readersearch.lua:151","min":1,"max":50,"help":"How many words around each match are shown in the search results list.","level":"basic"},
      {"key":"fulltext_search_results_max_lines","label":"Lines per search result","path":"Search tab (🔍) → Fulltext search settings","type":"int","absent":"disabled","effect":"next_book","source":"frontend/apps/reader/modules/readersearch.lua:174","min":1,"max":10,"help":"Lets each search result grow up to this many lines. Not set means one fixed line per result.","level":"advanced"},
      {"key":"fulltext_search_results_per_page","label":"Search results per page","path":"Search tab (🔍) → Fulltext search settings","type":"int","absent":10,"effect":"next_book","source":"frontend/apps/reader/modules/readersearch.lua:208","min":2,"max":24,"help":"How many search results fit on one page of the results list.","level":"basic"},
      {"key":"fulltext_search_zoom_to_page","label":"Show whole page for results (PDF)","path":"Search tab (🔍) → Fulltext search settings","type":"bool","absent":false,"effect":"immediate","source":"frontend/apps/reader/modules/readersearch.lua:223","help":"When jumping to a search result in a PDF or comic, shows the whole page instead of keeping your zoom. Only for PDFs and similar fixed-layout files.","level":"advanced"},
      {"key":"language_japanese_text_scan_length","label":"Japanese word scan length","path":"Search tab (🔍) → Japanese support","type":"int","absent":"plugin default","effect":"next_book","source":"plugins/japanese.koplugin/main.lua:230","min":0,"max":1000,"help":"For Japanese books only: how many characters the dictionary looks ahead when finding where a word ends. Not set uses the built-in value.","level":"advanced"},
    ],
  },
  {
    id: "language_ui", label: "Keyboard and units",
    summary: "The on-screen keyboard, measurement units, and the USB connection prompt.",
    affects: "The keyboard looks or types differently, sizes show in other units, and plugging into a computer may skip a question.",
    settings: [
      {"key":"dimension_units","label":"Measurement units","path":"Settings → Device → Dimension units","type":"enum","absent":"mm","effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:835","options":[{"value":"mm","label":"Millimetres"},{"value":"in","label":"Inches"},{"value":"px","label":"Screen pixels"}],"help":"Units used when KOReader shows sizes such as margins.","level":"advanced"},
      {"key":"dimension_units_append_px","label":"Also show pixels","path":"Settings → Device → Dimension units","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/common_settings_menu_table.lua:831","help":"Also shows sizes in screen pixels next to millimetres or inches.","level":"advanced"},
      {"key":"keyboard_layout_default","label":"Default keyboard language","path":"Settings → Device → Keyboard → Keyboard layouts (long-press)","type":"string","absent":null,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:80","maxLength":500,"help":"The keyboard language that is used by default, written as a language code such as en or tr.","example":"tr: the on-screen keyboard opens with Turkish letters.","level":"basic"},
      {"key":"keyboard_remember_layout","label":"Remember last keyboard language","path":"Settings → Device → Keyboard","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:156","help":"The keyboard opens in the language you used last time, instead of the default one.","level":"basic"},
      {"key":"keyboard_swipes_enabled","label":"Swipe keys for extra characters","path":"Settings → Device → Keyboard","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:263","help":"Swiping on a key types an extra character, such as an accented letter or symbol.","example":"Swipe up on 'e' to type 'é' without opening a pop-up.","level":"basic"},
      {"key":"keyboard_key_font_size","label":"Keyboard letter size","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"int","absent":22,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:191","help":"Size of the letters on the on-screen keyboard keys.","level":"basic"},
      {"key":"keyboard_key_bold","label":"Bold keyboard letters","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:192","help":"Shows the keyboard letters in bold, so they are easier to see.","level":"basic"},
      {"key":"keyboard_key_border","label":"Outlined keys","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"bool","absent":true,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:193","help":"Draws an outline around each keyboard key.","level":"basic"},
      {"key":"keyboard_key_compact","label":"Compact keyboard","path":"Settings → Device → Keyboard → Keyboard appearance settings","type":"bool","absent":false,"effect":"next_book","source":"frontend/ui/elements/menu_keyboard_layout.lua:194","help":"Makes the keys smaller with less space between them.","level":"advanced"},
      {"key":"mass_storage_confirmation_disabled","label":"Skip USB connection question","path":"Settings → Device → USB mass storage","type":"bool","absent":false,"effect":"immediate","source":"frontend/ui/elements/mass_storage.lua:26","help":"When you plug the Kobo into a computer, it goes straight into file-transfer mode without asking first.","level":"advanced"},
    ],
  },
  {
    id: "plugin_tables", label: "Statistics, timer and tools",
    summary: "Settings for built-in add-ons: reading statistics, the read timer, the word list, Calibre and a few others.",
    affects: "Your reading statistics and calendar, the read timer alerts, saved words and Calibre features change.",
    settings: [
      {"key":"statistics.min_sec","label":"Shortest time counted per page","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":5,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1097","min":0,"max":120,"unit":"seconds","help":"A page you turn faster than this many seconds is not counted as read. This affects the reading minutes Lasci's Board shows.","example":"5: flicking past pages quickly does not add reading time.","level":"advanced"},
      {"key":"statistics.max_sec","label":"Longest time counted per page","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":120,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1098","min":10,"max":7200,"unit":"seconds","help":"The most time counted for one page, so leaving the Kobo open on a page does not inflate your reading time. This affects the reading minutes Lasci's Board shows.","example":"120: if you leave a page open for 20 minutes, only 2 minutes are counted.","level":"advanced"},
      {"key":"statistics.freeze_finished_books","label":"Stop counting finished books","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1110","help":"Stops recording reading time for books marked finished, so re-reading parts of them does not change their statistics or your minutes on Lasci's Board.","level":"advanced"},
      {"key":"statistics.calendar_start_day_of_week","label":"Week starts on","path":"Tools tab (🔧) → Reading statistics → Settings","type":"enum","absent":2,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1124","options":[{"value":6,"label":"Friday"},{"value":7,"label":"Saturday"},{"value":1,"label":"Sunday"},{"value":2,"label":"Monday"}],"help":"The first day of the week in the reading statistics calendar.","level":"basic"},
      {"key":"statistics.calendar_nb_book_spans","label":"Books per calendar day","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":3,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1163","min":1,"max":5,"help":"How many books can be shown for one day in the reading statistics calendar.","level":"advanced"},
      {"key":"statistics.calendar_show_histogram","label":"Show reading-by-hour bars","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1174","help":"Shows a small bar chart in each calendar day of when during the day you read.","level":"advanced"},
      {"key":"statistics.calendar_browse_future_months","label":"Allow browsing future months","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1181","help":"Lets you page forward to months that have not happened yet in the reading calendar.","level":"advanced"},
      {"key":"statistics.calendar_day_start_hour","label":"Day starts at (hour)","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":0,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1210","min":0,"max":23,"help":"The hour when a new day starts in the daily reading timeline. Useful if you read past midnight.","example":"4: reading at 1 am counts with the previous evening.","level":"advanced"},
      {"key":"statistics.calendar_day_start_minute","label":"Day starts at (minute)","path":"Tools tab (🔧) → Reading statistics → Settings","type":"int","absent":0,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1211","min":0,"max":59,"help":"The minute part of the time a new day starts in the daily reading timeline.","level":"advanced"},
      {"key":"statistics.calendar_use_day_time_shift","label":"Use later day start in calendar","path":"Tools tab (🔧) → Reading statistics → Settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/statistics.koplugin/main.lua:1223","help":"Also uses the later day start in the monthly calendar, not just the daily timeline.","level":"advanced"},
      {"key":"readtimer.show_on_expiry","label":"When the timer ends","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"enum","absent":null,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:403","options":[{"value":"notification","label":"Short notice that disappears"},{"value":"nothing","label":"Nothing"}],"help":"What happens when the read timer runs out. Not set means a message you must tap away.","level":"basic"},
      {"key":"readtimer.snooze_minutes","label":"Snooze length","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"int","absent":5,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:375","min":1,"max":60,"unit":"minutes","help":"How many minutes Snooze adds when the timer goes off.","level":"basic"},
      {"key":"readtimer.auto_reschedule_interval","label":"Repeat timer automatically","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"bool","absent":false,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:276","help":"For a repeating timer, starts it again by itself each time it ends.","example":"A 30-minute timer reminds you every 30 minutes until you stop it.","level":"basic"},
      {"key":"readtimer.show_value_in_header","label":"Timer in top bar","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"bool","absent":false,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:285","help":"Shows the time left on the read timer in the top status bar.","level":"basic"},
      {"key":"readtimer.show_value_in_footer","label":"Timer in bottom bar","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"bool","absent":false,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:298","help":"Shows the time left on the read timer in the bottom status bar.","level":"basic"},
      {"key":"readtimer.expiry_message_text","label":"Timer message","path":"Reader → Navigation tab (bookmark icon) → Read timer","type":"string","absent":null,"effect":"next_book","source":"plugins/readtimer.koplugin/main.lua:420","maxLength":500,"help":"Your own text to show when the timer ends. If not set, it says 'Time is up'.","example":"'Lights out, sleep time'","level":"basic"},
      {"key":"vocabulary_builder.enabled","label":"Save looked-up words","path":"Search tab (🔍) → Vocabulary builder → settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/vocabbuilder.koplugin/main.lua:463","help":"Saves every word you look up in the dictionary to a word list you can review later like flashcards.","level":"basic"},
      {"key":"vocabulary_builder.with_context","label":"Save the sentence too","path":"Search tab (🔍) → Vocabulary builder → settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/vocabbuilder.koplugin/main.lua:459","help":"Also saves the sentence around each looked-up word, so you remember where you saw it.","level":"basic"},
      {"key":"cover_image_enabled","label":"Save cover picture to a file","path":"Settings → Screen → Cover image","type":"bool","absent":false,"effect":"next_book","source":"plugins/coverimage.koplugin/main.lua:782","help":"Saves the current book's cover as a picture file for other programs. Kobo's own software does not use it, so this is of little use here.","level":"advanced"},
      {"key":"calibre_wireless","label":"Calibre wireless transfer","path":"Tools tab (🔧) → Calibre → Wireless settings","type":"bool","absent":true,"effect":"restart","source":"plugins/calibre.koplugin/main.lua:264","help":"Lets the Calibre program on your computer send books to the Kobo over Wi-Fi. Takes effect after KOReader restarts.","level":"advanced"},
      {"key":"calibre_search_from_reader","label":"Calibre search while reading","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"restart","source":"plugins/calibre.koplugin/main.lua:174","help":"Lets you search your Calibre library on the Kobo while reading a book, not only from the file browser. Takes effect after a restart.","level":"advanced"},
      {"key":"calibre_search_case_insensitive","label":"Calibre search ignores capitals","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:195","help":"When on, searching your Calibre library ignores capital letters. When off, 'Dune' and 'dune' are different searches.","level":"advanced"},
      {"key":"calibre_search_find_by_title","label":"Calibre: search by title","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:204","help":"Searching your Calibre library looks at book titles.","level":"advanced"},
      {"key":"calibre_search_find_by_authors","label":"Calibre: search by authors","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:213","help":"Searching your Calibre library looks at author names.","level":"advanced"},
      {"key":"calibre_search_find_by_series","label":"Calibre: search by series","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:222","help":"Searching your Calibre library looks at series names.","level":"advanced"},
      {"key":"calibre_search_find_by_tag","label":"Calibre: search by tag","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:231","help":"Searching your Calibre library looks at Calibre tags.","level":"advanced"},
      {"key":"calibre_search_find_by_path","label":"Calibre: search by path","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":false,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:240","help":"Searching your Calibre library looks at file and folder names.","level":"advanced"},
      {"key":"calibre_search_cache_metadata","label":"Calibre: faster searches","path":"Tools tab (🔧) → Calibre → Search settings","type":"bool","absent":true,"effect":"next_book","source":"plugins/calibre.koplugin/main.lua:186","help":"Keeps a copy of your Calibre library's book details in memory, so searches are faster.","level":"advanced"},
      {"key":"terminal_font_size","label":"Terminal: font size","path":"Tools tab (🔧) → More tools → Terminal emulator","type":"int","absent":14,"effect":"next_book","source":"plugins/terminal.koplugin/main.lua:594","min":8,"max":30,"help":"Text size in the terminal tool, a technical command window.","level":"advanced"},
      {"key":"terminal_buffer_size","label":"Terminal: buffer size","path":"Tools tab (🔧) → More tools → Terminal emulator","type":"int","absent":16,"effect":"next_book","source":"plugins/terminal.koplugin/main.lua:618","min":10,"max":30,"unit":"kB","help":"How much past output the terminal tool keeps, in kilobytes.","level":"advanced"},
    ],
  },
  {
    id: "hidden_tunables", label: "Hidden tweaks",
    summary: "Technical tweaks that KOReader has no menu for.",
    affects: "Mostly small behind-the-scenes changes; leave these alone unless you know why.",
    settings: [
      {"key":"screensaver_max_files","label":"Max pictures for random sleep screen","path":"(no menu)","type":"int","absent":256,"effect":"next_sleep","source":"frontend/ui/screensaver.lua:93","help":"When the sleep screen picks a random picture from a folder, it looks at no more than this many files.","level":"advanced"},
      {"key":"followed_link_marker","label":"Link landing mark (seconds)","path":"(no menu)","type":"number","absent":1,"effect":"immediate","source":"frontend/apps/reader/modules/readerrolling.lua:794","help":"After you tap a link inside a book, a mark briefly appears in the margin showing where you landed. The number is how many seconds it stays.","example":"3: the mark stays for three seconds instead of one.","level":"advanced"},
      {"key":"history_size","label":"Books kept in history","path":"(no menu)","type":"int","absent":500,"effect":"restart","source":"frontend/readhistory.lua:82","help":"How many books are remembered in the reading history list. Takes effect after a restart.","level":"advanced"},
      {"key":"page_gap_color","label":"Gap colour between PDF pages","path":"(no menu)","type":"int","absent":8,"effect":"next_book","source":"frontend/apps/reader/modules/readerview.lua:107","min":0,"max":15,"unit":"grey level /15","help":"In PDFs shown as one continuous scroll, the shade of the gap between pages: 0 white, 8 grey, 15 black.","level":"advanced"},
      {"key":"legacy_image_scaling","label":"Older picture resizing","path":"(no menu)","type":"bool","absent":false,"effect":"restart","source":"frontend/ui/renderimage.lua:317","help":"Uses an older, faster but rougher way to resize pictures. Leave off for better-looking images. Takes effect after a restart.","level":"advanced"},
      {"key":"cre_disk_cache_max_size","label":"Book cache size","path":"(no menu)","type":"int","absent":"default","effect":"restart","source":"frontend/document/credocument.lua:97","unit":"MB","help":"How much storage, in megabytes, KOReader may use to remember laid-out books so they open faster. Not set means 64 MB. Takes effect after a restart.","level":"advanced"},
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



type SettingValue = boolean | number | string | (number | null)[] | null

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
  if (def.type === 'list') return def.list ? cleanList(def.list, v) : undefined
  if (def.type === 'int' || def.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
    if (def.off !== undefined && v === def.off) return v
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

/**
 * A fixed-length list (a Lua table on the Kobo): every item a number in its
 * range (or null where holes are allowed), set items never going down when
 * `ascending`, item i equal to item n-1-i when `mirrored`. The plugin checks
 * the same (lbcore.listAllowed).
 */
function cleanList(spec: ListSpec, v: unknown): (number | null)[] | undefined {
  if (!Array.isArray(v) || v.length !== spec.length) return undefined
  const out: (number | null)[] = []
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (x === null) { if (!spec.nullable) return undefined; out.push(null); continue }
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined
    if (spec.integer && !Number.isInteger(x)) return undefined
    const ranges = spec.positions ? [spec.positions[i]] : spec.ranges ?? []
    if (!ranges.some(r => r && x >= r[0] && x <= r[1])) return undefined
    out.push(x)
  }
  if (spec.ascending) {
    let prev = -Infinity
    for (const x of out) { if (x === null) continue; if (x < prev) return undefined; prev = x }
  }
  if (spec.mirrored && out.some((x, i) => x !== out[out.length - 1 - i])) return undefined
  if (spec.nullable && out.every(x => x === null)) return undefined
  return out
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

interface DeviceFacts {
  battery?: number
  charging?: boolean
  koreader_version?: string
  storage_total?: number
  storage_free?: number
  storage_at?: string
}

/** Battery, KOReader version and the user storage the plugin sends with a sync (anything odd is dropped). */
function cleanDeviceFacts(raw: Record<string, unknown>, nowIso?: string): DeviceFacts {
  const out: DeviceFacts = {}
  if (typeof raw.battery === 'number' && Number.isFinite(raw.battery) && raw.battery >= 0 && raw.battery <= 100) out.battery = Math.round(raw.battery)
  if (typeof raw.charging === 'boolean') out.charging = raw.charging
  if (typeof raw.koreader_version === 'string' && raw.koreader_version.trim()) out.koreader_version = raw.koreader_version.trim().slice(0, 40)
  const total = raw.storage_total
  const free = raw.storage_free
  // Up to 4 TB; free never more than total.
  if (typeof total === 'number' && typeof free === 'number' && Number.isFinite(total) && Number.isFinite(free)
    && total > 0 && total <= 4 * 1024 ** 4 && free >= 0 && free <= total) {
    out.storage_total = Math.round(total)
    out.storage_free = Math.round(free)
    if (nowIso) out.storage_at = nowIso
  }
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

const BOOK_COLUMNS = 'id, koreader_md5, title, author, series, series_index, language, isbn, publisher, description, page_count, file_path, kobo_content_id, read_status, rating, started_at, finished_at, progress_pct, last_read_at, read_seconds, read_pages, device_status, device_rating, on_device, kind, file_size, subjects'

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
    ...cleanDeviceFacts(body as unknown as Record<string, unknown>, nowIso),
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
      return json({ error: missing ? 'not_migrated' : 'server', message: missing ? 'Migrations 126, 127 and 128 (books, Kobo control, books browse) must be applied.' : 'Something went wrong on the server.' }, 500)
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
