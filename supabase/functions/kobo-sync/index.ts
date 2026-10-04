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

/** Splits `/…/kobo-sync/opds/<token>/books/<id>/<name>` into its parts. */
function parseRoute(pathname: string): { kind: 'feed'; token: string } | { kind: 'book'; token: string; id: string } | { kind: 'sweep' } | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[parts.length - 1] === 'sweep') return { kind: 'sweep' }
  const i = parts.indexOf('opds')
  if (i < 0 || !parts[i + 1]) return null
  const token = decodeURIComponent(parts[i + 1])
  if (parts[i + 2] === 'books' && parts[i + 3]) return { kind: 'book', token, id: parts[i + 3] }
  if (parts.length === i + 2) return { kind: 'feed', token }
  return null
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

async function touchState(db: Db, userId: string, patch: Record<string, string>) {
  await db.from('kobo_feed_state').upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

Deno.serve(async req => {
  const secret = Deno.env.get('KOBO_OPDS_TOKEN') ?? ''
  const userId = Deno.env.get('HEVY_USER_ID') ?? ''
  if (!secret || !userId) return text('Send to Kobo is not configured (KOBO_OPDS_TOKEN / HEVY_USER_ID).', 503)

  const url = new URL(req.url)
  const route = parseRoute(url.pathname)
  if (!route) return text('Not found', 404)
  const db = admin()

  try {
    if (route.kind === 'sweep') {
      if (req.method !== 'POST' || !sameToken(req.headers.get('x-kobo-token') ?? '', secret)) return text('Forbidden', 403)
      const removed = await sweep(db, userId)
      return new Response(JSON.stringify({ removed }), { headers: { 'Content-Type': 'application/json' } })
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
        'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('kobo-sync', e instanceof Error ? e.message : e)
    return text('Something went wrong on the server.', 500)
  }
})
