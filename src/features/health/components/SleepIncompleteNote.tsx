import { AlertTriangle } from 'lucide-react'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { formatSleepHours as fmtHrs } from '../healthAggregate'
import type { IncompleteNight } from '../sleepCompleteness'
import { fmtDayMonth } from './healthFormat'

// Says when a night on screen looks cut at the start (sleepCompleteness.ts) and
// why, so a short night from a late Health Auto Export delivery is never read
// as a bad night. `nights` are the flagged nights in view, oldest first.
export function SleepIncompleteNote({ nights, today }: { nights: IncompleteNight[]; today: string }) {
  const night = nights[nights.length - 1]
  if (!night) return null
  const others = nights.length - 1
  const label = night.date === today
    ? 'Last night'
    : `The night of ${fmtDayMonth(shiftDateStr(night.date, -1))}–${fmtDayMonth(night.date)}`
  return (
    <div data-tone="warn" role="note" className="tone-soft flex gap-2 rounded-row px-3 py-2 text-meta text-fg-2">
      <AlertTriangle aria-hidden className="tone-text mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {/* A div, not a p: the InfoBubble's panel is a div. */}
        <div>
          <span className="tone-text font-semibold">{label} may be incomplete.</span>{' '}
          Sleep starts at <b className="font-semibold tabular-nums text-fg">{night.startClock}</b> here,{' '}
          {fmtHrs(night.lateByMin / 60)} later than your usual {night.typicalStartClock}, and the night is shorter than usual.
          If you fell asleep earlier, the start of the night has not arrived yet.{' '}
          <InfoBubble label="Why a night can arrive incomplete">
            <span className="block">
              Health Auto Export's regular “Since Last Sync” automation only looks a few hours back for sleep. If it runs
              after you wake but before the Watch has passed the night to the iPhone, the next run no longer reaches the
              start of the night, so only the end arrives.
            </span>
            <span className="mt-2 block">
              The “Sleep catch-up” automation (Date Range “Default”) re-sends yesterday and today every few hours, so the
              whole night lands the same day; the weekly “Previous 7 Days” run also repairs it. Setup:
              docs/health-auto-export in the repository.
            </span>
            <span className="mt-2 block">If you really fell asleep at {night.startClock}, ignore this.</span>
          </InfoBubble>
        </div>
        {others > 0 && (
          <p className="mt-0.5 text-fg-muted">
            {others} more {others === 1 ? 'night' : 'nights'} in this window look the same.
          </p>
        )}
      </div>
    </div>
  )
}
