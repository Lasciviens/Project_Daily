import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { endOfWeek, format, isToday, startOfWeek, subDays } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { useScheduleBlocks, useTimeBlocks } from '../hooks/useSchedule'
import { useDayTasks, useTasksByIds, useTasksByWeek } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { EditCalendarEventModal } from '../../calendar/components/EditCalendarEventModal'
import { useDayPlanContext } from '../../training/hooks/usePlanContext'
import { useOpenWishes } from '../../wishes/hooks/useWishes'
import { useEntityModal } from '../../../shared/modals'
import { useNewIds } from '../../../shared/hooks/useNewIds'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { rememberLayout, rememberedLayout, useRememberedFlag } from '../../../shared/hooks/useLayoutMemory'
import { isOpenTask } from '../../todo/taskRules'
import { useCalendarStore, toast } from '../../../app/store'
import { qk } from '../../../shared/query'
import { Button, IconButton, KeepRoom, Skeleton, ToneDot, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatDurationMinutes } from '../../../shared/utils/formatDuration'
import { todayStr } from '../../../shared/utils/dateUtils'
import { aheadOnDay, buildDaySchedule, plannedMinutes } from '../daySchedule'
import { buildDayRows, dayRowCounts, hourLabel, repeatDayKeys, repeatDayRequest, repeatsToDoOn, rowTimeZone, untilLabel, type DayRow } from '../dayItems'
import { zoneTag } from '../../../shared/utils/timeZone'
import {
  ContinuationRow, EventRow, LinkedTaskRow, NowMarker, RepeatRow, SlotRow, TimeGutter, TrainingRow,
} from './DayAgendaRows'
import { OpenWishesRow, OpenWishesRowSkeleton, UndatedThisWeek, UndatedThisWeekSkeleton } from './DayAgendaExtras'
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
/** `addButton: false` — the caller has its own way to add (Home's quick add), so the day shows one Add. */
export function DayAgenda({ date, bare = false, addButton = true }: { date: Date; bare?: boolean; addButton?: boolean }) {
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
  const { data: templates = [], isLoading: templatesLoading, isError: templatesError, refetch: refetchTemplates } = useScheduleBlocks()
  const { data: blocks = [], isLoading: blocksLoading, isError: blocksError, refetch: refetchBlocks } = useTimeBlocks(day)
  const { data: prevBlocks = [], isLoading: prevLoading, isError: prevError, refetch: refetchPrev } = useTimeBlocks(prevDay)
  const { data: events, isFetching: calFetching, isLoading: eventsLoading } = useCalendarEventsForDay(day)
  // The two extras' reads (open wishes, this week's undated tasks) start with the day's. They are bands of their
  // own, never part of the list's order: the list doesn't wait for them, and each keeps its room while it loads
  // where it showed last time (THEME.md §5).
  const { data: wishes = [], isLoading: wishesLoading, isError: wishesError } = useOpenWishes()
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const { data: weekTasks = [], isLoading: weekLoading, isError: weekError } = useTasksByWeek(weekStart, endOfWeek(weekStart, { weekStartsOn: 1 }))
  const floating = useMemo(() => weekTasks.filter(t => !t.due_date && isOpenTask(t)), [weekTasks])
  const wishesRoom = useRememberedFlag('dayList:wishes', wishes.length > 0, !wishesLoading && !wishesError)
  const undatedRoom = useRememberedFlag('dayList:undated', floating.length > 0, !weekLoading && !weekError)
  const wishesBand = wishesLoading ? wishesRoom && <OpenWishesRowSkeleton /> : <OpenWishesRow wishes={wishes} />
  const undatedBand = weekLoading ? undatedRoom && <UndatedThisWeekSkeleton /> : <UndatedThisWeek floating={floating} />

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
  const linked = useTasksByIds(linkedIds)
  const linkedTasks = linked.data ?? []
  const rows = buildDayRows({ day, today, tasks: list, items, linkedTasks, repeatDays: list.repeatDays })
  // The list is one order across its reads (tasks, slots, repeats, the slots' tasks): it shows once they have all
  // answered, so a row never lands between rows already drawn. Google's events (an outside service) fill in where
  // they are; the list keeps its room until they have answered too.
  const firstAnswer = !list.isLoading && !templatesLoading && !blocksLoading && !prevLoading
    && !(linkedIds.length > 0 && (linked.isLoading || linked.isPlaceholderData))
  // The loading copy is the day's first answer only. Once the list is drawn, a later read keeps the rows on screen:
  // a delete or a move takes a task off the cached list while its slot is still cached, so the slot's task is read
  // by id under a new key — that used to put the whole list back into skeleton rows for a round trip.
  const [drawnDay, setDrawnDay] = useState<string | null>(null)
  if (firstAnswer && drawnDay !== day) setDrawnDay(day)
  const listReady = firstAnswer || drawnDay === day
  const settled = listReady && !eventsLoading
  // A failed read is one line, never this day's room for the next visit — the slots' and plans' reads too: without
  // them the list silently dropped the day's slots and its Next line named the wrong one (owner-critic, 07.11.2026).
  const failed = list.isError || templatesError || blocksError || prevError
  const retryFailed = () => {
    if (list.isError) void list.refetch()
    if (templatesError) void refetchTemplates()
    if (blocksError) void refetchBlocks()
    if (prevError) void refetchPrev()
  }

  // A repeat's day that is a task already counts with the tasks, never twice.
  const counts = dayRowCounts(list.counts, repeatsToDoOn(templates, day, today, repeatDayKeys(withRepeatDays)))
  // Repeat days that passed with no tick: on their day, never carried over
  // (yesterday's tail past midnight is yesterday's day, not one of today's).
  const missed = [...rows.timed, ...rows.anytime].filter(r => r.kind === 'repeat' && r.state === 'missed' && !r.spillover).length
  const planned = plannedMinutes(items)
  const next = viewingToday && !failed ? aheadOnDay(items, true, nowHour)[0] : undefined
  const planCtx = useDayPlanContext(day, rows.timed.some(r => r.kind === 'training') || rows.anytime.some(r => r.kind === 'training'))
  // A task added while the day is on screen rises in; the day's own rows don't.
  const fresh = useNewIds([...onList], day, !list.isLoading)

  // Until every read has answered, the list keeps the room it took when this day last loaded (THEME.md §5): what
  // sits under the card stays where it is drawn, for a busy day and an empty one alike. Two columns from 54rem.
  const { ref: rootRef, width } = useElementWidthRem<HTMLDivElement>()
  const cols: 1 | 2 = width != null && width >= 54 ? 2 : 1
  const roomIds = viewingToday ? [roomKey(day, cols), todayRoomKey(cols)] : [roomKey(day, cols)]
  const hasNext = !!next
  const nextRoom = viewingToday && !settled && !hasNext && rememberedNext(day)
  useEffect(() => { if (settled && !failed && viewingToday) rememberNext(day, hasNext) }, [settled, failed, viewingToday, day, hasNext])

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
  // Times on another clock than the phone's (183): said once in the heading when every timed row shares it ("Oslo time"),
  // else under each row that differs.
  const rowZones = rows.timed.map(r => (r.kind === 'event' ? null : zoneTag(rowTimeZone(r))))
  const sharedZone = rowZones.length > 0 && rowZones.every(z => z !== null && z === rowZones[0]) ? rowZones[0] : null
  const timedList = (
    <div className="flex flex-col gap-1">
      {rows.timed.map((r, n) => (
        <div key={r.key} className="flex flex-col gap-1">
          {nowAt === n && <NowMarker hour={nowHour} />}
          <div className="flex min-w-0 items-stretch gap-1.5">
            <TimeGutter row={r} hideZone={!!sharedZone} />
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
    <div ref={rootRef} className={cx('@container', !bare && 'card')}>
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {/* min-h-5: the count pill's height, so the row doesn't grow when the counts land. */}
          <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="section-label">Day plan</h2>
            {counts.open > 0 && <TonePill tone="accent">{counts.open} open</TonePill>}
            {counts.done > 0 && <span className="text-meta tabular-nums text-fg-muted">{counts.done} done</span>}
            {missed > 0 && <span className="text-meta tabular-nums text-fg-muted">{missed} missed</span>}
          </div>
          {/* Today's "Next:" line keeps its room while the day loads — when it showed last time. */}
          {nextRoom && <span aria-hidden className="mt-0.5 flex h-4 items-center"><Skeleton className="h-3 w-40" /></span>}
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
          {addButton && <Button variant="primary" size="sm" icon={<Plus />} onClick={() => openAdd()}>Add</Button>}
        </div>
      </div>

      <KeepRoom ids={roomIds} loading={!settled || width == null} first={ROOM_DEFAULT_REM[cols]} remember={!failed}>
      {!listReady ? <ListSkeleton rem={listRoom(roomIds, cols)} /> : failed ? (
        // A failed read must never look like an empty day, or a day without its slots.
        <p className="flex flex-wrap items-center gap-2 py-3 text-body text-fg-muted">
          {list.isError ? 'Couldn\'t load the day\'s tasks.' : 'Couldn\'t load the day\'s plan.'}
          <Button variant="ghost" size="sm" onClick={retryFailed}>Try again</Button>
        </p>
      ) : nothing ? (
        <>
          <div className="mb-1.5 empty:hidden">{wishesBand}</div>
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
          {undatedBand}
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
          <div className={cx('order-1 empty:hidden', RIGHT, '@[54rem]:row-start-1 @[54rem]:mb-3')}>{wishesBand}</div>
          <Group label="Anytime" empty="Nothing without a time" className={cx('order-1', RIGHT, '@[54rem]:row-start-2')} count={rows.anytime.length}>
            {list1(rows.anytime)}
          </Group>
          <Group
            label="Schedule"
            note={[planned > 0 ? `${formatDurationMinutes(planned)} planned` : null, sharedZone ? `${sharedZone} time` : null].filter(Boolean).join(' · ') || undefined}
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
          <div className={cx('order-5 empty:hidden', RIGHT, '@[54rem]:row-start-5 @[54rem]:mt-3')}>{undatedBand}</div>
        </div>
      )}
      </KeepRoom>

      {editEvent && <EditCalendarEventModal event={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
    </div>
  )
}

/** A part that sits in the Anytime column from a 54rem card. */
const RIGHT = 'min-w-0 @[54rem]:col-start-2'

/**
 * The list's room before a day has ever loaded on this device (rem), by column count: about an empty day's (on a
 * phone its three quick-add chips take two rows; on a wide card the list's old 136px loading height). A skeleton
 * sized for a busy day pulls a light day's page up as far as a short one pushes a busy day's down, so only the
 * day's own last height is better than this.
 */
const ROOM_DEFAULT_REM: Record<1 | 2, number> = { 1: 9.75, 2: 8.5 }
/** A task row with its meta line (62px) and the 4px between rows. */
const ROW_REM = 3.875
const ROW_GAP_REM = 0.25

const roomKey = (day: string, cols: number) => `dayList:${day}:${cols}`
const todayRoomKey = (cols: number) => `dayList:today:${cols}`
const nextKey = (day: string) => `dayNext:${day}`
const NEXT_TODAY = 'dayNext:today'

/** The room the list keeps while it loads (KeepRoom's own lookup), for the loading copy's rows. */
function listRoom(ids: readonly string[], cols: 1 | 2): number {
  for (const id of ids) {
    const v = rememberedLayout(id)
    if (typeof v === 'number') return v
  }
  return ROOM_DEFAULT_REM[cols]
}

/** Whether today's "Next:" line showed when this day (else the last today) last loaded. */
function rememberedNext(day: string): boolean {
  const own = rememberedLayout(nextKey(day))
  return typeof own === 'boolean' ? own : rememberedLayout(NEXT_TODAY) === true
}

function rememberNext(day: string, next: boolean) {
  rememberLayout(nextKey(day), next)
  rememberLayout(NEXT_TODAY, next)
}

/**
 * The loading copy of the list: task rows (62px, the loaded rows' height) filling the room the list keeps, in the
 * loaded list's columns (two from a 54rem card).
 */
function ListSkeleton({ rem }: { rem: number }) {
  const rows = Math.max(1, Math.floor((rem + ROW_GAP_REM) / (ROW_REM + ROW_GAP_REM)))
  return (
    <div aria-hidden className="grid grid-cols-1 items-start @[54rem]:grid-cols-2 @[54rem]:gap-x-6 @[72rem]:grid-cols-[minmax(0,38rem)_minmax(0,34rem)]">
      {[0, 1].map(col => (
        <div key={col} className={cx('min-w-0 flex-col gap-1', col === 0 ? 'flex' : 'hidden @[54rem]:flex')}>
          {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-[3.875rem]" rounded="rounded-row" />)}
        </div>
      ))}
    </div>
  )
}

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
