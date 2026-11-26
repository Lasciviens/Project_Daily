import { Popcorn } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { PlanThingButton } from '../../items/components/LinkedPlanChips'
import { useOpenPlan, usePlanThis } from '../../items/usePlanThis'

interface Props {
  /** The library entry the plan links to; null for a movie not in the library (Discover's "In cinemas"): it plans
   *  without a link. */
  entryId: string | null
  title: string
  /** Movie runtime in minutes — becomes the plan duration (rounded up to 15m). */
  runtimeMinutes?: number | null
}

/**
 * A movie's Plan (to watch at home) and Cinema (a trip: a movie plan titled "Cinema: X"), both through usePlanThis
 * with the movie's link. While the movie has an open plan they are one chip, "Planned 28.11.2026", that opens it.
 * TV planning lives in EpisodesPanel (plan selected episodes).
 */
export function PlanThisButton({ entryId, title, runtimeMinutes }: Props) {
  const plan = usePlanThis()
  const open = useOpenPlan('movie', entryId)
  return (
    <>
      <PlanThingButton thing={{ kind: 'movie', id: entryId, title, runtimeMinutes }} tip="Plan — watch it on a day" />
      {!open.data && (
        <Button size="sm" icon={<Popcorn aria-hidden />} tip="Cinema — plan a trip to see it"
          onClick={() => { void plan({ kind: 'movie', id: entryId, title, runtimeMinutes, cinema: true }) }}>
          Cinema
        </Button>
      )}
    </>
  )
}
