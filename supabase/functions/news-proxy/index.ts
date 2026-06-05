// Fetches an RSS feed URL server-side and returns raw XML with CORS headers.
// Required because most RSS feeds don't set Access-Control-Allow-Origin,
// so direct browser fetches from GitHub Pages are blocked.

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

// Only allow fetching from a known list of RSS feed URLs — prevents open proxy abuse
const ALLOWED_FEED_DOMAINS = [
  'www.vg.no',
  'www.cnnturk.com',
  'feeds.bbci.co.uk',
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }

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

    // Validate domain against allowlist — prevents this function from being used as an open proxy
    const feedDomain = new URL(url).hostname
    if (!ALLOWED_FEED_DOMAINS.includes(feedDomain)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'lascis-board/1.0 (furkan.hamdemir@power.no)' },
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
