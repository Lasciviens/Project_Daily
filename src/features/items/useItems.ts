// The item hooks every screen uses (contract: itemTypes.ts). The data layer
// fills these in; until then each write throws a named error.
import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../shared/query'
import type { CalendarReadbackState, ConvertPreview, ItemInput, RepeatDayAction, SavedItem } from './itemTypes'

const notYet = (what: string): never => { throw new Error(`${what}: the item data layer (migration 155) is not built yet`) }

export function useSaveItem() {
  return useMutationWithFeedback<SavedItem, ItemInput>({
    action: 'save item',
    mutationFn: async () => notYet('Save item'),
    successMessage: 'Saved',
  })
}

export function useRepeatDay() {
  return useMutationWithFeedback<void, { scheduleBlockId: string; date: string; action: RepeatDayAction }>({
    action: 'update a repeating day',
    mutationFn: async () => notYet('Repeat day'),
    successMessage: 'Saved',
  })
}

export function useConvertPreview() {
  return useQuery<ConvertPreview>({ queryKey: qk.items.convertPreview(), queryFn: async () => notYet('Convert preview'), staleTime: STALE.default, enabled: false })
}

export function useConvertOldItems() {
  return useMutationWithFeedback<{ converted: number }, void>({
    action: 'convert old items',
    mutationFn: async () => notYet('Convert old items'),
    successMessage: 'Converted',
  })
}

export function useCalendarReadbackState() {
  return useQuery<CalendarReadbackState>({ queryKey: qk.items.calendarReadback(), queryFn: async () => notYet('Calendar read-back state'), staleTime: STALE.default, enabled: false })
}
