import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useUpdateMemory } from '../../ai/hooks/useMemory'
import { KIND_LABEL, KINDS } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

interface Props {
  memory: AiMemory
  onClose: () => void
}

export function MemoryEditSheet({ memory, onClose }: Props) {
  const update = useUpdateMemory()
  // Seeded once per mount: the entity adapter keeps the first loaded row, so a
  // background refetch can't overwrite what is being typed.
  const [kind, setKind] = useState<AiMemory['kind']>(memory.kind)
  const [title, setTitle] = useState(memory.title)
  const [content, setContent] = useState(memory.content)

  function handleSave() {
    if (!title.trim() || !content.trim()) return
    update.mutate(
      { id: memory.id, patch: { kind, title: title.trim(), content: content.trim() } },
      { onSuccess: onClose },
    )
  }

  const canSave = !!title.trim() && !!content.trim()

  return (
    <ModalShell
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
