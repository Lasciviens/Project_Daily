import type { AiMemory } from '../../ai/api/memoryApi'
import { KIND_LABEL, KINDS, type MemoryDraft } from './memoryMeta'

// The memory form's fields, shared by the edit sheet (phones) and the detail
// pane beside the list (wider pages). Controlled: the caller owns the draft.

export function MemoryFields({ draft, onChange, idPrefix }: { draft: MemoryDraft; onChange: (d: MemoryDraft) => void; idPrefix: string }) {
  return (
    <div className="flex flex-col gap-3">
      <label className="block" htmlFor={`${idPrefix}-kind`}>
        <span className="field-label">Kind</span>
        <select id={`${idPrefix}-kind`} value={draft.kind} onChange={e => onChange({ ...draft, kind: e.target.value as AiMemory['kind'] })} className="select max-w-md">
          {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="block" htmlFor={`${idPrefix}-title`}>
        <span className="field-label">Title</span>
        <input id={`${idPrefix}-title`} value={draft.title} onChange={e => onChange({ ...draft, title: e.target.value })} className="input max-w-md" />
      </label>
      <label className="block" htmlFor={`${idPrefix}-content`}>
        <span className="field-label">Content</span>
        <textarea id={`${idPrefix}-content`} value={draft.content} onChange={e => onChange({ ...draft, content: e.target.value })} rows={6} className="input min-h-[140px] resize-y" />
      </label>
    </div>
  )
}
