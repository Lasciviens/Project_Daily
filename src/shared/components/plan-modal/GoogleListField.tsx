// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — A NEW GOOGLE TASKS LIST
//  The facts line's list menu (ItemFacts.ListFact) picks one of the Google
//  lists; "New list…" opens this field for a name. The name is found (any
//  case — never a second list of the same name) or made on Google at save
//  time by resolveOrCreateGoogleTaskListId in UnifiedPlanModal.tsx; an empty
//  field leaves the task in its list.
// ─────────────────────────────────────────────────────────────────────────────

import { useId } from 'react'
import { FactRow } from './ItemFacts'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'

interface Props {
  value:    string
  onChange: (title: string) => void
  locked?:  boolean
}

export function GoogleListField({ value, onChange, locked }: Props) {
  const { data: lists = [] } = useGoogleTaskLists()
  const datalistId = useId()
  const inputId = useId()

  return (
    <FactRow label="New list" htmlFor={inputId}>
      <input
        id={inputId}
        list={datalistId}
        value={value}
        disabled={locked}
        autoFocus
        maxLength={100}
        onChange={e => onChange(e.target.value)}
        placeholder="Name of the list"
        className="input input-sm disabled:opacity-60"
      />
      <datalist id={datalistId}>
        {lists.map(l => <option key={l.id} value={l.title} />)}
      </datalist>
      <p className="mt-1 text-meta text-fg-muted">Made on Google when you save; the task goes into it.</p>
    </FactRow>
  )
}
