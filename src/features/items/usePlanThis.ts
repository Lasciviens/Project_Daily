import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../app/store'
import { entityModal } from '../../shared/modals'
import { qk } from '../../shared/query/keys'
import { STALE } from '../../shared/query/stale'
import { todayStr } from '../../shared/utils/dateUtils'
import { fetchPlans } from '../football/api/footballApi'
import { planRoutine } from '../training/planTraining'
import { fetchLinkedThing, fetchOpenPlan } from './linkApi'
import type { TaskLink } from './linkKinds'
import type { ItemLinkKind } from './itemTypes'
import { planLookup, planRequest, type PlanThing } from './planThis'

// THE Plan helper (Phase 3 A2, owner 26.11.2026): every Plan button calls `usePlanThis()(thing)`. A thing that has
// an open plan opens that plan ("planning twice opens the plan"; one open plan per thing, 210); otherwise the item
// screen opens with the thing's defaults and its link, saved with the item in one transaction.

/** The open plan of a thing (the reverse chip "Planned 28.11.2026"); none for no id. */
export function useOpenPlan(kind: ItemLinkKind, id: string | null | undefined) {
  return useQuery({
    queryKey: qk.tasks.openPlan(kind, id ?? ''),
    queryFn: () => fetchOpenPlan(kind, id as string),
    enabled: !!id,
    staleTime: STALE.short,
  })
}

/** The thing a task plans (the item screen's Linked chip). */
export function useLinkedThing(link: TaskLink | null) {
  return useQuery({
    queryKey: qk.tasks.linkedThing(link?.kind ?? '', link?.id ?? ''),
    queryFn: () => fetchLinkedThing(link as TaskLink),
    enabled: !!link,
    staleTime: STALE.default,
  })
}

/** Plan a thing: its open plan if it has one, else a new plan of it. */
export function usePlanThis() {
  const qc = useQueryClient()
  return useCallback(async (thing: PlanThing) => {
    if (thing.kind === 'training') {
      await planRoutine(thing.routine ?? null, { date: thing.date, onSaved: thing.onSaved })
      return
    }
    let open: string | null = null
    try {
      if (thing.kind === 'football') {
        // A list read a moment ago may not know a match the subscription just added: read the records again.
        const plans = await qc.fetchQuery({ queryKey: qk.football.plans(), queryFn: fetchPlans, staleTime: 0 })
        open = plans.find(p => p.event_id === thing.match.id && p.task_id)?.task_id ?? null
      } else {
        const key = planLookup(thing)
        if (key) {
          // A show's plan counts only when it is this episode's (a batch of episodes may be open beside it).
          const episode = key.season != null && key.episode != null ? { season: key.season, episode: key.episode } : undefined
          const plan = await qc.fetchQuery({
            queryKey: episode ? qk.tasks.openPlan(key.kind, `${key.id}:${episode.season}:${episode.episode}`) : qk.tasks.openPlan(key.kind, key.id),
            queryFn: () => fetchOpenPlan(key.kind, key.id, episode), staleTime: 0,
          })
          open = plan?.taskId ?? null
        }
      }
    } catch { /* the check guards; it never blocks planning (the database still holds one open plan per thing) */ }
    if (open) {
      toast.info('Planned already — here it is')
      entityModal.open({ kind: 'task', id: open })
      return
    }
    entityModal.open(planRequest(thing, todayStr()))
  }, [qc])
}
