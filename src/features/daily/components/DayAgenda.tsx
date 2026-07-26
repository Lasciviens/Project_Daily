import { useState } from 'react'
import { format, getDay, isToday } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useScheduleBlocks, useTimeBlocks, useDeleteTimeBlock, useUpdateTimeBlock } from '../hooks/useSchedule'
import { useUpdateTask } from '../../todo/hooks/useTodos'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { EditCalendarEventModal } from '../../calendar/components/EditCalendarEventModal'
import { supabase } from '../../../integrations/supabase/client'
import { useCalendarStore, toast } from '../../../app/store'
import { formatDurationMinutes } from '../../../shared/utils/formatDuration'
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
  title:          string
  startHour:      number
  endHour:        number
  edgeClass:      string
  recurring:      boolean
  deletable:      boolean
  dateStr:        string
  sourceType?:    string | null
  sourceId?:      string | null
  calendarEvent?: CalendarEvent
  allDay?:        boolean
}

// `bare` — render as a chrome-less pane inside a parent surface (Daily's hero
// panel provides the card); default keeps the own-card look (Month tab).
export function DayAgenda({ date, bare = false }: { date: Date; bare?: boolean }) {
  const dateStr   = format(date, 'yyyy-MM-dd')
  const dayOfWeek = getDay(date)

  const [modal,      setModal]      = useState(false)
  const [clickTime,  setClickTime]  = useState<string | undefined>(undefined)
  const [editEvent,  setEditEvent]  = useState<CalendarEvent | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editTitle,  setEditTitle]  = useState('')

  const { data: schedBlocks = [] } = useScheduleBlocks()
  const { data: timeBlocks  = [] } = useTimeBlocks(dateStr)
  const { data: calEvents, isFetching: calFetching } = useCalendarEventsForDay(dateStr)
  const deleteBlock = useDeleteTimeBlock()
  const updateBlock = useUpdateTimeBlock()
  const updateTask  = useUpdateTask()
  const qc          = useQueryClient()
  const calToken    = useCalendarStore(s => s.accessToken)

  async function handleCalRefresh() {
    const tid = toast.loading('Syncing calendar…')
    try {
      await qc.refetchQueries({ queryKey: ['calendar', 'day', dateStr] })
      toast.dismiss(tid); toast.success('Calendar synced ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Sync failed')
    }
  }

  const taskSourceIds = timeBlocks
    .filter(b => b.source_type === 'task' && b.source_id)
    .map(b => b.source_id!)
  const { data: linkedTaskNotes = [] } = useQuery({
    queryKey: ['tasks', 'notes', dateStr, taskSourceIds.join(',')],
    queryFn:  async () => {
      const { data } = await supabase.from('tasks').select('id, description').in('id', taskSourceIds)
      return data ?? []
    },
    enabled:   taskSourceIds.length > 0,
    staleTime: 5 * 60_000,
  })
  const taskNotesMap = new Map(linkedTaskNotes.map(t => [t.id, t.description as string | null]))

  // ── Assemble the unified block list (same sources as the old timeline) ──
  const blocks: AgendaBlock[] = []
  for (const b of schedBlocks) {
    if (!b.days_of_week.includes(dayOfWeek)) continue
    blocks.push({
      id: b.id, title: b.title, dateStr, recurring: true, deletable: false,
      startHour: timeStrToHour(b.start_time), endHour: timeStrToHour(b.end_time),
      edgeClass: COLOR_EDGE[b.color] ?? COLOR_EDGE.blue,
    })
  }
  for (const b of timeBlocks) {
    // NULL start_time exists in real data (a plan saved without a time) —
    // shown in its own "unscheduled" group instead of being dropped.
    const start = b.start_time ? timeStrToHour(b.start_time) : null
    blocks.push({
      id: b.id, title: b.title, dateStr, recurring: false, deletable: true,
      startHour: start ?? -1, endHour: start != null ? start + b.duration_minutes / 60 : -1,
      edgeClass: COLOR_EDGE[b.color] ?? COLOR_EDGE.accent,
      sourceType: b.source_type, sourceId: b.source_id,
    })
  }
  for (const e of calEvents ?? []) {
    if (e.start.dateTime) {
      const s = new Date(e.start.dateTime)
      const en = new Date(e.end.dateTime ?? e.start.dateTime)
      blocks.push({
        id: e.id, title: e.summary ?? '(no title)', dateStr, recurring: false, deletable: false,
        startHour: s.getHours() + s.getMinutes() / 60, endHour: en.getHours() + en.getMinutes() / 60,
        edgeClass: COLOR_EDGE.green, calendarEvent: e,
      })
    } else if (e.start.date) {
      blocks.push({
        id: e.id, title: e.summary ?? '(no title)', dateStr, recurring: false, deletable: false,
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

  // ── Row renderer (plain render function, not a nested component —
  //     react-hooks/static-components: components created during render get a
  //     new identity every render and remount their subtree) ──
  function renderRow(block: AgendaBlock) {
    const isSelected = selectedId === block.id
    const isEditing  = editingId === block.id
    const isCal      = !!block.calendarEvent
    const durationMins = Math.round((block.endHour - block.startHour) * 60)
    const taskNotes  = block.sourceType === 'task' && block.sourceId ? taskNotesMap.get(block.sourceId) : null
    const isPast     = today && block.endHour <= nowHour
    const isActive   = today && block.startHour <= nowHour && block.endHour > nowHour

    function saveEdit() {
      const trimmed = editTitle.trim()
      if (trimmed && trimmed !== block.title) {
        updateBlock.mutate({ id: block.id, title: trimmed, dateStr: block.dateStr })
      }
      setEditingId(null)
    }
    function postpone30m() {
      updateBlock.mutate({ id: block.id, start_time: `${hourToTimeStr(Math.min(23.5, block.startHour + 0.5))}:00`, dateStr: block.dateStr })
    }
    function postpone1d() {
      const d = new Date(block.dateStr + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      const newDate = format(d, 'yyyy-MM-dd')
      updateBlock.mutate({ id: block.id, date: newDate, dateStr: block.dateStr, newDateStr: newDate })
      if (block.sourceType === 'task' && block.sourceId) {
        const dow = d.getDay()
        const section = dow === 0 || dow === 6 ? 'this_week'
          : newDate === format(new Date(), 'yyyy-MM-dd') ? 'today' : 'tomorrow'
        updateTask.mutate(
          { id: block.sourceId, patch: { due_date: newDate, section } },
          { onError: e => toast.error(`Block moved but its task's date didn't update: ${(e as Error).message}`) }
        )
      }
      setSelectedId(null)
    }

    return (
      <div
        onClick={() => isCal ? setEditEvent(block.calendarEvent!) : setSelectedId(isSelected ? null : block.id)}
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
                <span className="text-ink-500">–{hourToTimeStr(block.endHour)}</span>
                <span className="block text-[10px] text-ink-500">{formatDurationMinutes(durationMins)}</span>
              </>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                onClick={e => e.stopPropagation()}
                className="w-full bg-cream-100 text-xs font-semibold rounded px-1 py-0.5 outline-none"
              />
            ) : (
              <p className="text-xs font-semibold text-ink-800 truncate leading-snug">
                {block.title}
                {block.recurring && <span className="ml-1.5 text-[9px] font-normal text-ink-500" title="Recurring">⟳</span>}
                {isCal && <span className="ml-1.5 text-[9px] font-normal text-green-600" title="Google Calendar">◈</span>}
                {taskNotes && <span className="ml-1 text-[9px] opacity-40">📝</span>}
                {overlappingIds.has(block.id) && <span className="ml-1 text-[10px] text-red-500" title="Overlaps another block">⚠</span>}
                {isActive && <span className="ml-1.5 text-[9px] font-medium text-accent-600">now</span>}
              </p>
            )}
            {isSelected && taskNotes && (
              <p className="text-[10px] text-ink-500 mt-0.5 line-clamp-2">{taskNotes}</p>
            )}
          </div>
          {isSelected && block.deletable && !isEditing && (
            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
              {block.startHour >= 0 && (
                <button onClick={postpone30m} className="text-[10px] px-2 min-h-[44px] rounded border border-ink-200 text-ink-500 hover:border-accent-300">+30m</button>
              )}
              <button onClick={postpone1d} className="text-[10px] px-2 min-h-[44px] rounded border border-ink-200 text-ink-500 hover:border-accent-300">+1d</button>
              <button onClick={() => { setEditingId(block.id); setEditTitle(block.title) }} className="text-[10px] px-2 min-h-[44px] rounded border border-ink-200 text-ink-500 hover:border-accent-300">✎</button>
              <button onClick={() => { deleteBlock.mutate({ id: block.id, dateStr: block.dateStr }); setSelectedId(null) }} className="text-[10px] px-2 min-h-[44px] rounded border border-ink-200 text-ink-500 hover:text-red-500 hover:border-red-300">✕</button>
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

      <UnifiedPlanModal
        open={modal}
        onClose={() => { setModal(false); setClickTime(undefined) }}
        config={{ tabs: ['schedule', 'task'], heading: 'Add time block' }}
        defaults={{ date: dateStr, startTime: clickTime, category: 'daily' }}
      />
      {editEvent && <EditCalendarEventModal mode="edit" event={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
  )
}
