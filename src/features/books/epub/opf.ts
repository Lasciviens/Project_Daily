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
    authors: elements(meta, 'creator').map(e => clean(e.text)).filter(Boolean),
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

/**
 * The OPF with the edited fields written in: title and creators replaced, the
 * language set, Calibre's series meta (what KOReader and the Kobo read)
 * replaced, subjects replaced. Everything else is left exactly as it was.
 */
export function writeOpf(xml: string, edit: OpfEdit): string {
  const open = xml.match(/<(?:([\w-]+):)?metadata\b[^>]*>/i)
  if (!open || open.index === undefined) return xml
  const start = open.index + open[0].length
  const close = xml.slice(start).search(/<\/(?:[\w-]+:)?metadata>/i)
  if (close < 0) return xml
  let meta = xml.slice(start, start + close)
  const drop = (tag: string) => { meta = meta.replace(new RegExp(`\\s*<(?:[\\w-]+:)?${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</(?:[\\w-]+:)?${tag}>)`, 'gi'), '') }
  drop('title'); drop('creator'); drop('subject')
  if (edit.language) drop('language')
  meta = meta.replace(/\s*<(?:[\w-]+:)?meta\b[^>]*name\s*=\s*["']calibre:series(?:_index)?["'][^>]*?(?:\/>|>\s*<\/(?:[\w-]+:)?meta>)/gi, '')
  // A new series replaces EPUB 3's collection metas too, so two series never disagree.
  if (edit.series) meta = meta.replace(/\s*<(?:[\w-]+:)?meta\b[^>]*property\s*=\s*["'](?:belongs-to-collection|collection-type|group-position)["'][^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w-]+:)?meta>)/gi, '')
  const add: string[] = [`<dc:title>${encodeXml(edit.title)}</dc:title>`]
  for (const a of edit.authors) add.push(`<dc:creator>${encodeXml(a)}</dc:creator>`)
  if (edit.language) add.push(`<dc:language>${encodeXml(edit.language)}</dc:language>`)
  for (const s of edit.subjects) add.push(`<dc:subject>${encodeXml(s)}</dc:subject>`)
  if (edit.series) {
    add.push(`<meta name="calibre:series" content="${encodeXml(edit.series)}"/>`)
    if (edit.seriesIndex) add.push(`<meta name="calibre:series_index" content="${encodeXml(edit.seriesIndex)}"/>`)
  }
  let head = xml.slice(0, start)
  // The dc: prefix must be declared for the new elements.
  if (!/xmlns:dc\s*=/.test(xml)) head = head.replace(/<((?:[\w-]+:)?metadata)\b/i, '<$1 xmlns:dc="http://purl.org/dc/elements/1.1/"')
  return `${head}\n    ${add.join('\n    ')}${meta}${xml.slice(start + close)}`
}
