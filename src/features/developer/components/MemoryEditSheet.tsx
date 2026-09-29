import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useUpdateMemory } from '../../ai/hooks/useMemory'
import { MemoryFields } from './MemoryFields'
import { draftOf, draftValid } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

interface Props {
  memory: AiMemory
  onClose: () => void
}

export function MemoryEditSheet({ memory, onClose }: Props) {
  const update = useUpdateMemory()
  // Seeded once per mount: the entity adapter keeps the first loaded row, so a
  // background refetch can't overwrite what is being typed.
  const [draft, setDraft] = useState(() => draftOf(memory))

  function handleSave() {
    if (!draftValid(draft)) return
    update.mutate(
      { id: memory.id, patch: { kind: draft.kind, title: draft.title.trim(), content: draft.content.trim() } },
      { onSuccess: onClose },
    )
  }

  return (
    <ModalShell
      onClose={onClose}
      title="Edit memory"
      size="sm"
      dismissible={!update.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="ml-auto" onClick={handleSave} loading={update.isPending} disabled={!draftValid(draft)}>Save memory</Button>
        </div>
      }
    >
      <MemoryFields draft={draft} onChange={setDraft} idPrefix="memory-sheet" />
    </ModalShell>
  )
}
