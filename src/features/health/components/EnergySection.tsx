import { useChartColors } from '../../../shared/ui'
import { fillDays } from '../healthWindowStats'
import { useHealthHourly } from '../hooks/useHealthExport'
import { useEnergyWindow, MIN_COMPLETE_DAY_KCAL } from '../hooks/useHealthWindow'
import type { HealthRange } from './sectionTypes'
import { useRangeWindow, windowNoun } from './dateNav'
import { HealthTrendChart } from './HealthTrendChart'
import { HeadlineStat, SectionCard, TrendBadge } from './sectionKit'
import { fmtAxisFor, fmtInt } from './healthFormat'

export function EnergySection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()
  const win = useRangeWindow(range)
  const isDay = win.isDay

  // Measured values only — no synthetic top-up for a Watch-off hour. Day and
  // multi-day figures both come from the ONE window read (the separate
  // anchor-only queries, whose loading flag didn't match the chart, are gone).
  const energy = useEnergyWindow(win)
  const hourlyActive = useHealthHourly('active_energy', anchor, win.fetchFrom)
  const hourlyBasal = useHealthHourly('basal_energy_burned', anchor, win.fetchFrom)

  // Basal metabolic rate is continuous BY DEFINITION, so an hour with no row is
  // a measurement gap, never a real zero — shown as "N/24 h measured".
  const basalHoursCovered = (hourlyBasal.data ?? []).filter(b => b.value != null).length

  const t = energy.totalSummary
  const underRecorded = isDay ? 0
    : energy.total.filter(d => d.date >= win.from && d.date <= win.to && d.date !== win.today && d.value <= MIN_COMPLETE_DAY_KCAL).length
  const caption = isDay
    ? (t.partialToday ? 'So far today' : null)
    : [
        `${t.daysCounted} of ${t.totalDays} days`,
        t.partialToday ? 'today left out until it ends' : null,
        underRecorded ? `${underRecorded} under-recorded day${underRecorded > 1 ? 's' : ''} left out (under ${fmtInt(MIN_COMPLETE_DAY_KCAL)} kcal)` : null,
      ].filter(Boolean).join(' · ')

  let chartData: { label: string; date?: string; basal: number | null; active: number | null }[]
  if (isDay) {
    const a = hourlyActive.data ?? [], b = hourlyBasal.data ?? []
    chartData = a.map((row, i) => ({ label: row.label, active: row.value, basal: b[i]?.value ?? null }))
  } else {
    const basal = new Map(fillDays(energy.basal, win.from, win.to).map(d => [d.date, d.value]))
    chartData = fillDays(energy.active, win.from, win.to).map(d => ({
      label: fmtAxisFor(d.date, win.totalDays), date: d.date, active: d.value, basal: basal.get(d.date) ?? null,
    }))
  }

  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const noData = !energy.isLoading && t.daysWithData === 0

  return (
    <SectionCard dimmed={energy.isPlaceholderData}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HeadlineStat
          label={isDay ? `Energy · ${windowNoun(period, anchor)}` : `Energy · daily average, ${windowNoun(period, anchor)}`}
          value={energy.isLoading ? '…' : fmtInt(t.value)}
          unit={t.value != null ? `kcal${!isDay ? ' /day' : ''}` : undefined}
          sub={caption || null}
          trend={<TrendBadge pct={t.deltaPct} />}
        />
        <div className="flex gap-4 text-center">
          <div>
            <p className="text-lead font-bold tabular-nums" style={{ color: c.series[3] }}>{fmtInt(energy.activeSummary.value)}</p>
            <p className="text-micro font-normal text-fg-muted">{isDay ? 'active' : 'avg active'}</p>
          </div>
          <div>
            <p className="text-lead font-bold tabular-nums text-fg-2">{fmtInt(energy.basalSummary.value)}</p>
            <p className="text-micro font-normal text-fg-muted">{isDay ? 'basal' : 'avg basal'}</p>
            {isDay && !energy.isLoading && basalHoursCovered > 0 && basalHoursCovered < 24 && (
              <p
                data-tone="warn"
                className="tone-text text-micro font-medium"
                title={`Basal energy is only recorded for ${basalHoursCovered} of 24 hours on this day — the rest has no measurement (typically the Watch off the wrist, or hours still to come). The figure is the measured hours only, never an estimate.`}
              >
                {basalHoursCovered}/24 h measured
              </p>
            )}
          </div>
        </div>
      </div>

      {noData
        ? <p className="py-6 text-center text-meta text-fg-muted">No energy recorded {isDay ? 'on this day' : 'in this window'}.</p>
        : (
          <HealthTrendChart
            data={chartData}
            series={[
              { key: 'basal', label: 'basal', color: c.series[5], kind: 'bar', stackId: 'e' },
              { key: 'active', label: 'active', color: c.series[3], kind: 'bar', stackId: 'e' },
            ]}
            unit="kcal"
            ariaLabel={isDay ? 'Energy per hour, basal and active' : 'Energy per day, basal and active'}
            height={170}
            onViewDay={isDay ? undefined : viewDay}
          />
        )}
      <div className="flex gap-3 text-meta text-fg-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.series[5] }} />Basal</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.series[3] }} />Active</span>
      </div>
    </SectionCard>
  )
}
