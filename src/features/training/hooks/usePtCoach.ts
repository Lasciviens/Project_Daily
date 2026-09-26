import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchAssessments, generatePTAssessment, type PTAssessmentInput } from '../api/ptCoachApi'

export function usePtAssessments() {
  return useQuery({
    queryKey: qk.training.ptAssessments,
    queryFn:  () => fetchAssessments(),
    staleTime: STALE.default,
  })
}

export function useGeneratePtAssessment() {
  return useMutationWithFeedback({
    action:         'generate_pt_assessment',
    loadingMessage: 'The coach is reviewing your data…',
    successMessage: 'Assessment ready',
    mutationFn:     (input: PTAssessmentInput) => generatePTAssessment(input),
    invalidates:    [qk.training.ptAssessments],
  })
}
