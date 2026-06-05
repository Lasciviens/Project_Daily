// corsproxy.io fetches any URL server-side and returns the raw response body
// with CORS headers added. Free, no API key, well-maintained.
// Format: GET https://corsproxy.io/?{encodedUrl}  → raw RSS XML
const PROXY = 'https://corsproxy.io/?'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  title:   string
  link:    string
  pubDate: string
  thumbnail: string
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

    // Thumbnail: try <media:thumbnail url="...">, then <enclosure url="...">, then og image in description
    const mediaThumbnail = item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'thumbnail')[0]
    const enclosure      = item.querySelector('enclosure[type^="image"]')
    const thumbnail      = mediaThumbnail?.getAttribute('url') ?? enclosure?.getAttribute('url') ?? ''

    return {
      title:     text('title'),
      link:      (text('link') || item.querySelector('guid')?.textContent?.trim()) ?? '',
      pubDate:   text('pubDate'),
      thumbnail,
    }
  })
}

// ─── Exported function ────────────────────────────────────────────────────────

export async function fetchNews(feedKey: string, count = 8): Promise<NewsItem[]> {
  const feed = NEWS_FEEDS.find(f => f.key === feedKey) ?? NEWS_FEEDS[0]
  // corsproxy.io returns the raw RSS XML directly (no JSON wrapper)
  const proxied = `${PROXY}${encodeURIComponent(feed.url)}`

  const res = await fetch(proxied)
  if (!res.ok) throw new Error(`News proxy ${res.status}`)

  const xml = await res.text()
  return parseRSS(xml, count)
}
