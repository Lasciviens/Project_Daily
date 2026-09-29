import { Gauge } from 'lucide-react'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { Skeleton, cx, useChartColors } from '../../../../shared/ui'
import type { ZoneSummary, ZoneTime } from '../../workoutStats'

// Time in each heart-rate zone (workoutStats.timeInZones): one stacked bar and
// a row per zone. Zones are categories, not a status, so they take the chart
// series colours (THEME.md §2.5), easy to hard: slate, teal, lime, amber, rose.

const ZONE_SERIES: Record<ZoneTime['id'], number> = { very_light: 5, light: 0, moderate: 4, vigorous: 2, max: 3 }

const mins = (s: number) => (s === 0 ? '—' : s < 60 ? `${s}s` : `${Math.round(s / 60)} min`)

export function HeartRateZones({ summary, age, hrMax, isLoading }: {
  summary: ZoneSummary | null
  age: number | null
  /** The estimated max heart rate; null under 18 (adult formula only). */
  hrMax: number | null
  /** The profile (birth year) is still loading. */
  isLoading?: boolean
}) {
  const c = useChartColors()
  const fill = (id: ZoneTime['id']) => ({ backgroundColor: c.series[ZONE_SERIES[id]] })
  const heading = (
    <p className="section-label mb-1.5 flex items-center gap-1">
      <Gauge aria-hidden className="h-3.5 w-3.5" /> Time in heart-rate zones
      <InfoBubble label="About the zones">
        Zones are shares of your estimated max heart rate — 208 − 0.7 × age (Tanaka 2001), so they can be off by about
        ±10 bpm for you. Very light is under 57%, light 57–63%, moderate 64–76%, vigorous 77–95% and near max 96% and up
        (ACSM, Garber 2011). Moderate and harder count towards WHO&apos;s 150 minutes a week.
      </InfoBubble>
    </p>
  )
  if (isLoading) {
    return <section aria-busy="true">{heading}<Skeleton rounded="rounded-pill" className="h-3 w-full max-w-xl" /></section>
  }
  if (age == null) {
    return <section>{heading}<p className="text-meta text-fg-muted">Add your birth year in the Health profile to see time in each zone.</p></section>
  }
  if (hrMax == null) {
    return <section>{heading}<p className="text-meta text-fg-muted">Zones use an adult estimate of max heart rate, so they aren’t shown under 18.</p></section>
  }
  if (!summary) {
    return <section>{heading}<p className="text-meta text-fg-muted">This workout has no heart-rate samples.</p></section>
  }
  const shown = summary.zones.filter(z => z.seconds > 0)
  return (
    <section>
      {heading}
      <div className="flex h-3 w-full max-w-xl overflow-hidden rounded-pill bg-surface-2" role="img"
        aria-label={shown.map(z => `${z.label} ${mins(z.seconds)}`).join(', ')}>
        {shown.map(z => <span key={z.id} style={{ ...fill(z.id), width: `${z.share * 100}%` }} />)}
      </div>
      <ul className="mt-2 grid max-w-xl grid-cols-1 gap-x-6 sm:grid-cols-2">
        {summary.zones.map(z => (
          <li key={z.id} className={cx('flex min-h-[32px] items-center gap-2 border-t border-line py-1 text-meta', z.seconds === 0 && 'text-fg-faint')}>
            <span aria-hidden className={cx('h-2.5 w-2.5 shrink-0 rounded-full', z.seconds === 0 && 'opacity-40')} style={fill(z.id)} />
            <span className="min-w-0 flex-1">{z.label} <span className="text-micro font-normal text-fg-muted">{z.lowBpm}{z.highBpm != null ? `–${z.highBpm}` : '+'} bpm</span></span>
            <span className="shrink-0 font-medium tabular-nums text-fg">{mins(z.seconds)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">{Math.round(z.share * 100)}%</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-meta text-fg-muted">
        {mins(summary.moderatePlusSeconds)} at moderate or harder, against an estimated max of {summary.hrMax} bpm (age {age}).
      </p>
    </section>
  )
}
