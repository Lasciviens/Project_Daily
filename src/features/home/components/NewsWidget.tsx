import { useState } from 'react'
import { Newspaper } from 'lucide-react'
import { Button, SegmentedControl, Skeleton, Truncate, cx } from '../../../shared/ui'
import { NEWS_FEEDS, FEED_CATEGORIES, type FeedCategory, type NewsItem } from '../api/newsApi'
import { useNews } from '../hooks/useNews'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { NewsArticleSheet } from './NewsArticleSheet'
import { formatDateTime } from '../../../shared/utils/dateFormat'

const VISIBLE = 8

/** Source initials sit behind the image and show when it is absent or fails. */
function Thumb({ item, source, className }: { item: NewsItem; source: string; className: string }) {
  return (
    <div className={cx('relative shrink-0 overflow-hidden bg-surface-2', className)}>
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
  )
}

/** Phone / narrow column: one row per headline. */
function NewsRow({ item, source, onOpen }: { item: NewsItem; source: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="group -mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-row p-2 text-left transition-colors duration-100 hover:bg-surface-hover">
        <Thumb item={item} source={source} className="h-14 w-[72px] rounded-md" />
        <div className="min-w-0 flex-1">
          <Truncate as="p" lines={2} className="text-body font-semibold text-fg transition-colors duration-150 group-hover:text-accent-600">{item.title}</Truncate>
          {item.excerpt && <Truncate as="p" className="mt-0.5 text-meta text-fg-muted">{item.excerpt}</Truncate>}
          <p className="mt-0.5 text-micro tabular-nums text-fg-muted">{formatDateTime(item.pubDate)}</p>
        </div>
      </button>
    </li>
  )
}

/** The band across the bottom of Home: headlines side by side as small cards. */
function NewsCard({ item, source, onOpen }: { item: NewsItem; source: string; onOpen: () => void }) {
  return (
    <li className="min-w-0">
      <button type="button" onClick={onOpen} className="group flex h-full w-full flex-col overflow-hidden rounded-row border border-line text-left transition-colors duration-100 hover:bg-surface-hover">
        <Thumb item={item} source={source} className="aspect-[16/9] w-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <Truncate as="p" lines={3} className="text-body font-semibold text-fg transition-colors duration-150 group-hover:text-accent-600">{item.title}</Truncate>
          {item.excerpt && <Truncate as="p" lines={2} className="text-meta text-fg-muted">{item.excerpt}</Truncate>}
          <p className="mt-auto pt-1 text-micro tabular-nums text-fg-muted">{formatDateTime(item.pubDate)}</p>
        </div>
      </button>
    </li>
  )
}

/**
 * Headlines by category (NO · TR · World · Tech, Tech with two sources). A
 * headline opens the in-app reader (NewsArticleSheet), not a new tab.
 * `layout="band"`: cards side by side across the page (Home's bottom band);
 * `list`: one row each (phones). `visible`: how many headlines to show.
 */
export function NewsWidget({ visible = VISIBLE, layout = 'list' }: { visible?: number; layout?: 'list' | 'band' }) {
  const [category, setCategory] = useState<FeedCategory>('no')
  const feeds = NEWS_FEEDS.filter(f => f.category === category)
  const [feedKey, setFeedKey] = useState<Partial<Record<FeedCategory, string>>>({})
  const feed = feeds.find(f => f.key === feedKey[category]) ?? feeds[0] ?? NEWS_FEEDS[0]
  const [reading, setReading] = useState<{ item: NewsItem; source: string } | null>(null)
  const ws = useWidgetState('news', { mobileCollapsed: true })
  const { data, isLoading, error, refetch, isFetching } = useNews(feed.key, { enabled: !ws.collapsed })
  const band = layout === 'band'

  return (
    <WidgetShell title="News" icon={<Newspaper />} ws={ws} onRefresh={() => refetch()} refreshing={isFetching}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl<FeedCategory>
          size="sm"
          value={category}
          onChange={setCategory}
          options={FEED_CATEGORIES.map(c => ({ value: c.key, label: c.label }))}
        />
        {feeds.length > 1 && (
          <SegmentedControl<string>
            size="sm"
            value={feed.key}
            onChange={k => setFeedKey(prev => ({ ...prev, [category]: k }))}
            options={feeds.map(f => ({ value: f.key, label: f.label }))}
          />
        )}
      </div>
      {isLoading && (
        band ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-56 w-full" rounded="rounded-row" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-14 w-[72px] shrink-0" rounded="rounded-md" />
                <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3 w-2/3" /></div>
              </div>
            ))}
          </div>
        )
      )}
      {error && !data && (
        <div className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
          <span>Feed unavailable — {(error as Error).message}</span>
          <Button size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}
      {data && data.length === 0 && <p className="text-body text-fg-muted">No headlines in this feed right now.</p>}
      {data && data.length > 0 && (
        band ? (
          <div className="@container">
            <ul className="grid grid-cols-1 gap-3 @[30rem]:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
              {data.slice(0, visible).map(item => <NewsCard key={item.link} item={item} source={feed.label} onOpen={() => setReading({ item, source: feed.label })} />)}
            </ul>
          </div>
        ) : (
          <ul className="space-y-1">
            {data.slice(0, visible).map(item => <NewsRow key={item.link} item={item} source={feed.label} onOpen={() => setReading({ item, source: feed.label })} />)}
          </ul>
        )
      )}
      {reading && <NewsArticleSheet item={reading.item} source={reading.source} onClose={() => setReading(null)} />}
    </WidgetShell>
  )
}
