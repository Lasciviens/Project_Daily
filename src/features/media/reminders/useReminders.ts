import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import type { MediaType } from '../types'
import { fetchReminder, saveReminder } from './remindersApi'

export function useReleaseReminder(type: MediaType, tmdbId: number, enabled = true) {
  return useQuery({ queryKey: qk.mediaReminder(type, tmdbId), queryFn: () => fetchReminder(type, tmdbId), enabled: enabled && tmdbId > 0, staleTime: STALE.default })
}

export function useSaveReminder() {
  return useMutationWithFeedback({
    action: 'media_reminder_save',
    mutationFn: saveReminder,
    successMessage: (_r, v) => (v.offsets.length ? 'Reminder saved' : 'Reminder removed'),
    invalidates: (_r, v) => [qk.mediaReminder(v.type, v.tmdbId)],
  })
}
