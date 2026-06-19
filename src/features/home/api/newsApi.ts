// RSS feeds are blocked by CORS when fetched directly from GitHub Pages.
// We proxy through a Supabase Edge Function that fetches server-side and adds CORS headers.
// The Edge Function validates the target domain against a fixed allowlist — not an open proxy.
const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/news-proxy`

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  title:     string
  link:      string
  pubDate:   string
  thumbnail: string
  excerpt:   string   // plain-text first ~120 chars of <description>
}

export interface NewsFeed {
  key:      string
  label:    string
  category: 'no' | 'tr' | 'world'
  url:      string
}

export type FeedCategory = 'no' | 'tr' | 'world'

// ─── Feed registry ────────────────────────────────────────────────────────────

export const NEWS_FEEDS: NewsFeed[] = [
  { key: 'vg',      label: 'VG',       category: 'no',    url: 'https://www.vg.no/rss/feed/?categories=1' },
  { key: 'cnnturk', label: 'CNN Türk', category: 'tr',    url: 'https://www.cnnturk.com/feed/rss/all/news' },
  { key: 'bbc',     label: 'BBC',      category: 'world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
]

export const FEED_CATEGORIES = [
  { key: 'no'    as FeedCategory, label: '🇳🇴 NO' },
  { key: 'tr'    as FeedCategory, label: '🇹🇷 TR' },
  { key: 'world' as FeedCategory, label: '🌐 World' },
]

// ─── RSS image helpers ────────────────────────────────────────────────────────

// Upgrade http → https, expand protocol-relative URLs, decode HTML entities.
function normalizeImageUrl(raw: string): string {
  if (!raw) return ''
  const url = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('http://')) return `https://${url.slice(7)}`
  return url
}

function looksLikeImageUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    return /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(pathname) || /\/image/i.test(pathname)
  } catch { return false }
}

// First <img src="…"> inside an HTML/CDATA blob.
function firstImgSrc(html: string): string {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return m ? normalizeImageUrl(m[1]) : ''
}

// Multi-strategy image extraction — tries namespace tags, enclosure, then inline HTML.
// VG puts images in enclosure without a type attribute; CNN Türk uses content:encoded <img>.
function extractImageUrl(item: Element): string {
  const MRSS    = 'http://search.yahoo.com/mrss/'
  const CONTENT = 'http://purl.org/rss/1.0/modules/content/'

  // 1. <media:thumbnail url="…"> (BBC, many feeds)
  const mt = item.getElementsByTagNameNS(MRSS, 'thumbnail')[0]
  if (mt?.getAttribute('url')) return normalizeImageUrl(mt.getAttribute('url')!)

  // 2. <media:content url="…" type="image/…"> (VG, others)
  const mc = Array.from(item.getElementsByTagNameNS(MRSS, 'content'))
    .find(el => el.getAttribute('type')?.startsWith('image') || el.getAttribute('url'))
  if (mc?.getAttribute('url')) return normalizeImageUrl(mc.getAttribute('url')!)

  // 3. <enclosure type="image/…">
  const encImg = item.querySelector('enclosure[type^="image"]')
  if (encImg?.getAttribute('url')) return normalizeImageUrl(encImg.getAttribute('url')!)

  // 4. <enclosure> with no type but URL that looks like an image
  const encAny = item.querySelector('enclosure[url]')
  if (encAny) {
    const u = normalizeImageUrl(encAny.getAttribute('url')!)
    if (looksLikeImageUrl(u)) return u
  }

  // 5. <img src="…"> inside <description> CDATA
  const desc = item.querySelector('description')?.textContent ?? ''
  if (desc) { const src = firstImgSrc(desc); if (src) return src }

  // 6. <img src="…"> inside <content:encoded> CDATA (CNN Türk)
  const encoded = item.getElementsByTagNameNS(CONTENT, 'encoded')[0]?.textContent ?? ''
  if (encoded) { const src = firstImgSrc(encoded); if (src) return src }

  return ''
}

// ─── RSS parser ───────────────────────────────────────────────────────────────

// Parse raw RSS XML string into NewsItem array using browser's DOMParser.
function parseRSS(xml: string, count: number): NewsItem[] {
  const doc   = new DOMParser().parseFromString(xml, 'text/xml')
  const items = Array.from(doc.querySelectorAll('item')).slice(0, count)

  return items.map(item => {
    const text = (tag: string) => item.querySelector(tag)?.textContent?.trim() ?? ''

    const thumbnail = extractImageUrl(item)

    if (import.meta.env.DEV) {
      console.debug('[newsApi] item:', text('title').slice(0, 40), '| img:', thumbnail || '(none)')
    }

    // Excerpt: strip HTML tags from <description>, collapse whitespace, cap at 120 chars
    const rawDesc  = item.querySelector('description')?.textContent ?? ''
    const descText = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const excerpt  = descText.length > 120 ? descText.slice(0, 120).trimEnd() + '…' : descText

    return {
      title:   text('title'),
      link:    (text('link') || item.querySelector('guid')?.textContent?.trim()) ?? '',
      pubDate: text('pubDate'),
      thumbnail,
      excerpt,
    }
  })
}

// ─── Exported function ────────────────────────────────────────────────────────

export async function fetchNews(feedKey: string, count = 8): Promise<NewsItem[]> {
  const feed = NEWS_FEEDS.find(f => f.key === feedKey) ?? NEWS_FEEDS[0]

  const res = await fetch(PROXY_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: feed.url }),
  })
  if (!res.ok) throw new Error(`News proxy ${res.status}`)

  const xml   = await res.text()
  const items = parseRSS(xml, count)

  // Rewrite thumbnail URLs through the image proxy — CDNs block direct hotlinks from GitHub Pages
  return items.map(item => ({
    ...item,
    thumbnail: item.thumbnail
      ? `${PROXY_URL}?url=${encodeURIComponent(item.thumbnail)}`
      : '',
  }))
}
