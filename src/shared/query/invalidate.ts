import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { qk } from './keys'

// Invalidation by DOMAIN EVENT, not by key: a mutation says what happened
// ("the task graph changed") and every view that shows it refreshes. Each
// group lists roots, so every query under them matches by prefix.
const groups = {
  /** A task, its schedule slot or its calendar event changed. */
  taskGraph: [qk.tasks.all, qk.schedule.all, qk.calendar.all],
  schedule: [qk.schedule.all, qk.calendar.all],
  /** Anything in the food diary / plan / targets / water. */
  nutrition: [qk.foodLog.all, qk.mealPlan.all, qk.water.all, qk.dayTargets.all, qk.dayTargets.profiles],
  recipes: [qk.recipes.all, qk.ingredients.all, qk.mealPlan.all],
  /** An episode was marked (un)watched: progress, next-up, planned blocks, recents. */
  episodeWatched: [qk.media.watchedAll, qk.media.nextEpisodeAll, qk.media.tv, qk.media.recent(), qk.schedule.all],
  media: [qk.media.movies, qk.media.tv, qk.media.watchedAll, qk.media.nextEpisodeAll, qk.media.recent()],
  training: [qk.hevy.all, qk.strava.all, qk.training.all, qk.health.all],
  /** After an Ask-AI turn: every table the assistant can write. */
  aiWrite: [
    qk.tasks.all, qk.schedule.all, qk.calendar.all,
    qk.recipes.all, qk.ingredients.all, qk.mealPlan.all, qk.foodLog.all, qk.water.all, qk.dayTargets.all,
    qk.shop.all, qk.projects.all, qk.media.movies, qk.media.tv, qk.media.watchedAll, qk.media.nextEpisodeAll,
    qk.wishes.all, qk.devRequests.all, qk.memory.all, qk.work.all,
    qk.athlete.profile, qk.athlete.limitations, qk.athlete.musclePrefs,
  ],
} satisfies Record<string, readonly QueryKey[]>

export type InvalidationGroup = keyof typeof groups

/** Refreshes every query under the given groups and/or explicit keys. */
export function invalidate(qc: QueryClient, ...targets: Array<InvalidationGroup | QueryKey>) {
  const keys = targets.flatMap(t => (typeof t === 'string' ? groups[t] : [t])) as QueryKey[]
  return Promise.all(keys.map(queryKey => qc.invalidateQueries({ queryKey })))
}

export const INVALIDATION_GROUPS = groups
