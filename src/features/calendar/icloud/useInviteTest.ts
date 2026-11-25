import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { checkInviteTest, deleteInviteTest, removeInviteGuest, rewriteInviteTest, sendInviteTest, type InviteTestState } from './inviteTestApi'

// The invite test (25.11.2026): one hook per action. Every action answers the event as iCloud has it afterwards, kept
// under one key the card reads — never fetched by itself (every read asks iCloud, so only a tap does it). The guests'
// addresses never reach the error log (logPayload: false); the toasts name none.

/** The last answer of any invite test action (undefined until the first tap this session). */
export function useInviteTestState() {
  return useQuery<InviteTestState | null>({ queryKey: qk.icloud.inviteTest(), queryFn: () => null, enabled: false, staleTime: STALE.never })
}

function useKeepState() {
  const qc = useQueryClient()
  return (s: InviteTestState) => qc.setQueryData(qk.icloud.inviteTest(), s)
}

const guests = (n: number) => `${n} guest${n === 1 ? '' : 's'}`

export function useCheckInviteTest() {
  const keep = useKeepState()
  return useMutationWithFeedback({
    action: 'icloud_invite_check',
    mutationFn: () => checkInviteTest(),
    successMessage: s => !s.exists ? 'No test event in Apple Calendar' : `Test event read · ${guests(s.guests.length)}`,
    onSuccess: keep,
  })
}

export function useSendInviteTest() {
  const keep = useKeepState()
  return useMutationWithFeedback({
    action: 'icloud_invite_send',
    mutationFn: (addresses: string[]) => sendInviteTest(addresses),
    successMessage: s => `Invite test sent · ${guests(s.guests.length)} · look in their inboxes`,
    onSuccess: keep,
    logPayload: false,
  })
}

export function useRewriteInviteTest() {
  const keep = useKeepState()
  return useMutationWithFeedback({
    action: 'icloud_invite_rewrite',
    mutationFn: () => rewriteInviteTest(),
    successMessage: 'Test event rewritten · see whether a second invitation arrives',
    onSuccess: keep,
  })
}

export function useRemoveInviteGuest() {
  const keep = useKeepState()
  return useMutationWithFeedback({
    action: 'icloud_invite_remove_guest',
    mutationFn: (guest: string) => removeInviteGuest(guest),
    successMessage: 'Guest removed · a cancellation should arrive',
    onSuccess: keep,
    logPayload: false,
  })
}

export function useDeleteInviteTest() {
  const keep = useKeepState()
  return useMutationWithFeedback({
    action: 'icloud_invite_delete',
    mutationFn: () => deleteInviteTest(),
    successMessage: 'Test event deleted',
    onSuccess: keep,
  })
}
