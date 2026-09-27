import { fmtClock } from '../../healthTrendStats'
import { SLEEP_COLOR } from '../sleepStages'
import { fmtAxisDay } from '../healthFormat'

// Bed and wake time per night over the last two weeks, on one clock axis from
// 18:00 to 14:00, so an irregular schedule is visible at a glance. A night
// row is drawn from sleep onset (first session start) to wake (last session
// end); naps inside that window are part of the night's sessions.

const AXIS_START = 18 * 60 // 18:00
const AXIS_SPAN = 20 * 60  // to 14:00 next day

function pos(minutes: number): number {
  const m = ((minutes - AXIS_START) % 1440 + 1440) % 1440
  return Math.min(100, (m / AXIS_SPAN) * 100)
}

export function SleepTimeline({ timeline, wakeCenter, onsetCenter }: {
  timeline: { date: string; onset: number; wake: number }[]
  wakeCenter?: number | null
  onsetCenter?: number | null
}) {
  if (!timeline.length) return null
  const ticks = [18, 22, 2, 6, 10, 14]
  return (
    <div role="img" aria-label="Bed and wake time per night, last 14 nights" className="flex flex-col gap-1">
      <div className="relative ml-14 h-4 text-micro font-normal text-fg-faint">
        {ticks.map(h => (
          <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pos(h * 60)}%` }}>{String(h).padStart(2, '0')}</span>
        ))}
      </div>
      <div className="relative">
        {[onsetCenter, wakeCenter].map((c, i) => c != null && (
          <span key={i} aria-hidden className="absolute bottom-0 top-0 ml-14 w-px border-l border-dashed border-line-strong"
            style={{ left: `calc((100% - 3.5rem) * ${pos(c) / 100})` }} />
        ))}
        {timeline.map(t => {
          const a = pos(t.onset), b = pos(t.wake)
          return (
            <div key={t.date} className="flex h-5 items-center gap-2" title={`${fmtAxisDay(t.date)}: ${fmtClock(t.onset)}–${fmtClock(t.wake)}`}>
              <span className="w-12 shrink-0 text-right text-micro font-normal tabular-nums text-fg-muted">{fmtAxisDay(t.date)}</span>
              <div className="relative h-2.5 flex-1 rounded-full bg-surface-2">
                <div className="absolute h-full rounded-full" style={{ left: `${a}%`, width: `${Math.max(1, b - a)}%`, backgroundColor: SLEEP_COLOR }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-micro font-normal text-fg-faint">Each row is the night that ended that morning. Dashed lines: your usual bed and wake time.</p>
    </div>
  )
}
