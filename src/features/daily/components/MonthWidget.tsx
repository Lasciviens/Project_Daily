import { useState } from 'react'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, addDays,
  addMonths, subMonths, isSameMonth, isToday, isSameDay,
} from 'date-fns'
import { formatMonthYear, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { useDayTasks, useOpenOnDay, useTasksByMonth } from '../../todo/hooks/useTodos'
import { countTasks, isOpenTask, onDay } from '../../todo/taskRules'
import { todayStr } from '../../../shared/utils/dateUtils'
import { DateNav } from '../../../shared/components/DateNav'
import { Button, Card, Checkbox, TonePill, Truncate, cx } from '../../../shared/ui'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { useRepeatDays } from '../hooks/useSchedule'
import { useMonthKinds } from '../hooks/useMonthKinds'
import { useMonthLines } from '../hooks/useMonthLines'
import { MONTH_KIND, MONTH_KINDS, dayAccessibleName, dayTexts, shownSlots, type MonthKind, type MonthSlotLine } from '../monthLines'

interface Props {
  onDayClick?:    (date: Date) => void
  highlightDate?: Date
  /** Larger day numbers — used by the Month tab. */
  big?:           boolean
}

// Personal → Month (owner, 25.11.2026: "Bigger calendar. Text under dates
// about the insight. I want to see overview on my month. It should be well
// visible." + "some checkbox to hide or show categories"): under each date one
// short line per kind (monthLines.ts) where the grid is wide enough, a row of
// tinted dots on a phone (upright or sideways) or a narrow grid.
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
  // plus the repeat days still to do; done = closed as done on that day.
  const today = todayStr()
  const todayList = useDayTasks(today)
  const repeats = useRepeatDays(tasks)
  const openOn = useOpenOnDay(tasks)
  function taskFacts(dateStr: string) {
    const done = dateStr === today ? todayList.counts.done : countTasks(tasks.filter(t => onDay(t, dateStr, today)), dateStr, today).done
    return { open: openOn(dateStr) + repeats.toDoOn(dateStr), done }
  }

  const openCount = tasks.filter(isOpenTask).length + repeats.toDoBetween(fromStr, toStr)
  const failed = [...(tasksQ.isError ? ['tasks' as const] : []), ...lines.failed]

  // Lines where they fit (a grid of 34rem: a day about 4.6rem wide), never on a phone — sideways, its
  // lines made the month several screens tall. Measured before the first paint, so nothing jumps.
  const phone = useBreakpoint() === 'phone'
  const { ref: gridRef, width: gridWidth } = useElementWidthRem()
  const withLines = !phone && (gridWidth ?? 0) >= 34
  const roomy = withLines && (gridWidth ?? 0) >= 52
  const linesReady = lines.ready && (hidden.includes('tasks') || (!tasksQ.isLoading && !todayList.isLoading))

  return (
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
        <div className="flex shrink-0 items-center gap-1">
          {openCount > 0 && <TonePill tone="accent">{openCount} open</TonePill>}
        </div>
      </div>
      </div>

      <KindPicker hidden={hidden} onToggle={toggle} />
      {failed.length > 0 && (
        <p role="alert" className="mb-1 flex items-center gap-2 text-meta text-fg-muted">
          <span className="min-w-0 flex-1">Couldn&apos;t load: {failed.map(k => MONTH_KIND[k].label).join(', ')}</span>
          <Button size="sm" variant="ghost" tip="Retry — read the month again" onClick={() => { lines.retry(); if (tasksQ.isError) void tasksQ.refetch() }}>Retry</Button>
        </p>
      )}

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
            const dateStr   = format(day, 'yyyy-MM-dd')
            const slots     = inMonth ? shownSlots(dayTexts({ tasks: taskFacts(dateStr), ...lines.factsOf(dateStr) }), hidden) : []

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => clickable && onDayClick?.(day)}
                disabled={!clickable}
                aria-pressed={selected}
                aria-label={dayAccessibleName(formatWeekdayDate(day, 'long'), slots)}
                className={cx(
                  'flex min-h-[44px] min-w-0 flex-col rounded-control tabular-nums transition-colors duration-150',
                  withLines ? 'items-stretch border px-1.5 pb-1.5 pt-1' : 'items-center py-1',
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
                {inMonth && (withLines ? <DayLines slots={slots} roomy={roomy} ready={linesReady} /> : <DayDots slots={slots} />)}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
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

/** A phone or a narrow grid: one dot per kind with something that day, each kind in its fixed slot. */
function DayDots({ slots }: { slots: readonly MonthSlotLine[] }) {
  if (!slots.length) return null
  return (
    <span aria-hidden className="mt-0.5 flex h-1.5 items-center gap-0.5">
      {slots.map(s => (
        <span key={s.kind} data-tint={MONTH_KIND[s.kind].tint} className={cx('tint-dot h-1.5 w-1.5 rounded-full', !s.text && 'invisible')} />
      ))}
    </span>
  )
}

/** A wide grid: the day's lines, one per kind with something, in the kinds' order. The room
 *  for every shown kind is kept (1rem a line) and the lines show once every shown kind has
 *  answered (`ready`), so no line moves down when a later read lands. */
function DayLines({ slots, roomy, ready }: { slots: readonly MonthSlotLine[]; roomy: boolean; ready: boolean }) {
  if (!slots.length) return null
  return (
    <span aria-hidden className={cx('mt-0.5 flex min-w-0 flex-col text-left text-fg-2', roomy ? 'text-meta' : 'text-micro')} style={{ minHeight: `${slots.length}rem` }}>
      {ready && slots.filter(s => s.text).map(s => (
        <span key={s.kind} className="flex h-4 min-w-0 items-center gap-1">
          <span data-tint={MONTH_KIND[s.kind].tint} className="tint-dot h-1.5 w-1.5 shrink-0 rounded-full" />
          <Truncate className="min-w-0">{s.text}</Truncate>
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
