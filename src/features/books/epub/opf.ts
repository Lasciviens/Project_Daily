// Reading and editing an EPUB's package file (OPF) — pure, regex-based so it
// runs in the verify script without a DOM; verified by scripts/verify-epub-tools.cjs.
// Only the fields the Send to Kobo preview shows are read or written.

export interface EpubMeta {
  title: string | null
  authors: string[]
  language: string | null
  publisher: string | null
  year: number | null
  isbn: string | null
  description: string | null
  subjects: string[]
  series: string | null
  seriesIndex: string | null
  /** Path of the cover image inside the archive, if the OPF names one. */
  coverPath: string | null
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function decodeXml(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : m
      }
      return ENTITY[e.toLowerCase()] ?? m
    })
}
export function encodeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Element text as plain words: markup removed, entities decoded, then any escaped HTML (a description's <p>) removed too. */
const clean = (s: string) => decodeXml(s.replace(/<[^>]+>/g, ' ')).replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim()

/** The OPF path from META-INF/container.xml. */
export function opfPath(containerXml: string): string | null {
  const m = containerXml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i)
  return m ? decodeXml(m[1]) : null
}

function elements(xml: string, tag: string): { attrs: string; text: string }[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>)`, 'gi')
  const out: { attrs: string; text: string }[] = []
  for (const m of xml.matchAll(re)) out.push({ attrs: m[1] ?? '', text: m[2] ?? '' })
  return out
}
const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m ? decodeXml(m[1]) : null
}

/** A path relative to the OPF's folder → its path inside the archive. */
export function resolvePath(opf: string, href: string): string {
  const base = opf.includes('/') ? opf.slice(0, opf.lastIndexOf('/') + 1) : ''
  const parts: string[] = []
  for (const p of (base + decodeURIComponent(href.split('#')[0])).split('/')) {
    if (p === '..') parts.pop()
    else if (p && p !== '.') parts.push(p)
  }
  return parts.join('/')
}

/**
 * The creators who are authors: no role, or role "aut" (EPUB 2 opf:role, or
 * an EPUB 3 <meta refines="#id" property="role">). Illustrators, translators
 * and editors are left out — they are not the book's authors.
 */
function authorElements(meta: string): { attrs: string; text: string }[] {
  const roles = new Map<string, string>()
  for (const m of elements(meta, 'meta')) {
    if (attr(m.attrs, 'property') !== 'role') continue
    const ref = attr(m.attrs, 'refines')
    if (ref?.startsWith('#')) roles.set(ref.slice(1), clean(m.text).toLowerCase())
  }
  return elements(meta, 'creator').filter(e => {
    const role = (attr(e.attrs, 'opf:role') ?? attr(e.attrs, 'role') ?? roles.get(attr(e.attrs, 'id') ?? '') ?? 'aut').toLowerCase()
    return role === 'aut'
  })
}

export function readOpf(xml: string, opf: string): EpubMeta {
  const meta = xml.match(/<(?:[\w-]+:)?metadata\b[\s\S]*?<\/(?:[\w-]+:)?metadata>/i)?.[0] ?? xml
  const first = (tag: string) => { const e = elements(meta, tag)[0]; const t = e ? clean(e.text) : ''; return t || null }
  const metas = elements(meta, 'meta')
  const named = (n: string) => { const m = metas.find(x => attr(x.attrs, 'name') === n); return m ? attr(m.attrs, 'content') : null }
  const prop = (p: string) => { const m = metas.find(x => attr(x.attrs, 'property') === p); return m ? clean(m.text) || null : null }
  const date = first('date')
  const year = date?.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1]
  const ids = elements(meta, 'identifier').map(e => clean(e.text))
  const isbn = ids.map(i => i.replace(/^urn:isbn:/i, '').replace(/[\s-]/g, '')).find(i => /^(97[89])?\d{9}[\dX]$/i.test(i)) ?? null
  // The cover: EPUB 3 "cover-image" property, else EPUB 2 <meta name="cover" content="id">.
  const items = elements(xml, 'item')
  const coverId = named('cover')
  const cover = items.find(i => /(^|\s)cover-image(\s|$)/.test(attr(i.attrs, 'properties') ?? ''))
    ?? (coverId ? items.find(i => attr(i.attrs, 'id') === coverId) : undefined)
  const href = cover ? attr(cover.attrs, 'href') : null
  const description = first('description')
  return {
    title: first('title'),
    authors: authorElements(meta).map(e => clean(e.text)).filter(Boolean),
    language: first('language'),
    publisher: first('publisher'),
    year: year ? Number(year) : null,
    isbn,
    description: description ? description.slice(0, 5000) : null,
    subjects: [...new Set(elements(meta, 'subject').map(e => clean(e.text)).filter(Boolean))].slice(0, 12),
    series: named('calibre:series') ?? prop('belongs-to-collection'),
    seriesIndex: named('calibre:series_index') ?? prop('group-position'),
    coverPath: href ? resolvePath(opf, href) : null,
  }
}

export interface OpfEdit {
  title: string
  authors: string[]
  language: string | null
  series: string | null
  seriesIndex: string | null
  subjects: string[]
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The OPF with only the fields that CHANGED written in; everything else —
 * other creators (illustrators…), ids, file-as sort names, subtitles — stays
 * exactly as it was. Nothing changed → the same text back (the file is sent
 * untouched).
 *   title       the first <dc:title>'s text, in place
 *   authors     the author creators replaced (other roles kept)
 *   language    the first <dc:language>'s text, in place (or added)
 *   subjects    every <dc:subject> replaced
 *   series      Calibre's series metas (what KOReader and the Kobo read), EPUB 3's collection metas removed
 */
export function writeOpf(xml: string, edit: OpfEdit, opf = 'content.opf'): string {
  const open = xml.match(/<(?:[\w-]+:)?metadata\b[^>]*>/i)
  if (!open || open.index === undefined) return xml
  const start = open.index + open[0].length
  const close = xml.slice(start).search(/<\/(?:[\w-]+:)?metadata>/i)
  if (close < 0) return xml
  const before = readOpf(xml, opf)
  let meta = xml.slice(start, start + close)
  const add: string[] = []
  const textOf = (tag: string, value: string) => {
    const re = new RegExp(`(<(?:[\\w-]+:)?${tag}\\b[^>]*>)[\\s\\S]*?(</(?:[\\w-]+:)?${tag}>)`, 'i')
    if (re.test(meta)) meta = meta.replace(re, (_m, a: string, b: string) => `${a}${encodeXml(value)}${b}`)
    else add.push(`<dc:${tag}>${encodeXml(value)}</dc:${tag}>`)
  }
  const removeAll = (re: RegExp) => { meta = meta.replace(re, '') }
  const elementRe = (tag: string) => new RegExp(`\\s*<(?:[\\w-]+:)?${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</(?:[\\w-]+:)?${tag}>)`, 'gi')

  if (edit.title && edit.title !== before.title) textOf('title', edit.title)
  if (edit.language && edit.language !== before.language) textOf('language', edit.language)
  if (!same(edit.authors, before.authors)) {
    const authors = authorElements(meta)
    for (const a of authors) {
      const re = new RegExp(`\\s*<(?:[\\w-]+:)?creator\\b${a.attrs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>${a.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</(?:[\\w-]+:)?creator>`, 'i')
      meta = meta.replace(re, '')
    }
    for (const a of edit.authors) add.push(`<dc:creator>${encodeXml(a)}</dc:creator>`)
  }
  if (!same(edit.subjects, before.subjects)) {
    removeAll(elementRe('subject'))
    for (const t of edit.subjects) add.push(`<dc:subject>${encodeXml(t)}</dc:subject>`)
  }
  if ((edit.series ?? null) !== before.series || (edit.series && (edit.seriesIndex ?? null) !== before.seriesIndex)) {
    removeAll(/\s*<(?:[\w-]+:)?meta\b[^>]*name\s*=\s*["']calibre:series(?:_index)?["'][^>]*?(?:\/>|>\s*<\/(?:[\w-]+:)?meta>)/gi)
    // A new series replaces EPUB 3's collection metas too, so two series never disagree.
    removeAll(/\s*<(?:[\w-]+:)?meta\b[^>]*property\s*=\s*["'](?:belongs-to-collection|collection-type|group-position)["'][^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w-]+:)?meta>)/gi)
    if (edit.series) {
      add.push(`<meta name="calibre:series" content="${encodeXml(edit.series)}"/>`)
      if (edit.seriesIndex) add.push(`<meta name="calibre:series_index" content="${encodeXml(edit.seriesIndex)}"/>`)
    }
  }
  const changed = add.length > 0 || meta !== xml.slice(start, start + close)
  if (!changed) return xml
  let head = xml.slice(0, start)
  // The dc: prefix must be declared for the new elements.
  if (add.some(a => a.startsWith('<dc:')) && !/xmlns:dc\s*=/.test(xml)) head = head.replace(/<((?:[\w-]+:)?metadata)\b/i, '<$1 xmlns:dc="http://purl.org/dc/elements/1.1/"')
  return `${head}${add.length ? `\n    ${add.join('\n    ')}` : ''}${meta}${xml.slice(start + close)}`
}
