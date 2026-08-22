import { useState } from 'react'
import { format, getDay, isToday } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useScheduleBlocks, useTimeBlocks, useDeleteTimeBlock, useUpdateTimeBlock,
  useDeleteScheduleBlock,
} from '../hooks/useSchedule'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { EditCalendarEventModal } from '../../calendar/components/EditCalendarEventModal'
import { supabase } from '../../../integrations/supabase/client'
import { useCalendarStore, toast } from '../../../app/store'
import { formatDurationMinutes } from '../../../shared/utils/formatDuration'
import type { CalendarEvent } from '../../calendar/types'
import type { TimeBlock, ScheduleBlock } from '../types'
import type { Task } from '../../todo/types'

// ─────────────────────────────────────────────────────────────────────────────
//  DayAgenda — replaces the old 24h × 52px pixel-grid DayTimeline. Design
//  rationale (choices compared: keep-but-shrink the hour grid / pure agenda
//  list / hybrid): real usage is SPARSE (live data: ~1 block per day), so a
//  1248px-tall mostly-empty grid wasted the page's center column, and a long
//  block rendered as a huge empty rectangle. An agenda shows each block as
//  ONE information-dense row (time · duration · title · badges · actions),
//  scales from empty to busy days, and gives night hours (<06:00) their own
//  labelled group instead of pretending 03:00 is "morning".
//
//  Migration 077 click-routing (no more Task/Schedule tab dichotomy): ✎ on a
//  row opens the ONE modal in the mode that matches what was actually
//  clicked — a calendar event opens EditCalendarEventModal (unchanged), a
//  recurring template opens UnifiedPlanModal in 'recurring' mode, a
//  task-linked one-off block opens the Task itself (mode='task' — the
//  Schedule section lives inside it now), and a standalone one-off block
//  opens 'schedule' mode directly. Nothing here decides which tab to show;
//  the caller (this file) decides which ENTITY was clicked.
// ─────────────────────────────────────────────────────────────────────────────

const NIGHT_END = 6 // hours before this belong to the night, not the morning

const COLOR_EDGE: Record<string, string> = {
  blue:   'border-l-blue-400',
  green:  'border-l-green-400',
  orange: 'border-l-orange-400',
  purple: 'border-l-purple-400',
  accent: 'border-l-accent-500',
  red:    'border-l-red-400',
}

function timeStrToHour(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}
function hourToTimeStr(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

interface AgendaBlock {
  id:             string
  kind:           'recurring' | 'block' | 'calendar'
  title:          string
  startHour:      number
  endHour:        number
  edgeClass:      string
  dateStr:        string
  taskId?:        string | null
  calendarEvent?: CalendarEvent
  allDay?:        boolean
}

// `bare` — render as a chrome-less pane inside a parent surface (Daily's hero
// panel provides the card); default keeps the own-card look (Month tab).
export function DayAgenda({ date, bare = false }: { date: Date; bare?: boolean }) {
  const dateStr   = format(date, 'yyyy-MM-dd')
  const dayOfWeek = getDay(date)

  const [modal,             setModal]             = useState(false)
  const [clickTime,         setClickTime]         = useState<string | undefined>(undefined)
  const [editEvent,         setEditEvent]         = useState<CalendarEvent | null>(null)
  const [editTask,          setEditTask]          = useState<Task | null>(null)
  const [editTimeBlock,     setEditTimeBlock]     = useState<TimeBlock | null>(null)
  const [editScheduleBlock, setEditScheduleBlock] = useState<ScheduleBlock | null>(null)
  const [selectedId,        setSelectedId]        = useState<string | null>(null)

  const { data: schedBlocks = [] } = useScheduleBlocks()
  const { data: timeBlocks  = [] } = useTimeBlocks(dateStr)
  const { data: calEvents, isFetching: calFetching } = useCalendarEventsForDay(dateStr)
  const deleteBlock         = useDeleteTimeBlock()
  const updateBlock         = useUpdateTimeBlock()
  const deleteScheduleBlock = useDeleteScheduleBlock()
  const qc                  = useQueryClient()
  const calToken            = useCalendarStore(s => s.accessToken)

  async function handleCalRefresh() {
    const tid = toast.loading('Syncing calendar…')
    try {
      await qc.refetchQueries({ queryKey: ['calendar', 'day', dateStr] })
      toast.dismiss(tid); toast.success('Calendar synced ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Sync failed')
    }
  }

  // Full linked-Task rows (not just notes) — needed both for the 📝 preview
  // and so ✎ can open the Task editor immediately with no extra round trip.
  const linkedTaskIds = timeBlocks.filter(b => b.task_id).map(b => b.task_id!)
  const { data: linkedTasksFull = [] } = useQuery({
    queryKey: ['tasks', 'by-ids', dateStr, linkedTaskIds.join(',')],
    queryFn:  async () => {
      const { data } = await supabase.from('tasks').select('*').in('id', linkedTaskIds)
      return (data ?? []) as Task[]
    },
    enabled:   linkedTaskIds.length > 0,
    staleTime: 5 * 60_000,
  })
  const linkedTaskMap = new Map(linkedTasksFull.map(t => [t.id, t]))

  // A block's own google_calendar_event_id already represents its Google
  // Calendar presence — an event fetched separately from the Calendar API
  // for the same id would otherwise render the same thing twice.
  const linkedGCalIds = new Set(timeBlocks.map(b => b.google_calendar_event_id).filter(Boolean))

  // ── Assemble the unified block list (same sources as the old timeline) ──
  const blocks: AgendaBlock[] = []
  for (const b of schedBlocks) {
    if (!b.days_of_week.includes(dayOfWeek)) continue
    const startHour = timeStrToHour(b.start_time)
    let endHour = timeStrToHour(b.end_time)
    // Cross-midnight recurring block (e.g. 23:00-01:00): end_time's own clock
    // reading is BEFORE start_time's, so a plain parse gives a negative
    // duration. Add 24h so downstream duration/overlap math stays correct —
    // display re-wraps with `% 24` in renderRow (mirrors minutesBetweenWrapping's
    // same wrap rule in planModal.config.ts).
    if (endHour <= startHour) endHour += 24
    blocks.push({
      id: b.id, kind: 'recurring', title: b.title, dateStr,
      startHour, endHour,
      edgeClass: COLOR_EDGE[b.color] ?? COLOR_EDGE.blue,
    })
  }
  for (const b of timeBlocks) {
    // NULL start_time exists in real data (a plan saved without a time) —
    // shown in its own "unscheduled" group instead of being dropped.
    const start = b.start_time ? timeStrToHour(b.start_time) : null
    blocks.push({
      id: b.id, kind: 'block', title: b.title, dateStr,
      startHour: start ?? -1, endHour: start != null ? start + b.duration_minutes / 60 : -1,
      edgeClass: COLOR_EDGE[b.color] ?? COLOR_EDGE.accent,
      taskId: b.task_id,
    })
  }
  for (const e of calEvents ?? []) {
    if (linkedGCalIds.has(e.id)) continue
    if (e.start.dateTime) {
      const s = new Date(e.start.dateTime)
      const en = new Date(e.end.dateTime ?? e.start.dateTime)
      blocks.push({
        id: e.id, kind: 'calendar', title: e.summary ?? '(no title)', dateStr,
        startHour: s.getHours() + s.getMinutes() / 60, endHour: en.getHours() + en.getMinutes() / 60,
        edgeClass: COLOR_EDGE.green, calendarEvent: e,
      })
    } else if (e.start.date) {
      blocks.push({
        id: e.id, kind: 'calendar', title: e.summary ?? '(no title)', dateStr,
        startHour: -1, endHour: -1, edgeClass: COLOR_EDGE.green, calendarEvent: e, allDay: true,
      })
    }
  }

  const allDayEvents = blocks.filter(b => b.allDay)
  const unscheduled  = blocks.filter(b => !b.allDay && b.startHour < 0)
  const timed        = blocks.filter(b => b.startHour >= 0).sort((a, b) => a.startHour - b.startHour)
  const night        = timed.filter(b => b.startHour < NIGHT_END)
  const day          = timed.filter(b => b.startHour >= NIGHT_END)

  const overlappingIds = new Set<string>()
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[i].startHour < timed[j].endHour && timed[i].endHour > timed[j].startHour) {
        overlappingIds.add(timed[i].id); overlappingIds.add(timed[j].id)
      }
    }
  }

  const totalBookedMin = timed.reduce((s, b) => s + Math.max(0, (b.endHour - b.startHour) * 60), 0)
  const now = new Date()
  const nowHour = now.getHours() + now.getMinutes() / 60
  const today = isToday(date)
  const nextBlock = today ? day.find(b => b.startHour > nowHour) : undefined

  function openAdd(time?: string) { setClickTime(time); setModal(true) }

  // ✎ opens the ONE editor for whichever entity this row actually is — see
  // the file-header comment for the routing rule.
  function openEditor(block: AgendaBlock) {
    if (block.kind === 'recurring') {
      const sb = schedBlocks.find(s => s.id === block.id)
      if (sb) setEditScheduleBlock(sb)
      return
    }
    if (block.taskId) {
      const t = linkedTaskMap.get(block.taskId)
      if (t) setEditTask(t)
      return
    }
    const tb = timeBlocks.find(b => b.id === block.id)
    if (tb) setEditTimeBlock(tb)
  }

  // ── Row renderer (plain render function, not a nested component —
  //     react-hooks/static-components: components created during render get a
  //     new identity every render and remount their subtree) ──
  function renderRow(block: AgendaBlock) {
    const isSelected = selectedId === block.id
    const isCal       = block.kind === 'calendar'
    const isRecurring = block.kind === 'recurring'
    const durationMins = Math.round((block.endHour - block.startHour) * 60)
    const taskNotes  = block.taskId ? linkedTaskMap.get(block.taskId)?.description : null
    const isPast     = today && block.endHour <= nowHour
    const isActive   = today && block.startHour <= nowHour && block.endHour > nowHour

    function postpone30m() {
      updateBlock.mutate({ id: block.id, patch: { start_time: `${hourToTimeStr(Math.min(23.5, block.startHour + 0.5))}:00` } })
    }
    function postpone1d() {
      const d = new Date(block.dateStr + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      const newDate = format(d, 'yyyy-MM-dd')
      // Moves only this block's own schedule — a task's deadline (due_date)
      // and its schedule slot are independent facts (migration 077); postponing
      // where a task-linked block sits on the calendar must never move when
      // the task itself is due.
      updateBlock.mutate({ id: block.id, patch: { date: newDate } })
      setSelectedId(null)
    }

    // A row tap opens the right editor DIRECTLY — no select-then-✎ second
    // step. The small ⋯ toggle (always visible, its own 44px target) is the
    // ONLY way to reach the quick actions (postpone/delete) without leaving
    // the agenda; it stops propagation so it never also opens the editor.
    return (
      <div
        onClick={() => isCal ? setEditEvent(block.calendarEvent!) : openEditor(block)}
        className={`group rounded-md border-l-2 ${block.edgeClass} px-2.5 py-1.5 cursor-pointer transition-colors ${
          isActive || isSelected ? 'bg-cream-100' : 'hover:bg-cream-100/70'
        } ${isPast ? 'opacity-50' : ''} ${overlappingIds.has(block.id) ? 'ring-1 ring-red-300' : ''}`}
      >
        {/* The whole row is the tap target (onClick above), so it must clear
            44px: the wrapper's py-1.5 adds 12px to this 32px line = 44 exactly,
            which keeps the agenda dense instead of padding every row to 56. */}
        <div className="flex items-center gap-2.5 min-h-[32px]">
          <div className="w-[86px] shrink-0 text-[11px] tabular-nums leading-tight">
            {block.allDay || block.startHour < 0 ? (
              <span className="text-ink-500">{block.allDay ? 'All day' : 'No time'}</span>
            ) : (
              <>
                <span className="font-semibold text-ink-800">{hourToTimeStr(block.startHour)}</span>
                <span className="text-ink-500">–{hourToTimeStr(block.endHour % 24)}</span>
                <span className="block text-[10px] text-ink-500">{formatDurationMinutes(durationMins)}</span>
              </>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-ink-800 truncate leading-snug">
              {block.title}
              {isRecurring && <span className="ml-1.5 text-[9px] font-normal text-ink-500" title="Recurring">⟳</span>}
              {isCal && <span className="ml-1.5 text-[9px] font-normal text-green-600" title="Google Calendar">◈</span>}
              {taskNotes && <span className="ml-1 text-[9px] opacity-40">📝</span>}
              {overlappingIds.has(block.id) && <span className="ml-1 text-[10px] text-red-500" title="Overlaps another block">⚠</span>}
              {isActive && <span className="ml-1.5 text-[9px] font-medium text-accent-600">now</span>}
            </p>
            {isSelected && taskNotes && (
              <p className="text-[10px] text-ink-500 mt-0.5 line-clamp-2">{taskNotes}</p>
            )}
          </div>
          {!isCal && (
            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
              {isSelected && block.kind === 'block' && block.startHour >= 0 && (
                <button onClick={postpone30m} className="text-[10px] px-2 min-h-[44px] rounded border border-ink-200 text-ink-500 hover:border-accent-300">+30m</button>
              )}
              {isSelected && block.kind === 'block' && (
                <button onClick={postpone1d} className="text-[10px] px-2 min-h-[44px] rounded border border-ink-200 text-ink-500 hover:border-accent-300">+1d</button>
              )}
              {isSelected && (
                <button
                  onClick={() => {
                    if (isRecurring) deleteScheduleBlock.mutate(block.id)
                    else deleteBlock.mutate({ id: block.id, dateStr: block.dateStr })
                    setSelectedId(null)
                  }}
                  className="text-[10px] px-2 min-h-[44px] rounded border border-ink-200 text-ink-500 hover:text-red-500 hover:border-red-300"
                >✕</button>
              )}
              <button
                onClick={() => setSelectedId(isSelected ? null : block.id)}
                title={isSelected ? 'Hide quick actions' : 'Quick actions (postpone/delete)'}
                className="w-[28px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700"
              >⋯</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // "Nh free · +" gap rows were removed per explicit request ("böyle bir şey
  // istemiyorum herhangi bir yerde") — the agenda shows only real blocks now.

  function renderNowMarker() {
    return (
      <div className="flex items-center gap-1.5 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
        <span className="text-[10px] font-semibold text-red-500 shrink-0">{hourToTimeStr(nowHour)}</span>
        <div className="flex-1 border-t border-red-300" />
      </div>
    )
  }

  // Where the now-marker slots into the day list
  const nowIndex = today ? day.findIndex(b => b.startHour > nowHour) : -1

  return (
    <div className={bare ? 'p-4 sm:p-5' : 'card p-4'}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Schedule</h2>
          {nextBlock && (
            <p className="text-[10px] text-ink-500 mt-0.5 truncate">
              Next: <span className="font-semibold text-ink-700">{nextBlock.title}</span> at {hourToTimeStr(nextBlock.startHour)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalBookedMin > 0 && (
            <span className="text-[10px] text-ink-500">{formatDurationMinutes(totalBookedMin)} planned</span>
          )}
          {calToken && (
            <button
              onClick={handleCalRefresh} disabled={calFetching} title="Sync Google Calendar"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              <span className={calFetching ? 'animate-spin inline-block' : ''}>↻</span>
            </button>
          )}
          <button
            onClick={() => openAdd()}
            className="bg-accent-500 text-white hover:bg-accent-600 min-h-[44px] px-4 rounded-full text-xs font-semibold transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* All-day calendar events */}
        {allDayEvents.map(b => <div key={b.id}>{renderRow(b)}</div>)}

        {/* 🌙 Night — anything before 06:00 is the night, not the morning */}
        {night.length > 0 && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 px-1 pt-1">🌙 Night</p>
            {night.map(b => <div key={b.id}>{renderRow(b)}</div>)}
            <div className="border-t border-ink-100 my-0.5" />
          </>
        )}

        {/* Day blocks with the now marker between them */}
        {day.map((b, i) => (
          <div key={b.id} className="flex flex-col gap-1.5">
            {today && nowIndex === i && renderNowMarker()}
            {renderRow(b)}
          </div>
        ))}
        {today && nowIndex === -1 && day.length > 0 && nowHour > day[day.length - 1].endHour && renderNowMarker()}

        {/* Unscheduled (no start time) */}
        {unscheduled.length > 0 && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 px-1 pt-1">No time set</p>
            {unscheduled.map(b => <div key={b.id}>{renderRow(b)}</div>)}
          </>
        )}

        {/* Empty day — quick-add chips instead of a giant empty grid */}
        {timed.length === 0 && unscheduled.length === 0 && allDayEvents.length === 0 && (
          <div className="text-center py-5">
            <p className="text-sm text-ink-500 mb-2.5">Nothing scheduled</p>
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              {[['Morning', '09:00'], ['Afternoon', '13:00'], ['Evening', '19:00']].map(([label, t]) => (
                <button key={t} onClick={() => openAdd(t)}
                  className="text-[11px] px-3 rounded-lg border border-ink-200 text-ink-500 hover:border-accent-300 hover:text-accent-700 transition-colors min-h-[44px]">
                  + {label} {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* "+ Add" — always creates a standalone one-off block (schedule mode);
          "Also add to Tasks" is offered inside ScheduleTab itself. */}
      <UnifiedPlanModal
        open={modal}
        onClose={() => { setModal(false); setClickTime(undefined) }}
        mode="schedule"
        config={{ heading: 'Add time block' }}
        defaults={{ date: dateStr, startTime: clickTime, category: 'daily' }}
      />

      {/* ✎ editors — exactly one entity per open, routed by openEditor() */}
      <UnifiedPlanModal
        open={!!editTask}
        onClose={() => setEditTask(null)}
        config={{ heading: 'Edit Task' }}
        task={editTask ?? undefined}
      />
      <UnifiedPlanModal
        open={!!editTimeBlock}
        onClose={() => setEditTimeBlock(null)}
        config={{ heading: 'Edit block' }}
        timeBlock={editTimeBlock ?? undefined}
      />
      <UnifiedPlanModal
        open={!!editScheduleBlock}
        onClose={() => setEditScheduleBlock(null)}
        config={{ heading: 'Edit recurring block' }}
        scheduleBlock={editScheduleBlock ?? undefined}
      />

      {editEvent && <EditCalendarEventModal mode="edit" event={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
  )
}
