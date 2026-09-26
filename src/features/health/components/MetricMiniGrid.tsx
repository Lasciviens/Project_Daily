import { MetricMiniCard, type MiniMetricConfig, type MiniMetricWindow } from './MetricMiniCard'

// 2-up on mobile, 4-up from sm breakpoint — the matrix layout for the "extra"
// HealthKit metrics that don't warrant their own full chart. `window` is the
// Health tab's own shared date/period selection, forwarded so each card reads
// the same range the rest of the page is showing instead of a fixed last-7-days.
export function MetricMiniGrid({ title, metrics, window }: { title: string; metrics: MiniMetricConfig[]; window: MiniMetricWindow }) {
  if (!metrics.length) return null
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="section-label">{title}</p>
      <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-4">
        {metrics.map(m => <MetricMiniCard key={m.metric} config={m} window={window} />)}
      </div>
    </div>
  )
}
