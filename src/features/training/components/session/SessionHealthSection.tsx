import { useState } from 'react'
import { ChevronDown, Watch } from 'lucide-react'
import { cx } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import type { HealthWorkoutSummary } from '../../../health/api/healthApi'
import { WorkoutHealthStats } from '../log/WorkoutHealthStats'

/** The Apple Watch numbers of a session, collapsed by default — the stats row
 *  already carries the average heart rate; this is the detail on demand. */
export function SessionHealthSection({ match, isLoading, isError }: {
  match: HealthWorkoutSummary | null
  isLoading: boolean
  isError: boolean
}) {
  const [open, setOpen] = useState(false)
  const info = (
    <InfoBubble label="About the Apple Watch numbers">
      From the Apple Health workout recorded at the same time as this session (Hevy saves its workouts to Apple Health;
      Health Auto Export sends them here). It counts when the two overlap for most of their length.
      <span className="mt-1.5 block">
        <b>Active</b> energy is what the workout burned on top of your resting burn; <b>total</b> adds the resting burn over
        the same time. Calories and heart rate are the watch&apos;s estimates.
      </span>
    </InfoBubble>
  )

  if (isLoading) return null
  if (!match) {
    return (
      <p className="flex items-center gap-1.5 text-meta text-fg-muted">
        <Watch aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {isError ? 'Apple Health data couldn’t be loaded.' : 'No Apple Watch workout was recorded during this session.'}
      </p>
    )
  }
  return (
    <section className="rounded-row border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left"
      >
        <Watch aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
        <span className="flex-1 text-body font-semibold text-fg">Heart rate &amp; energy</span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-line p-3"><WorkoutHealthStats match={match} explainer={info} /></div>}
    </section>
  )
}
