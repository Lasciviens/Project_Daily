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

export type DeliveryStatus = 'queued' | 'downloaded' | 'expired' | 'cancelled'

export interface FeedDelivery {
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
export const KEEP_AFTER_DOWNLOAD_MS = 24 * 3600 * 1000
export const KEEP_UNDELIVERED_MS = 7 * 24 * 3600 * 1000

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** The book's title for the feed: its own, else the file name without extension(s). */
export function displayTitle(d: Pick<FeedDelivery, 'title' | 'filename'>): string {
  const t = d.title?.trim()
  if (t) return t
  return d.filename.replace(/\.kepub\.epub$/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim() || d.filename
}

/** A file name safe in a URL path segment and on FAT32 (no / \ : * ? " < > |). */
export function safeFileName(name: string): string {
  const cleaned = [...name.normalize('NFC')].map(ch => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('')
    .replace(/_+/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned.slice(-120) || 'book.epub'
}

/**
 * The object name inside the bucket. Supabase Storage refuses keys with
 * brackets or non-ASCII letters ("[Harry Potter _3] … Tutsağı.epub"), so the
 * stored object is always book.<ext>; the real name lives in `filename`.
 */
export function storageFileName(name: string): string {
  const n = name.toLowerCase()
  if (n.endsWith('.kepub.epub')) return 'book.kepub.epub'
  if (n.endsWith('.pdf')) return 'book.pdf'
  return 'book.epub'
}

/** A Content-Disposition header that is valid for any name (HTTP headers are Latin-1 only). */
export function contentDisposition(name: string): string {
  const ascii = [...name.normalize('NFKD')].map(ch => {
    const c = ch.charCodeAt(0)
    if (c >= 0x300 && c <= 0x36f) return ''
    return c >= 32 && c < 127 && ch !== '"' && ch !== '\\' ? ch : '_'
  }).join('').replace(/_+/g, '_') || 'book'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** The MIME type KOReader needs on the acquisition link. */
export function acquisitionType(d: Pick<FeedDelivery, 'filename' | 'mime'>): string {
  if (/\.pdf$/i.test(d.filename)) return 'application/pdf'
  return 'application/epub+zip'
}

/** Rows the feed lists: waiting or downloaded within the keep window, newest first. */
export function feedEntries(rows: readonly FeedDelivery[], nowMs: number): FeedDelivery[] {
  return rows
    .filter(r => r.status === 'queued' || (r.status === 'downloaded' && !!r.downloaded_at && nowMs - Date.parse(r.downloaded_at) < KEEP_AFTER_DOWNLOAD_MS))
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Rows whose file must go now: downloaded > 24 h ago, or queued > 7 days. */
export function sweepTargets(rows: readonly FeedDelivery[], nowMs: number): FeedDelivery[] {
  return rows.filter(r =>
    (r.status === 'downloaded' && !!r.downloaded_at && nowMs - Date.parse(r.downloaded_at) >= KEEP_AFTER_DOWNLOAD_MS) ||
    (r.status === 'queued' && nowMs - Date.parse(r.created_at) >= KEEP_UNDELIVERED_MS))
}

/** A weak validator that changes whenever the listed entries change. */
export function feedEtag(entries: readonly FeedDelivery[]): string {
  let h = 2166136261
  for (const e of entries) {
    for (const ch of `${e.id}|${e.status}|${e.created_at};`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  }
  return `W/"kobo-${entries.length}-${h.toString(16)}"`
}

export function bookHref(base: string, token: string, d: Pick<FeedDelivery, 'id' | 'filename'>): string {
  return `${base}/opds/${encodeURIComponent(token)}/books/${d.id}/${encodeURIComponent(safeFileName(d.filename))}`
}

/** The whole Atom feed. `base` is the function's public URL (no trailing slash). */
export function buildFeed(base: string, token: string, entries: readonly FeedDelivery[], updatedIso: string): string {
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

export type Route =
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
export function parseRoute(pathname: string): Route | null {
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
