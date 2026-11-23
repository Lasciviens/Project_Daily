import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../../shared/query'
import { fetchSuggestions, fetchSuggestRuns, lookForIdeasNow, setSuggestionState } from '../suggestApi'
import { SUGGESTION_STATE_LABEL, type SuggestionState } from '../suggestRules'

// The Suggestions view's reads and its two actions (Developer → AI → Learn → Suggestions). One action = one hook.

export function useSuggestions() {
  return useQuery({ queryKey: qk.aiSuggestions.list(), queryFn: fetchSuggestions, staleTime: STALE.short })
}

export function useSuggestRuns() {
  return useQuery({ queryKey: qk.aiSuggestions.runs(), queryFn: fetchSuggestRuns, staleTime: STALE.short })
}

/** Keep · Dismiss · Built · Bring back. The words say what happened; nothing is built or changed by any of them. */
export function useSetSuggestionState() {
  return useMutationWithFeedback({
    action: 'ai_suggestion_state',
    successMessage: (state: SuggestionState) => (state === 'new' ? 'Idea brought back' : `Idea ${SUGGESTION_STATE_LABEL[state].toLowerCase()}`),
    mutationFn: ({ id, state }: { id: string; state: SuggestionState }) => setSuggestionState(id, state),
    invalidates: ['aiSuggestions'],
  })
}

export function useLookForIdeasNow() {
  return useMutationWithFeedback({
    action: 'ai_suggest_make',
    successMessage: (message: string) => message,
    mutationFn: () => lookForIdeasNow(),
    invalidates: ['aiSuggestLook'],
  })
}
