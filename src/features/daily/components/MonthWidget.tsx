import { useState } from 'react'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, addDays,
  addMonths, subMonths, isSameMonth, isToday, isSameDay,
} from 'date-fns'
import { formatMonthYear, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { useDayTasks, useTasksByMonth } from '../../todo/hooks/useTodos'
import { closedOn, countTasks, isOpenTask, onDay } from '../../todo/taskRules'
import { todayStr } from '../../../shared/utils/dateUtils'
import { DateNav } from '../../../shared/components/DateNav'
import { Button, Card, Checkbox, KeepRoom, TonePill, Truncate, cx } from '../../../shared/ui'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { useRepeatDays } from '../hooks/useSchedule'
import { useMonthKinds } from '../hooks/useMonthKinds'
import { useMonthLines } from '../hooks/useMonthLines'
import {
  MONTH_KIND, MONTH_KINDS, dayAccessibleName, dayCounts, dayTexts, monthLineRoom, onTasksLine, shownSlots, type MonthKind, type MonthSlotLine,
} from '../monthLines'
import type { Task } from '../../todo/types'
import { monthRoomKey } from '../dailyBoards'

interface Props {
  onDayClick?:    (date: Date) => void
  highlightDate?: Date
  /** Larger day numbers — used by the Month tab. */
  big?:           boolean
}

// Personal → Month (owner, 25.11.2026: "Bigger calendar. Text under dates
// about the insight. I want to see overview on my month. It should be well
// visible." + "some checkbox to hide or show categories"): under each date one
// short line per kind (monthLines.ts) where the grid is wide enough, tiny
// coloured counts per kind on a phone (upright or sideways) or a narrow grid.
export function MonthWidget({ onDayClick, highlightDate, big }: Props) {
  const [viewDate, setViewDate] = useState(new Date())

  // Structurally independent of the day view, but its position still follows
  // it: jump to the month containing highlightDate whenever it lands outside
  // the month currently on screen (adjust-during-render pattern — React's
  // recommended replacement for setState-in-effect).
  const highlightKey = highlightDate ? format(highlightDate, 'yyyy-MM') : null
  const [seenHighlightKey, setSeenHighlightKey] = useState(highlightKey)
  if (highlightKey !== seenHighlightKey) {
    setSeenHighlightKey(highlightKey)
    if (highlightDate) setViewDate(highlightDate)
  }

  const monthStart = startOfMonth(viewDate)
  const monthEnd   = endOfMonth(viewDate)
  const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd     = endOfWeek(monthEnd,     { weekStartsOn: 1 })
  const fromStr    = format(monthStart, 'yyyy-MM-dd')
  const toStr      = format(monthEnd, 'yyyy-MM-dd')

  const tasksQ = useTasksByMonth(monthStart, monthEnd)
  const tasks = tasksQ.data ?? []
  const { hidden, toggle } = useMonthKinds()
  const lines = useMonthLines(fromStr, toStr, hidden)

  const days: Date[] = []
  let d = calStart
  while (d <= calEnd) {
    days.push(d)
    d = addDays(d, 1)
  }

  // The day's task line counts as the day's list does (taskRules): open on the
  // day — today's from the day list, with its overdue and undated Today rows —
  // plus the repeat days still to do; done = closed as done on that day; missed =
  // closed as missed that day (156) plus the past repeat days with no task of
  // their own; cancelled = cancelled that day (not missed). Past days are a record.
  // While Training is shown, training sessions and their repeats are its line's, not Tasks' (each counts once).
  const today = todayStr()
  const todayList = useDayTasks(today)
  const trainingShown = !hidden.includes('training')
  const repeats = useRepeatDays(tasks, { withoutTraining: trainingShown })
  const counted = (list: readonly Task[]) => list.filter(t => onTasksLine(t, trainingShown))
  function taskFacts(dateStr: string) {
    const list = counted(dateStr === today ? [...todayList.open, ...todayList.done, ...todayList.cancelled] : tasks.filter(t => onDay(t, dateStr, today)))
    const counts = countTasks(list, dateStr, today)
    // Missed (156: closed as missed on its own day) is one of countTasks' cancelled.
    const missedTasks = list.filter(t => t.closed_reason === 'missed' && closedOn(t, dateStr)).length
    return {
      open: counts.open + repeats.toDoOn(dateStr), done: counts.done,
      missed: missedTasks + repeats.missedOn(dateStr), cancelled: counts.cancelled - missedTasks,
    }
  }

  const openCount = counted(tasks).filter(isOpenTask).length + repeats.toDoBetween(fromStr, toStr)
  const failed = [...(tasksQ.isError ? ['tasks' as const] : []), ...lines.failed]

  // Lines where they fit (a grid of 34rem: a day about 4.6rem wide), never on a phone — sideways, its
  // lines made the month several screens tall. Measured before the first paint, so nothing jumps.
  const phone = useBreakpoint() === 'phone'
  const { ref: gridRef, width: gridWidth } = useElementWidthRem()
  const withLines = !phone && (gridWidth ?? 0) >= 34
  const linesReady = lines.ready && (hidden.includes('tasks') || (!tasksQ.isLoading && !todayList.isLoading))
  const slotsOf = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd')
    const facts = { tasks: taskFacts(dateStr), ...lines.factsOf(dateStr) }
    return shownSlots(dayTexts(facts), hidden, dayCounts(facts))
  }
  const monthSlots = new Map(days.filter(day => isSameMonth(day, viewDate)).map(day => [format(day, 'yyyy-MM-dd'), slotsOf(day)]))
  // Each day keeps room for the most lines any day of the month has (3 before the reads answer), so the month fits
  // one screen; a phone's counts take one row, two on a narrow grid with more than three kinds shown.
  // About how many 12px characters a day's line holds: a day is a seventh of the grid less the 0.25rem gaps, its
  // padding (0.75rem) and the dot (0.625rem); a character is about 0.41rem. A longer line wraps once.
  const charsPerLine = Math.floor((((gridWidth ?? 0) - 1.5) / 7 - 1.375) / 0.41)
  const lineRoom = Math.min(monthLineRoom([...monthSlots.values()], linesReady, charsPerLine), 2 * (MONTH_KINDS.length - hidden.length))
  const countRows = (gridWidth ?? 0) < 30 && MONTH_KINDS.length - hidden.length > 3 ? 2 : 1

  return (
    <KeepRoom ids={monthRoomKey(phone)} loading={!linesReady} remember={!failed.length}>
    <Card>
      {/* One line at every width: under 23rem of card (a 402px phone) the month is cut to three letters
          ("Dec 2026"), the gaps tighten and the right side never shrinks. */}
      <div className="@container/monthhead mb-2">
      <div className="flex min-w-0 items-center justify-between gap-1 @[23rem]/monthhead:gap-2">
        <DateNav
          label={<MonthLabel date={viewDate} />}
          onPrev={() => setViewDate(p => subMonths(p, 1))}
          onNext={() => setViewDate(p => addMonths(p, 1))}
          onToday={() => setViewDate(new Date())}
          isToday={isSameMonth(viewDate, new Date())}
          labelClassName="whitespace-nowrap text-lead font-semibold text-fg @[23rem]/monthhead:min-w-[120px]"
        />
        <div className="flex min-w-0 shrink items-center justify-end gap-1">
          {/* A failed read sits in the header row, so the grid under it never moves. */}
          {failed.length > 0 ? (
            <span role="alert" className="flex min-w-0 items-center gap-1 text-meta text-fg-muted">
              <Truncate className="min-w-0" fullText={`Couldn't load: ${failed.map(k => MONTH_KIND[k].label).join(', ')}`}>
                Couldn&apos;t load: {failed.map(k => MONTH_KIND[k].label).join(', ')}
              </Truncate>
              <Button size="sm" variant="ghost" tip="Retry — read the month again" onClick={() => { lines.retry(); if (tasksQ.isError) void tasksQ.refetch() }}>Retry</Button>
            </span>
          ) : openCount > 0 && <TonePill tone="accent">{openCount} open</TonePill>}
        </div>
      </div>
      </div>

      <KindPicker hidden={hidden} onToggle={toggle} />

      <div ref={gridRef}>
        <div className="mb-1 grid grid-cols-7">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => (
            <div key={i} className={cx('py-1 text-micro font-semibold text-fg-faint', withLines ? 'pl-1.5 text-left' : 'text-center')}>{label}</div>
          ))}
        </div>

        <div className={cx('grid grid-cols-7', withLines ? 'gap-1' : 'gap-0.5')}>
          {days.map(day => {
            const inMonth   = isSameMonth(day, viewDate)
            const current   = isToday(day)
            const selected  = highlightDate ? isSameDay(day, highlightDate) : false
            const clickable = !!onDayClick && inMonth
            const slots     = monthSlots.get(format(day, 'yyyy-MM-dd')) ?? []
            const name      = dayAccessibleName(formatWeekdayDate(day, 'long'), slots)

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => clickable && onDayClick?.(day)}
                disabled={!clickable}
                aria-pressed={selected}
                aria-label={name}
                title={name}
                className={cx(
                  'flex min-w-0 flex-col rounded-control tabular-nums transition-colors duration-150',
                  withLines ? 'items-stretch border px-1.5 pb-1.5 pt-1' : 'items-center py-1',
                  // A day of another month is its number only: it never stretches to its week's room.
                  !inMonth && 'self-start',
                  selected ? 'border-transparent bg-accent-50 ring-2 ring-inset ring-accent-500'
                    : clickable ? 'border-line hover:bg-surface-hover'
                    : inMonth ? 'border-line'
                    : 'cursor-default border-transparent opacity-50',
                )}
              >
                <span className={cx(
                  'grid h-7 min-w-[1.75rem] place-items-center rounded-full px-1 font-semibold',
                  withLines ? 'self-start' : 'self-center',
                  big ? 'text-ui' : 'text-body',
                  current ? 'bg-accent-500 text-on-accent' : selected ? 'text-accent-700' : inMonth ? 'text-fg' : 'text-fg-faint',
                )}>
                  {format(day, 'd')}
                </span>
                {inMonth && (withLines
                  ? <DayLines slots={slots} room={lineRoom} ready={linesReady} />
                  : <DayCounts slots={slots} rows={countRows} ready={linesReady} />)}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
    </KeepRoom>
  )
}

/** One checkbox per kind, the box in the kind's tint: the key to the dots and lines below. */
function KindPicker({ hidden, onToggle }: { hidden: readonly MonthKind[]; onToggle: (k: MonthKind) => void }) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-0 sm:gap-x-4">
      {MONTH_KINDS.map(k => (
        <Checkbox key={k} checked={!hidden.includes(k)} onChange={() => onToggle(k)} label={MONTH_KIND[k].label} tip={MONTH_KIND[k].tip} tint={MONTH_KIND[k].tint} />
      ))}
    </div>
  )
}

/** A phone or a narrow grid (owner, 25.11.2026: "tiny counts" instead of dots): each kind's number for the day in its
 *  own tint, in the kinds' order; the room for `rows` rows is kept and the numbers show once every read answered. */
function DayCounts({ slots, rows, ready }: { slots: readonly MonthSlotLine[]; rows: 1 | 2; ready: boolean }) {
  if (!slots.length) return null
  return (
    <span aria-hidden className={cx('mt-0.5 flex max-w-full flex-wrap justify-center gap-x-1 text-micro font-semibold leading-3 tabular-nums', rows === 2 ? 'h-6' : 'h-3')}>
      {ready && slots.filter(s => s.count > 0).map(s => (
        <span key={s.kind} data-tint={MONTH_KIND[s.kind].tint} className="tint-ink">{s.count}</span>
      ))}
    </span>
  )
}

/** A wide grid: the day's lines, one per kind with something, in the kinds' order, 12px. Every day keeps `room`
 *  lines (1rem each: the most any day of the month has) and the lines show once every shown kind has answered
 *  (`ready`), so no line moves down when a later read lands. */
function DayLines({ slots, room, ready }: { slots: readonly MonthSlotLine[]; room: number; ready: boolean }) {
  if (!slots.length || room <= 0) return null
  return (
    <span aria-hidden className="mt-0.5 flex min-w-0 flex-col text-left text-meta text-fg-2" style={{ minHeight: `${room}rem` }}>
      {ready && slots.filter(s => s.text).map(s => (
        <span key={s.kind} className="flex min-h-4 min-w-0 items-start gap-1 leading-4">
          <span data-tint={MONTH_KIND[s.kind].tint} className="tint-dot mt-[0.3125rem] h-1.5 w-1.5 shrink-0 rounded-full" />
          <Truncate lines={2} className="min-w-0">{s.text}</Truncate>
        </span>
      ))}
    </span>
  )
}

/** "December 2026", or "Dec 2026" in a narrow card (the full name is still read aloud). */
function MonthLabel({ date }: { date: Date }) {
  const full = formatMonthYear(date)
  const [month, year] = [full.slice(0, full.lastIndexOf(' ')), full.slice(full.lastIndexOf(' ') + 1)]
  return (
    <>
      <span aria-hidden>{month.slice(0, 3)}<span className="hidden @[23rem]/monthhead:inline">{month.slice(3)}</span> {year}</span>
      <span className="sr-only">{full}</span>
    </>
  )
}
