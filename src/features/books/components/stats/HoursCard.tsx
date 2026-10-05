import { Clock } from 'lucide-react'
import { Card, CardHeader } from '../../../../shared/ui'
import { formatDuration, hourGrid } from '../../readingAggregate'
import type { ReadingEvent } from '../../types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hh = (h: number) => String(h).padStart(2, '0')

/** When you read: weekday × hour, shaded by minutes, over the chart's window. */
export function HoursCard({ events, days }: { events: readonly ReadingEvent[]; days: number }) {
  const grid = hourGrid(events)
  const max = Math.max(...grid.flat(), 1)
  const peak = grid.flatMap((row, w) => row.map((v, h) => ({ v, w, h }))).sort((a, b) => b.v - a.v)[0]
  return (
    <Card>
      <CardHeader title="When you read" variant="label" icon={<Clock />} subtitle={`Last ${days} days`} />
      <div className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="img"
        aria-label={peak?.v ? `Most reading on ${WEEKDAYS[peak.w]} around ${hh(peak.h)}:00` : 'No reading in this window'}>
        {grid.map((row, w) => [
          <span key={`l${w}`} className="text-micro text-fg-faint">{WEEKDAYS[w]}</span>,
          ...row.map((v, h) => (
            <span key={`${w}-${h}`} className="aspect-square rounded-[2px] bg-accent-500"
              style={{ opacity: v ? 0.15 + 0.85 * (v / max) : 0.06 }}
              title={`${WEEKDAYS[w]} ${hh(h)}:00 — ${formatDuration(v)}`} />
          )),
        ])}
      </div>
      <div className="mt-1 flex justify-between pl-9 text-micro tabular-nums text-fg-faint"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      <p className="mt-2 text-meta text-fg-muted">
        {peak?.v ? `Most often on ${WEEKDAYS[peak.w]} around ${hh(peak.h)}:00.` : 'Nothing read in this window — pick a longer one above.'}
      </p>
    </Card>
  )
}
