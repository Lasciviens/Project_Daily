import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchDayTargets, upsertDayTargets, DAY_TARGETS_DEFAULTS } from '../api/dayTargetsApi'
import type { DayTargets, NutritionGoal } from '../api/dayTargetsApi'

export type { DayTargets, NutritionGoal }

// Daily nutrition goals — one DB row per user (migration 086, day_targets),
// no longer localStorage-only. `placeholderData` (NOT `initialData`) seeds
// the same DEFAULTS the old localStorage version shipped so every consumer
// (NutritionCard, FoodTodayTab, WaterTracker, useNutritionCoach) keeps
// rendering instantly on first paint — but, unlike `initialData`, it does
// NOT mark the query as already-fetched-and-fresh. REAL BUG this fixes:
// `initialData` stamps `dataUpdatedAt` as "now" the instant the hook mounts,
// so combined with `staleTime: 5min` the query read as fresh from the very
// first render and `fetchDayTargets` never actually ran on a normal page
// load — every reload silently kept showing the hardcoded defaults instead
// of the real saved goal, reading exactly like "the DB save isn't working"
// even though every write DOES land (a save's own `onSettled` invalidate
// was the only thing that ever forced a real fetch, which is why editing a
// goal right after loading could look like it worked while a page RELOAD
// reverted it). `placeholderData` renders the same instant fallback without
// suppressing the mount-time fetch.
const QK = ['day-targets'] as const

export function useDayTargets() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: QK,
    queryFn:  fetchDayTargets,
    staleTime: 5 * 60_000,
    placeholderData: DAY_TARGETS_DEFAULTS,
  })
  const targets = data ?? DAY_TARGETS_DEFAULTS

  // Optimistic — a goal pill tap or a stepper click should feel instant, not
  // wait on a round trip, matching the old synchronous setState feel.
  const mutation = useMutationWithFeedback<DayTargets, DayTargets, { previous?: DayTargets }>({
    action:     'update_day_targets',
    mutationFn: (next: DayTargets) => upsertDayTargets(next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: QK })
      const previous = qc.getQueryData<DayTargets>(QK)
      qc.setQueryData(QK, next)
      return { previous }
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(QK, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  })

  const update = useCallback((patch: Partial<DayTargets>) => {
    mutation.mutate({ ...targets, ...patch })
  }, [targets, mutation])

  return { targets, update }
}
