import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { formatDate } from '../../../shared/utils/dateFormat'
import { fetchDiaryEntry, saveDiaryEntry, type DiaryEntry } from '../api/diaryApi'

export function useDiaryEntry(day: string) {
  return useQuery({ queryKey: qk.diary.day(day), queryFn: () => fetchDiaryEntry(day), staleTime: STALE.default })
}

/** "Diary saved · 28.10.2026". The written row is the result: the day's cache takes it at once. */
export function useSaveDiaryEntry() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'diary_save',
    mutationFn: ({ day, body }: { day: string; body: string }) => saveDiaryEntry(day, body),
    successMessage: (_r: DiaryEntry, v) => `Diary saved · ${formatDate(v.day)}`,
    onSuccess: row => qc.setQueryData(qk.diary.day(row.day), row),
    // The owner's private words stay out of the error log.
    logPayload: false,
    invalidates: [qk.diary.all],
  })
}
