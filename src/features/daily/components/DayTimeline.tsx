import { useState, useEffect, useRef, useCallback } from 'react'
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

const HOUR_START = 0
const HOUR_END   = 24
const HOUR_PX    = 52

const COLOR: Record<string, string> = {
  blue:   'bg-blue-100 border-blue-300 text-blue-800',
  green:  'bg-green-100 border-green-300 text-green-800',
  orange: 'bg-orange-100 border-orange-300 text-orange-800',
  purple: 'bg-purple-100 border-purple-300 text-purple-800',
  accent: 'bg-accent-100 border-accent-300 text-accent-700',
  red:    'bg-red-100 border-red-300 text-red-800',
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

interface Block {
  id:              string
  title:           string
  startHour:       number
  endHour:         number
  colorClass:      string
  deletable:       boolean
  dateStr:         string
  sourceType?:     string | null
  sourceId?:       string | null
  calendarEvent?:  CalendarEvent
}

interface DragState { id: string; offsetY: number; dateStr: string }
interface Props { date: Date }

export function DayTimeline({ date }: Props) {
  const dateStr    = format(date, 'yyyy-MM-dd')
  const dayOfWeek  = getDay(date)
  const [modal,      setModal]      = useState(false)
  const [clickTime,  setClickTime]  = useState<string | undefined>(undefined)
  const [hoverY,     setHoverY]     = useState<number | null>(null)
  const [editEvent,  setEditEvent]  = useState<CalendarEvent | null>(null)
  const [dragging,   setDragging]   = useState<DragState | null>(null)
  const [dragY,      setDragY]      = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editTitle,  setEditTitle]  = useState('')
  const scrollRef    = useRef<HTMLDivElement>(null)
  const timelineRef  = useRef<HTMLDivElement>(null)

  function openModalAt(y: number) {
    const rawHour = HOUR_START + y / HOUR_PX
    const snapped = Math.floor(rawHour * 2) / 2  // snap to 30-min slots
    const clamped = Math.max(HOUR_START, Math.min(HOUR_END - 0.5, snapped))
    setClickTime(hourToTimeStr(clamped))
    setModal(true)
  }

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-block]')) return
    const rect = timelineRef.current!.getBoundingClientRect()
    openModalAt(e.clientY - rect.top)
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = timelineRef.current!.getBoundingClientRect()
    setHoverY(e.clientY - rect.top)
  }

  const { data: schedBlocks = [] }  = useScheduleBlocks()
  const { data: timeBlocks  = [] }  = useTimeBlocks(dateStr)
  const { data: calEvents, isFetching: calFetching } = useCalendarEventsForDay(dateStr)
  const calEventList                = calEvents ?? []
  const deleteBlock                 = useDeleteTimeBlock()
  const updateBlock                 = useUpdateTimeBlock()
  const updateTask                  = useUpdateTask()
  const qc                          = useQueryClient()
  const calToken                    = useCalendarStore(s => s.accessToken)

  async function handleCalRefresh() {
    const tid = toast.loading('Syncing calendar…')
    try {
      await qc.refetchQueries({ queryKey: ['calendar', 'day', dateStr] })
      toast.dismiss(tid); toast.success('Calendar synced ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Sync failed')
    }
  }

  // One batch query to get notes for all task-linked blocks
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

  const handleBlockMouseDown = useCallback((e: React.MouseEvent, blockId: string, topPx: number) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = timelineRef.current!.getBoundingClientRect()
    const offsetY = (e.clientY - rect.top) - topPx
    setDragging({ id: blockId, offsetY, dateStr })
    setDragY(e.clientY - rect.top)
  }, [dateStr])

  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect) return
      setDragY(e.clientY - rect.top)
    }
    function onUp(e: MouseEvent) {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (rect && dragging) {
        const rawHour = HOUR_START + (e.clientY - rect.top - dragging.offsetY) / HOUR_PX
        const snapped = Math.floor(rawHour * 2) / 2
        const clamped = Math.max(HOUR_START, Math.min(HOUR_END - 0.5, snapped))
        updateBlock.mutate({ id: dragging.id, start_time: `${hourToTimeStr(clamped)}:00`, dateStr: dragging.dateStr })
      }
      setDragging(null)
      setDragY(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging, updateBlock])

  // Build unified block list
  const blocks: Block[] = []

  // Recurring schedule blocks (apply only on matching day)
  for (const b of schedBlocks) {
    if (!b.days_of_week.includes(dayOfWeek)) continue
    blocks.push({
      id: b.id, title: b.title, dateStr,
      startHour:  timeStrToHour(b.start_time),
      endHour:    timeStrToHour(b.end_time),
      colorClass: COLOR[b.color] ?? COLOR.blue,
      deletable:  false,
    })
  }

  // One-off time blocks
  for (const b of timeBlocks) {
    if (!b.start_time) continue
    const start = timeStrToHour(b.start_time)
    blocks.push({
      id: b.id, title: b.title, dateStr,
      startHour:  start,
      endHour:    start + b.duration_minutes / 60,
      colorClass: COLOR[b.color] ?? COLOR.accent,
      deletable:  true,
      sourceType: b.source_type,
      sourceId:   b.source_id,
    })
  }

  // Google Calendar events
  for (const e of calEventList) {
    if (e.start.dateTime) {
      // Timed event — editable
      const s  = new Date(e.start.dateTime)
      const en = new Date(e.end.dateTime ?? e.start.dateTime)
      blocks.push({
        id: e.id, title: e.summary ?? '(no title)', dateStr,
        startHour:    s.getHours() + s.getMinutes() / 60,
        endHour:      en.getHours() + en.getMinutes() / 60,
        colorClass:   COLOR.green,
        deletable:    false,
        calendarEvent: e,
      })
    } else if (e.start.date) {
      // All-day event — show as full bar at top of visible range
      blocks.push({
        id: e.id, title: `◈ ${e.summary ?? '(no title)'}`, dateStr,
        startHour:    HOUR_START,
        endHour:      HOUR_START + 0.5,
        colorClass:   COLOR.green,
        deletable:    false,
        calendarEvent: e,
      })
    }
  }

  const visibleBlocks = blocks.filter(b => b.startHour < HOUR_END && b.endHour > HOUR_START)

  // Overlap detection: mark blocks that conflict with another
  const overlappingIds = new Set<string>()
  for (let i = 0; i < visibleBlocks.length; i++) {
    for (let j = i + 1; j < visibleBlocks.length; j++) {
      const a = visibleBlocks[i], b = visibleBlocks[j]
      if (a.startHour < b.endHour && a.endHour > b.startHour) {
        overlappingIds.add(a.id)
        overlappingIds.add(b.id)
      }
    }
  }

  // Fullness: total booked hours / available hours
  const totalAvail  = HOUR_END - HOUR_START
  const totalBooked = visibleBlocks.reduce((sum, b) => {
    const start = Math.max(b.startHour, HOUR_START)
    const end   = Math.min(b.endHour, HOUR_END)
    return sum + Math.max(0, end - start)
  }, 0)
  const fullness = Math.min(100, Math.round((totalBooked / totalAvail) * 100))

  // Current time
  const now = new Date()
  const nowHour = now.getHours() + now.getMinutes() / 60
  const showNow = isToday(date) && nowHour >= HOUR_START && nowHour < HOUR_END

  // Next upcoming block today
  const nextBlock = isToday(date)
    ? visibleBlocks
        .filter(b => b.startHour > nowHour)
        .sort((a, b) => a.startHour - b.startHour)[0]
    : undefined
  const nextBlockMinutes = nextBlock ? Math.round((nextBlock.startHour - nowHour) * 60) : 0

  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

  // Scroll to current time (or 7am if not today) on mount
  useEffect(() => {
    if (!scrollRef.current) return
    const targetHour = isToday(date) ? nowHour : 7
    const targetPx   = (targetHour - HOUR_START) * HOUR_PX
    scrollRef.current.scrollTop = Math.max(0, targetPx - scrollRef.current.clientHeight * 0.25)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr])

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Day Schedule</h2>
          {nextBlock && nextBlockMinutes <= 120 && (
            <p className="text-[10px] text-accent-600 mt-0.5 truncate">
              Next: <span className="font-semibold">{nextBlock.title}</span> at {hourToTimeStr(nextBlock.startHour)}
              {nextBlockMinutes <= 60
                ? ` (in ${nextBlockMinutes}m)`
                : ` (in ${Math.floor(nextBlockMinutes / 60)}h ${nextBlockMinutes % 60}m)`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-2">
            <div className="h-1.5 w-16 bg-ink-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${fullness > 80 ? 'bg-red-400' : 'bg-accent-400'}`}
                style={{ width: `${fullness}%` }}
              />
            </div>
            <span className="text-xs text-ink-500">{fullness}%</span>
          </div>
          {calToken && (
            <button
              onClick={handleCalRefresh}
              disabled={calFetching}
              title="Sync Google Calendar"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors duration-150 disabled:opacity-50 text-base font-medium"
            >
              <span className={calFetching ? 'animate-spin inline-block' : ''}>↻</span>
            </button>
          )}
          <button
            onClick={() => { setClickTime(undefined); setModal(true) }}
            className="bg-accent-500 text-white hover:bg-accent-600 min-h-[44px] px-3 rounded-full text-xs font-semibold transition-colors duration-150"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Empty state */}
      {visibleBlocks.length === 0 && (
        <p className="text-sm text-ink-300 text-center py-3 mb-2">No scheduled blocks — click + Add to get started</p>
      )}

      {/* Timeline — scrollable, shows ~8h at a time */}
      <div ref={scrollRef} className="overflow-y-auto max-h-[520px]">
        <div
          ref={timelineRef}
          className="relative cursor-crosshair"
          style={{ height: `${(HOUR_END - HOUR_START) * HOUR_PX}px` }}
          onClick={handleTimelineClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverY(null)}
        >
          {/* Hour grid lines */}
          {hours.map(h => (
            <div
              key={h}
              className="absolute left-0 right-0"
              style={{ top: `${(h - HOUR_START) * HOUR_PX}px` }}
            >
              <div className="flex items-start">
                <span className="text-[10px] text-ink-400 w-10 -mt-[7px] select-none flex-shrink-0">
                  {String(h).padStart(2, '0')}:00
                </span>
                <div className="flex-1 border-t border-ink-100" />
              </div>
            </div>
          ))}

          {/* Half-hour ticks */}
          {hours.map(h => (
            <div
              key={`${h}h`}
              className="absolute right-0"
              style={{ top: `${(h - HOUR_START) * HOUR_PX + HOUR_PX / 2}px`, left: '40px' }}
            >
              <div className="border-t border-dashed border-ink-50" />
            </div>
          ))}

          {/* Hover time indicator */}
          {hoverY !== null && (
            <div
              className="absolute flex items-center pointer-events-none z-10"
              style={{ top: `${hoverY}px`, left: 0, right: 0 }}
            >
              <span className="text-[9px] text-accent-500 w-10 text-right pr-1.5 select-none">
                {hourToTimeStr(Math.max(HOUR_START, Math.min(HOUR_END, HOUR_START + hoverY / HOUR_PX)))}
              </span>
              <div className="flex-1 border-t border-dashed border-accent-300 opacity-60" />
            </div>
          )}

          {/* Blocks */}
          {visibleBlocks.map(block => {
            const clampedStart = Math.max(block.startHour, HOUR_START)
            const clampedEnd   = Math.min(block.endHour, HOUR_END)
            const baseTopPx = (clampedStart - HOUR_START) * HOUR_PX
            const isDraggingThis = dragging?.id === block.id
            const isSelected = selectedId === block.id
            const topPx = isDraggingThis && dragY !== null
              ? Math.max(0, dragY - dragging!.offsetY)
              : baseTopPx
            const heightPx = Math.max((clampedEnd - clampedStart) * HOUR_PX, isSelected ? 56 : 20)
            const durationMins = Math.round((block.endHour - block.startHour) * 60)
            const isCalEvent = !!block.calendarEvent
            const dragHour = isDraggingThis && dragY !== null
              ? Math.max(HOUR_START, Math.min(HOUR_END - 0.5, Math.floor((HOUR_START + (dragY - dragging!.offsetY) / HOUR_PX) * 2) / 2))
              : null

            function postpone30m() {
              const newHour = Math.min(HOUR_END - 0.5, block.startHour + 0.5)
              const newTime = `${hourToTimeStr(newHour)}:00`
              updateBlock.mutate({ id: block.id, start_time: newTime, dateStr: block.dateStr })
            }

            function postpone1d() {
              const d = new Date(block.dateStr + 'T00:00:00')
              d.setDate(d.getDate() + 1)
              const newDate = format(d, 'yyyy-MM-dd')
              updateBlock.mutate({ id: block.id, date: newDate, dateStr: block.dateStr, newDateStr: newDate })
              // Keep linked task in sync
              if (block.sourceType === 'task' && block.sourceId) {
                const dow  = d.getDay()
                const section = dow === 0 || dow === 6 ? 'this_week'
                  : newDate === format(new Date(), 'yyyy-MM-dd') ? 'today'
                  : 'tomorrow'
                updateTask.mutate({ id: block.sourceId, patch: { due_date: newDate, section } })
              }
              setSelectedId(null)
            }

            const isEditing   = editingId === block.id
            const isOverlap   = overlappingIds.has(block.id)
            const taskNotes   = block.sourceType === 'task' && block.sourceId
              ? taskNotesMap.get(block.sourceId) ?? null
              : null

            function startEdit(e: React.MouseEvent) {
              e.stopPropagation()
              setEditingId(block.id)
              setEditTitle(block.title)
              setSelectedId(null)
            }

            function saveEdit() {
              const trimmed = editTitle.trim()
              if (trimmed && trimmed !== block.title) {
                updateBlock.mutate({ id: block.id, title: trimmed, dateStr: block.dateStr })
              }
              setEditingId(null)
            }

            return (
              <div
                key={block.id}
                data-block="true"
                onClick={isCalEvent
                  ? (e) => { e.stopPropagation(); setEditEvent(block.calendarEvent!) }
                  : isEditing
                    ? (e) => e.stopPropagation()
                    : (e) => { e.stopPropagation(); setSelectedId(isSelected ? null : block.id) }}
                onMouseDown={block.deletable && !isSelected && !isEditing ? (e) => handleBlockMouseDown(e, block.id, baseTopPx) : undefined}
                className={`absolute left-11 right-1 rounded-lg border px-2 py-1 group ${isSelected ? 'overflow-visible z-30 shadow-lg' : 'overflow-hidden'} ${block.colorClass} ${isCalEvent ? 'cursor-pointer hover:brightness-95' : block.deletable ? 'cursor-pointer' : 'cursor-default'} ${isDraggingThis ? 'opacity-80 shadow-lg z-20' : ''} ${isSelected ? 'ring-2 ring-accent-400' : ''} ${isOverlap && !isSelected ? 'ring-1 ring-red-400' : ''}`}
                style={isSelected ? { top: `${topPx}px`, minHeight: `${heightPx}px` } : { top: `${topPx}px`, height: `${heightPx}px` }}
              >
                {block.deletable && !isSelected && !isEditing && (
                  <span className="absolute top-1 left-1 text-[10px] opacity-0 group-hover:opacity-40 transition-opacity select-none">⠿</span>
                )}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    className="w-full bg-white/80 text-[11px] font-semibold rounded px-1 py-0.5 outline-none text-inherit"
                  />
                ) : (
                  <p className="text-[11px] font-semibold leading-tight truncate pl-3">
                    {block.title}
                    {taskNotes && !isSelected && <span className="opacity-40 ml-1 text-[9px]">📝</span>}
                  </p>
                )}
                {heightPx >= 28 && !isEditing && (
                  <p className="text-[10px] opacity-60 pl-3">
                    {isDraggingThis && dragHour !== null ? hourToTimeStr(dragHour) : hourToTimeStr(block.startHour)} – {hourToTimeStr(block.endHour)}
                    {durationMins >= 30 ? ` · ${formatDurationMinutes(durationMins)}` : ''}
                    {isOverlap && <span className="ml-1 text-red-500">⚠</span>}
                  </p>
                )}
                {isSelected && taskNotes && (
                  <p className="text-[10px] opacity-60 pl-3 mt-0.5 pr-2 line-clamp-2">{taskNotes}</p>
                )}
                {isSelected && block.deletable && (
                  <div className="flex items-center gap-1 mt-1 pl-3" onClick={e => e.stopPropagation()}>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => postpone30m()}
                      className="text-[10px] px-1.5 min-h-[44px] rounded bg-white/90 hover:bg-white border border-current"
                    >+30m</button>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => postpone1d()}
                      className="text-[10px] px-1.5 min-h-[44px] rounded bg-white/90 hover:bg-white border border-current"
                    >+1d</button>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={startEdit}
                      className="text-[10px] px-1.5 min-h-[44px] rounded bg-white/90 hover:bg-white border border-current"
                      title="Edit title"
                    >✎</button>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => { deleteBlock.mutate({ id: block.id, dateStr: block.dateStr }); setSelectedId(null) }}
                      className="text-[10px] px-1.5 min-h-[44px] rounded bg-white/70 hover:bg-white border border-current opacity-70 hover:opacity-100 ml-auto mr-1"
                    >✕</button>
                  </div>
                )}
                {isCalEvent && !isSelected && (
                  <span className="absolute top-1 right-1.5 text-[10px] opacity-0 group-hover:opacity-50 transition-opacity">
                    ✎
                  </span>
                )}
                {block.deletable && !isSelected && !isEditing && (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); deleteBlock.mutate({ id: block.id, dateStr: block.dateStr }); setSelectedId(null) }}
                    className="absolute top-1 right-1 text-[10px] opacity-60 hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}

          {/* Current time line */}
          {showNow && (
            <div
              className="absolute flex items-center pointer-events-none"
              style={{ top: `${(nowHour - HOUR_START) * HOUR_PX}px`, left: '38px', right: 0 }}
            >
              <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -ml-1" />
              <div className="flex-1 border-t-2 border-red-400" />
            </div>
          )}
        </div>
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
