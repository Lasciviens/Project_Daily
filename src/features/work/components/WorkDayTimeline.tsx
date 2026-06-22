import { useQuery } from '@tanstack/react-query'
import { fetchTimeBlocks } from '../../daily/api/scheduleApi'
import { format } from 'date-fns'

const HOUR_START = 7
const HOUR_END   = 18
const TOTAL_MINS = (HOUR_END - HOUR_START) * 60

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function pct(mins: number): string {
  return `${Math.max(0, Math.min(100, ((mins - HOUR_START * 60) / TOTAL_MINS) * 100)).toFixed(2)}%`
}

const HOUR_LABELS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)

const COLOR_MAP: Record<string, string> = {
  blue:   '#3B82F6',
  green:  '#22C55E',
  red:    '#EF4444',
  purple: '#A855F7',
  orange: '#F97316',
  pink:   '#EC4899',
  sky:    '#0EA5E9',
  teal:   '#14B8A6',
}

function resolveColor(color: string): string {
  if (color.startsWith('#')) return color
  return COLOR_MAP[color] ?? '#94A3B8'
}

export default function WorkDayTimeline() {
  const today   = format(new Date(), 'yyyy-MM-dd')
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes()

  const { data: blocks = [] } = useQuery({
    queryKey: ['time-blocks', today],
    queryFn:  () => fetchTimeBlocks(today),
    staleTime: 5 * 60_000,
  })

  const timed = blocks.filter(b => b.start_time)

  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400 mb-3">Today's Schedule</p>

      {/* Timeline bar */}
      <div className="relative h-8 bg-ink-50 rounded-lg overflow-hidden">
        {/* Hour tick marks */}
        {HOUR_LABELS.map(h => (
          <div
            key={h}
            className="absolute top-0 bottom-0 border-l border-ink-200"
            style={{ left: pct((h - HOUR_START) * 60) }}
          />
        ))}

        {/* Blocks */}
        {timed.map(block => {
          const startMins = timeToMins(block.start_time!)
          const dur       = block.duration_minutes || 30
          const endMins   = startMins + dur
          if (endMins < HOUR_START * 60 || startMins > HOUR_END * 60) return null
          const bg = resolveColor(block.color)
          return (
            <div
              key={block.id}
              title={block.title}
              className="absolute top-1 bottom-1 rounded text-[9px] text-white font-medium flex items-center px-1 overflow-hidden"
              style={{
                left:            pct(startMins),
                width:           pct(Math.min(endMins, HOUR_END * 60) - Math.max(startMins, HOUR_START * 60)),
                backgroundColor: bg,
              }}
            >
              <span className="truncate">{block.title}</span>
            </div>
          )
        })}

        {/* Now marker */}
        {nowMins >= HOUR_START * 60 && nowMins <= HOUR_END * 60 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500 z-10"
            style={{ left: pct(nowMins) }}
          >
            <div className="w-2 h-2 rounded-full bg-red-500 -translate-x-[3px] -translate-y-0" />
          </div>
        )}
      </div>

      {/* Hour labels */}
      <div className="relative h-4 mt-0.5">
        {HOUR_LABELS.filter((_, i) => i % 2 === 0).map(h => (
          <span
            key={h}
            className="absolute text-[9px] text-ink-300 -translate-x-1/2"
            style={{ left: pct((h - HOUR_START) * 60) }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Block list */}
      {timed.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {timed.map(block => (
            <span
              key={block.id}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: resolveColor(block.color) }}
            >
              {block.start_time?.slice(0, 5)} {block.title}
            </span>
          ))}
        </div>
      )}

      {timed.length === 0 && (
        <p className="text-xs text-ink-300 mt-1">No time blocks scheduled today</p>
      )}
    </div>
  )
}
