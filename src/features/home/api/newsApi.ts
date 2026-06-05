// rss2json.com converts RSS to JSON with CORS support.
// Free tier: 10k req/day — with 3 feeds at 15m interval = ~288 req/day, well within limit.
// If a feed returns status != 'ok', the API key rate limit or bad URL is the likely cause.
const RSS2JSON = 'https://api.rss2json.com/v1/api.json'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  title:       string
  link:        string
  pubDate:     string
  description: string
  thumbnail:   string
}

export interface NewsFeed {
  key:      string
  label:    string
  category: 'no' | 'tr' | 'world'
  url:      string
}

// ─── Feed registry ────────────────────────────────────────────────────────────

export const NEWS_FEEDS: NewsFeed[] = [
  { key: 'vg',       label: 'VG',       category: 'no',    url: 'https://www.vg.no/rss/feed/?categories=1' },
  { key: 'cnnturk',  label: 'CNN Türk', category: 'tr',    url: 'https://www.cnnturk.com/feed/rss/all/news' },
  { key: 'bbc',      label: 'BBC',      category: 'world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
]

export const FEED_CATEGORIES = [
  { key: 'no',    label: '🇳🇴 NO' },
  { key: 'tr',    label: '🇹🇷 TR' },
  { key: 'world', label: '🌐 World' },
] as const

export type FeedCategory = 'no' | 'tr' | 'world'

// ─── Exported function ────────────────────────────────────────────────────────

export async function fetchNews(feedKey: string, count = 8): Promise<NewsItem[]> {
  const feed = NEWS_FEEDS.find(f => f.key === feedKey) ?? NEWS_FEEDS[0]
  const url  = `${RSS2JSON}?rss_url=${encodeURIComponent(feed.url)}&count=${count}`
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`News API ${res.status}`)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(`Feed unavailable: ${data.message ?? 'unknown'}`)
  return data.items as NewsItem[]
}
