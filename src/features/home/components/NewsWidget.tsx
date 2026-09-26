import { useState } from 'react'
import { Newspaper } from 'lucide-react'
import { Button, SegmentedControl, Skeleton } from '../../../shared/ui'
import { NEWS_FEEDS, FEED_CATEGORIES, type FeedCategory, type NewsItem } from '../api/newsApi'
import { useNews } from '../hooks/useNews'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

const VISIBLE = 8

function NewsRow({ item, source }: { item: NewsItem; source: string }) {
  return (
    <li>
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="group -mx-2 flex gap-3 rounded-row p-2 transition-colors duration-100 hover:bg-surface-hover">
        {/* Source initials sit behind the image and show when it is absent or fails. */}
        <div className="relative h-14 w-[72px] shrink-0 overflow-hidden rounded-md bg-surface-2">
          <span aria-hidden className="absolute inset-0 flex select-none items-center justify-center text-micro font-semibold text-fg-faint">
            {source.slice(0, 3).toUpperCase()}
          </span>
          {item.thumbnail && (
            <img
              src={item.thumbnail}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-body font-semibold text-fg transition-colors duration-150 group-hover:text-accent-600">{item.title}</p>
          {item.excerpt && <p className="mt-0.5 line-clamp-1 text-meta text-fg-muted">{item.excerpt}</p>}
          <p className="mt-0.5 text-micro tabular-nums text-fg-muted">
            {new Date(item.pubDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </a>
    </li>
  )
}

export function NewsWidget() {
  const [category, setCategory] = useState<FeedCategory>('no')
  const ws = useWidgetState('news', { mobileCollapsed: true })
  const feed = NEWS_FEEDS.find(f => f.category === category) ?? NEWS_FEEDS[0]
  const { data, isLoading, error, refetch, isFetching } = useNews(feed.key, { enabled: !ws.collapsed })

  return (
    <WidgetShell title="News" icon={<Newspaper />} ws={ws} onRefresh={() => refetch()} refreshing={isFetching}>
      <div className="mb-3">
        <SegmentedControl<FeedCategory>
          size="sm"
          value={category}
          onChange={setCategory}
          options={FEED_CATEGORIES.map(c => ({ value: c.key, label: c.label }))}
        />
      </div>
      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-14 w-[72px] shrink-0" rounded="rounded-md" />
              <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3 w-2/3" /></div>
            </div>
          ))}
        </div>
      )}
      {error && !data && (
        <div className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
          <span>Feed unavailable — {(error as Error).message}</span>
          <Button size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}
      {data && data.length === 0 && <p className="text-body text-fg-muted">No headlines in this feed right now.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-1">
          {data.slice(0, VISIBLE).map(item => <NewsRow key={item.link} item={item} source={feed.label} />)}
        </ul>
      )}
    </WidgetShell>
  )
}
