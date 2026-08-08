import { useState } from 'react'
import { Sheet } from '../../../shared/components/Sheet'
import { useUpdateMemory } from '../../ai/hooks/useMemory'
import { KIND_LABEL, KINDS } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

interface Props {
  memory: AiMemory | null   // null = closed
  onClose: () => void
}

const fieldCls = 'min-h-[44px] w-full px-3 text-sm border border-ink-200 rounded-lg bg-cream-50 text-ink-800'

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

  return (
    <Sheet
      open={!!memory}
      onClose={onClose}
      title="Edit memory"
      size="sm"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-lg text-sm text-ink-500 hover:text-ink-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={update.isPending || !title.trim() || !content.trim()}
            className="ml-auto min-h-[44px] px-5 rounded-lg text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-500">Kind</span>
          <select value={kind} onChange={e => setKind(e.target.value as AiMemory['kind'])} className={fieldCls}>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-500">Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} className={fieldCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-500">Content</span>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={6}
            className={`${fieldCls} min-h-[140px] py-2 resize-y`}
          />
        </label>
      </div>
    </Sheet>
  )
}
