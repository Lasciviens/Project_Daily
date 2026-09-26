import { format, addDays, parseISO, differenceInCalendarDays } from 'date-fns'
import { useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import type { TimeBlock } from '../../daily/types'

// Local YYYY-MM-DD (no UTC shift)
function ymd(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function relativeDay(dateStr: string): string {
  const days = differenceInCalendarDays(parseISO(dateStr), new Date())
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7)   return format(parseISO(dateStr), 'EEEE')          // e.g. Friday
  return format(parseISO(dateStr), 'EEE d MMM')                      // e.g. Mon 14 Jul
}

/**
 * Compact banner showing the next planned training session — the soonest
 * future `time_blocks` row with category='training'. Hidden when none planned.
 * Always clickable: the shared block editor opens the linked task (blocks
 * with a task_id) or, for a plain time-block-only session, the block itself.
 */
export function NextSessionBanner() {
  const modal = useEntityModal()
  const today = ymd(new Date())
  const to    = ymd(addDays(new Date(), 30))
  const { data: blocks = [] } = useTrainingBlocks(today, to)

  const nowHHMM = format(new Date(), 'HH:mm')
  const upcoming = blocks
    .filter((b: TimeBlock) => b.date > today || (b.date === today && (b.start_time ?? '99:99') >= nowHHMM))
    .sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')))

  const next = upcoming[0]
  if (!next) return null

  const time = next.start_time ? next.start_time.slice(0, 5) : null

  return (
    <button
      type="button"
      onClick={() => modal.open({ kind: 'time-block', id: next.id, config: { heading: 'Edit session' } })}
      title="Edit this session"
      className="card-interactive flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600">
        <CalendarClock className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="section-label">Next session</p>
        <p className="truncate text-body font-semibold text-fg">{next.title}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-body font-bold text-fg">{relativeDay(next.date)}</p>
        {time && <p className="text-meta tabular-nums text-fg-muted">{time}</p>}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
    </button>
  )
}
