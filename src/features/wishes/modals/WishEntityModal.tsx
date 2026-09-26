import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useWish } from '../hooks/useWishes'
import { WishSheet } from '../components/WishSheet'

/** `wish`: edit one wish, loaded by id from the shared wishes query. */
export function WishEntityModal({ request, onClose }: EntityModalProps<'wish'>) {
  const query = useWish(request.id)
  const wish = useFirstLoaded(query.data)
  // A loaded list without this row reads as "no longer exists".
  if (!wish) return <EntityModalPending query={query} what="wish" onClose={onClose} />
  return <WishSheet wish={wish} onClose={onClose} />
}
