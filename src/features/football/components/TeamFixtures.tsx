import { useState } from 'react'
import { CalendarCheck, CalendarPlus } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, MetaLine, SectionLabel, SkeletonText } from '../../../shared/ui'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { osloParts } from '../footballModel'
import { usePlanIt, usePlannedTasks, useTeamFixtures } from '../hooks/useFootball'
import { MatchRow } from './MatchRow'

const FIRST = 5

/**
 * A club's coming matches in every competition (owner, 25.10.2026: "search
 * teams and see their fixtures and be able to plan some matches"): its day
 * and competition, the match (a tap opens it), and Plan it — or, once it is
 * in your day, its item. Followed or not.
 */
export function TeamFixtures({ teamId }: { teamId: string }) {
  const fixtures = useTeamFixtures(teamId)
  const planned = usePlannedTasks()
  const planIt = usePlanIt()
  const modal = useEntityModal()
  const [all, setAll] = useState(false)
  const coming = (fixtures.data ?? []).filter(m => m.state === 'pre' || m.state === 'in' || m.state === 'postponed')
  const shown = all ? coming : coming.slice(0, FIRST)

  return (
    <section className="flex flex-col gap-1">
      <SectionLabel>Coming up</SectionLabel>
      {fixtures.isLoading ? <SkeletonText lines={3} />
        : fixtures.isError ? (
          <p className="text-body text-fg-muted">
            The fixtures couldn't be read from ESPN.{' '}
            <button type="button" className="font-semibold text-accent-600" onClick={() => { void fixtures.refetch() }}>Try again</button>
          </p>
        )
        : coming.length === 0 ? <p className="text-body text-fg-muted">ESPN has no coming matches for this club yet.</p>
        : (
          <ul className="-mx-1 flex flex-col">
            {shown.map(m => {
              const taskId = planned.get(m.id)
              return (
                <li key={m.id} className="flex flex-col">
                  <MetaLine className="px-3 pt-1 text-micro tabular-nums text-fg-muted" items={[formatWeekdayDate(osloParts(m.kickoff).date), m.league?.name]} />
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1"><MatchRow match={m} planned={!!taskId} /></div>
                    {taskId ? (
                      <button type="button" className="icon-btn shrink-0 text-info" aria-label="In your day — open it" title="In your day"
                        onClick={() => modal.open({ kind: 'task', id: taskId })}>
                        <CalendarCheck aria-hidden className="h-4 w-4" />
                      </button>
                    ) : m.state === 'pre' && m.league ? (
                      <button type="button" className="icon-btn shrink-0" aria-label="Plan it" title="Plan it"
                        onClick={() => { void planIt(m) }}>
                        <CalendarPlus aria-hidden className="h-4 w-4" />
                      </button>
                    ) : <span aria-hidden className="w-8 shrink-0" />}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {coming.length > FIRST && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${coming.length}`}
        </Button>
      )}
    </section>
  )
}
