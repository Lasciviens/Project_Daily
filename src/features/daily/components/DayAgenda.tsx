import { useMemo, useState, type ReactNode } from 'react'
import { format, isToday, subDays } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { useScheduleBlocks, useTimeBlocks } from '../hooks/useSchedule'
import { useDayTasks, useTasksByIds } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { EditCalendarEventModal } from '../../calendar/components/EditCalendarEventModal'
import { useDayPlanContext } from '../../training/hooks/usePlanContext'
import { useEntityModal } from '../../../shared/modals'
import { useNewIds } from '../../../shared/hooks/useNewIds'
import { useCalendarStore, toast } from '../../../app/store'
import { qk } from '../../../shared/query'
import { Button, IconButton, Skeleton, ToneDot, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatDurationMinutes } from '../../../shared/utils/formatDuration'
import { todayStr } from '../../../shared/utils/dateUtils'
import { aheadOnDay, buildDaySchedule, plannedMinutes } from '../daySchedule'
import { buildDayRows, dayRowCounts, hourLabel, repeatDayKeys, repeatDayRequest, repeatsToDoOn, untilLabel, type DayRow } from '../dayItems'
import {
  ContinuationRow, EventRow, LinkedTaskRow, NowMarker, RepeatRow, SlotRow, TimeGutter, TrainingRow,
} from './DayAgendaRows'
import { OpenWishesRow, UndatedThisWeek } from './DayAgendaExtras'
import type { CalendarEvent } from '../../calendar/types'

// ─────────────────────────────────────────────────────────────────────────────
//  DayAgenda — Daily's day as ONE list (owner, 15.10.2026: "one item"). It
//  replaced two panes side by side — Schedule (slots, repeating plans, Google
//  events; "Add") and Tasks (the day's tasks; "Add task") — where a task with
//  its slot showed twice and a repeat could not be ticked. The rows come from
//  dayItems.ts (pure), built over the reads the day already had: the day list
//  (useDayTasks — never filtered, NEVER_HIDES), the one day schedule
//  (daySchedule.ts: slots, yesterday's tails, repeating plans, Google events
//  the app didn't make) and the tasks of the day's slots.
//
//  Split by TIME, never by table:
//   - phone / narrow card: Anytime first, then the timed rows in time order
//     with the now-marker (today), then Done and Cancelled;
//   - from a 54rem card (laptop): the timed rows in one column, Anytime (then
//     Done, Cancelled) in the other.
//  A ticked timed row stays dimmed in its slot; a repeat day that passed with
//  no tick stays on its day as Missed. ONE Add (the one sheet, this day as its
//  date). Every editor opens through useEntityModal by id; Google events open
//  EditCalendarEventModal (edit only, on ModalShell).
// ─────────────────────────────────────────────────────────────────────────────

// `bare` — a pane inside a parent surface (Daily's hero card, the picked-day
// card); without it the list draws its own card.
export function DayAgenda({ date, bare = false }: { date: Date; bare?: boolean }) {
  const day = format(date, 'yyyy-MM-dd')
  const prevDay = format(subDays(date, 1), 'yyyy-MM-dd')
  const today = todayStr()
  const viewingToday = isToday(date)
  const now = new Date()
  const nowHour = now.getHours() + now.getMinutes() / 60

  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null)
  const modal = useEntityModal()
  const qc = useQueryClient()
  const calToken = useCalendarStore(s => s.accessToken)

  // The reads the day always had.
  const list = useDayTasks(day)
  const { data: templates = [] } = useScheduleBlocks()
  const { data: blocks = [] } = useTimeBlocks(day)
  const { data: prevBlocks = [] } = useTimeBlocks(prevDay)
  const { data: events, isFetching: calFetching } = useCalendarEventsForDay(day)

  // A repeat's day that is a task (156, made on its day) is that day's row and
  // state — also when it closed on another day (ticked late or ahead).
  const dayList = useMemo(() => [...list.open, ...list.done, ...list.cancelled], [list.open, list.done, list.cancelled])
  const withRepeatDays = useMemo(() => [...list.repeatDays, ...dayList], [list.repeatDays, dayList])
  const items = useMemo(
    () => buildDaySchedule({ date: day, blocks, prevBlocks, templates, events: events ?? [], dayTasks: withRepeatDays }),
    [day, blocks, prevBlocks, templates, events, withRepeatDays],
  )
  // A slot whose task is not on this day's list (its date is another day) still ticks: its task by id.
  const onList = new Set(dayList.map(t => t.id))
  const linkedIds = [...new Set([...blocks, ...prevBlocks].map(b => b.task_id).filter((id): id is string => !!id && !onList.has(id)))].sort()
  const { data: linkedTasks = [] } = useTasksByIds(linkedIds)
  const rows = buildDayRows({ day, today, tasks: list, items, linkedTasks, repeatDays: list.repeatDays })

  // A repeat's day that is a task already counts with the tasks, never twice.
  const counts = dayRowCounts(list.counts, repeatsToDoOn(templates, day, today, repeatDayKeys(withRepeatDays)))
  // Repeat days that passed with no tick: on their day, never carried over
  // (yesterday's tail past midnight is yesterday's day, not one of today's).
  const missed = [...rows.timed, ...rows.anytime].filter(r => r.kind === 'repeat' && r.state === 'missed' && !r.spillover).length
  const planned = plannedMinutes(items)
  const next = viewingToday ? aheadOnDay(items, true, nowHour)[0] : undefined
  const planCtx = useDayPlanContext(day, rows.timed.some(r => r.kind === 'training') || rows.anytime.some(r => r.kind === 'training'))
  // A task added while the day is on screen rises in; the day's own rows don't.
  const fresh = useNewIds([...onList], day, !list.isLoading)

  // ONE Add: the one sheet, this day as its date (the section follows the
  // date: taskRules.sectionForDay — Today for today, else Backlog).
  function openAdd(time?: string) {
    modal.open({ kind: 'task', defaults: { date: day, dueDate: day, section: list.section, ...(time ? { startTime: time, scheduled: true } : {}) } })
  }

  async function refreshCalendar() {
    const tid = toast.loading('Syncing calendar…')
    try {
      await qc.refetchQueries({ queryKey: qk.calendar.dayAll(day) })
      toast.dismiss(tid); toast.success('Calendar synced')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Sync failed')
    }
  }

  // The editor of whatever the row is, by id (a continuation opens yesterday's thing).
  function openRow(r: DayRow) {
    const i = r.item
    if (r.kind === 'event' && i?.event) return setEditEvent(i.event)
    if (r.kind === 'training' && i) return modal.open({ kind: 'training-session', plan: { kind: i.kind === 'recurring' ? 'recurring' : 'block', id: i.canonicalId, date: i.planDate } })
    if (i?.kind === 'recurring') return modal.open(repeatDayRequest(i.canonicalId, i.planDate))
    if (i?.taskId) return modal.open({ kind: 'task', id: i.taskId })
    if (i) return modal.open({ kind: 'time-block', id: i.canonicalId })
    if (r.task) return modal.open({ kind: 'task', id: r.task.id })
  }

  const isPast = (r: DayRow) => viewingToday && r.startHour !== null && (r.endHour ?? r.startHour) <= nowHour
  const isActive = (r: DayRow) => viewingToday && r.startHour !== null && r.endHour !== null && r.startHour <= nowHour && r.endHour > nowHour

  function renderRow(r: DayRow): ReactNode {
    if (r.spillover) return <ContinuationRow row={r} past={isPast(r)} onOpen={() => openRow(r)} />
    switch (r.kind) {
      case 'event':    return <EventRow row={r} past={isPast(r)} active={isActive(r)} onOpen={() => openRow(r)} />
      case 'training': return <TrainingRow row={r} planCtx={planCtx} nowHour={nowHour} active={isActive(r)} />
      case 'repeat':   return <RepeatRow row={r} active={isActive(r)} />
      case 'slot':     return <SlotRow row={r} past={isPast(r)} active={isActive(r)} />
      case 'task':
        if (!r.task) return <LinkedTaskRow row={r} />
        return (
          <div className={cx(r.state !== 'open' && 'opacity-60')}>
            <ToDoItem task={r.task} isNew={fresh.has(r.task.id)} />
          </div>
        )
    }
  }

  // The now-line sits before the first row that starts later (or after the last).
  const nowAt = viewingToday ? rows.timed.findIndex(r => r.startHour! > nowHour) : -2
  const timedList = (
    <div className="flex flex-col gap-1">
      {rows.timed.map((r, n) => (
        <div key={r.key} className="flex flex-col gap-1">
          {nowAt === n && <NowMarker hour={nowHour} />}
          <div className="flex min-w-0 items-stretch gap-1.5">
            <TimeGutter row={r} />
            <div className="min-w-0 flex-1">{renderRow(r)}</div>
          </div>
        </div>
      ))}
      {nowAt === -1 && rows.timed.length > 0 && <NowMarker hour={nowHour} />}
    </div>
  )
  const list1 = (rs: DayRow[]) => <div className="flex flex-col gap-1">{rs.map(r => <div key={r.key}>{renderRow(r)}</div>)}</div>

  const nothing = rows.timed.length + rows.anytime.length + rows.done.length + rows.cancelled.length === 0

  return (
    // The container is the whole pane (its padding included), so the columns
    // split where the card is 54rem wide, as the two panes did.
    <div className={cx('@container', !bare && 'card')}>
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="section-label">Day plan</h2>
            {counts.open > 0 && <TonePill tone="accent">{counts.open} open</TonePill>}
            {counts.done > 0 && <span className="text-meta tabular-nums text-fg-muted">{counts.done} done</span>}
            {missed > 0 && <span className="text-meta tabular-nums text-fg-muted">{missed} missed</span>}
          </div>
          {next && (next.inProgress ? (
            <Truncate as="p" className="mt-0.5 text-meta text-fg-muted" fullText={`Now: ${next.title} until ${untilLabel(next.endHour)}`}>
              Now: <span className="font-semibold text-fg-2">{next.title}</span> until {untilLabel(next.endHour)}
            </Truncate>
          ) : (
            <Truncate as="p" className="mt-0.5 text-meta text-fg-muted" fullText={`Next: ${next.title} at ${hourLabel(next.startHour)}`}>
              Next: <span className="font-semibold text-fg-2">{next.title}</span> at {hourLabel(next.startHour)}
            </Truncate>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {calToken && (
            <IconButton label="Sync Google Calendar" onClick={refreshCalendar} disabled={calFetching}>
              <RefreshCw className={cx(calFetching && 'animate-spin')} />
            </IconButton>
          )}
          <Button variant="primary" size="sm" icon={<Plus />} onClick={() => openAdd()}>Add</Button>
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" rounded="rounded-row" />)}
        </div>
      ) : list.isError ? (
        // A failed read must never look like an empty day.
        <p className="flex flex-wrap items-center gap-2 py-3 text-body text-fg-muted">
          Couldn't load the day's tasks.
          <Button variant="ghost" size="sm" onClick={() => void list.refetch()}>Try again</Button>
        </p>
      ) : nothing ? (
        <>
          <div className="mb-1.5 empty:hidden"><OpenWishesRow /></div>
          {/* An empty day: quick adds at a time instead of an empty grid. */}
          <div className="py-4 text-center">
            <p className="mb-2.5 text-body text-fg-muted">Nothing planned</p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {[['Morning', '09:00'], ['Afternoon', '13:00'], ['Evening', '19:00']].map(([label, t]) => (
                <button key={t} type="button" onClick={() => openAdd(t)} className="chip min-h-[44px]">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {label} <span className="tabular-nums text-fg-muted">{t}</span>
                </button>
              ))}
            </div>
          </div>
          <UndatedThisWeek />
        </>
      ) : (
        // One list of parts, every part a direct child. Phone: a column in
        // `order` — Anytime (the wishes row above it) · Schedule · Done ·
        // Cancelled · this week's undated. From a 54rem card: a grid with the
        // Schedule in column 1 across every row and the rest stacked in column
        // 2; the last row is 1fr, so a tall Schedule grows that row and never
        // stretches the gaps between Anytime and Done (spacing is margins, so
        // a part that isn't there leaves no gap).
        <div className="flex flex-col gap-3 @[54rem]:grid @[54rem]:grid-cols-2 @[54rem]:grid-rows-[auto_auto_auto_auto_auto_1fr] @[54rem]:items-start @[54rem]:gap-x-6 @[54rem]:gap-y-0 @[72rem]:grid-cols-[minmax(0,38rem)_minmax(0,34rem)]">
          <div className={cx('order-1 empty:hidden', RIGHT, '@[54rem]:row-start-1 @[54rem]:mb-3')}><OpenWishesRow /></div>
          <Group label="Anytime" empty="Nothing without a time" className={cx('order-1', RIGHT, '@[54rem]:row-start-2')} count={rows.anytime.length}>
            {list1(rows.anytime)}
          </Group>
          <Group
            label="Schedule"
            note={planned > 0 ? `${formatDurationMinutes(planned)} planned` : undefined}
            empty="Nothing at a set time"
            className="order-2 @[54rem]:col-start-1 @[54rem]:row-start-1 @[54rem]:row-end-7"
            count={rows.timed.length}
          >
            {timedList}
          </Group>
          {rows.done.length > 0 && (
            <Group label="Done" className={cx('order-3', RIGHT, '@[54rem]:row-start-3 @[54rem]:mt-3')} count={rows.done.length}>
              {list1(rows.done)}
            </Group>
          )}
          {rows.cancelled.length > 0 && (
            <Group label="Cancelled" className={cx('order-4', RIGHT, '@[54rem]:row-start-4 @[54rem]:mt-3')} count={rows.cancelled.length}>
              <div className="opacity-60">{list1(rows.cancelled)}</div>
            </Group>
          )}
          <div className={cx('order-5 empty:hidden', RIGHT, '@[54rem]:row-start-5 @[54rem]:mt-3')}><UndatedThisWeek /></div>
        </div>
      )}

      {editEvent && <EditCalendarEventModal event={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
    </div>
  )
}

/** A part that sits in the Anytime column from a 54rem card. */
const RIGHT = 'min-w-0 @[54rem]:col-start-2'

/** One part of the list. An empty part keeps its heading (with `empty`) only
 *  where it is a column of its own (54rem); in the one list it leaves no line. */
function Group({ label, note, empty, count, className, children }: {
  label: string; note?: string; empty?: string; count: number; className?: string; children: ReactNode
}) {
  return (
    <section className={cx('min-w-0', count === 0 && 'hidden @[54rem]:block', className)} aria-label={label}>
      <p className="mb-1 flex items-baseline gap-1.5 px-1">
        <span className="section-label">{label}</span>
        {note && <span className="text-micro tabular-nums text-fg-muted">· {note}</span>}
      </p>
      {count > 0 ? children : empty && (
        <p className="hidden items-center gap-2 px-1 py-2 text-meta text-fg-muted @[54rem]:flex">
          <ToneDot tone="neutral" /> {empty}
        </p>
      )}
    </section>
  )
}
