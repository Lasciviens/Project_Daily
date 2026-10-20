// Confirming a sleep night complete (migration 164): one tap on the "may be
// incomplete" note, "Marked complete · Undo", and the note never comes back
// for that night (Health → Sleep reads the confirmations into the rule).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { confirmSleepNight, fetchSleepConfirmations, unconfirmSleepNight } from '../api/sleepConfirmApi'

// One Set per answer (not per render), so the night rule isn't run again on every render.
const toSet = (days: string[]): ReadonlySet<string> => new Set(days)

/** Wake days of the confirmed nights. */
export function useSleepConfirmations() {
  return useQuery({
    queryKey: qk.health.sleepConfirmations,
    queryFn: fetchSleepConfirmations,
    staleTime: STALE.default,
    select: toSet,
  })
}

/** `label` names the night in the message ("The night of 17.10 – 18.10"). */
export function useConfirmSleepNight() {
  const qc = useQueryClient()
  // The write's own answer is the result: the cached list follows it at once, the re-read runs behind.
  const put = (date: string, on: boolean) => qc.setQueryData<string[]>(qk.health.sleepConfirmations,
    days => (on ? [...new Set([...(days ?? []), date])] : (days ?? []).filter(d => d !== date)))
  const undo = useMutationWithFeedback({
    action: 'sleep_night_unconfirm',
    mutationFn: ({ date }: { date: string; label: string }) => unconfirmSleepNight(date),
    successMessage: (_r, { label }) => `${label}: marked as maybe incomplete again`,
    onSuccess: (_r, v) => put(v.date, false),
    invalidates: [qk.health.sleepConfirmations],
  })
  return useMutationWithFeedback({
    action: 'sleep_night_confirm',
    mutationFn: ({ date }: { date: string; label: string }) => confirmSleepNight(date),
    silent: 'says it with its Undo (onSuccess)',
    onSuccess: (_r, v) => {
      put(v.date, true)
      toast.undo(`${v.label}: marked complete`, () => {
        void undo.mutateAsync(v).catch(() => { /* the mutation said why */ })
      })
    },
    invalidates: [qk.health.sleepConfirmations],
  })
}
