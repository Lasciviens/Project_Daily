import { useState, useEffect, useRef } from 'react'
import { format, getDay, isToday } from 'date-fns'
import { useScheduleBlocks, useTimeBlocks, useDeleteTimeBlock } from '../hooks/useSchedule'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { AddTimeBlockModal } from './AddTimeBlockModal'

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

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

interface Block {
  id:         string
  title:      string
  startHour:  number
  endHour:    number
  colorClass: string
  deletable:  boolean
  dateStr:    string
}

interface Props { date: Date }

export function DayTimeline({ date }: Props) {
  const dateStr    = format(date, 'yyyy-MM-dd')
  const dayOfWeek  = getDay(date)
  const [modal, setModal] = useState(false)
  const scrollRef  = useRef<HTMLDivElement>(null)

  const { data: schedBlocks = [] }  = useScheduleBlocks()
  const { data: timeBlocks  = [] }  = useTimeBlocks(dateStr)
  const { data: calEvents   = [] }  = useCalendarEventsForDay(dateStr)
  const deleteBlock                 = useDeleteTimeBlock()

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
    })
  }

  // Google Calendar events
  for (const e of calEvents) {
    if (e.start.dateTime) {
      // Timed event
      const s  = new Date(e.start.dateTime)
      const en = new Date(e.end.dateTime ?? e.start.dateTime)
      blocks.push({
        id: e.id, title: e.summary ?? '(no title)', dateStr,
        startHour:  s.getHours() + s.getMinutes() / 60,
        endHour:    en.getHours() + en.getMinutes() / 60,
        colorClass: COLOR.green,
        deletable:  false,
      })
    } else if (e.start.date) {
      // All-day event — show as full bar at top of visible range
      blocks.push({
        id: e.id, title: `◈ ${e.summary ?? '(no title)'}`, dateStr,
        startHour:  HOUR_START,
        endHour:    HOUR_START + 0.5,
        colorClass: COLOR.green,
        deletable:  false,
      })
    }
  }

  const visibleBlocks = blocks.filter(b => b.startHour < HOUR_END && b.endHour > HOUR_START)

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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Day Schedule</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 bg-ink-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${fullness > 80 ? 'bg-red-400' : 'bg-accent-400'}`}
                style={{ width: `${fullness}%` }}
              />
            </div>
            <span className="text-xs text-ink-500">{fullness}% booked</span>
          </div>
          <button
            onClick={() => setModal(true)}
            className="bg-accent-50 text-accent-600 hover:bg-accent-100 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-150"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Timeline — scrollable, shows ~8h at a time */}
      <div ref={scrollRef} className="overflow-y-auto max-h-[520px]">
        <div className="relative" style={{ height: `${(HOUR_END - HOUR_START) * HOUR_PX}px` }}>
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

          {/* Blocks */}
          {visibleBlocks.map(block => {
            const clampedStart = Math.max(block.startHour, HOUR_START)
            const clampedEnd   = Math.min(block.endHour, HOUR_END)
            const topPx    = (clampedStart - HOUR_START) * HOUR_PX
            const heightPx = Math.max((clampedEnd - clampedStart) * HOUR_PX, 20)
            const durationMins = Math.round((block.endHour - block.startHour) * 60)

            return (
              <div
                key={block.id}
                className={`absolute left-11 right-1 rounded-lg border px-2 py-1 overflow-hidden group ${block.colorClass}`}
                style={{ top: `${topPx}px`, height: `${heightPx}px` }}
              >
                <p className="text-[11px] font-semibold leading-tight truncate">{block.title}</p>
                {heightPx >= 32 && (
                  <p className="text-[10px] opacity-60">{formatDuration(durationMins)}</p>
                )}
                {block.deletable && (
                  <button
                    onClick={() => deleteBlock.mutate({ id: block.id, dateStr: block.dateStr })}
                    className="absolute top-1 right-1 text-[10px] opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
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

      {modal && <AddTimeBlockModal dateStr={dateStr} onClose={() => setModal(false)} />}
    </div>
  )
}
