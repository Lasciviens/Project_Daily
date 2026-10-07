// ─────────────────────────────────────────────────────────────────────────────
//  Article extraction — turns a news page's HTML into readable text for the
//  in-app reader (Home → News → a headline's popup).
//
//  Pure, dependency-free and import-free: it runs in the browser-free
//  `news-article` edge function AND in scripts/verify-article-extract.cjs.
//  MIRRORED BY HAND into supabase/functions/news-article/index.ts between the
//  `<article-extract>` markers (Deno can't import from src/); the verify script
//  fails when the two copies differ.
//
//  Strategy, in order: page metadata (Open Graph / meta / JSON-LD) for the
//  title, lead, image, byline and date; then the body from the <article>
//  element whose paragraphs hold the most text (else <main>, else the page);
//  JSON-LD `articleBody` wins when it is clearly longer (VG, CNN Türk put the
//  whole text there). Scripts, nav, asides, forms and footers are dropped;
//  short or boilerplate paragraphs ("Read more", "Les også") are skipped.
// ─────────────────────────────────────────────────────────────────────────────

// <article-extract>
export interface ArticleBlock { kind: 'p' | 'h' | 'img'; text?: string; src?: string; alt?: string }

export interface ExtractedArticle {
  url: string
  siteName: string | null
  title: string | null
  /** The standfirst / description. */
  lead: string | null
  byline: string | null
  /** ISO timestamp as the page states it. */
  published: string | null
  image: string | null
  paragraphs: string[]
  /** Paragraphs, sub-headings and inline images in reading order. */
  blocks: ArticleBlock[]
  /** The page says it is paywalled, or the text found is very short. */
  likelyTruncated: boolean
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø', aelig: 'æ', AElig: 'Æ', auml: 'ä', Auml: 'Ä',
  ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç', eacute: 'é', Eacute: 'É',
  egrave: 'è', aacute: 'á', oacute: 'ó', iacute: 'í', uacute: 'ú', ntilde: 'ñ', szlig: 'ß',
  copy: '©', reg: '®', trade: '™', euro: '€', shy: '',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return e in ENTITIES ? ENTITIES[e] : m
  })
}

/** Tags out, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

function metaMap(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const head = html.slice(0, 400_000)
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = parseAttrs(tag)
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase()
    if (key && a.content != null && !(key in out)) out[key] = a.content.trim()
  }
  return out
}

const ARTICLE_TYPES = /^(NewsArticle|Article|BlogPosting|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|LiveBlogPosting|TechArticle|Report)$/

interface LdArticle { headline?: string; body?: string; author?: string; published?: string; image?: string; free?: boolean }

function ldNodes(v: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(v)) { for (const x of v) ldNodes(x, out); return }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    out.push(o)
    if (o['@graph']) ldNodes(o['@graph'], out)
  }
}

function ldName(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    const names = v.map(ldName).filter((x): x is string => !!x)
    return names.length ? names.join(', ') : undefined
  }
  if (v && typeof v === 'object') { const n = (v as Record<string, unknown>).name; return typeof n === 'string' ? n : undefined }
  return undefined
}

function ldImage(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return ldImage(v[0])
  if (v && typeof v === 'object') { const u = (v as Record<string, unknown>).url; return typeof u === 'string' ? u : undefined }
  return undefined
}

function jsonLdArticle(html: string): LdArticle | null {
  const nodes: Record<string, unknown>[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try { ldNodes(JSON.parse(m[1].trim()), nodes) } catch { /* a broken block is skipped */ }
  }
  const isArticle = (n: Record<string, unknown>) => {
    const t = n['@type']
    return (Array.isArray(t) ? t : [t]).some(x => typeof x === 'string' && ARTICLE_TYPES.test(x))
  }
  const found = nodes.filter(isArticle)
  if (!found.length) return null
  const a = found.reduce((best, n) => (String(n.articleBody ?? '').length > String(best.articleBody ?? '').length ? n : best), found[0])
  const parts = Array.isArray(a.hasPart) ? a.hasPart : a.hasPart ? [a.hasPart] : []
  const free = a.isAccessibleForFree === false || a.isAccessibleForFree === 'False' || a.isAccessibleForFree === 'false'
    || parts.some(p => p && typeof p === 'object' && ['false', 'False', false].includes((p as Record<string, unknown>).isAccessibleForFree as string))
    ? false : undefined
  return {
    headline: typeof a.headline === 'string' ? a.headline : undefined,
    body: typeof a.articleBody === 'string' ? a.articleBody : undefined,
    author: ldName(a.author),
    published: typeof a.datePublished === 'string' ? a.datePublished : undefined,
    image: ldImage(a.image),
    free,
  }
}

/** Inner HTML of every <tag>…</tag>, outermost first, nesting respected. */
export function elementRegions(html: string, tag: string): string[] {
  const open = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi')
  const out: string[] = []
  const stack: number[] = []
  let m: RegExpExecArray | null
  while ((m = open.exec(html))) {
    if (m[0][1] !== '/') stack.push(m.index + m[0].length)
    else if (stack.length) {
      const start = stack.pop()!
      out.push(html.slice(start, m.index))
    }
  }
  return out
}

const DROP = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'aside', 'footer', 'form', 'button', 'figcaption', 'select']

function stripNoise(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
  for (const t of DROP) s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?</${t}\\s*>`, 'gi'), ' ')
  return s
}

const BOILERPLATE = /^(les også|les mer|read more|related|see also|sign up|subscribe|annonse|advertisement|reklame|share this|del (artikkelen|saken)|følg oss|follow us|cookie|image source|getty images|bildet:|foto:|photo:|this video can not be played|copyright|©|ilgili haber|haberin devamı|reklam|få mer innhold fra|gjør vg til en foretrukken|informasjon om ai i|se hva som topper|hvilket produkt er du mest)/i

function absolutize(src: string, base: string): string | null {
  try {
    const u = new URL(src.startsWith('//') ? `https:${src}` : src, base)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.protocol === 'http:') u.protocol = 'https:'
    return u.toString()
  } catch { return null }
}

/** The srcset entry nearest a reading width (≤ 1280w, else the smallest one). */
function pickSrcset(srcset: string): { u: string; w: number } | undefined {
  const entries = srcset.split(/,\s+(?=\S)/).map(x => {
    const [u, d] = x.trim().split(/\s+/)
    return { u, w: d && /w$/.test(d) ? Number(d.slice(0, -1)) : 0 }
  }).filter(e => e.u && !e.u.startsWith('data:'))
  if (!entries.length) return undefined
  const fit = entries.filter(e => e.w > 0 && e.w <= 1280).sort((a, b) => b.w - a.w)[0]
  return fit ?? entries.sort((a, b) => a.w - b.w)[entries.length - 1]
}

function imageFrom(tag: string, base: string): { src: string; alt: string } | null {
  const a = parseAttrs(tag)
  const set = pickSrcset(a['data-srcset'] ?? a.srcset ?? '')
  const raw = [set?.u, a['data-src'], a['data-original'], a.src].find(c => c && !c.startsWith('data:'))
  if (!raw) return null
  // Thumbnails and avatars: the best srcset entry, else the width attribute, is under 300 px.
  const w = set && set.w > 0 ? set.w : Number(a.width)
  if (Number.isFinite(w) && w > 0 && w < 300) return null
  if (/\.svg(\?|$)|logo|icon|avatar|sprite|pixel|placeholder|1x1|chart\.googleapis|qr-?code|doubleclick|adservice/i.test(raw)) return null
  const src = absolutize(raw, base)
  return src ? { src, alt: (a.alt ?? '').trim() } : null
}

function blocksFrom(region: string, base: string): ArticleBlock[] {
  const s = stripNoise(region)
  const out: ArticleBlock[] = []
  const re = /<(p|h2|h3)\b[^>]*>([\s\S]*?)<\/\1\s*>|<img\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (!m[1]) {
      const img = imageFrom(m[0], base)
      if (img) out.push({ kind: 'img', src: img.src, alt: img.alt })
      continue
    }
    const text = htmlToText(m[2])
    if (m[1].toLowerCase() === 'p') {
      if (text.length >= 25 && !BOILERPLATE.test(text)) out.push({ kind: 'p', text })
    } else if (text.length >= 3 && text.length <= 160 && !BOILERPLATE.test(text)) out.push({ kind: 'h', text })
  }
  return out
}

const textLength = (blocks: ArticleBlock[]) => blocks.reduce((n, b) => n + (b.kind === 'p' ? b.text!.length : 0), 0)

/** Drops repeats, a heading with no paragraph after it, images past the sixth, and the lead/main image echoed in the body. */
function tidy(blocks: ArticleBlock[], lead: string | null, image: string | null): ArticleBlock[] {
  const seen = new Set<string>()
  const out: ArticleBlock[] = []
  let images = 0
  const leadKey = lead ? lead.toLowerCase() : null
  const imgKey = (u: string) => u.split('?')[0]
  const mainImg = image ? imgKey(image) : null
  for (const b of blocks) {
    const key = b.kind === 'img' ? `img:${imgKey(b.src!)}` : `${b.kind}:${b.text!.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    if (b.kind === 'p' && leadKey && b.text!.toLowerCase() === leadKey) continue
    if (b.kind === 'img') {
      if (mainImg && imgKey(b.src!) === mainImg) continue
      if (++images > 6) continue
    }
    out.push(b)
  }
  while (out.length && out[out.length - 1].kind !== 'p') out.pop()
  return out.filter((b, i) => b.kind !== 'h' || out.slice(i + 1).some(x => x.kind === 'p'))
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const meta = metaMap(html)
  const ld = jsonLdArticle(html)
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = meta['og:title'] || meta['twitter:title'] || ld?.headline || (titleTag ? htmlToText(titleTag[1]) : '') || null
  const lead = meta['og:description'] || meta.description || meta['twitter:description'] || null
  const imageRaw = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || ld?.image || null
  const image = imageRaw ? absolutize(imageRaw, url) : null
  let siteName = meta['og:site_name'] || null
  if (!siteName) { try { siteName = new URL(url).hostname.replace(/^www\./, '') } catch { siteName = null } }
  const byline = meta.author || ld?.author || meta['article:author'] || null
  const published = meta['article:published_time'] || ld?.published || meta['og:article:published_time'] || meta.pubdate || null

  // The <article> holding the most paragraph text; then <main>; then the whole page.
  let best: ArticleBlock[] = []
  for (const region of elementRegions(html, 'article')) {
    const b = blocksFrom(region, url)
    if (textLength(b) > textLength(best)) best = b
  }
  if (textLength(best) < 300) {
    for (const region of elementRegions(html, 'main')) {
      const b = blocksFrom(region, url)
      if (textLength(b) > textLength(best)) best = b
    }
  }
  if (textLength(best) < 300) {
    const body = elementRegions(html, 'body')[0] ?? html
    const b = blocksFrom(body, url)
    if (textLength(b) > textLength(best)) best = b
  }

  const ldBody = ld?.body ? decodeEntities(ld.body.replace(/<[^>]+>/g, ' ')) : ''
  if (ldBody.length > 300 && ldBody.length > textLength(best) * 1.3) {
    best = ldBody.split(/\n+|(?<=[.!?])\s{2,}/).map(t => t.replace(/\s+/g, ' ').trim()).filter(t => t.length >= 2).map(text => ({ kind: 'p' as const, text }))
  }

  const blocks = tidy(best, lead ? htmlToText(lead) : null, image)
  const paragraphs = blocks.filter(b => b.kind === 'p').map(b => b.text!)
  const chars = paragraphs.reduce((n, p) => n + p.length, 0)
  return {
    url,
    siteName: siteName ? htmlToText(siteName) : null,
    title: title ? htmlToText(title) : null,
    lead: lead ? htmlToText(lead) : null,
    byline: byline ? htmlToText(byline) : null,
    published,
    image,
    paragraphs,
    blocks,
    likelyTruncated: ld?.free === false || chars < 500,
  }
}
// </article-extract>
