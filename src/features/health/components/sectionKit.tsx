import type { ReactNode } from 'react'
import { Card, cx } from '../../../shared/ui'
import { fmtPct } from './healthFormat'

/** A Health section's panel. `dimmed` while the previous window's data is
 *  still on screen and the new one loads (keepPreviousData). */
export function SectionCard({ children, className, dimmed }: { children: ReactNode; className?: string; dimmed?: boolean }) {
  return (
    <Card className={cx('flex flex-col gap-3 transition-opacity', dimmed && 'opacity-60', className)} aria-busy={dimmed || undefined}>
      {children}
    </Card>
  )
}

/** Eyebrow + big number: the section's headline figure. */
export function HeadlineStat({ label, value, unit, sub, trend }: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  /** One muted line under the number ("today so far", "today left out"). */
  sub?: ReactNode
  trend?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="section-label">{label}</p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-kpi font-bold leading-tight tabular-nums tracking-tight text-fg">
        <span>
          {value}
          {unit != null && <span className="text-body font-normal text-fg-muted"> {unit}</span>}
        </span>
        {trend}
      </p>
      {sub != null && <p className="text-meta text-fg-muted">{sub}</p>}
    </div>
  )
}

/** A secondary figure beside the headline. */
export function SideStat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-lead font-bold tabular-nums text-fg">{value}</p>
      <p className="text-micro font-normal text-fg-muted">{label}</p>
    </div>
  )
}

/** Change against the same-length window before. Neutral unless the metric
 *  has a direction that is genuinely better (e.g. more sleep) — all-day
 *  average heart rate has none, so it gets no colour (H-13). */
export function TrendBadge({ pct, good }: { pct: number | null | undefined; good?: 'up' | 'down' }) {
  const text = fmtPct(pct)
  if (!text) return null
  const up = (pct as number) > 0
  const tone = good ? ((good === 'up') === up ? 'success' : 'danger') : 'neutral'
  return (
    <span data-tone={tone} className="tone-text text-micro font-semibold tabular-nums"
      title="Compared with the same-length period just before">
      {up ? '▲' : '▼'} {text.replace(/^[+−]/, '')}
    </span>
  )
}
