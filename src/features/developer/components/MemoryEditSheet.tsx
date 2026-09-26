import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { useUpdateMemory } from '../../ai/hooks/useMemory'
import { KIND_LABEL, KINDS } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

interface Props {
  memory: AiMemory | null   // null = closed
  onClose: () => void
}

export function MemoryEditSheet({ memory, onClose }: Props) {
  const update = useUpdateMemory()
  // Keyed remount (key={memory?.id} at the call site) is what keeps this
  // form's local state in sync with whichever row was tapped — same pattern
  // WishSheet uses to survive a background refetch mid-edit.
  const [kind, setKind] = useState<AiMemory['kind']>(memory?.kind ?? 'note')
  const [title, setTitle] = useState(memory?.title ?? '')
  const [content, setContent] = useState(memory?.content ?? '')

  function handleSave() {
    if (!memory || !title.trim() || !content.trim()) return
    update.mutate(
      { id: memory.id, patch: { kind, title: title.trim(), content: content.trim() } },
      { onSuccess: onClose },
    )
  }

  const canSave = !!title.trim() && !!content.trim()

  return (
    <ModalShell
      open={!!memory}
      onClose={onClose}
      title="Edit memory"
      size="sm"
      dismissible={!update.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="ml-auto" onClick={handleSave} loading={update.isPending} disabled={!canSave}>Save memory</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="field-label">Kind</span>
          <select value={kind} onChange={e => setKind(e.target.value as AiMemory['kind'])} className="select">
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} className="input" />
        </label>
        <label className="block">
          <span className="field-label">Content</span>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={6} className="input min-h-[140px] resize-y" />
        </label>
      </div>
    </ModalShell>
  )
}
