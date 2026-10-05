import { HardDrive } from 'lucide-react'
import { Card, CardHeader, TonePill } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import { formatDateTime } from '../../../../shared/utils/dateFormat'
import { useKoboFeedState } from '../../hooks/useBooks'
import { useLibrary } from '../../hooks/useLibrary'
import { formatBytes, storageBreakdown } from '../../kobo/storageView'

const PARTS = [
  { key: 'books', label: 'Books', color: 'rgb(var(--chart-1))' },
  { key: 'news', label: 'News', color: 'rgb(var(--chart-5))' },
  { key: 'other', label: 'KOReader, fonts and Kobo system', color: 'rgb(var(--chart-6))' },
] as const

/** How full the Kobo is, and what fills it. */
export function StorageCard() {
  const state = useKoboFeedState()
  const { data: books = [] } = useLibrary(true, { includeNews: true })
  const s = storageBreakdown(state.data, books)
  return (
    <Card>
      <CardHeader title="Storage" icon={<HardDrive />}
        action={<HelpTip label="About storage"><p>The Kobo reports how much space is used and free each time it syncs. “Books” and “News” add up the files you have on it; the rest is KOReader, its fonts and dictionaries, and Kobo’s own system files.</p></HelpTip>} />
      {!s ? (
        <p className="text-meta text-fg-muted">The Kobo reports its storage after the next sync with plugin 1.2.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-kpi font-semibold tabular-nums text-fg">{formatBytes(s.free)}</span>
            <span className="text-meta text-fg-muted">free of {formatBytes(s.total)}</span>
            {s.usedShare >= 0.9 && <TonePill tone="warn">Almost full</TonePill>}
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img"
            aria-label={`${Math.round(s.usedShare * 100)}% used: books ${formatBytes(s.books)}, news ${formatBytes(s.news)}, other ${formatBytes(s.other)}`}>
            {PARTS.map(p => s[p.key] > 0 && (
              <span key={p.key} style={{ width: `${(s[p.key] / s.total) * 100}%`, background: p.color }} />
            ))}
          </div>
          <ul className="grid gap-1.5 text-meta sm:grid-cols-2">
            {PARTS.map(p => (
              <li key={p.key} className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
                <span className="flex-1 text-fg-2">{p.label}</span>
                <span className="tabular-nums text-fg">{formatBytes(s[p.key])}</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm border border-line bg-surface-2" />
              <span className="flex-1 text-fg-2">Free</span>
              <span className="tabular-nums text-fg">{formatBytes(s.free)}</span>
            </li>
          </ul>
          <p className="text-micro text-fg-muted">
            {s.at ? `Reported ${formatDateTime(s.at)}.` : ''}
            {s.unsized > 0 ? ` ${s.unsized} ${s.unsized === 1 ? 'file has' : 'files have'} no size yet; counted under “other” until the next library sync.` : ''}
          </p>
        </div>
      )}
    </Card>
  )
}
