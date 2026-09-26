import { EntityModalPending, useFirstLoaded, type EntityModalProps } from '../../../shared/modals'
import { MemoryEditSheet } from '../../developer/components/MemoryEditSheet'
import { useMemories } from '../hooks/useMemory'

/** `memory`: edit one saved AI memory, read from the ai-memory list by id. */
export function MemoryEntityModal({ request, onClose }: EntityModalProps<'memory'>) {
  const query = useMemories()
  const memory = useFirstLoaded(query.data?.find(m => m.id === request.id))
  if (!memory) return <EntityModalPending query={query} what="memory" size="sm" onClose={onClose} />
  return <MemoryEditSheet memory={memory} onClose={onClose} />
}
