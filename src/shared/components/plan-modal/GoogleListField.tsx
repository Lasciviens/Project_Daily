// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — GOOGLE TASK LIST FIELD
//  Free text, not a fixed picker over `domain` — the app's own domain enum
//  (personal/work/media) is coarser than the nav categories a user actually
//  thinks in (Training, Projects, ... all collapse to domain='personal'
//  today), so this field lets a task's Google list be typed/picked per task
//  instead. A native <input list> + <datalist> gives free text AND
//  autocomplete over existing lists with zero extra state — the value typed
//  or picked here is resolved (and created on Google if new, matched
//  case-insensitively so it never duplicates) by
//  resolveOrCreateGoogleTaskListId at save time in UnifiedPlanModal.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import { useId } from 'react'
import { FieldLabel } from './fields'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'

interface Props {
  value:    string
  onChange: (title: string) => void
  locked?:  boolean
}

export function GoogleListField({ value, onChange, locked }: Props) {
  const { data: lists = [] } = useGoogleTaskLists()
  const datalistId = useId()

  return (
    <div>
      <FieldLabel>Google Task list</FieldLabel>
      <input
        list={datalistId}
        value={value}
        disabled={locked}
        onChange={e => onChange(e.target.value)}
        placeholder="Personal, Work, Training…"
        className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
      />
      <datalist id={datalistId}>
        {lists.map(l => <option key={l.id} value={l.title} />)}
      </datalist>
      <p className="mt-1.5 text-xs text-ink-400">
        Pick an existing list or type a new name — it's created on Google automatically.
      </p>
    </div>
  )
}
