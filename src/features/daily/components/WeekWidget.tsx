import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { addDays, addWeeks, format, startOfWeek, endOfWeek, isToday, isSameDay, getISOWeek, differenceInCalendarWeeks } from 'date-fns'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import { useCalendarEventDatesForRange, useCalendarList } from '../../calendar/hooks/useCalendar'
import { useCalendarStore } from '../../../app/store'
import { DateNav } from '../../../shared/components/DateNav'
import { Card, IconButton, ToneDot, TonePill, cx } from '../../../shared/ui'
import type { Task } from '../../todo/types'

interface Props {
  onDayClick?: (date: Date) => void
  highlightDate?: Date
}

export function WeekWidget({ onDayClick, highlightDate }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [showCalFilter, setShowCalFilter] = useState(false)

  const baseWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekStart     = weekOffset === 0 ? baseWeekStart : addWeeks(baseWeekStart, weekOffset)
  const weekEnd       = endOfWeek(weekStart, { weekStartsOn: 1 })
  const weekNumber    = getISOWeek(weekStart)
  const isCurrentWeek = weekOffset === 0

  // Structurally independent of the day view, but its position still follows
  // it: jump to the week containing highlightDate whenever it lands outside
  // the week currently on screen (e.g. paging many days ahead via Daily's ‹ ›).
  // Adjust-during-render (React's replacement for setState-in-effect).
  const highlightKey = highlightDate ? format(highlightDate, 'yyyy-MM-dd') : null
  const [seenHighlightKey, setSeenHighlightKey] = useState<string | null>(null)
  if (highlightKey !== seenHighlightKey) {
    setSeenHighlightKey(highlightKey)
    if (highlightDate) setWeekOffset(differenceInCalendarWeeks(highlightDate, baseWeekStart, { weekStartsOn: 1 }))
  }

  const { data: tasks = [] } = useTasksByWeek(weekStart, weekEnd)
  const { data: calDates }   = useCalendarEventDatesForRange(weekStart, weekEnd)
  const { data: calList = [] } = useCalendarList()
  const { selectedCalendarIds, setSelectedCalendarIds } = useCalendarStore()

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function openCountForDay(date: Date): number {
    const dateStr = format(date, 'yyyy-MM-dd')
    return tasks.filter(
      t => t.due_date === dateStr && t.status !== 'done' && t.status !== 'cancelled'
    ).length
  }

  function hasCalEventOnDay(date: Date): boolean {
    return calDates?.has(format(date, 'yyyy-MM-dd')) ?? false
  }

  function toggleCalendar(id: string) {
    const current = selectedCalendarIds ?? calList.map(c => c.id)
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id]
    setSelectedCalendarIds(next.length === calList.length ? null : next)
  }

  function isCalSelected(id: string): boolean {
    if (!selectedCalendarIds) return true
    return selectedCalendarIds.includes(id)
  }

  const floatingTasks = tasks.filter(
    (t): t is Task => !t.due_date && t.status !== 'done'
  )

  const openTotal   = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length
  const totalTasks  = tasks.filter(t => t.status !== 'cancelled').length
  const doneTasks   = tasks.filter(t => t.status === 'done').length
  const donePercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  return (
    <Card className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-1">
        <DateNav
          label={`Week ${weekNumber}`}
          onPrev={() => setWeekOffset(w => w - 1)}
          onNext={() => setWeekOffset(w => w + 1)}
          onToday={() => setWeekOffset(0)}
          isToday={isCurrentWeek}
          labelClassName="min-w-[72px] text-lead font-semibold text-fg"
        />
        <div className="flex items-center gap-1">
          {openTotal > 0 && <TonePill tone="accent">{openTotal} open</TonePill>}
          {calList.length > 1 && (
            <IconButton
              label="Filter calendars"
              aria-pressed={showCalFilter}
              onClick={() => setShowCalFilter(p => !p)}
              className={cx(showCalFilter && 'bg-accent-50 text-accent-600')}
            >
              <SlidersHorizontal />
            </IconButton>
          )}
        </div>
      </div>

      {showCalFilter && calList.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5 border-b border-line pb-3">
          {calList.map(cal => (
            <button
              key={cal.id}
              type="button"
              aria-pressed={isCalSelected(cal.id)}
              onClick={() => toggleCalendar(cal.id)}
              className="pill-tab"
            >
              {cal.summary}
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        {/* en-GB (day-first); this card owns the range label. */}
        <p className="text-meta tabular-nums text-fg-muted">
          {format(weekStart, 'd MMM')} – {format(weekEnd, 'd MMM yyyy')}
        </p>
        {totalTasks > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${donePercent}%` }} />
            </div>
            <span className="text-meta tabular-nums text-fg-muted">{donePercent}% done</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {days.map(day => {
          const current     = isToday(day)
          const selected    = highlightDate ? isSameDay(day, highlightDate) : false
          const openCount   = openCountForDay(day)
          const hasCalEvent = hasCalEventOnDay(day)
          const clickable   = !!onDayClick

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDayClick?.(day)}
              disabled={!clickable}
              aria-pressed={selected}
              aria-label={format(day, 'EEEE d MMMM')}
              className={cx(
                'flex min-h-[72px] flex-col items-center rounded-row px-1 py-2 text-center transition-colors duration-150',
                current ? 'bg-accent-500 text-on-accent'
                  : selected ? 'bg-accent-50 text-accent-700 ring-2 ring-inset ring-accent-500'
                  : clickable ? 'bg-surface-2 hover:bg-surface-hover'
                  : 'bg-surface-2',
              )}
            >
              <span className={cx('text-micro font-semibold uppercase', current ? 'opacity-80' : 'text-fg-faint')}>
                {format(day, 'EEE')}
              </span>
              <span className={cx('mt-0.5 text-lead font-bold tabular-nums', !current && !selected && 'text-fg')}>
                {format(day, 'd')}
              </span>
              {openCount > 0 && (
                <span className={cx('mt-0.5 rounded-sm px-1 text-micro font-semibold tabular-nums', current ? 'bg-accent-700 text-on-accent' : 'bg-accent-50 text-accent-700')}>
                  {openCount}
                </span>
              )}
              {hasCalEvent && <span data-tone="info" aria-hidden className={cx('tone-dot mt-1 !h-1 !w-1', current && 'opacity-80')} />}
            </button>
          )
        })}
      </div>

      {floatingTasks.length > 0 && isCurrentWeek && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="section-label mb-2">This week — no date</p>
          <ul>
            {floatingTasks.slice(0, 5).map(task => (
              <li key={task.id} className="flex items-center gap-2 py-1">
                <ToneDot tone="accent" className="!h-1.5 !w-1.5" />
                <span className="truncate text-body text-fg-2">{task.title}</span>
              </li>
            ))}
          </ul>
          {floatingTasks.length > 5 && <p className="mt-1 text-meta text-fg-muted">+{floatingTasks.length - 5} more</p>}
        </div>
      )}
    </Card>
  )
}
