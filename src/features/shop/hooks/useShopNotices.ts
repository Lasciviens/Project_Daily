import { useQuery } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { fetchShopNotices, setNoticeRead } from '../api/noticesApi'

/** The server's unread notices for the Shop (211): Needs a look shows them; the bell shows them too (212). */
export function useShopNotices() {
  return useQuery({ queryKey: qk.notifications.shop(), queryFn: fetchShopNotices, staleTime: STALE.short })
}

/** Got it on a notice: read, with "Put away · Undo" (Undo makes it unread again). */
export function usePutNoticeAway() {
  const back = useMutationWithFeedback({
    action: 'notice_unread',
    successMessage: 'Back in Needs a look',
    mutationFn: (id: string) => setNoticeRead(id, false),
    invalidates: [qk.notifications.all],
  })
  return useMutationWithFeedback({
    action: 'notice_read',
    silent: 'its own toast reports it with Undo ("Put away · Undo")',
    mutationFn: (id: string) => setNoticeRead(id, true),
    onSuccess: (_r: void, id: string) => { toast.undo('Put away', () => back.mutate(id)) },
    invalidates: [qk.notifications.all],
  })
}
