import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { runClaudeJob } from '../../ai/claude/claudeApi'
import { quickRowCount, quickTextProblem, readQuickItems, QUICK_LIMITS, type QuickItem } from '../quickParseRules'

// ✨ Sort out on the quick list: one `quick_list_parse` call (quickParseRules.ts decides first whether it is needed). The answer
// is checked again here (`readQuickItems`, the function's own rules); nothing is written: the review and "Add N" do that.

export interface QuickParseResult {
  items: QuickItem[]
  /** Rows the checks left out (the function's count plus this side's): not the owner's words, a link, a repeat. */
  dropped: number
  /** What the call cost, from its ledger row. */
  costUsd: number | null
}

/** Sends the text to the model once and hands back the checked items. */
export function useQuickParse() {
  return useMutationWithFeedback<QuickParseResult, { text: string }>({
    action: 'quick_list_parse',
    silent: 'the review shows the items; a stop is the function\'s own sentence, toasted by the primitive',
    logPayload: false,
    mutationFn: async ({ text }) => {
      const clean = text.trim()
      const problem = quickTextProblem(clean)
      if (problem) throw new Error(problem)
      const { result, call } = await runClaudeJob<unknown>('quick_list_parse', { text: clean })
      const cost = call && typeof call.cost_usd === 'number' && Number.isFinite(call.cost_usd) ? call.cost_usd : null
      const items = readQuickItems(result, clean)
      // The function already left out what it could not use and says how many; its count is input, so it is read as a small whole number only.
      const said = (result as { dropped?: unknown } | null)?.dropped
      const theirs = typeof said === 'number' && Number.isInteger(said) && said >= 0 && said <= QUICK_LIMITS.items ? said : 0
      return { items, dropped: theirs + Math.max(0, quickRowCount(result) - items.length), costUsd: cost }
    },
  })
}
