import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import type { SaveReport } from '../learnSave'

/**
 * After the owner saved what an AI answer filled: the call id and the saved values go to the function, which compares them
 * with its own copy of the answer. A background note: the save itself reports, and a failure here never touches it.
 * Several saves (Tidy up all) go as one report.
 */
export function useReportAiSave() {
  return useMutationWithFeedback({
    action: 'ai_learn_save',
    silent: 'a background note for Developer → AI → Learned; the save itself reports its result',
    // Saved values are the owner's data (a title, a place): never in the error log.
    logPayload: false,
    // Loaded at the first save that reports: the forms that use this (Food, Settings, Shop) stay inside their size budget.
    mutationFn: async (report: SaveReport | readonly SaveReport[]) => (await import('../learnSave')).reportAiSave(report),
    invalidates: ['aiLearn'],
  })
}
