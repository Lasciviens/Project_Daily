import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { productFromPhotos, type PhotoProductInput } from '../photoProductJob'
import type { PhotoAnswer } from '../photoProductRules'

/** Shop → 📷✨: the photos (already shrunk, held by the caller for the second call) and the line → questions or a draft, for review. */
export function useProductPhoto() {
  return useMutationWithFeedback<{ answer: PhotoAnswer; costUsd: number | null; callId: string | null }, PhotoProductInput>({
    action: 'product_from_photo',
    silent: 'the questions show in the add screen, the draft fills its facts for review',
    // The photos are the owner's: never in the error log.
    logPayload: false,
    mutationFn: input => productFromPhotos(input),
  })
}
