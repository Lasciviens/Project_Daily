import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNews, NEWS_FEEDS, FEED_CATEGORIES, type FeedCategory, type NewsItem } from '../api/newsApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

// ─── Component ────────────────────────────────────────────────────────────────

export function NewsWidget() {
  // Mobile audit: 2026-06-15 — thumbnail absolute positioning verified OK; category tab touch targets raised to min-h-[32px] min-w-[40px] within 40px header constraint
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
          className={`text-[10px] px-2 py-1 rounded font-medium transition-colors duration-150 min-h-[32px] min-w-[40px] ${
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
                {/* Source initials sit behind the image; shown when image is absent or fails */}
                <div className="w-20 h-16 rounded-md flex-shrink-0 bg-ink-100 overflow-hidden relative">
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-ink-400 select-none">
                    {activeFeed.label.slice(0, 3).toUpperCase()}
                  </span>
                  {item.thumbnail && (
                    <img
                      src={item.thumbnail}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold text-ink-900 group-hover:text-accent-600 leading-snug line-clamp-2 transition-colors duration-150">
                    {item.title}
                  </div>
                  {item.excerpt && (
                    <div className="text-xs text-ink-500 mt-0.5 line-clamp-2 leading-snug">
                      {item.excerpt}
                    </div>
                  )}
                  <div className="text-[11px] text-ink-400 mt-1">
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
