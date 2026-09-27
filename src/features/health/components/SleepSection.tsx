import { useState } from 'react'
import { TonePill } from '../../../shared/ui'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import {
  computeSleepSummary, extractSleepSessions, formatSleepHours as fmtHrs, manualNightKeys, sleepNightKey, sleepSourcesByNight,
  type SleepSummary,
} from '../healthAggregate'
import { fillDays, mean } from '../healthWindowStats'
import { useSleepWindow } from '../hooks/useHealthWindow'
import type { HealthRange } from './sectionTypes'
import { useRangeWindow, windowNoun } from './dateNav'
import { MetricMiniGrid } from './MetricMiniGrid'
import { SLEEP_EXTRA_METRICS } from './miniMetrics'
import { HealthTrendChart } from './HealthTrendChart'
import { HeadlineStat, SectionCard, TrendBadge } from './sectionKit'
import { SleepNightChart } from './SleepNightChart'
import { SLEEP_COLOR } from './sleepStages'
import { SleepStageBar } from './SleepStageBar'
import { ManualSleepForm } from './ManualSleepForm'
import { SleepRawRows } from './SleepRawRows'
import { fmtAxisFor, fmtDayLong, fmtDayMonth, windowCaption } from './healthFormat'
import { nightEndingOn, nightMissingText } from '../healthDateLabels'

// Nights are filed under the day you WOKE UP, so "today" in Day mode is last
// night — a finished night that always counts (H-01).
export function SleepSection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, period, setPeriod } = range
  const win = useRangeWindow(range)
  const isDay = win.isDay
  const sleep = useSleepWindow(win)
  const [form, setForm] = useState<{ date: string; hours: number | null } | null>(null)

  const inWindow = sleep.nights.filter(n => n.date >= win.from && n.date <= win.to)
  const points = sleep.points.filter(p => { const k = sleepNightKey(p); return k >= win.from && k <= win.to })
  const manual = manualNightKeys(sleep.points)
  const sources = sleepSourcesByNight(sleep.points)

  // The night that ENDED on the selected day — never the newest night on record.
  const endNight = nightEndingOn(inWindow, anchor)
  const dayNight = isDay ? endNight : null
  const periodNight: SleepSummary | null = !isDay && inWindow.length ? {
    date: win.to,
    total: mean(inWindow.map(n => n.total)) as number,
    deep: mean(inWindow.map(n => n.deep)) as number,
    core: mean(inWindow.map(n => n.core)) as number,
    rem: mean(inWindow.map(n => n.rem)) as number,
    awake: mean(inWindow.map(n => n.awake)) as number,
  } : null
  const detail = isDay ? dayNight : periodNight
  const s = sleep.summary
  // A manual entry replaces the Watch for that night, so the Watch's own
  // session timeline would describe different data than the headline (H-20).
  const replaced = isDay && manual.has(anchor)
  const sessions = isDay && dayNight && !replaced ? extractSleepSessions(sleep.points, anchor) : []

  const headline = isDay
    ? (anchor === win.today ? 'Last night' : `Night of ${fmtDayMonth(shiftDateStr(anchor, -1))}–${fmtDayMonth(anchor)}`)
    : `Sleep · average per night, ${windowNoun(period, anchor)}`

  function manualHoursFor(date: string): number | null {
    const rows = sleep.points.filter(p => p.date === date && p.source === 'manual')
    return rows.length ? computeSleepSummary(rows)[0]?.total ?? null : null
  }
  const openForm = (date: string) => setForm({ date, hours: manualHoursFor(date) })
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }

  const chartData = fillDays(inWindow.map(n => ({ date: n.date, value: n.total })), win.from, win.to)
    .map(d => ({ label: fmtAxisFor(d.date, win.totalDays), date: d.date, total: d.value }))

  return (
    <SectionCard dimmed={sleep.isPlaceholderData}>
      <div>
        <div className="flex flex-wrap items-end gap-2">
          <HeadlineStat
            label={headline}
            value={sleep.isLoading ? '…' : isDay ? (dayNight ? fmtHrs(dayNight.total) : '—') : s.value != null ? fmtHrs(s.value) : '—'}
            unit={!isDay && s.value != null ? '/night' : undefined}
            sub={isDay ? null : windowCaption(s, { unitNoun: 'nights' })}
            trend={<TrendBadge pct={s.deltaPct} />}
          />
          {isDay && dayNight && manual.has(anchor) && <TonePill tone="neutral" className="mb-1">Manual</TonePill>}
        </div>
        {isDay && !dayNight && !sleep.isLoading && (
          <p className="mt-1 text-meta text-fg-muted">{nightMissingText(anchor, win.today)} — pick another day, or add it by hand below.</p>
        )}
        {!isDay && s.best && s.worst && (
          <p className="mt-1 text-meta text-fg-muted">
            Longest {fmtHrs(s.best.value)} ({fmtDayMonth(s.best.date)}) · shortest {fmtHrs(s.worst.value)} ({fmtDayMonth(s.worst.date)})
          </p>
        )}
        {/* The window's last night is the one that ended on its last day —
            said so when it is missing, never swapped for an older night. */}
        {!isDay && !sleep.isLoading && (
          <p className="mt-1 text-meta text-fg-2">
            {endNight
              ? <>{anchor === win.today ? 'Last night' : `Night of ${fmtDayMonth(shiftDateStr(anchor, -1))}–${fmtDayMonth(anchor)}`}: <b className="font-semibold tabular-nums text-fg">{fmtHrs(endNight.total)}</b></>
              : `${nightMissingText(anchor, win.today)}.`}
          </p>
        )}
        {!isDay && inWindow.length === 0 && !sleep.isLoading && (
          <p className="mt-1 text-meta text-fg-muted">No sleep recorded in this window.</p>
        )}
      </div>

      {sessions.length > 0 && <SleepNightChart sessions={sessions} />}
      {replaced && (
        <p className="text-meta text-fg-muted">The Watch's data for this night is replaced by your manual entry.</p>
      )}

      {form && <ManualSleepForm key={form.date} initialDate={form.date} initialHours={form.hours} onClose={() => setForm(null)} />}
      {!form && (
        <button type="button" onClick={() => openForm(isDay ? anchor : todayStr())}
          className="btn-ghost btn-sm self-start px-2 text-meta">
          {isDay && manual.has(anchor) ? 'Correct this night by hand' : 'Add a night by hand'}
        </button>
      )}

      {detail && <SleepStageBar night={detail} averaged={!isDay} />}

      {!isDay && inWindow.length > 0 && (
        <HealthTrendChart
          data={chartData}
          series={[{ key: 'total', label: 'asleep', color: SLEEP_COLOR, kind: 'bar' }]}
          unit=""
          ariaLabel="Hours asleep per night"
          height={140}
          formatValue={fmtHrs}
          refLines={[{ y: 7, label: '7 h' }]}
          onViewDay={viewDay}
          extraActions={date => [{ label: 'Correct by hand', onClick: () => openForm(date) }]}
          describe={p => {
            const src = p.date ? sources.get(p.date) : null
            return src && src.size ? <p className="text-fg-muted">{[...src].join(', ')}</p> : null
          }}
        />
      )}
      {!isDay && inWindow.length > 0 && (
        <p className="text-micro text-fg-faint">Each bar is the night that ended that morning. {fmtDayLong(win.from)} – {fmtDayLong(win.to)}.</p>
      )}

      <MetricMiniGrid title="Breathing during sleep" metrics={SLEEP_EXTRA_METRICS} window={{ from: win.from, to: win.to, period }} onViewDay={viewDay} hideWhenEmpty />
      <SleepRawRows points={points} />
    </SectionCard>
  )
}
