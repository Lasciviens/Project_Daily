import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { setPictureSourceState, type PictureSource } from '../api/shopPictureApi'

/** Clear a picture source (state ignored) with "· Undo" that puts it back; the one write the browser may make on the memory. */
export function useSetPictureSourceState() {
  const set = useMutationWithFeedback({
    action: 'picture_source_state',
    silent: 'its toast with Undo says what was cleared; Undo puts it back',
    mutationFn: ({ id, state }: { id: string; state: PictureSource['state']; host?: string }) => setPictureSourceState(id, state),
    invalidates: [qk.shop.pictureSources()],
  })
  return {
    pending: set.isPending,
    clear: (s: Pick<PictureSource, 'id' | 'host'>) => set.mutate({ id: s.id, state: 'ignored' }, {
      onSuccess: () => toast.undo(`${s.host} cleared`, () => set.mutate({ id: s.id, state: 'on' })),
    }),
  }
}
