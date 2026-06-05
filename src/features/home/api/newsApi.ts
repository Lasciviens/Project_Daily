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

// ─── RSS parser ───────────────────────────────────────────────────────────────

// Parse raw RSS XML string into NewsItem array using browser's DOMParser.
// Extracts <title>, <link>, <pubDate>, and <media:thumbnail> or <enclosure>.
function parseRSS(xml: string, count: number): NewsItem[] {
  const doc   = new DOMParser().parseFromString(xml, 'text/xml')
  const items = Array.from(doc.querySelectorAll('item')).slice(0, count)

  return items.map(item => {
    const text = (tag: string) => item.querySelector(tag)?.textContent?.trim() ?? ''

    // Thumbnail: try RSS media tags only — description <img> URLs are hotlink-protected on many sites
    // <media:thumbnail> — BBC, many feeds
    // <media:content type="image/..."> — VG and others
    // <enclosure type="image/..."> — some feeds
    const MRSS = 'http://search.yahoo.com/mrss/'
    const mediaThumbnail = item.getElementsByTagNameNS(MRSS, 'thumbnail')[0]
    const mediaContent   = Array.from(item.getElementsByTagNameNS(MRSS, 'content'))
      .find(el => el.getAttribute('type')?.startsWith('image') || el.getAttribute('url'))
    const enclosure      = item.querySelector('enclosure[type^="image"]')

    const thumbnail = (
      mediaThumbnail?.getAttribute('url') ??
      mediaContent?.getAttribute('url')   ??
      enclosure?.getAttribute('url')      ??
      ''
    )

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

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const res = await fetch(PROXY_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'apikey':        anonKey,
    },
    body: JSON.stringify({ url: feed.url }),
  })
  if (!res.ok) throw new Error(`News proxy ${res.status}`)

  const xml = await res.text()
  return parseRSS(xml, count)
}
