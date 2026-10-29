import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { connectICloud, disconnectICloud, fetchICloudChanges, fetchICloudStatus, removeICloudTest, runICloudCheck, type ICloudStatus } from './icloudApi'

export function useICloudStatus() {
  return useQuery({ queryKey: qk.icloud.status(), queryFn: fetchICloudStatus, staleTime: STALE.default })
}

export function useConnectICloud() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'icloud_connect',
    mutationFn: ({ appleId, appPassword }: { appleId: string; appPassword: string }) => connectICloud(appleId, appPassword),
    successMessage: (s: ICloudStatus) => `iCloud connected · ${s.appleId ?? ''}`.trim(),
    onSuccess: s => qc.setQueryData(qk.icloud.status(), s),
    // The app-specific password never reaches the error log.
    logPayload: false,
    invalidates: [qk.icloud.all],
  })
}

/** A failed call may have left a new "Last problem" on the server: the status reads it again. */
function useRefreshStatus() {
  const qc = useQueryClient()
  return () => { void qc.invalidateQueries({ queryKey: qk.icloud.all }) }
}

export function useDisconnectICloud() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'icloud_disconnect',
    mutationFn: () => disconnectICloud(),
    successMessage: 'iCloud disconnected · revoke the app-specific password at account.apple.com too',
    onSuccess: s => qc.setQueryData(qk.icloud.status(), s),
    invalidates: [qk.icloud.all],
  })
}

/** The check's own panel shows each step; the toast says how it went in one line. */
export function useRunICloudCheck() {
  const refresh = useRefreshStatus()
  return useMutationWithFeedback({
    action: 'icloud_check',
    mutationFn: () => runICloudCheck(),
    successMessage: r => {
      if (r.needsCalendar) return 'iCloud check: make the test calendar on your iPhone first'
      const failed = r.steps.filter(s => !s.ok).length
      return failed ? `iCloud check: ${failed} step${failed === 1 ? '' : 's'} failed — see the card` : 'iCloud check done · look at your iPhone and Mac'
    },
    invalidates: [qk.icloud.all],
    onError: refresh,
  })
}

export function useICloudChanges() {
  const refresh = useRefreshStatus()
  return useMutationWithFeedback({
    action: 'icloud_changes',
    mutationFn: () => fetchICloudChanges(),
    successMessage: r => !r.tokenWorked ? 'iCloud did not answer "what changed"' : r.changes.length ? `${r.changes.length} change${r.changes.length === 1 ? '' : 's'} from iCloud` : 'No changes from iCloud yet',
    invalidates: [qk.icloud.all],
    onError: refresh,
  })
}

export function useRemoveICloudTest() {
  const refresh = useRefreshStatus()
  return useMutationWithFeedback({
    action: 'icloud_remove_test',
    mutationFn: () => removeICloudTest(),
    successMessage: r => r.removed === 'calendar' ? 'Test calendar removed from iCloud'
      : r.removed === 'events' ? 'Test events removed from iCloud · your calendar stays'
      : r.message ?? 'Nothing to remove',
    invalidates: [qk.icloud.all],
    onError: refresh,
  })
}
