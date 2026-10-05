import { CalendarDays } from 'lucide-react'
import { Card, CardHeader, SegmentedControl } from '../../../../shared/ui'
import { formatDayMonth } from '../../../../shared/utils/dateFormat'
import { addDays, dayRange, dayState, formatDuration, type DayState } from '../../readingAggregate'
import type { ReadingSettings } from '../../types'
import { NoReadingData } from './statsKit'
import { WINDOWS, type WindowValue } from './statsFormat'

/** Minutes per day for the chosen window (the window also scopes "Books in this window" and "When you read"). */
export function MinutesChartCard({ win, onWin, perDay, today, lastSeenDay, settings, empty }: {
  win: WindowValue; onWin: (w: WindowValue) => void; perDay: Map<string, number>; today: string
  lastSeenDay: string | null; settings: ReadingSettings; empty: boolean
}) {
  const days = dayRange(addDays(today, -(Number(win) - 1)), today)
  return (
    <Card>
      <CardHeader title="Minutes per day" variant="label" icon={<CalendarDays />} wrap
        action={<SegmentedControl size="sm" options={[...WINDOWS]} value={win} onChange={onWin} />} />
      {empty ? <NoReadingData /> : (
        <DayBars days={days} perDay={perDay} goal={settings.daily_minutes_goal}
          stateOf={d => dayState(d, perDay.get(d) ?? 0, today, lastSeenDay, settings.streak_min_minutes)} />
      )}
    </Card>
  )
}

const BAR_TONE: Record<DayState, string> = {
  read: 'bg-accent-500',
  today: 'bg-accent-300',
  short: 'bg-accent-200',
  zero: 'bg-transparent',
  unknown: 'bg-transparent border border-dashed border-line',
}

/** One bar per day; a day the Kobo has not reported is drawn dashed (unknown), never as zero. */
function DayBars({ days, perDay, goal, stateOf }: {
  days: string[]; perDay: Map<string, number>; goal: number; stateOf: (d: string) => DayState
}) {
  const max = Math.max(goal, ...days.map(d => (perDay.get(d) ?? 0) / 60), 1)
  const total = days.reduce((t, d) => t + (perDay.get(d) ?? 0), 0)
  const readDays = days.filter(d => (perDay.get(d) ?? 0) > 0).length
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-fg-muted">
        <span className="font-semibold text-fg">{formatDuration(total)}</span> over {readDays} {readDays === 1 ? 'day' : 'days'}
        {readDays > 0 && ` · ${formatDuration(total / readDays)} on a reading day`}
      </p>
      <div className="relative h-36" role="img" aria-label={`Minutes read per day, ${days.length} days`}>
        <div className="absolute inset-x-0 border-t border-dashed border-accent-300" style={{ bottom: `${(goal / max) * 100}%` }} aria-hidden />
        <div className={`absolute inset-0 flex items-end ${days.length <= 90 ? 'gap-px' : ''}`}>
          {days.map(d => {
            const min = (perDay.get(d) ?? 0) / 60
            const st = stateOf(d)
            const h = st === 'unknown' ? 100 : Math.max((min / max) * 100, min > 0 ? 3 : 0)
            return (
              <div key={d} className="flex h-full min-w-0 flex-1 items-end" title={`${formatDayMonth(d)}: ${st === 'unknown' ? 'not synced yet' : `${Math.round(min)} min`}`}>
                <div className={`w-full ${days.length <= 90 ? 'rounded-t-[3px]' : ''} ${BAR_TONE[st]} ${st === 'unknown' ? 'opacity-60' : ''}`} style={{ height: `${h}%` }} />
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex justify-between text-micro tabular-nums text-fg-faint">
        <span>{formatDayMonth(days[0])}</span>
        <span>Goal {goal} min</span>
        <span>{formatDayMonth(days[days.length - 1])}</span>
      </div>
    </div>
  )
}
