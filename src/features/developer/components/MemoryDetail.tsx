import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Card, CardHeader } from '../../../shared/ui'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { relativeTime } from '../../../shared/utils/relativeTime'
import { useUpdateMemory } from '../../ai/hooks/useMemory'
import { MemoryFields } from './MemoryFields'
import { SOURCE_LABEL, draftChanged, draftOf, draftValid } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

/**
 * The detail pane beside the memory list (wider pages): the picked memory,
 * editable in place. Mount it with `key={memory.id}` — the draft is seeded
 * once per memory, so a background refetch never overwrites typing.
 * `onDirtyChange` tells the list whether an unsaved edit is open, so picking
 * another row or a filter that hides this one can ask before dropping it.
 */
export function MemoryDetail({ memory, onDelete, onDirtyChange }: {
  memory: AiMemory
  onDelete: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const update = useUpdateMemory()
  const [draft, setDraft] = useState(() => draftOf(memory))
  const changed = draftChanged(draft, memory)

  useEffect(() => {
    onDirtyChange?.(changed)
  }, [changed, onDirtyChange])
  // Leaving (a confirmed switch, a delete) leaves nothing unsaved behind.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  async function handleSave() {
    if (!draftValid(draft) || !changed) return
    await withProgress(
      () => update.mutateAsync({ id: memory.id, patch: { kind: draft.kind, title: draft.title.trim(), content: draft.content.trim() } }),
      { loading: 'Saving…', success: 'Saved' },
    )
  }

  return (
    <Card aria-label="Memory details" className="flex max-h-[calc(100dvh-7rem)] flex-col overflow-y-auto">
      <CardHeader title="Edit memory" subtitle={`${SOURCE_LABEL[memory.source]} · ${relativeTime(memory.updated_at)}`} />
      <MemoryFields draft={draft} onChange={setDraft} idPrefix="memory-pane" />
      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" icon={<Trash2 />} onClick={onDelete} className="text-danger">Delete</Button>
        {changed && <Button variant="ghost" onClick={() => setDraft(draftOf(memory))} className="ml-auto">Revert</Button>}
        <Button variant="primary" className={changed ? undefined : 'ml-auto'} onClick={() => { void handleSave() }} loading={update.isPending} disabled={!changed || !draftValid(draft)}>
          Save memory
        </Button>
      </div>
    </Card>
  )
}
