import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchDiaryEntry, saveDiaryEntry } from '../api/diaryApi'
import { clearDiaryDraftIf } from '../diaryDrafts'

export function useDiaryEntry(day: string) {
  return useQuery({ queryKey: qk.diary.day(day), queryFn: () => fetchDiaryEntry(day), staleTime: STALE.default })
}

/** Saves while the owner types (the card's "Saved HH:MM" line is the result; an error toasts).
 *  The written row is the result: the day's cache takes it at once, and the waiting words
 *  are dropped only if they are the ones just saved. */
export function useSaveDiaryEntry() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'diary_save',
    mutationFn: ({ day, body }: { day: string; body: string }) => saveDiaryEntry(day, body),
    silent: 'the Diary card\'s "Saved HH:MM" line',
    onSuccess: (row, v) => {
      qc.setQueryData(qk.diary.day(row.day), row)
      clearDiaryDraftIf(v.day, v.body)
    },
    // The owner's private words stay out of the error log.
    logPayload: false,
    invalidates: [qk.diary.all],
  })
}
