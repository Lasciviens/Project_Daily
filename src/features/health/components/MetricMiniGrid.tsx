import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Skeleton } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { getAggregationType } from '../healthMetrics'
import { useHealthMetricsBatch, useLatestHealthValues } from '../hooks/useHealthExport'
import { MetricMiniCard } from './MetricMiniCard'
import { miniCardSummary } from './miniCardSummary'
import type { MiniMetricConfig, MiniMetricWindow } from './miniMetrics'

// The "extra" HealthKit metrics that don't warrant their own chart. ONE batch
// read for the grid's window metrics and one for its point-in-time metrics —
// each card used to run its own paginated query (~21 for the Steps view,
// H-08). Cards with nothing to show fold into a "Not recorded" list instead of
// a wall of em dashes (H-22); they stay one tap away.
export function MetricMiniGrid({ title, metrics, window, onViewDay, hideWhenEmpty, standalone, id }: {
  title: string
  metrics: MiniMetricConfig[]
  window: MiniMetricWindow
  onViewDay?: (date: string) => void
  /** Tier-3 cards: render nothing at all when no metric has data, and never
   *  list the empty ones. */
  hideWhenEmpty?: boolean
  /** Its own card with a heading of this level, instead of a block inside a card. */
  standalone?: 'h2' | 'h3'
  id?: string
}) {
  const [showEmpty, setShowEmpty] = useState(false)
  const latestMetrics = metrics.filter(m => getAggregationType(m.metric) === 'latest').map(m => m.metric)
  const windowMetrics = metrics.filter(m => getAggregationType(m.metric) !== 'latest').map(m => m.metric)
  const batch = useHealthMetricsBatch(windowMetrics, window.from, window.to)
  const latest = useLatestHealthValues(latestMetrics, window.to)

  if (!metrics.length) return null
  const loading = (windowMetrics.length > 0 && batch.isLoading) || (latestMetrics.length > 0 && latest.isLoading)
  const today = todayStr()
  const cards = metrics.map(m => {
    const daily = batch.data?.daily[m.metric] ?? []
    const l = latest.data?.[m.metric] ?? null
    return { m, daily, points: batch.data?.points[m.metric] ?? [], latest: l,
      hasData: miniCardSummary(getAggregationType(m.metric), daily, l, window, today).hasData }
  })
  const withData = cards.filter(c => c.hasData)
  const empty = hideWhenEmpty ? [] : cards.filter(c => !c.hasData)
  if (hideWhenEmpty && !loading && withData.length === 0) return null
  const render = (c: (typeof cards)[number]) => (
    <MetricMiniCard key={c.m.metric} config={c.m} window={window} points={c.points} daily={c.daily} latest={c.latest} onViewDay={onViewDay} />
  )

  return (
    <div id={id} className={standalone ? 'card flex w-full max-w-4xl scroll-mt-4 flex-col gap-2 p-4 sm:p-5' : 'flex flex-col gap-2 border-t border-line pt-3'}>
      {standalone === 'h2' ? <h2 className="text-lead font-semibold text-fg">{title}</h2>
        : standalone === 'h3' ? <h3 className="text-body font-semibold text-fg">{title}</h3>
        : <p className="section-label">{title}</p>}
      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: Math.min(4, metrics.length) }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-24" />)}
        </div>
      ) : (
        <>
          {withData.length > 0
            ? <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-4">{withData.map(render)}</div>
            : <p className="text-meta text-fg-muted">Nothing recorded in this window.</p>}
          {empty.length > 0 && (
            <>
              <button type="button" aria-expanded={showEmpty} onClick={() => setShowEmpty(s => !s)}
                className="btn-ghost btn-sm gap-1 self-start px-2 text-meta">
                <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${showEmpty ? 'rotate-180' : ''}`} />
                Not recorded in this window ({empty.length})
              </button>
              {showEmpty && <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-4">{empty.map(render)}</div>}
            </>
          )}
        </>
      )}
    </div>
  )
}
