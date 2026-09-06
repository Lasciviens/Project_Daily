import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchDayTargets, upsertDayTargets, DAY_TARGETS_DEFAULTS } from '../api/dayTargetsApi'
import type { DayTargets, NutritionGoal } from '../api/dayTargetsApi'

export type { DayTargets, NutritionGoal }

// Daily nutrition goals — one DB row per user (migration 086, day_targets),
// no longer localStorage-only. `initialData` seeds the same DEFAULTS the old
// localStorage version shipped, so every consumer (NutritionCard,
// FoodTodayTab, WaterTracker, useNutritionCoach) keeps rendering instantly on
// first paint instead of waiting on the fetch.
const QK = ['day-targets'] as const

export function useDayTargets() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: QK,
    queryFn:  fetchDayTargets,
    staleTime: 5 * 60_000,
    initialData: DAY_TARGETS_DEFAULTS,
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
