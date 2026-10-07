// POST /  → fetch RSS feed by URL, return raw XML
// GET  /?url=<imgUrl> → proxy an image from a trusted feed CDN

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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }

  // ── GET: image proxy ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const imageUrl = new URL(req.url).searchParams.get('url')
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    let parsedUrl: URL
    try { parsedUrl = new URL(imageUrl) } catch {
      return new Response(JSON.stringify({ error: 'Invalid url' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }
    if (parsedUrl.protocol !== 'https:') {
      return new Response(JSON.stringify({ error: 'HTTPS only' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }
    if (!imageAllowed(parsedUrl.hostname)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    const upstream = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'lascis-board/1.0 (github.com/Lasciviens/Project_Daily)',
        'Accept':     'image/*,image/webp,*/*;q=0.8',
        // Send no Referer so CDN hotlink checks pass
      },
    })
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    return new Response(upstream.body, {
      headers: {
        ...corsHeaders(origin),
        'Content-Type':  upstream.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  }

  // ── POST: RSS feed proxy ──────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) })
  }

  try {
    const { url } = await req.json() as { url?: string }
    if (!url) {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    const feedDomain = new URL(url).hostname
    if (!ALLOWED_FEED_DOMAINS.includes(feedDomain)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'lascis-board/1.0 (github.com/Lasciviens/Project_Daily)' },
    })
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    const xml = await upstream.text()
    return new Response(xml, {
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    })
  }
})
