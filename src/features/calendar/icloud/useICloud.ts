import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { connectICloud, disconnectICloud, fetchICloudChanges, fetchICloudStatus, readICloudCalendars, removeICloudTest, runICloudCheck, setupICloudCalendars, type ICloudStatus } from './icloudApi'

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

/** Read-only: the week in the owner's iCloud calendars, kept only on screen. */
export function useReadICloud() {
  const refresh = useRefreshStatus()
  return useMutationWithFeedback({
    action: 'icloud_read',
    mutationFn: () => readICloudCalendars(),
    successMessage: r => {
      const events = r.days.reduce((n, d) => n + d.events.length + d.more, 0) + r.series.length
      const failed = r.calendars.filter(c => c.problem).length
      return `Read ${events} event${events === 1 ? '' : 's'} from ${r.calendars.length} calendar${r.calendars.length === 1 ? '' : 's'}${failed ? ` · ${failed} couldn't be read` : ''}`
    },
    invalidates: [qk.icloud.all],
    onError: refresh,
  })
}

const calendars = (n: number) => `${n} calendar${n === 1 ? '' : 's'}`

/** Create / update in Apple Calendar (Settings → Calendar): each area's calendar made or brought up to date.
 *  All made: a success toast. Any not made: a warning naming them (the rows say why). */
export function useSetupICloudCalendars() {
  const refresh = useRefreshStatus()
  return useMutationWithFeedback({
    action: 'icloud_setup',
    mutationFn: () => setupICloudCalendars(),
    successMessage: r => {
      if (r.areas.some(a => a.state === 'failed')) return undefined
      return `Apple Calendar: ${calendars(r.areas.filter(a => a.state !== 'off').length)} ready`
    },
    onSuccess: r => {
      const failed = r.areas.filter(a => a.state === 'failed')
      if (!failed.length) return
      const ready = r.areas.filter(a => a.state !== 'off' && a.state !== 'failed').length
      toast.warning(`Apple Calendar: ${calendars(ready)} ready · not made: ${failed.map(a => a.name).join(', ')}`)
    },
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
