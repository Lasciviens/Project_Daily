import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNews, NEWS_FEEDS, FEED_CATEGORIES, type FeedCategory, type NewsItem } from '../api/newsApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

// ─── Component ────────────────────────────────────────────────────────────────

export function NewsWidget() {
  const [category, setCategory] = useState<FeedCategory>('no')
  // News updates infrequently — 15m is the right default
  const ws = useWidgetState('news', { collapsed: false, intervalMs: 15 * 60_000 })

  const activeFeed = NEWS_FEEDS.find(f => f.category === category) ?? NEWS_FEEDS[0]

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:        ['news', activeFeed.key],
    queryFn:         () => fetchNews(activeFeed.key),
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed,
  })

  const categoryTabs = (
    <div className="flex gap-1">
      {FEED_CATEGORIES.map(c => (
        <button
          key={c.key}
          onClick={() => setCategory(c.key)}
          className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors duration-150 ${
            category === c.key
              ? 'bg-accent-500 text-white'
              : 'text-ink-400 hover:bg-ink-100'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  )

  return (
    <WidgetShell
      title="News"
      ws={ws}
      headerRight={categoryTabs}
      onManualSync={() => { refetch(); ws.markSynced() }}
    >
      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error     && (
        <div className="text-ink-400 text-sm">
          Feed unavailable — {(error as Error).message}
        </div>
      )}
      {data && (
        <ul className="space-y-4">
          {data.slice(0, 8).map((item: NewsItem, i: number) => (
            <li key={i}>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex gap-3"
              >
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="w-16 h-12 object-cover rounded-md flex-shrink-0 bg-ink-100"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-800 group-hover:text-accent-600 leading-snug line-clamp-2 transition-colors duration-150">
                    {item.title}
                  </div>
                  <div className="text-xs text-ink-400 mt-1">
                    {new Date(item.pubDate).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  )
}
