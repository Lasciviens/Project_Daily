import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { readGuessEstimate, type GuessEstimate } from '../../../recipes/quickGuess'
import { describeGuessPhoto, draftDevRequest, explainError, improveAd, placeIdeas, readReceiptPhoto, writeWeek, type ErrorExplanation } from '../featureJobs'
import { shrinkPhoto } from '../photoShrink'
import type { ReceiptRead, RequestDraft } from '../featureRules'

// One hook per AI feature of 22.11.2026 (docs/features/ai-plan.md). Each result only fills a form or shows a text for
// the owner to review, so each is `silent` (the screen shows it); a failure is toasted and logged by the primitive.
// A photo is shrunk in the browser first, and `logPayload: false` keeps its bytes out of the error log.

/** Food → Quick guess → "From a photo". */
export function usePhotoGuess() {
  return useMutationWithFeedback<GuessEstimate & { costUsd: number | null }, { file: File; text: string }>({
    action: 'guess_from_photo',
    silent: 'the estimate fills the sheet, marked AI estimate, for review',
    logPayload: false,
    mutationFn: async ({ file, text }) => {
      const { result, costUsd } = await describeGuessPhoto(await shrinkPhoto(file), text)
      const estimate = readGuessEstimate(result)
      if (!estimate || !estimate.title) throw new Error("That didn't look like food — try another photo")
      return { ...estimate, costUsd }
    },
  })
}

/** Shop → "From a receipt". */
export function useReadReceipt() {
  return useMutationWithFeedback<ReceiptRead & { costUsd: number | null }, File>({
    action: 'read_receipt',
    silent: 'the receipt fills the form, which you check before saving',
    logPayload: false,
    mutationFn: async file => readReceiptPhoto(await shrinkPhoto(file), todayStr()),
  })
}

/** Dev Requests composer ✨. */
export function useDraftDevRequest() {
  return useMutationWithFeedback<RequestDraft & { costUsd: number | null }, { text: string; pages: readonly string[]; currentPage: string }>({
    action: 'draft_dev_request',
    silent: 'the draft fills the composer, with Undo, for review',
    mutationFn: ({ text, pages, currentPage }) => draftDevRequest(text, pages, currentPage),
  })
}

/** Developer → Errors → "Explain". */
export function useExplainError() {
  return useMutationWithFeedback<ErrorExplanation, { message: string; context: Record<string, unknown> | null }>({
    action: 'explain_error',
    silent: 'the explanation is shown in its own sheet',
    // The error is scrubbed before it is sent, but its raw text stays out of the log (it is logged already).
    logPayload: false,
    mutationFn: ({ message, context }) => explainError(message, context),
  })
}

/** Work → "Write my week". */
export function useWriteWeek() {
  return useMutationWithFeedback<{ text: string; costUsd: number | null }, Record<string, unknown>>({
    action: 'write_week',
    silent: 'the text is shown with a Copy button',
    mutationFn: input => writeWeek(input),
  })
}

/** Shop → "Write the ad" → "Improve". */
export function useImproveAd() {
  return useMutationWithFeedback<{ text: string; costUsd: number | null }, { title: string; template: string; notes: string }>({
    action: 'improve_ad',
    silent: 'the improved text replaces the ad in the sheet, with Undo, for editing',
    mutationFn: ({ title, template, notes }) => improveAd(title, template, notes),
  })
}

/** Wishes → "Ideas" for a place. */
export function usePlaceIdeas() {
  return useMutationWithFeedback<{ ideas: string[]; fromSearch: boolean; costUsd: number | null }, { place: string; wish: string; notes: string }>({
    action: 'place_ideas',
    silent: 'the ideas are shown for you to add to the notes',
    mutationFn: ({ place, wish, notes }) => placeIdeas(place, wish, notes),
  })
}
