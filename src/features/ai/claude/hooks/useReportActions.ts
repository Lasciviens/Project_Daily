import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { checkReportsNow, makeReportNow } from '../reportActions'

// The two buttons of Developer → AI → Learn → Batches: queue this week's report now, and read back a waiting one.

export function useMakeReportNow() {
  return useMutationWithFeedback({
    action: 'ai_report_make',
    successMessage: (message: string) => message,
    mutationFn: () => makeReportNow(),
    invalidates: ['aiReports'],
  })
}

export function useCheckReportsNow() {
  return useMutationWithFeedback({
    action: 'ai_report_check',
    successMessage: (message: string) => message,
    mutationFn: () => checkReportsNow(),
    invalidates: ['aiReports'],
  })
}
