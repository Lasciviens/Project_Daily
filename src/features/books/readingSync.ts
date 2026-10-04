// The Kobo plugin's sync contract — pure and import-free, GENERATED into
// supabase/functions/kobo-sync by scripts/sync-kobo-shared.mjs and verified by
// scripts/verify-reading-sync.cjs (docs/kobo/PLAN.md §4.1, §4.2).
//
// A request carries the books it mentions (metadata from Nickel's database and
// KOReader's statistics/sidecars) and KOReader's page_stat_data rows grouped by
// book md5, unchanged in shape: [page, start_time (epoch s), duration (s), total_pages].
// Rows may be days old (an outbox drained late) and may repeat (lookback, full
// re-sync): the server stores each at its own time and ignores duplicates.

export const MAX_BOOKS = 300
export const MAX_EVENTS = 5000
export const MAX_INVENTORY = 20000
const MD5 = /^[0-9a-f]{32}$/

export type DeviceStatus = 'reading' | 'complete' | 'abandoned' | 'new'
export type ReadStatus = 'want' | 'reading' | 'finished' | 'paused' | 'dropped'

export interface SyncBook {
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
}

export interface SyncBody {
  v?: number
  device_id: string
  device_time: number
  plugin_version?: string
  final?: boolean          // this request finished a complete drain
  /**
   * Every md5 on the device, sent once the library's book rows have all been
   * posted (in earlier requests), and only when the plugin read the whole
   * library. Books the server holds that are missing here are marked off-device.
   */
  inventory_md5s?: string[]
  books?: SyncBook[]
  stats?: Record<string, unknown[]>
}

export interface EventRow { page: number; start: number; duration: number; total: number | null }

export interface BookRowLike {
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
export function validateSync(body: unknown, nowSec: number): string | null {
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
export function parseEvent(row: unknown, nowSec: number): EventRow | null {
  if (!Array.isArray(row) || row.length < 3) return null
  const page = int(row[0], 0, 1_000_000)
  const start = int(row[1], 946684800, nowSec + 86400)
  const duration = int(row[2], 0, 86400)
  if (page === null || start === null || duration === null) return null
  return { page, start, duration, total: int(row[3], 1, 1_000_000) }
}

/** KOReader's summary.status → our read_status (one way, device → app). */
export function mapDeviceStatus(s: unknown): ReadStatus | null {
  if (s === 'reading') return 'reading'
  if (s === 'complete') return 'finished'
  if (s === 'abandoned') return 'dropped'
  return null
}

/** The plugin sends 0–1 (KOReader's percent_finished; Nickel's 0–100 is divided first) → a percentage, 2 decimals. */
export function toPercent(v: unknown): number | null {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return Math.round(n * 10000) / 100
}

/** "Rowling, J. K." stays; a list "A & B" stays — only trims and caps. */
export function cleanAuthors(v: unknown): string | null {
  const s = str(v, 300)
  return s ? s.replace(/\s*\n\s*/g, ', ') : null
}

/** A title from a file path when nothing better is known: "Author - Title.epub" → "Title". */
export function titleFromPath(path: string | null | undefined): string | null {
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
export function newBookRow(b: SyncBook): Omit<BookRowLike, never> & { title: string } {
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
  }
}

/**
 * The patch for a book the server already holds. Metadata only FILLS empty
 * fields (the owner may have corrected a title in the app). Progress, last
 * read and totals always follow the device. A device status or rating is
 * applied only when it CHANGED on the device since the last sync, so an edit
 * made in the app is not undone on every sync. Returns {} when nothing changes.
 */
export function bookPatch(existing: BookRowLike, b: SyncBook): Partial<BookRowLike> {
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
export function lastSeenIso(deviceTime: number, nowSec: number): string {
  const t = Math.abs(deviceTime - nowSec) <= 86400 ? Math.min(deviceTime, nowSec) : nowSec
  return new Date(t * 1000).toISOString()
}
