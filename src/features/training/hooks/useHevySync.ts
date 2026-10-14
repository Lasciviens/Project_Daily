import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyAccountStatus, fetchHevySyncState, syncMissingHevyWorkouts, triggerIncrementalHevySync, triggerInitialHevySync } from '../api/hevyApi'
import { checkWorkoutsToast, hevySyncNotes, notInHevyQuestion, workoutsToOffer } from '../hevyAccountModel'

/** The events-feed cursor: when the last incremental sync ran. */
export function useHevySyncState() {
  return useQuery({
    queryKey: qk.hevy.syncCursor(),
    queryFn:  fetchHevySyncState,
    staleTime: STALE.live,
  })
}

// A sync can add workouts, re-read body measurements (the bodyweight series)
// and prune routines the current program points at; a workout logged from a
// routine also deletes its planned-session task (and block) server-side. So
// both syncs refresh every training view plus the task graph. The toast also
// says what this Sync couldn't read (the library, the account — 154).
export function useIncrementalHevySync() {
  return useMutationWithFeedback({
    action:         'hevy_incremental_sync',
    successMessage: (r: Awaited<ReturnType<typeof triggerIncrementalHevySync>>) => `Synced: +${r.updated} updated, ${r.deleted} deleted${hevySyncNotes(r)}`,
    mutationFn:     triggerIncrementalHevySync,
    invalidates:    ['training', 'taskGraph'],
  })
}

/** The Hevy account (user info, Hevy's workout count) and the stored
 *  workouts that count is compared with — the Hevy card on Subscriptions. */
export function useHevyAccountStatus() {
  return useQuery({
    queryKey: qk.hevy.account(),
    queryFn:  fetchHevyAccountStatus,
    staleTime: STALE.default,
  })
}

/**
 * The Hevy card's count check, one action for any gap: reads every page of
 * Hevy's workout list and stores the ones missing here (new workouts can
 * close planned sessions, migration 141, so the task graph refreshes too).
 * After a complete listing, stored workouts Hevy no longer has are offered
 * for deletion — the question, then "N workouts deleted · Undo".
 */
export function useCheckWorkoutsWithHevy() {
  const check = useMutationWithFeedback({
    action:         'hevy_sync_missing_workouts',
    loadingMessage: 'Reading every workout in Hevy…',
    // No toast when the delete question follows: the question says it.
    successMessage: checkWorkoutsToast,
    mutationFn:     syncMissingHevyWorkouts,
    invalidates:    ['training', 'taskGraph'],
  })
  const del = useRowsDelete({
    table:       'hevy_workouts',
    action:      'delete_hevy_workouts_not_in_hevy',
    invalidates: ['training', 'taskGraph'],
  })
  async function run() {
    let r: Awaited<ReturnType<typeof syncMissingHevyWorkouts>>
    try { r = await check.mutateAsync() } catch { return }
    const gone = workoutsToOffer(r)
    if (gone.length === 0) return
    const q = notInHevyQuestion(gone, r.added)
    await del.run(gone.map(w => w.id), { title: q.title, message: q.message, done: q.done })
  }
  return { run, busy: check.isPending || del.busy }
}

export function useInitialHevySync() {
  return useMutationWithFeedback({
    action:         'hevy_initial_sync',
    loadingMessage: 'Syncing all Hevy data…',
    successMessage: (r: Awaited<ReturnType<typeof triggerInitialHevySync>>) => `Synced ${r.workouts} workouts${hevySyncNotes(r)}`,
    mutationFn:     triggerInitialHevySync,
    invalidates:    ['training', 'taskGraph'],
  })
}
