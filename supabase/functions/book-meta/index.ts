// book-meta — fills a book's cover, page count, publisher and year
// (docs/kobo/PLAN.md §4.5). Browser JWT (verify_jwt ON); the caller's own row is
// read and written through RLS with the caller's token.
//
// Source order: Nasjonalbiblioteket (api.nb.no, no key — Norwegian books are
// poor in Open Library) by ISBN, or by title + author for a Norwegian book;
// then Open Library (keyless; cover by cover id, not by ISBN, whose endpoint is
// rate-limited per IP). Only EMPTY fields are filled — never a value the
// owner set. Covers are linked, never copied into Storage (the 1 GB wall).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const UA = 'LascisBoard/1.0 (+https://lasciviens.github.io/Project_Daily)'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

interface Found { source: string; cover_url?: string; page_count?: number; publisher?: string; published_year?: number; isbn?: string; language?: string; series?: string }

const fold = (s: string | null | undefined) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^(.*), (the|a|an)$/, '$2 $1').replace(/[^a-z0-9æøå]+/g, ' ').trim()
const sameTitle = (a: string, b: string) => {
  const x = fold(a), y = fold(b)
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x))
}
/** The automatic (no review) lookup: the whole title must match, not a prefix ("It" is not "It Ends With Us"). */
const exactTitle = (a: string, b: string) => { const x = fold(a); return !!x && x === fold(b) }
/** Any author surname in common, when both sides name one. */
const sameAuthor = (mine: string | null, theirs: string[] | undefined) => {
  if (!mine || !theirs?.length) return true
  const words = new Set(fold(mine).split(' ').filter(w => w.length > 2))
  return theirs.some(t => fold(t).split(' ').some(w => words.has(w)))
}
const year = (s: unknown) => { const m = String(s ?? '').match(/\d{4}/); return m ? Number(m[0]) : undefined }

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal })
    if (!r.ok) return null
    return await r.json()
  } catch { return null } finally { clearTimeout(t) }
}

async function fromNb(isbn: string | null, title: string, author: string | null, strict = false): Promise<Found | null> {
  const q = isbn ? `isbn:${isbn}` : `${title} ${author ?? ''}`.trim()
  const d = await getJson(`https://api.nb.no/catalog/v1/items?q=${encodeURIComponent(q)}&filter=mediatype:b%C3%B8ker&size=5`)
  const items: any[] = d?._embedded?.items ?? []
  const item = items.find(i => isbn || (strict ? exactTitle(i?.metadata?.title ?? '', title) : sameTitle(i?.metadata?.title ?? '', title)))
  if (!item) return null
  const m = item.metadata ?? {}
  return {
    source: 'Nasjonalbiblioteket',
    // 200 px tall: NB refuses larger sizes for in-copyright books (checked live: 300 px → 403).
    cover_url: item._links?.thumbnail_large?.href,
    page_count: typeof m.pageCount === 'number' ? m.pageCount : undefined,
    publisher: m.originInfo?.publisher,
    published_year: year(m.originInfo?.issued),
    isbn: m.identifiers?.isbn13?.[0],
    // NB's `series` is the publisher's imprint series ("Aschehoug krim"), not the book series: not used.
  }
}

async function fromOpenLibrary(isbn: string | null, title: string, author: string | null, strict = false): Promise<Found | null> {
  const fields = 'title,author_name,cover_i,isbn,number_of_pages_median,first_publish_year,publisher'
  const url = isbn
    ? `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=3&fields=${fields}`
    : `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author.split(/[,&;]| and /)[0])}` : ''}&limit=5&fields=${fields}`
  const d = await getJson(url)
  const doc = (d?.docs ?? []).find((x: any) => isbn ||
    (strict ? exactTitle(x?.title ?? '', title) && sameAuthor(author, x?.author_name) : sameTitle(x?.title ?? '', title)))
  if (!doc) return null
  return {
    source: 'Open Library',
    cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined,
    page_count: doc.number_of_pages_median,
    publisher: doc.publisher?.[0],
    published_year: doc.first_publish_year,
    isbn: doc.isbn?.find((i: string) => i.length === 13) ?? doc.isbn?.[0],
  }
}

const NORWEGIAN = /^(nb|nn|no|nob|nno|nor)\b/i

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  })
  const { data: { user } } = await db.auth.getUser()
  if (!user) return json({ error: 'unauthorized', message: 'Sign in again.' }, 401)
  // mode 'cover': the app's automatic lookup — the cover only, exact title (+ author) match.
  let body: { book_id?: string; mode?: string }
  try { body = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
  if (!body.book_id) return json({ error: 'invalid', message: 'book_id is required.' }, 400)

  const { data: book, error } = await db.from('books')
    .select('id, title, author, isbn, language, cover_url, page_count, publisher, published_year, series')
    .eq('id', body.book_id).maybeSingle()
  if (error) return json({ error: 'server', message: 'Could not read the book (is migration 126 applied?).' }, 500)
  if (!book) return json({ error: 'not_found', message: 'That book no longer exists.' }, 404)

  const isbn = (book.isbn ?? '').replace(/[^0-9Xx]/g, '') || null
  const norwegian = NORWEGIAN.test(book.language ?? '') || (isbn?.startsWith('97882') ?? false)
  const tries: (() => Promise<Found | null>)[] = []
  const strict = body.mode === 'cover'
  if (isbn || norwegian) tries.push(() => fromNb(isbn, book.title, book.author, strict))
  tries.push(() => fromOpenLibrary(isbn, book.title, book.author, strict))
  if (!isbn && !norwegian) tries.push(() => fromNb(null, book.title, book.author, strict))
  const FIELDS = strict ? ['cover_url'] as const : ['cover_url', 'page_count', 'publisher', 'published_year', 'isbn', 'series'] as const

  const patch: Record<string, unknown> = {}
  let source: string | null = null
  for (const t of tries) {
    const f = await t()
    if (!f) continue
    for (const k of FIELDS) {
      if ((book as Record<string, unknown>)[k] == null && patch[k] == null && f[k] != null && f[k] !== '') {
        patch[k] = f[k]
        source = source ?? f.source
      }
    }
    if (patch.cover_url && (strict || patch.page_count)) break
  }
  const updated = Object.keys(patch)
  const row = { ...patch, meta_source: source, meta_checked_at: new Date().toISOString() }
  // cover_source arrives with migration 127; without it the update still goes through.
  let { error: upErr } = await db.from('books').update(patch.cover_url ? { ...row, cover_source: 'lookup' } : row).eq('id', book.id)
  if (upErr?.code === '42703' && patch.cover_url) ({ error: upErr } = await db.from('books').update(row).eq('id', book.id))
  if (upErr) return json({ error: 'server', message: 'Could not save what was found.' }, 500)
  return json({ updated: updated.map(k => k.replace('_url', '').replace('_', ' ')), source })
})
