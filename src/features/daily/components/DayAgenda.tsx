import { useState } from 'react'
import { format, getDay, isToday, subDays } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CalendarDays, CornerDownRight, Moon, MoreHorizontal, Plus, RefreshCw, Repeat, StickyNote, Trash2,
} from 'lucide-react'
import {
  useScheduleBlocks, useTimeBlocks, useDeleteTimeBlock, useUpdateTimeBlock,
  useDeleteScheduleBlock,
} from '../hooks/useSchedule'
import { useTasksByIds } from '../../todo/hooks/useTodos'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { useEntityModal } from '../../../shared/modals'
import { EditCalendarEventModal } from '../../calendar/components/EditCalendarEventModal'
import { useCalendarStore, toast } from '../../../app/store'
import { qk } from '../../../shared/query'
import { Button, IconButton, cx } from '../../../shared/ui'
import { formatDurationMinutes } from '../../../shared/utils/formatDuration'
import { projectOneOffBlocksForDay, projectRecurringBlocksForDay, projectCalendarEventForDay } from './dayAgendaProjection'
import type { CalendarEvent } from '../../calendar/types'

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
//  Migration 077 click-routing (no more Task/Schedule tab dichotomy): a row
//  tap opens the ONE modal in the mode that matches what was actually
//  clicked — a calendar event opens EditCalendarEventModal, a
//  recurring template opens UnifiedPlanModal in 'recurring' mode, a
//  task-linked one-off block opens the Task itself (mode='task' — the
//  Schedule section lives inside it now), and a standalone one-off block
//  opens 'schedule' mode directly. Nothing here decides which tab to show;
//  the caller (this file) decides which ENTITY was clicked. A task-linked
//  row is opened by id through the shared entity-modal host (the adapter
//  loads the task itself), NEVER by a lookup into a preloaded map — the map
//  can still be loading when the tap happens, and a miss used to do nothing.
//
//  Cross-midnight projection (dayAgendaProjection.ts): every one-off block
//  and recurring template is projected onto EVERY day it actually occupies,
//  each showing only its own [0,24) portion — see that file's header
//  comment for the full rationale.
// ─────────────────────────────────────────────────────────────────────────────

const NIGHT_END = 6 // hours before this belong to the night, not the morning

// time_blocks/schedule_blocks.color is a user-picked tag; each maps onto a
// tone so both themes work. Google Calendar rows use the success edge.
const COLOR_EDGE: Record<string, string> = {
  blue:   'border-l-info',
  green:  'border-l-success',
  orange: 'border-l-warn',
  purple: 'border-l-highlight',
  accent: 'border-l-accent-500',
  red:    'border-l-danger',
}

function hourToTimeStr(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

interface AgendaBlock {
  id:             string  // unique within this day's render — may be a synthetic spillover id
  canonicalId:    string  // the REAL row id — every mutation routes through this
  kind:           'recurring' | 'block' | 'calendar'
  title:          string
  startHour:      number
  endHour:        number
  edgeClass:      string
  dateStr:        string
  taskId?:        string | null
  calendarEvent?: CalendarEvent
  allDay?:        boolean
  spillover:      boolean
}

// `bare` — render as a chrome-less pane inside a parent surface (Daily's hero
// panel provides the card); default keeps the own-card look (Month tab).
export function DayAgenda({ date, bare = false }: { date: Date; bare?: boolean }) {
  const dateStr     = format(date, 'yyyy-MM-dd')
  const prevDateStr = format(subDays(date, 1), 'yyyy-MM-dd')
  const dayOfWeek   = getDay(date)

  const [editEvent,         setEditEvent]         = useState<CalendarEvent | null>(null)
  const [selectedId,        setSelectedId]        = useState<string | null>(null)

  const { data: schedBlocks = [] } = useScheduleBlocks()
  const { data: timeBlocks  = [] } = useTimeBlocks(dateStr)
  const { data: prevTimeBlocks = [] } = useTimeBlocks(prevDateStr)
  const { data: calEvents, isFetching: calFetching } = useCalendarEventsForDay(dateStr)
  const deleteBlock         = useDeleteTimeBlock()
  const updateBlock         = useUpdateTimeBlock()
  const deleteScheduleBlock = useDeleteScheduleBlock()
  const qc                  = useQueryClient()
  const calToken            = useCalendarStore(s => s.accessToken)

  const modal = useEntityModal()

  async function handleCalRefresh() {
    const tid = toast.loading('Syncing calendar…')
    try {
      await qc.refetchQueries({ queryKey: qk.calendar.dayAll(dateStr) })
      toast.dismiss(tid); toast.success('Calendar synced')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Sync failed')
    }
  }

  // Full linked-Task rows (not just notes) — used for the 📝 preview only
  // now; navigation no longer depends on this map being loaded (see above).
  const linkedTaskIds = [...timeBlocks, ...prevTimeBlocks].filter(b => b.task_id).map(b => b.task_id!)
  const { data: linkedTasksFull = [] } = useTasksByIds(linkedTaskIds)
  const taskNotesMap = new Map(linkedTasksFull.map(t => [t.id, t.description ?? null]))

  // A block's own google_calendar_event_id already represents its Google
  // Calendar presence — an event fetched separately from the Calendar API
  // for the same id would otherwise render the same thing twice. Real bug
  // fixed: this used to build the set from `timeBlocks` alone. A block
  // whose OWN date is YESTERDAY but that crosses midnight into today
  // renders a spillover row today (via projectOneOffBlocksForDay's
  // `previousDayBlocks` argument) sourced from `prevTimeBlocks` — and its
  // linked Calendar event, per Google's own events.list window semantics
  // (an event matches a day's query whenever event.end > that day's
  // timeMin), is ALSO returned by today's own `useCalendarEventsForDay`
  // fetch. Without prevTimeBlocks in this set, that event rendered a
  // second time as a separate 'calendar' row alongside its own spillover.
  const linkedGCalIds = new Set(
    [...timeBlocks, ...prevTimeBlocks].map(b => b.google_calendar_event_id).filter(Boolean)
  )

  // ── Assemble the unified block list ─────────────────────────────────────
  const blocks: AgendaBlock[] = []

  for (const p of projectRecurringBlocksForDay(dateStr, dayOfWeek, schedBlocks)) {
    const original = schedBlocks.find(s => s.id === p.canonicalId)
    blocks.push({
      id: p.id, canonicalId: p.canonicalId, kind: p.kind, title: p.title, dateStr,
      startHour: p.startHour, endHour: p.endHour, taskId: p.taskId, spillover: p.spillover,
      edgeClass: COLOR_EDGE[original?.color ?? 'blue'] ?? COLOR_EDGE.blue,
    })
  }
  for (const p of projectOneOffBlocksForDay(timeBlocks, prevTimeBlocks)) {
    const original = (p.spillover ? prevTimeBlocks : timeBlocks).find(b => b.id === p.canonicalId)
    blocks.push({
      id: p.id, canonicalId: p.canonicalId, kind: p.kind, title: p.title, dateStr,
      startHour: p.startHour, endHour: p.endHour, taskId: p.taskId, spillover: p.spillover,
      edgeClass: COLOR_EDGE[original?.color ?? 'accent'] ?? COLOR_EDGE.accent,
    })
  }
  for (const e of calEvents ?? []) {
    if (linkedGCalIds.has(e.id)) continue
    if (e.start.dateTime) {
      // Real bug fixed: this used to build startHour/endHour straight from
      // each instant's own `.getHours()+.getMinutes()/60` — correct for
      // each instant in isolation, but assembled into one startHour/endHour
      // pair for TODAY's render, a cross-midnight event (23:00 yesterday →
      // 01:00 today) produced startHour=23 > endHour=1: a negative-duration
      // "row" that broke the overlap check and the booked-minutes sum the
      // moment a Calendar event crossed midnight. projectCalendarEventForDay
      // clips it onto THIS day exactly like the one-off/recurring block
      // helpers already do for their own cross-midnight rows.
      const projected = projectCalendarEventForDay(dateStr, e)
      if (!projected) continue
      blocks.push({
        id: e.id, canonicalId: e.id, kind: 'calendar', title: e.summary ?? '(no title)', dateStr,
        startHour: projected.startHour, endHour: projected.endHour,
        edgeClass: COLOR_EDGE.green, calendarEvent: e, spillover: projected.spillover,
      })
    } else if (e.start.date) {
      blocks.push({
        id: e.id, canonicalId: e.id, kind: 'calendar', title: e.summary ?? '(no title)', dateStr,
        startHour: -1, endHour: -1, edgeClass: COLOR_EDGE.green, calendarEvent: e, allDay: true, spillover: false,
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

  // Every row's endHour/startHour is already clipped to this day's own
  // [0,24) window by the projection helpers, so summing them here can never
  // double-count a minute that also appears (as a separate spillover row)
  // on the adjacent day.
  const totalBookedMin = timed.reduce((s, b) => s + Math.max(0, (b.endHour - b.startHour) * 60), 0)
  const now = new Date()
  const nowHour = now.getHours() + now.getMinutes() / 60
  const today = isToday(date)
  const nextBlock = today ? day.find(b => b.startHour > nowHour) : undefined

  // "+ Add" — always creates a standalone one-off block (schedule mode);
  // "Also add to Tasks" is offered inside ScheduleTab itself.
  function openAdd(time?: string) {
    modal.open({ kind: 'time-block', config: { heading: 'Add time block' }, defaults: { date: dateStr, startTime: time, category: 'daily' } })
  }

  // Opens the ONE editor for whichever entity this row actually is — see
  // the file-header comment for the routing rule. Always routes through
  // canonicalId, never the (possibly synthetic) spillover row id.
  function openEditor(block: AgendaBlock) {
    if (block.kind === 'recurring') {
      modal.open({ kind: 'schedule-block', id: block.canonicalId, config: { heading: 'Edit recurring block' } })
      return
    }
    // The editor loads the row by id itself (loading + not-found states in
    // its own shell), so a tap never silently does nothing.
    if (block.taskId) {
      modal.open({ kind: 'task', id: block.taskId, config: { heading: 'Edit task' } })
      return
    }
    modal.open({ kind: 'time-block', id: block.canonicalId, config: { heading: 'Edit block' } })
  }

  // ── Row renderer (plain render function, not a nested component —
  //     react-hooks/static-components: components created during render get a
  //     new identity every render and remount their subtree) ──
  function renderRow(block: AgendaBlock) {
    const isSelected = selectedId === block.id
    const isCal       = block.kind === 'calendar'
    const isRecurring = block.kind === 'recurring'
    const durationMins = Math.round((block.endHour - block.startHour) * 60)
    const taskNotes  = block.taskId ? taskNotesMap.get(block.taskId) : null
    const isPast     = today && block.endHour <= nowHour
    const isActive   = today && block.startHour <= nowHour && block.endHour > nowHour

    function postpone30m() {
      updateBlock.mutate({ id: block.canonicalId, patch: { start_time: `${hourToTimeStr(Math.min(23.5, block.startHour + 0.5))}:00` } })
    }
    function postpone1d() {
      const d = new Date(block.dateStr + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      const newDate = format(d, 'yyyy-MM-dd')
      // Moves only this block's own schedule — a task's deadline (due_date)
      // and its schedule slot are independent facts (migration 077); postponing
      // where a task-linked block sits on the calendar must never move when
      // the task itself is due.
      updateBlock.mutate({ id: block.canonicalId, patch: { date: newDate } })
      setSelectedId(null)
    }

    // A row tap opens the right editor DIRECTLY — no select-then-✎ second
    // step. The small ⋯ toggle (always visible, its own 44px target) is the
    // ONLY way to reach the quick actions (postpone/delete) without leaving
    // the agenda; it stops propagation so it never also opens the editor.
    // A spillover row (the tail of yesterday's block) is still clickable —
    // it edits the SAME canonical block yesterday's own row would.
    const overlaps = overlappingIds.has(block.id)
    const quickBtn = 'min-h-[44px] rounded-control border border-line px-2 text-meta font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg'
    return (
      <div
        onClick={() => isCal ? setEditEvent(block.calendarEvent!) : openEditor(block)}
        className={cx(
          'group cursor-pointer rounded-control border-l-2 px-2.5 py-1.5 transition-colors duration-150',
          block.edgeClass,
          isActive || isSelected ? 'bg-surface-2' : 'hover:bg-surface-hover',
          isPast && 'opacity-50',
          overlaps && 'ring-1 ring-inset ring-danger/40',
        )}
      >
        {/* The whole row is the tap target: py-1.5 + this 32px line = 44px. */}
        <div className="flex min-h-[32px] items-center gap-2.5">
          <div className="w-[86px] shrink-0 text-meta leading-tight tabular-nums">
            {block.allDay || block.startHour < 0 ? (
              <span className="text-fg-muted">{block.allDay ? 'All day' : 'No time'}</span>
            ) : (
              <>
                <span className="font-semibold text-fg">{hourToTimeStr(block.startHour)}</span>
                <span className="text-fg-muted">–{hourToTimeStr(block.endHour)}</span>
                <span className="block text-micro text-fg-muted">{formatDurationMinutes(durationMins)}</span>
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1.5 text-body font-semibold leading-snug text-fg">
              {block.spillover && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-label="Continued from yesterday" />}
              <span className="truncate">{block.title}</span>
              {isRecurring && <Repeat className="h-3 w-3 shrink-0 text-fg-muted" aria-label="Recurring" />}
              {isCal && <CalendarDays data-tone="success" className="tone-text h-3 w-3 shrink-0" aria-label="Google Calendar" />}
              {taskNotes && <StickyNote className="h-3 w-3 shrink-0 text-fg-faint" aria-label="Has notes" />}
              {overlaps && <AlertTriangle data-tone="danger" className="tone-text h-3.5 w-3.5 shrink-0" aria-label="Overlaps another block" />}
              {isActive && <span className="shrink-0 text-micro font-semibold text-accent-600">now</span>}
            </p>
            {isSelected && taskNotes && (
              <p className="mt-0.5 line-clamp-2 text-meta text-fg-muted">{taskNotes}</p>
            )}
          </div>
          {!isCal && (
            <div className="flex shrink-0 items-center gap-1" onClick={e => e.stopPropagation()}>
              {isSelected && block.kind === 'block' && !block.spillover && block.startHour >= 0 && (
                <button type="button" onClick={postpone30m} className={quickBtn}>+30m</button>
              )}
              {isSelected && block.kind === 'block' && !block.spillover && (
                <button type="button" onClick={postpone1d} className={quickBtn}>+1d</button>
              )}
              {isSelected && (
                <button
                  type="button"
                  aria-label="Delete block"
                  onClick={() => {
                    if (isRecurring) deleteScheduleBlock.mutate(block.canonicalId)
                    else deleteBlock.mutate({ id: block.canonicalId, dateStr: block.dateStr })
                    setSelectedId(null)
                  }}
                  className={cx(quickBtn, 'hover:text-danger')}
                ><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              )}
              <button
                type="button"
                onClick={() => setSelectedId(isSelected ? null : block.id)}
                aria-label={isSelected ? 'Hide quick actions' : 'Quick actions'}
                aria-expanded={isSelected}
                className="grid min-h-[44px] w-[32px] place-items-center rounded-control text-fg-faint hover:bg-surface-hover hover:text-fg"
              ><MoreHorizontal className="h-4 w-4" aria-hidden /></button>
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
      <div className="flex items-center gap-1.5 px-1" data-tone="danger">
        <span className="tone-dot !h-1.5 !w-1.5" aria-hidden />
        <span className="tone-text shrink-0 text-micro font-semibold tabular-nums">{hourToTimeStr(nowHour)}</span>
        <div className="flex-1 border-t border-danger/40" />
      </div>
    )
  }

  // Where the now-marker slots into the day list
  const nowIndex = today ? day.findIndex(b => b.startHour > nowHour) : -1
  const groupLabel = 'flex items-center gap-1.5 px-1 pt-1 section-label'

  return (
    <div className={bare ? 'p-4 sm:p-5' : 'card p-4 sm:p-5'}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="section-label">Schedule</h2>
          {nextBlock && (
            <p className="mt-0.5 truncate text-meta text-fg-muted">
              Next: <span className="font-semibold text-fg-2">{nextBlock.title}</span> at {hourToTimeStr(nextBlock.startHour)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {totalBookedMin > 0 && (
            <span className="text-meta tabular-nums text-fg-muted">{formatDurationMinutes(totalBookedMin)} planned</span>
          )}
          {calToken && (
            <IconButton label="Sync Google Calendar" onClick={handleCalRefresh} disabled={calFetching}>
              <RefreshCw className={cx(calFetching && 'animate-spin')} />
            </IconButton>
          )}
          <Button variant="primary" size="sm" icon={<Plus />} onClick={() => openAdd()}>Add</Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {allDayEvents.map(b => <div key={b.id}>{renderRow(b)}</div>)}

        {/* Anything before 06:00 is the night, not the morning */}
        {night.length > 0 && (
          <>
            <p className={groupLabel}><Moon className="h-3 w-3" aria-hidden /> Night</p>
            {night.map(b => <div key={b.id}>{renderRow(b)}</div>)}
            <div className="my-0.5 border-t border-line" />
          </>
        )}

        {day.map((b, i) => (
          <div key={b.id} className="flex flex-col gap-1.5">
            {today && nowIndex === i && renderNowMarker()}
            {renderRow(b)}
          </div>
        ))}
        {today && nowIndex === -1 && day.length > 0 && nowHour > day[day.length - 1].endHour && renderNowMarker()}

        {unscheduled.length > 0 && (
          <>
            <p className={groupLabel}>No time set</p>
            {unscheduled.map(b => <div key={b.id}>{renderRow(b)}</div>)}
          </>
        )}

        {/* Empty day — quick-add chips instead of a giant empty grid */}
        {timed.length === 0 && unscheduled.length === 0 && allDayEvents.length === 0 && (
          <div className="py-5 text-center">
            <p className="mb-2.5 text-body text-fg-muted">Nothing scheduled</p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {[['Morning', '09:00'], ['Afternoon', '13:00'], ['Evening', '19:00']].map(([label, t]) => (
                <button key={t} type="button" onClick={() => openAdd(t)} className="chip min-h-[44px]">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {label} <span className="tabular-nums text-fg-muted">{t}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {editEvent && <EditCalendarEventModal event={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
  )
}
