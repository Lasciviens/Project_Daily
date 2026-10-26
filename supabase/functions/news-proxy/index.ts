// POST /  → fetch RSS feed by URL, return raw XML
// GET  /?url=<imgUrl> → proxy an image from a trusted feed CDN
//
// The one function with no caller check (a feed fetch and an <img> send no
// JWT), so the allow-lists are its only guard. Redirects are never followed
// blindly: every hop is checked against the same list as the first URL (at
// most MAX_REDIRECTS), an image answer must be image/*, and both answers have
// a size cap — otherwise an open redirect on a listed site would make this an
// open proxy (security review 26.10.2026; scripts/verify-ssrf-guard.cjs).

function imageAllowed(host: string): boolean {
  return ALLOWED_IMAGE_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))
}

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

const ALLOWED_FEED_DOMAINS = [
  'www.vg.no',
  'www.cnnturk.com',
  'feeds.bbci.co.uk',
  'www.tek.no',              // https://www.tek.no/api/rss/rss2/medium/collections
  'feeds.arstechnica.com',   // https://feeds.arstechnica.com/arstechnica/index
]

// A listed domain also covers its subdomains (imageAllowed): VG serves from
// akamai.vgc.no, CNN Türk from image.cnnturk.com — exact matching refused both.
const ALLOWED_IMAGE_DOMAINS = [
  'ichef.bbci.co.uk',
  'vg.no',
  'vgc.no',                         // VG's image CDN (akamai.vgc.no)
  'schibsted.media',                // VG video stills (images.stream.schibsted.media)
  'cnnturk.com',
  'bilder.tv2.no',
  'dbstatic.no',
  'images.tv2.no',
  'cdn.cnnturk.com',
  'c.bilder.no',
  'shared.cdn.smp.schibsted.com',   // tek.no enclosures
  'cdn.arstechnica.net',
]

const UA = 'lascis-board/1.0 (github.com/Lasciviens/Project_Daily)'
const MAX_REDIRECTS = 3
// Measured 26.10.2026: the five feeds are 14–79 KB, their pictures at most 0.3 MB.
const FEED_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

interface UrlRules { allowed: (host: string) => boolean; protocols: string[] }
const IMAGE_RULES: UrlRules = { allowed: imageAllowed, protocols: ['https:'] }
const FEED_RULES: UrlRules = { allowed: host => ALLOWED_FEED_DOMAINS.includes(host), protocols: ['https:', 'http:'] }

class ProxyError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** `raw` (relative to `base` for a redirect's Location) when it passes the rules. */
function checkUrl(raw: string, base: URL | undefined, rules: UrlRules): URL {
  let url: URL
  try { url = new URL(raw, base) } catch { throw new ProxyError(base ? 502 : 400, base ? 'Invalid redirect' : 'Invalid url') }
  if (!rules.protocols.includes(url.protocol)) throw new ProxyError(base ? 403 : 400, rules.protocols.length === 1 ? 'HTTPS only' : 'HTTP or HTTPS only')
  if (url.username || url.password || !rules.allowed(url.hostname)) {
    throw new ProxyError(403, base ? 'Redirect to a domain that is not allowed' : 'Domain not allowed')
  }
  return url
}

/** Fetches an allowed URL, following at most MAX_REDIRECTS redirects, each re-checked. */
async function fetchAllowed(raw: string, rules: UrlRules, headers: Record<string, string>): Promise<Response> {
  let url = checkUrl(raw, undefined, rules)
  for (let hop = 0; ; hop++) {
    const res = await fetch(url.toString(), { headers, redirect: 'manual' })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    await res.body?.cancel()
    if (hop >= MAX_REDIRECTS) throw new ProxyError(502, 'Too many redirects')
    url = checkUrl(location, url, rules)
  }
}

/** The whole body, or null when it is larger than `max` bytes. */
async function readCapped(res: Response, max: number): Promise<ArrayBuffer | null> {
  if (Number(res.headers.get('content-length')) > max) { await res.body?.cancel(); return null }
  const reader = res.body?.getReader()
  if (!reader) return new ArrayBuffer(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out.buffer as ArrayBuffer
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }

  // ── GET: image proxy ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const imageUrl = new URL(req.url).searchParams.get('url')
    if (!imageUrl) return fail(400, 'Missing url')

    try {
      const upstream = await fetchAllowed(imageUrl, IMAGE_RULES, {
        'User-Agent': UA,
        'Accept':     'image/*,image/webp,*/*;q=0.8',
        // Send no Referer so CDN hotlink checks pass
      })
      if (!upstream.ok) {
        await upstream.body?.cancel()
        return fail(502, `Upstream ${upstream.status}`)
      }
      const type = (upstream.headers.get('content-type') ?? '').trim()
      if (!/^image\//i.test(type)) {
        await upstream.body?.cancel()
        return fail(415, 'Not an image')
      }
      const bytes = await readCapped(upstream, IMAGE_MAX_BYTES)
      if (!bytes) return fail(502, 'Image too large')

      return new Response(bytes, {
        headers: {
          ...corsHeaders(origin),
          'Content-Type':  type,
          'Cache-Control': 'public, max-age=86400',
          // An image opened on its own (an SVG, say) runs no script here.
          'X-Content-Type-Options':  'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      })
    } catch (err) {
      if (err instanceof ProxyError) return fail(err.status, err.message)
      return fail(502, 'Upstream unreachable')
    }
  }

  // ── POST: RSS feed proxy ──────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) })
  }

  try {
    const { url } = await req.json() as { url?: string }
    if (!url) return fail(400, 'Missing url')

    const upstream = await fetchAllowed(url, FEED_RULES, { 'User-Agent': UA })
    if (!upstream.ok) {
      await upstream.body?.cancel()
      return fail(502, `Upstream ${upstream.status}`)
    }
    const bytes = await readCapped(upstream, FEED_MAX_BYTES)
    if (!bytes) return fail(502, 'Feed too large')

    const xml = new TextDecoder().decode(bytes)
    return new Response(xml, {
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (err) {
    if (err instanceof ProxyError) return fail(err.status, err.message)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return fail(500, msg)
  }
})
