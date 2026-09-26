import { useMemo, useState } from 'react'
import { AlertTriangle, Brain, Plus } from 'lucide-react'
import { entityModal } from '../../../shared/modals'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { useMemories, useCreateMemory, useDeleteMemory } from '../../ai/hooks/useMemory'
import { MemoryRow } from './MemoryRow'
import { KIND_LABEL, KINDS } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

// Durable ai_memory rows (migration 064). The one place to see, correct or
// delete what has been remembered, and the only path that ever writes a
// `source: 'user'` row (chat's save_memory writes 'ai').

function QuickAdd() {
  const create = useCreateMemory()
  const [kind, setKind] = useState<AiMemory['kind']>('fact')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    create.mutate(
      { kind, title: title.trim(), content: content.trim() },
      { onSuccess: () => { setTitle(''); setContent('') } },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="card mb-4 flex flex-col gap-2 p-3 sm:flex-row">
      <select value={kind} onChange={e => setKind(e.target.value as AiMemory['kind'])} aria-label="Kind" className="select sm:w-36">
        {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="input sm:flex-1" />
      <input value={content} onChange={e => setContent(e.target.value)} placeholder="What should the AI remember?" aria-label="Content" className="input sm:flex-[2]" />
      <Button type="submit" variant="primary" icon={<Plus />} loading={create.isPending} disabled={!title.trim() || !content.trim()}>
        Add memory
      </Button>
    </form>
  )
}

export function MemoryTab() {
  const { data: memories = [], isLoading, error, refetch } = useMemories()
  const deleteMemory = useDeleteMemory()
  const [kindFilter, setKindFilter] = useState<AiMemory['kind'] | 'all'>('all')

  const filtered = useMemo(
    () => kindFilter === 'all' ? memories : memories.filter(m => m.kind === kindFilter),
    [memories, kindFilter],
  )

  async function handleDelete(memory: AiMemory) {
    if (await entityModal.confirm({ title: `Delete "${memory.title}"?`, confirmLabel: 'Delete', destructive: true })) deleteMemory.mutate(memory.id)
  }

  return (
    <div className="max-w-4xl">
      <QuickAdd />

      <div className="scroll-x -mx-4 mb-3 flex gap-1 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter by kind">
        <button type="button" role="tab" aria-selected={kindFilter === 'all'} onClick={() => setKindFilter('all')} className="pill-tab">
          All <span className="count-badge">{memories.length}</span>
        </button>
        {KINDS.map(k => {
          const count = memories.filter(m => m.kind === k).length
          if (count === 0) return null
          return (
            <button key={k} type="button" role="tab" aria-selected={kindFilter === k} onClick={() => setKindFilter(f => f === k ? 'all' : k)} className="pill-tab">
              {KIND_LABEL[k]} <span className="count-badge">{count}</span>
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-20" />)}
        </div>
      ) : error ? (
        <EmptyState
          bordered
          icon={<AlertTriangle />}
          title="Couldn't load memories"
          description={(error as Error).message}
          action={<Button size="sm" onClick={() => { void refetch() }}>Try again</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          bordered
          icon={<Brain />}
          title={memories.length === 0 ? 'Nothing remembered yet' : 'No memories of this kind'}
          description={memories.length === 0
            ? 'Durable facts and summaries the AI has been asked to remember. Ask it to remember something in chat, or add one above.'
            : undefined}
        />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {filtered.map(memory => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              onEdit={() => entityModal.open({ kind: 'memory', id: memory.id })}
              onDelete={() => { void handleDelete(memory) }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
