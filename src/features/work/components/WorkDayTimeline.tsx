import { useTimeBlocks } from '../../daily/hooks/useSchedule'
import { format } from 'date-fns'
import type { Task } from '../../todo/types'

interface Props {
  workTasks: Task[]
}

const HOUR_START = 7
const HOUR_END   = 18
const TOTAL_MINS = (HOUR_END - HOUR_START) * 60

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

function leftPct(mins: number): string {
  return `${Math.max(0, Math.min(100, ((mins - HOUR_START * 60) / TOTAL_MINS) * 100)).toFixed(3)}%`
}

function widthPct(start: number, end: number): string {
  const clamped = Math.min(end, HOUR_END * 60) - Math.max(start, HOUR_START * 60)
  return `${Math.max(1, (clamped / TOTAL_MINS) * 100).toFixed(3)}%`
}

const HOUR_LABELS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)

const COLOR_MAP: Record<string, string> = {
  blue: '#3B82F6', green: '#22C55E', red: '#EF4444', purple: '#A855F7',
  orange: '#F97316', pink: '#EC4899', sky: '#0EA5E9', teal: '#14B8A6',
  accent: '#F59E0B',
}

function resolveColor(color: string): string {
  if (color?.startsWith('#')) return color
  return COLOR_MAP[color] ?? '#94A3B8'
}

export default function WorkDayTimeline({ workTasks }: Props) {
  const today   = format(new Date(), 'yyyy-MM-dd')
  const now     = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()

  const workTaskIds = new Set(workTasks.map(t => t.id))

  // Shared hook (key ['schedule','day',today]) so schedule mutations elsewhere
  // refresh this timeline too — previously it used its own ['time-blocks',today]
  // key that nothing invalidated, leaving it stale until reload.
  const { data: allBlocks = [] } = useTimeBlocks(today)

  // Only show blocks linked to work tasks or manual/calendar
  const blocks = allBlocks.filter(b =>
    !b.source_type ||
    b.source_type === 'manual' ||
    b.source_type === 'calendar' ||
    (b.source_type === 'task' && b.source_id && workTaskIds.has(b.source_id))
  )

  const timedBlocks = blocks.filter(b => b.start_time)
  const displayLabels = HOUR_LABELS.filter((h, i) => i % 2 === 0 || h === HOUR_END)

  // Now / Next — the current block (if any) and the next upcoming one.
  const current = timedBlocks.find(b => {
    const start = timeToMins(b.start_time!)
    return nowMins >= start && nowMins < start + (b.duration_minutes || 30)
  })
  const next = timedBlocks
    .filter(b => timeToMins(b.start_time!) > nowMins)
    .sort((a, b) => timeToMins(a.start_time!) - timeToMins(b.start_time!))[0]

  function endTime(b: { start_time: string | null; duration_minutes: number }): string {
    const end = timeToMins(b.start_time!) + (b.duration_minutes || 30)
    return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 w-full">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
          Today's Schedule
        </p>
        <div className="flex items-center gap-3 text-[11px] min-w-0">
          {current && (
            <span className="text-ink-700 truncate">
              <span className="font-semibold text-emerald-600">Now:</span> {current.title}
              <span className="text-ink-400"> · until {endTime(current)}</span>
            </span>
          )}
          {next && (
            <span className="text-ink-500 truncate">
              <span className="font-semibold text-ink-400">Next:</span> {next.title}
              <span className="text-ink-400"> @ {next.start_time!.slice(0, 5)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Timeline bar — overflow visible so now-marker dot isn't clipped */}
      <div className="relative h-12 bg-ink-50 rounded-lg w-full" style={{ overflow: 'visible' }}>
        {/* Clipped inner for the bar background */}
        <div className="absolute inset-0 rounded-lg overflow-hidden bg-ink-50">
          {/* Hour grid lines */}
          {HOUR_LABELS.map(h => (
            <div
              key={h}
              className="absolute top-0 bottom-0 border-l border-ink-200/60"
              style={{ left: leftPct(h * 60) }}
            />
          ))}

          {/* Time blocks */}
          {timedBlocks.map(block => {
            const startMins = timeToMins(block.start_time!)
            const dur       = block.duration_minutes || 30
            const endMins   = startMins + dur
            if (endMins < HOUR_START * 60 || startMins > HOUR_END * 60) return null
            return (
              <div
                key={block.id}
                title={`${block.start_time?.slice(0, 5)} — ${block.title}`}
                className="absolute top-2 bottom-2 rounded text-[9px] text-white font-semibold flex items-center px-1.5 overflow-hidden"
                style={{
                  left:            leftPct(startMins),
                  width:           widthPct(startMins, endMins),
                  backgroundColor: resolveColor(block.color),
                  minWidth:        '4px',
                }}
              >
                <span className="truncate leading-none">{block.title}</span>
              </div>
            )
          })}
        </div>

        {/* Now marker — outside clipped div so dot shows above bar */}
        {nowMins >= HOUR_START * 60 && nowMins <= HOUR_END * 60 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
            style={{ left: leftPct(nowMins) }}
          >
            <div className="absolute -top-1 -translate-x-[3px] w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
          </div>
        )}
      </div>

      {/* Hour labels — first label left-aligned, last right-aligned, rest centered */}
      <div className="relative h-4 mt-1 w-full">
        {displayLabels.map(h => {
          const isFirst = h === HOUR_START
          const isLast  = h >= HOUR_END - 1
          return (
            <span
              key={h}
              className="absolute text-[9px] text-ink-400 select-none"
              style={{
                left:      leftPct(h * 60),
                transform: isFirst ? 'none' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {h}:00
            </span>
          )
        })}
      </div>

      {timedBlocks.length === 0 && (
        <p className="text-xs text-ink-300 mt-1">No work blocks scheduled today</p>
      )}
    </div>
  )
}
