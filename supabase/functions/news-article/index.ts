// news-article — downloads one news page server-side and returns its readable
// text for Home's in-app reader (NewsArticleSheet). Browser JWT (verify_jwt ON,
// and the caller is resolved with getUser below).
//
// POST { url } → { title, lead, byline, published, image, paragraphs[], blocks[],
//                  url, siteName, likelyTruncated }
//
// Safety: http/https only; localhost, private, link-local and numeric-encoded
// hosts refused (the ai-proxy fetchUrl guard), and names that resolve to such an
// address, re-checked on EVERY redirect hop
// (redirects are followed manually, at most 5); 8 s timeout; the body is read
// up to 3 MB and only text/html (or xhtml) is accepted. Nothing is stored.
//
// The extraction between the <article-extract> markers is a HAND MIRROR of
// src/features/home/articleExtract.ts (Deno cannot import from src/). Edit
// that file, then copy the block here; scripts/verify-article-extract.cjs
// fails while the two differ.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' },
})

const UA = 'Mozilla/5.0 (compatible; LascisBoard/1.0; +https://lasciviens.github.io/Project_Daily)'
const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 8000

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 198 && (b === 18 || b === 19)) return true    // benchmarking
  if (a >= 224) return true                                // multicast, reserved, broadcast
  if (a === 100 && b >= 64 && b <= 127) return true   // carrier-grade NAT
  return false
}

function isPrivateHost(hostname: string): boolean {
  let h = hostname.toLowerCase().trim()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true
  // IPv6 literal: refused outright. These fetchers read web pages by name, so an
  // IPv6 literal is never a real target — and the URL parser rewrites embedded
  // IPv4 ([::ffff:127.0.0.1] → [::ffff:7f00:1]), which a pattern check misses.
  if (h.includes(':')) return true
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateIPv4(h)
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true
  return false
}

// An IPv6 address as its eight 16-bit groups (an embedded IPv4 tail too), or null.
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (tail) {
    const q = tail.slice(1).map(Number)
    if (q.some(n => n > 255)) return null
    s = s.slice(0, tail.index) + `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...rest]
  if (fill < 0 || groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map(g => parseInt(g, 16))
}

// True for an IPv6 address a public web page never has: unspecified, loopback,
// IPv4-compatible/-mapped (judged by the IPv4 inside), NAT64, unique local
// (fd00:ec2::254 is AWS's metadata), link-local, site-local, multicast,
// documentation, Teredo, 6to4 around a private IPv4, discard.
function isPrivateIPv6(ip: string): boolean {
  const g = ipv6Groups(ip)
  if (!g) return true
  const v4 = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isPrivateIPv4(v4(g[6], g[7]))
  if (g.slice(0, 6).every(x => x === 0)) return true
  if (g[0] === 0x64 && g[1] === 0xff9b) return true
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00) return true
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return true
  if (g[0] === 0x2002) return isPrivateIPv4(v4(g[1], g[2]))
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true
  return false
}

// A public NAME can still point at a private address (127.0.0.1.nip.io,
// localtest.me, a record its owner points at 169.254.169.254), so every hop's
// name is resolved and refused when any A/AAAA answer is private (audit
// 28.10.2026). Fails closed: a name that doesn't resolve, a resolver error or a
// runtime without Deno.resolveDns refuses the hop; "no record of this type" is
// not an error. Only a timeout (the fetch's own signal) is passed on. fetch
// resolves the name again, so a rebinding name with a zero TTL can still
// change its answer in between — this closes the fixed names.
async function resolvesToPrivate(hostname: string, signal?: AbortSignal): Promise<boolean> {
  const h = hostname.toLowerCase().trim()
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateIPv4(h)
  if (h.startsWith('[') || h.includes(':')) return true
  const lookup = async (type: 'A' | 'AAAA'): Promise<string[] | null> => {
    try { return await Deno.resolveDns(h, type, { signal }) } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      return e instanceof Deno.errors.NotFound ? [] : null
    }
  }
  try {
    const [a, aaaa] = await Promise.all([lookup('A'), lookup('AAAA')])
    if (!a || !aaaa || a.length + aaaa.length === 0) return true
    return a.some(ip => isPrivateIPv4(ip)) || aaaa.some(ip => isPrivateIPv6(ip))
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    return true
  }
}

class FetchError extends Error { constructor(public code: string, message: string) { super(message) } }

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BYTES) { await reader.cancel(); break }
    chunks.push(value)
  }
  const out = new Uint8Array(Math.min(total, MAX_BYTES))
  let off = 0
  for (const c of chunks) { out.set(c.subarray(0, out.length - off), off); off += c.length; if (off >= out.length) break }
  return out
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  let charset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
  }
  try { return new TextDecoder((charset ?? 'utf-8').toLowerCase()).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

async function fetchPage(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    let current = rawUrl
    for (let hop = 0; ; hop++) {
      let url: URL
      try { url = new URL(current) } catch { throw new FetchError('bad_url', 'Invalid URL') }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('bad_url', 'Only http and https links can be read')
      if (url.username || url.password || isPrivateHost(url.hostname) || await resolvesToPrivate(url.hostname, ctl.signal)) {
        throw new FetchError('not_allowed', 'This address is not allowed')
      }
      const res = await fetch(url.toString(), {
        signal: ctl.signal,
        redirect: 'manual',
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8,tr;q=0.7' },
      })
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (location) {
        await res.body?.cancel()
        if (hop >= 5) throw new FetchError('upstream', 'Too many redirects')
        current = new URL(location, url).toString()
        continue
      }
      if (!res.ok) { await res.body?.cancel(); throw new FetchError('upstream', `The site answered ${res.status}`) }
      const type = res.headers.get('content-type')
      if (type && !/text\/html|application\/xhtml/i.test(type)) { await res.body?.cancel(); throw new FetchError('not_html', 'The link is not a web page') }
      return { html: decode(await readCapped(res), type), finalUrl: url.toString() }
    }
  } catch (e) {
    if (e instanceof FetchError) throw e
    if ((e as Error).name === 'AbortError') throw new FetchError('timeout', 'The site took too long to answer')
    throw new FetchError('upstream', 'Could not reach the site')
  } finally {
    clearTimeout(timer)
  }
}

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

/** An alt that is only "Bilde av / Foto av / Bild av / Picture of <name>" — a byline portrait. */
const BYLINE_ALT = /^(bilde|foto|bild|picture|photo|image) (av|of) [^:|()]{1,60}$/i

function imageFrom(tag: string, base: string): { src: string; alt: string } | null {
  const a = parseAttrs(tag)
  const set = pickSrcset(a['data-srcset'] ?? a.srcset ?? '')
  const raw = [set?.u, a['data-src'], a['data-original'], a.src].find(c => c && !c.startsWith('data:'))
  if (!raw) return null
  // Thumbnails and avatars: the best srcset entry, else the width attribute, is under 300 px.
  const w = set && set.w > 0 ? set.w : Number(a.width)
  if (Number.isFinite(w) && w > 0 && w < 300) return null
  if (/\.svg(\?|$)|logo|icon|avatar|sprite|pixel|placeholder|1x1|chart\.googleapis|qr-?code|doubleclick|adservice/i.test(raw)) return null
  const alt = (a.alt ?? '').trim()
  // Writer/byline portraits: VG labels them only "Bilde av <name>" (a real
  // photo carries a caption with "Foto: …"), so a bare "Bilde av X" is skipped.
  if (BYLINE_ALT.test(alt)) return null
  const src = absolutize(raw, base)
  return src ? { src, alt } : null
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  })
  const { data: { user } } = await db.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (!(await isAppUser(user.id))) return json({ error: 'forbidden' }, 403)

  let url = ''
  try { url = String(((await req.json()) as { url?: unknown }).url ?? '').trim() } catch { /* empty body */ }
  if (!url || url.length > 2048) return json({ error: 'bad_url', message: 'Missing url' }, 400)

  try {
    const { html, finalUrl } = await fetchPage(url)
    return json(extractArticle(html, finalUrl))
  } catch (e) {
    const err = e instanceof FetchError ? e : new FetchError('upstream', 'Could not read the article')
    const status = err.code === 'bad_url' || err.code === 'not_allowed' ? 400 : err.code === 'timeout' ? 504 : 502
    return json({ error: err.code, message: err.message }, status)
  }
})
