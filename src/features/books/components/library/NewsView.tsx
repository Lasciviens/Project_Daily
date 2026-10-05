import { Newspaper, Tablet } from 'lucide-react'
import { Card, EmptyState, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { formatDuration, matchesSearch } from '../../readingAggregate'
import type { Book } from '../../types'

/** News Downloader issues: only news — no status, no queue, no rating. Newest first. */
export function NewsView({ news, query }: { news: Book[]; query: string }) {
  const modal = useEntityModal()
  const rows = news.filter(b => matchesSearch(b, query))
    .sort((a, b) => (b.last_read_at ?? b.created_at).localeCompare(a.last_read_at ?? a.created_at))
  if (news.length === 0) {
    return <Card><EmptyState icon={<Newspaper />} title="No news issues"
      description="Issues the Kobo's News Downloader makes land here, kept apart from your books." /></Card>
  }
  return (
    <Card>
      <p className="mb-2 text-meta text-fg-muted">News issues are kept apart from books: they never get a status, a rating or a place in Want to read. Their reading time still counts in Stats, as news.</p>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map(b => (
          <li key={b.id}>
            <button type="button" onClick={() => modal.open({ kind: 'book', id: b.id })}
              className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left hover:bg-surface-hover">
              <Newspaper className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <Truncate as="span" className="block text-body font-medium text-fg">{b.title}</Truncate>
                <span className="block text-micro text-fg-muted">
                  Added {formatDate(b.created_at)}{b.last_read_at ? ` · read ${formatDate(b.last_read_at)}` : ''}
                </span>
              </span>
              {b.read_seconds ? <span className="shrink-0 text-meta tabular-nums text-fg-2">{formatDuration(b.read_seconds)}</span> : null}
              {b.on_device && <Tablet className="h-4 w-4 shrink-0 text-fg-muted" aria-label="On the Kobo" />}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
