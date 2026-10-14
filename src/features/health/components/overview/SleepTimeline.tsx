import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { TOOLTIP_BOX } from '../../../../shared/components/charts/chartKit'
import { cx } from '../../../../shared/ui'
import { fmtClock, type ClockRow } from '../../healthTrendStats'
import { isoWeek, numericMonth } from '../../healthDateLabels'
import { SLEEP_COLOR } from '../sleepStages'
import { fmtAxisDay, fmtDayLong, fmtDayMonth } from '../healthFormat'
import { hm } from './heroFormat'

// Bed and wake time over the period picked in the range bar, on one clock
// axis from 18:00 to 14:00, so an irregular schedule is visible at a glance.
// A row is drawn from sleep onset (first session start) to wake (last session
// end); naps inside that window are part of the night's sessions. Up to two
// weeks a row is one night; longer periods show each week's (or, past 120
// days, each month's) average night (healthTrendStats.clockRows), so the
// chart stays the same height.
//
// Hover a row (or tap it on a phone, or arrow through with the keyboard) for
// its exact times. The whole chart is one control rather than a 20px button
// per row.

const UNIT_WORD: Record<ClockRow['unit'], string> = { night: 'night', week: 'week', month: 'month' }

function rowLabel(r: ClockRow): string {
  if (r.unit === 'night') return fmtAxisDay(r.date)
  return r.unit === 'week' ? `Wk ${isoWeek(r.date).week}` : numericMonth(r.date)
}

function rowTitle(r: ClockRow): string {
  return r.unit === 'night' ? fmtDayLong(r.date) : `${fmtDayMonth(r.date)} – ${fmtDayMonth(r.until)}`
}

const AXIS_START = 18 * 60 // 18:00
const AXIS_SPAN = 20 * 60  // to 14:00 next day
const ROW_REM = 1.25       // h-5
const LABEL_REM = 3.5      // w-12 label + gap-2

function pos(minutes: number): number {
  const m = ((minutes - AXIS_START) % 1440 + 1440) % 1440
  return Math.min(100, (m / AXIS_SPAN) * 100)
}

/** Minutes from onset to wake, across midnight. */
function spanMinutes(onset: number, wake: number): number {
  return ((wake - onset) % 1440 + 1440) % 1440
}

function NightTooltip({ night, index }: { night: ClockRow; index: number }) {
  const avg = night.unit !== 'night'
  const mid = (pos(night.onset) + pos(night.wake)) / 200
  // Above the row, or below it for the top rows; horizontally centred on the
  // bar and clamped inside the chart.
  const vertical = index < 3
    ? { top: `calc(${(index + 1) * ROW_REM}rem + 4px)` }
    : { bottom: `calc(100% - ${index * ROW_REM}rem + 4px)` }
  return (
    <div
      className={cx(TOOLTIP_BOX, 'pointer-events-none absolute z-10 w-[11rem]')}
      style={{ ...vertical, left: `clamp(0px, calc(${LABEL_REM}rem + (100% - ${LABEL_REM}rem) * ${mid} - 5.5rem), calc(100% - 11rem))` }}
    >
      <p className="font-medium text-fg-muted">{rowTitle(night)}</p>
      {avg && <p className="text-fg-muted">Average of {night.nights} {night.nights === 1 ? 'night' : 'nights'}</p>}
      <p className="tabular-nums text-fg">Fell asleep <b>{fmtClock(night.onset)}</b></p>
      <p className="tabular-nums text-fg">Woke <b>{fmtClock(night.wake)}</b></p>
      <p className="tabular-nums text-fg-2">
        {night.asleep != null ? <>Slept <b>{hm(night.asleep)}</b>{avg ? ' a night' : ''}</> : <>{hm(spanMinutes(night.onset, night.wake) / 60)} asleep to awake</>}
      </p>
    </div>
  )
}

export function SleepTimeline({ rows: timeline, wakeCenter, onsetCenter }: {
  rows: ClockRow[]
  wakeCenter?: number | null
  onsetCenter?: number | null
}) {
  const [active, setActive] = useState<number | null>(null)
  if (!timeline.length) return null
  const unit = UNIT_WORD[timeline[0].unit]
  const ticks = [18, 22, 2, 6, 10, 14]
  const last = timeline.length - 1
  const current = active != null && active <= last ? active : null

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setActive(i => Math.min(last, (i ?? -1) + 1)) }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setActive(i => Math.max(0, (i ?? last + 1) - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(last) }
    else if (e.key === 'Escape') setActive(null)
  }
  const hover = (i: number) => (e: PointerEvent) => { if (e.pointerType === 'mouse') setActive(i) }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative ml-14 h-4 text-micro font-normal text-fg-faint" aria-hidden>
        {ticks.map(h => (
          <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pos(h * 60)}%` }}>{String(h).padStart(2, '0')}</span>
        ))}
      </div>
      <div
        role="group"
        tabIndex={0}
        aria-label={`Bed and wake time per ${unit}. Use the arrow keys for each ${unit}'s times.`}
        className="relative rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        onKeyDown={onKey}
        onFocus={e => { if (active == null && e.currentTarget.matches(':focus-visible')) setActive(last) }}
        onBlur={() => setActive(null)}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setActive(null) }}
      >
        {[onsetCenter, wakeCenter].map((c, i) => c != null && (
          <span key={i} aria-hidden className="absolute bottom-0 top-0 ml-14 w-px border-l border-dashed border-line-strong"
            style={{ left: `calc((100% - 3.5rem) * ${pos(c) / 100})` }} />
        ))}
        {timeline.map((t, i) => {
          const a = pos(t.onset), b = pos(t.wake)
          const on = current === i
          return (
            <div key={t.date} className="flex h-5 cursor-default items-center gap-2"
              onPointerEnter={hover(i)} onPointerMove={hover(i)}
              onClick={() => setActive(cur => (cur === i ? null : i))}>
              <span className={cx('w-16 shrink-0 text-right text-micro tabular-nums', on ? 'font-semibold text-fg' : 'font-normal text-fg-muted')}>{rowLabel(t)}</span>
              <div className={cx('relative h-2.5 flex-1 rounded-full', on ? 'bg-surface-hover' : 'bg-surface-2')}>
                <div className="absolute h-full rounded-full transition-opacity duration-100"
                  style={{ left: `${a}%`, width: `${Math.max(1, b - a)}%`, backgroundColor: SLEEP_COLOR, opacity: current == null || on ? 1 : 0.45 }} />
              </div>
            </div>
          )
        })}
        {current != null && <NightTooltip night={timeline[current]} index={current} />}
        <p className="sr-only" aria-live="polite">
          {current != null ? `${rowTitle(timeline[current])}: fell asleep ${fmtClock(timeline[current].onset)}, woke ${fmtClock(timeline[current].wake)}${timeline[current].asleep != null ? `, slept ${hm(timeline[current].asleep)}` : ''}.` : ''}
        </p>
      </div>
      <p className="text-micro font-normal text-fg-faint">
        {unit === 'night' ? 'Each row is the night that ended that morning' : `Each row is a ${unit}’s average night`} — hover or tap one for its times.
        {wakeCenter != null || onsetCenter != null ? ' Dashed lines: your usual bed and wake time.' : ''}
      </p>
    </div>
  )
}
