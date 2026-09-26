import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending } from '../../recipes/modals/entityModalLoad'
import { useFirstLoaded } from '../../recipes/modals/useFirstLoaded'
import { useWishes } from '../hooks/useWishes'
import { WishSheet } from '../components/WishSheet'

/** `wish`: edit one wish, read from the shared ['wish-items'] list by id. */
export function WishEntityModal({ request, onClose }: EntityModalProps<'wish'>) {
  const query = useWishes()
  const wish = useFirstLoaded(query.data?.find(w => w.id === request.id))
  if (!wish) {
    // The list loaded but has no such row → "no longer exists".
    return <EntityModalPending query={query} what="wish" onClose={onClose} />
  }
  return <WishSheet wish={wish} onClose={onClose} />
}
