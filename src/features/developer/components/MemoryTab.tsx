import { useMemo, useState } from 'react'
import { EmptyState } from '../../../shared/components/EmptyState'
import { useMemories, useCreateMemory, useDeleteMemory } from '../../ai/hooks/useMemory'
import { MemoryRow } from './MemoryRow'
import { MemoryEditSheet } from './MemoryEditSheet'
import { KIND_BADGE, KIND_LABEL, KINDS } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

// Durable ai_memory rows (migration 064) — until now write-only from chat
// (the `save_memory` tool) and read-only via db_query, with no UI anywhere.
// This tab is the first place the user can see, correct or delete what's been
// remembered, and the only path that ever produces a `source: 'user'` row.

const fieldCls = 'min-h-[44px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 text-ink-800'

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
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-1.5 mb-3">
      <select value={kind} onChange={e => setKind(e.target.value as AiMemory['kind'])} className={`${fieldCls} sm:w-32`}>
        {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      <input
        value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Title"
        className={`${fieldCls} sm:flex-1`}
      />
      <input
        value={content} onChange={e => setContent(e.target.value)}
        placeholder="What should the AI remember?"
        className={`${fieldCls} sm:flex-[2]`}
      />
      <button
        type="submit"
        disabled={create.isPending || !title.trim() || !content.trim()}
        className="min-h-[44px] px-4 rounded-lg text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 whitespace-nowrap"
      >
        + Add
      </button>
    </form>
  )
}

export function MemoryTab() {
  const { data: memories = [], isLoading, error } = useMemories()
  const deleteMemory = useDeleteMemory()
  const [kindFilter, setKindFilter] = useState<AiMemory['kind'] | 'all'>('all')
  const [editing, setEditing] = useState<AiMemory | null>(null)

  const filtered = useMemo(
    () => kindFilter === 'all' ? memories : memories.filter(m => m.kind === kindFilter),
    [memories, kindFilter],
  )

  return (
    <>
      <QuickAdd />

      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <button
          onClick={() => setKindFilter('all')}
          className={`text-[11px] px-2.5 min-h-[44px] rounded border font-medium transition-colors ${
            kindFilter === 'all' ? 'bg-accent-500 text-white border-accent-500' : 'bg-ink-50 text-ink-600 border-ink-200'
          }`}
        >
          All {memories.length}
        </button>
        {KINDS.map(k => {
          const count = memories.filter(m => m.kind === k).length
          if (count === 0) return null
          return (
            <button
              key={k}
              onClick={() => setKindFilter(f => f === k ? 'all' : k)}
              className={`text-[11px] px-2.5 min-h-[44px] rounded border transition-colors ${
                kindFilter === k ? KIND_BADGE[k] + ' font-semibold' : 'bg-ink-50 text-ink-600 border-ink-200'
              }`}
            >
              {KIND_LABEL[k]} {count}
            </button>
          )
        })}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-cream-200 animate-pulse" />)}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl p-3">⚠ {(error as Error).message}</div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon="🧠"
          title="Nothing remembered yet"
          description={
            memories.length === 0
              ? "Durable facts and summaries the AI has been asked to remember. Nothing here yet — ask it to remember something in chat, or add one above."
              : 'No memories match this filter.'
          }
        />
      )}

      <div className="flex flex-col gap-2">
        {filtered.map(memory => (
          <MemoryRow
            key={memory.id}
            memory={memory}
            onEdit={() => setEditing(memory)}
            onDelete={() => { if (confirm(`Delete "${memory.title}"?`)) deleteMemory.mutate(memory.id) }}
          />
        ))}
      </div>

      <MemoryEditSheet key={editing?.id ?? 'none'} memory={editing} onClose={() => setEditing(null)} />
    </>
  )
}
