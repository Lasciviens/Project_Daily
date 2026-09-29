import { cx } from '../../../../shared/ui'
import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import type { DayData } from './calendarModel'
import { DayMarkGlyph, StravaBar } from './DayMarkGlyph'
import { DAY_MARK_LABEL, dayMarkOf, weekSessionCount, type MonthWeek } from './monthGrid'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
// The week-total column only from a 22rem-wide calendar (container query):
// on a phone the seven days get the width.
const COLS = 'grid grid-cols-7 @[22rem]:grid-cols-[repeat(7,minmax(0,1fr))_2.75rem]'

/** The week's count: shown from 22rem, while screen readers always get the
 *  sentence (a name on a plain span is ignored, so it's visually hidden text;
 *  absolutely positioned, it takes no grid cell). */
function WeekTotal({ count, target, current }: { count: number; target: number | null; current: boolean }) {
  const met = target != null && target > 0 && count >= target
  return (
    <>
      <span className="sr-only">{current && target ? `${count} of ${target} workouts this week` : `${count} ${count === 1 ? 'workout' : 'workouts'} that week`}</span>
      <span aria-hidden className="hidden items-center justify-center text-meta tabular-nums @[22rem]:flex">
        <span data-tone={met ? 'success' : undefined} className={cx(met ? 'tone-text font-semibold' : count > 0 ? 'font-medium text-fg-2' : 'text-fg-faint')}>
          {count}{current && target ? <span className="font-normal text-fg-muted">/{target}</span> : null}
        </span>
      </span>
    </>
  )
}

/**
 * The month grid: borderless 44px day cells, one mark under each day number
 * (monthGrid.dayMarkOf), a Strava bar, today's number ringed in the accent,
 * the selected day filled, the current week on a tinted band, and each
 * week's workout count on the right.
 */
export function MonthGrid({ weeks, dayByDate, todayStr, currentWeek, selected, onSelect, weeklyTarget }: {
  weeks: readonly MonthWeek[]
  dayByDate: ReadonlyMap<string, DayData>
  todayStr: string
  currentWeek: string
  selected: string | null
  onSelect: (date: string) => void
  weeklyTarget: number | null
}) {
  return (
    <div role="group" aria-label="Training calendar" className="flex flex-col gap-0.5">
      <div aria-hidden className={COLS}>
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1 text-center text-micro font-semibold uppercase text-fg-muted">{d}</span>
        ))}
        <span className="hidden py-1 text-center text-micro font-semibold uppercase text-fg-muted @[22rem]:block">Wk</span>
      </div>
      {weeks.map(week => {
        const days = week.cells.map(c => dayByDate.get(c.date))
        const current = week.weekStart === currentWeek
        return (
          <div key={week.weekStart} className={cx(COLS, 'rounded-row', current && 'bg-accent-50')}>
            {week.cells.map((cell, i) => {
              const day = days[i]
              const mark = day ? dayMarkOf(day) : null
              const strava = (day?.activities.length ?? 0) > 0
              const isToday = cell.date === todayStr
              const isSelected = cell.date === selected
              const name = formatWeekdayDate(cell.date, 'long')
              return (
                <button
                  key={cell.date}
                  type="button"
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={[name, mark ? DAY_MARK_LABEL[mark] : null, strava ? 'Strava activity' : null].filter(Boolean).join(', ')}
                  onClick={() => onSelect(cell.date)}
                  className={cx(
                    'flex min-h-[48px] flex-col items-center justify-start gap-1 rounded-row pb-1.5 pt-1 transition-colors duration-100',
                    isSelected ? 'bg-surface-2 ring-1 ring-inset ring-line-strong' : 'hover:bg-surface-hover',
                  )}
                >
                  <span className={cx(
                    'grid h-7 w-7 place-items-center rounded-full text-body tabular-nums',
                    isToday ? 'font-bold text-accent-600 ring-2 ring-accent-500' : cell.inMonth ? 'font-medium text-fg-2' : 'text-fg-faint',
                    current && !isToday && cell.inMonth && 'font-semibold text-fg',
                  )}>
                    {cell.dayOfMonth}
                  </span>
                  <span className="flex h-2 items-center">{mark && <DayMarkGlyph mark={mark} className={cell.inMonth ? undefined : 'opacity-50'} />}</span>
                  <span className="flex h-0.5 items-center">{strava && <StravaBar />}</span>
                </button>
              )
            })}
            <WeekTotal count={weekSessionCount(days.filter((d): d is DayData => !!d))} target={weeklyTarget} current={current} />
          </div>
        )
      })}
    </div>
  )
}
