import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast, useCalendarStore } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { invalidate, qk, STALE } from '../../../shared/query'
import { ensureValidCalendarToken } from '../../calendar/api/calendarTokenSync'
import { fetchCalendarLinkedTaskIds } from '../../daily/api/scheduleApi'
import { drainGoogleTasksOutbox } from '../api/googleTasksOutbox'
import { fetchGoogleTasksSyncState, runGoogleTasksSync } from '../api/googleTasksSync'
import { googleTasksPushCandidates, googleTasksSyncHealth, googleTasksSyncMessage, shouldBackgroundSync, type GoogleTasksSyncSummary } from '../api/googleTasksRules'
import { updateTask } from '../api/tasksApi'
import { isOpenTask } from '../taskRules'
import type { Task } from '../types'

/** The server's last Google Tasks run (Settings → Subscriptions shows it). */
export function useGoogleTasksSyncState() {
  return useQuery({
    queryKey: qk.googleTasks.syncState(),
    queryFn: fetchGoogleTasksSyncState,
    staleTime: STALE.live,
  })
}

/**
 * "Sync now": one full run of google-tasks-sync for the signed-in user — the
 * same code the 20-minute cron runs, so a problem the cron has (an expired
 * Google grant, Tasks not allowed, a list Google refuses) shows here as the
 * error, and the run's outcome lands in the sync state either way.
 */
export function useSyncFromGoogleTasks() {
  return useMutationWithFeedback({
    action: 'sync_google_tasks',
    mutationFn: () => runGoogleTasksSync({ full: true, force: true }),
    successMessage: (r: GoogleTasksSyncSummary) => googleTasksSyncMessage(r),
    // The same run reads Google Calendar back (155): a moved event moves its
    // slot and the slot its task — the day's schedule refreshes with the tasks.
    invalidates: ['taskGraph', qk.googleTaskLists.all, qk.googleTasks.all],
  })
}

// Catch-up action for tasks created before Google was connected, OR whose
// create-time sync silently failed (a real incident: the ambiguous-overload
// RPC bug, fixed separately, could leave google_sync_enabled=true with
// google_task_id still NULL for anything created during that window — the
// task never actually reached Google despite looking "already synced").
//
// The real signal for "not yet on Google" is the absence of google_task_id,
// NOT google_sync_enabled — that flag reflects INTENT (set at create time,
// before any Google call happens), not outcome.
//
// Calendar-linked tasks (google_sync_enabled=false BY DESIGN — see
// UnifiedPlanModal's skipGoogleTasks) also have no google_task_id, so
// they're excluded by checking for a linked time_blocks row with its own
// google_calendar_event_id — pushing those would recreate the exact
// "task duplicated as both a Calendar event and a Task" bug that flag exists
// to prevent.
export function usePushToGoogleTasks() {
  return useMutationWithFeedback({
    action: 'push_to_google_tasks',
    mutationFn: async (tasks: Task[]) => {
      const token = await ensureValidCalendarToken()
      if (!token) throw new Error('Google is not connected: connect it in Settings → Subscriptions')

      const notYetSynced = googleTasksPushCandidates(tasks, isOpenTask)
      const calendarLinkedIds = await fetchCalendarLinkedTaskIds(notYetSynced.map(t => t.id))
      const candidates = notYetSynced.filter(t => !calendarLinkedIds.has(t.id))

      for (const t of candidates) {
        // A task already marked google_sync_enabled=true (the stuck-create
        // case) needs an explicit false→true transition to re-trigger
        // migration 071's opt-in branch — setting true→true is a no-op the
        // trigger doesn't see as a change at all.
        if (t.google_sync_enabled) await updateTask(t.id, { google_sync_enabled: false })
        await updateTask(t.id, { google_sync_enabled: true })
      }

      const { failed } = await drainGoogleTasksOutbox(token, { force: true })
      return { pushed: Math.max(0, candidates.length - failed), failed }
    },
    successMessage: (r: { pushed: number; failed: number }) =>
      r.pushed === 0 && r.failed === 0 ? 'All tasks already in Google Tasks'
      : r.failed > 0 ? `Pushed ${r.pushed}, ${r.failed} failed`
      : `Pushed ${r.pushed} task${r.pushed === 1 ? '' : 's'} to Google`,
    invalidates: [qk.tasks.all, qk.googleTasks.all],
  })
}

// One background run at a time for the whole app.
let backgroundRun: Promise<void> | null = null

/** localStorage key of the sync error this device was last warned about. */
export const GOOGLE_TASKS_WARNED_KEY = 'lasci.googleTasks.warnedError'

/**
 * A failed sync must not stay silent (owner, point 16 of 13.10.2026: "No sync"
 * with nothing on screen). After a background run, a failure the device hasn't
 * been told about yet gets one warning toast; the same error repeating every
 * run stays quiet, and a good run clears the memory so the next failure warns.
 */
async function warnOnNewFailure(qc: QueryClient): Promise<void> {
  const state = await qc.fetchQuery({ queryKey: qk.googleTasks.syncState(), queryFn: fetchGoogleTasksSyncState, staleTime: 0 })
  const health = googleTasksSyncHealth(state)
  try {
    if (health.kind === 'ok') { localStorage.removeItem(GOOGLE_TASKS_WARNED_KEY); return }
    if (health.kind !== 'failed' || localStorage.getItem(GOOGLE_TASKS_WARNED_KEY) === health.error) return
    localStorage.setItem(GOOGLE_TASKS_WARNED_KEY, health.error)
  } catch { /* storage blocked: warn anyway */ }
  if (health.kind === 'failed') toast.warning(`Google Tasks sync failed: ${health.error} — see Settings → Subscriptions → Google`)
}

async function syncInBackground(qc: QueryClient): Promise<void> {
  const connected = !!useCalendarStore.getState().accessToken
  if (backgroundRun || !connected) return
  backgroundRun = (async () => {
    const state = await qc.fetchQuery({ queryKey: qk.googleTasks.syncState(), queryFn: fetchGoogleTasksSyncState, staleTime: 0 })
    if (!shouldBackgroundSync(state?.updated_at, Date.now(), connected)) return
    const result = await runGoogleTasksSync()
    if ((result.readback?.applied ?? 0) > 0) void invalidate(qc, 'taskGraph')
    else if ((result.imported ?? 0) > 0 || (result.drained ?? 0) > 0) void qc.invalidateQueries({ queryKey: qk.tasks.all })
    void qc.invalidateQueries({ queryKey: qk.googleTaskLists.all })
  })()
    // Not logged here: the function records every failed run in the sync
    // state (shown on Settings → Subscriptions) and logs a new problem once;
    // logging again from every open would repeat it every 10 minutes.
    .catch(() => {})
    .finally(() => {
      backgroundRun = null
      void qc.invalidateQueries({ queryKey: qk.googleTasks.all })
      void warnOnNewFailure(qc).catch(() => {})
    })
  return backgroundRun
}

/**
 * Brings Google's changes in when the app opens or comes back to the front,
 * at most every 10 minutes counting the cron's own runs — so the app is
 * current even when the 20-minute cron isn't running. Quiet when it works; a
 * new failure gets one warning toast (warnOnNewFailure), and every failure is
 * in the sync state (Settings → Subscriptions) and the error log.
 */
export function useGoogleTasksBackgroundSync() {
  const qc = useQueryClient()
  // Also re-runs when the Google token first arrives (a fresh load restores
  // it from calendar-token a moment after the app mounts).
  const connected = useCalendarStore(s => !!s.accessToken)
  useEffect(() => {
    if (!connected) return
    const run = () => { if (document.visibilityState === 'visible') void syncInBackground(qc) }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [qc, connected])
}
