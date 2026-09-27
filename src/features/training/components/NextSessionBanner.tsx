import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { useNextTrainingSession } from '../hooks/useTrainingSessions'

function relativeDay(dateStr: string, today: Date): string {
  const days = differenceInCalendarDays(parseISO(dateStr), today)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7)   return format(parseISO(dateStr), 'EEEE')          // e.g. Friday
  return format(parseISO(dateStr), 'EEE d MMM')                      // e.g. Mon 14 Jul
}

/**
 * Compact banner showing the next planned training session — the ONE
 * definition (useNextTrainingSession: one-off training blocks AND recurring
 * training templates) that Daily and Home read too. It used to read one-off
 * blocks only, so a weekly routine never showed here. Hidden when none is
 * planned. A one-off opens the shared block editor (which routes a
 * task-linked block to its task); a recurring one opens its template.
 */
export function NextSessionBanner() {
  const modal = useEntityModal()
  const { data: next } = useNextTrainingSession()
  if (!next) return null

  const open = () => next.kind === 'recurring'
    ? modal.open({ kind: 'schedule-block', id: next.id, config: { heading: 'Edit recurring session' } })
    : modal.open({ kind: 'time-block', id: next.id, config: { heading: 'Edit session' } })

  return (
    <button
      type="button"
      onClick={open}
      title="Edit this session"
      className="card-interactive flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600">
        <CalendarClock className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="section-label">Next session</p>
        <p className="truncate text-body font-semibold text-fg">{next.kind === 'recurring' && '⟳ '}{next.title}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-body font-bold text-fg">{relativeDay(next.date, new Date())}</p>
        {next.startTime && <p className="text-meta tabular-nums text-fg-muted">{next.startTime}</p>}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
    </button>
  )
}
