export interface NewsItem {
  title:       string
  link:        string
  pubDate:     string
  description: string
  thumbnail:   string
}

export const NEWS_FEEDS: { key: string; label: string; url: string }[] = [
  { key: 'nrk', label: 'NRK',  url: 'https://www.nrk.no/nyheter/siste.rss' },
  { key: 'vg',  label: 'VG',   url: 'https://www.vg.no/rss/feed/?categories=1' },
  { key: 'e24', label: 'E24',  url: 'https://e24.no/rss' },
  { key: 'bbc', label: 'BBC',  url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
]

export async function fetchNews(feedKey: string, count = 6): Promise<NewsItem[]> {
  const feed = NEWS_FEEDS.find(f => f.key === feedKey) ?? NEWS_FEEDS[0]
  const res = await fetch(
    `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}&count=${count}`
  )
  if (!res.ok) throw new Error(`News API ${res.status}`)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error('News feed unavailable')
  return data.items as NewsItem[]
}
