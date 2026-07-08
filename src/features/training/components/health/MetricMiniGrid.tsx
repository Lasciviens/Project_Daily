import { MetricMiniCard, type MiniMetricConfig } from './MetricMiniCard'

// 2-up on mobile, 4-up from sm breakpoint — the matrix layout requested for
// the "extra" HealthKit metrics that don't warrant their own full chart.
export function MetricMiniGrid({ title, metrics }: { title: string; metrics: MiniMetricConfig[] }) {
  if (!metrics.length) return null
  return (
    <div className="pt-3 border-t border-ink-100 flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {metrics.map(m => <MetricMiniCard key={m.metric} config={m} />)}
      </div>
    </div>
  )
}
