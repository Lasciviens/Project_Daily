// Confirming a sleep night complete (migration 164): one tap on the "may be
// incomplete" note, "Marked complete · Undo", and the note never comes back
// for that night (Health → Sleep reads the confirmations into the rule).
import { useQuery } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { confirmSleepNight, fetchSleepConfirmations, unconfirmSleepNight } from '../api/sleepConfirmApi'

/** Wake days of the confirmed nights. */
export function useSleepConfirmations() {
  return useQuery({
    queryKey: qk.health.sleepConfirmations,
    queryFn: fetchSleepConfirmations,
    staleTime: STALE.default,
    select: (days: string[]) => new Set(days),
  })
}

/** `label` names the night in the message ("The night of 17.10 – 18.10"). */
export function useConfirmSleepNight() {
  const undo = useMutationWithFeedback({
    action: 'sleep_night_unconfirm',
    mutationFn: ({ date }: { date: string; label: string }) => unconfirmSleepNight(date),
    successMessage: (_r, { label }) => `${label}: marked as maybe incomplete again`,
    invalidates: [qk.health.sleepConfirmations],
  })
  return useMutationWithFeedback({
    action: 'sleep_night_confirm',
    mutationFn: ({ date }: { date: string; label: string }) => confirmSleepNight(date),
    silent: 'says it with its Undo (onSuccess)',
    onSuccess: (_r, v) => {
      toast.undo(`${v.label}: marked complete`, () => {
        void undo.mutateAsync(v).catch(() => { /* the mutation said why */ })
      })
    },
    invalidates: [qk.health.sleepConfirmations],
    refresh: 'wait',
  })
}
