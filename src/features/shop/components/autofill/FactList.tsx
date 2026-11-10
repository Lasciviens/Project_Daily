import { useState, type KeyboardEvent } from 'react'
import { Truncate, cx, type Tone } from '../../../../shared/ui'
import {
  FACT_LABEL, FORM_FACTS, factKept, factText, specsText, type Confidence, type Fact, type FactFields, type FactKey,
} from '../../autofillModel'

/** A confidence word is a tone (THEME §2.4): exact the success tone, likely info, check the warning. */
const CONFIDENCE_TONE: Record<Confidence, Tone> = { exact: 'success', likely: 'info', check: 'warn' }

type EditableKey = Exclude<FactKey, 'title' | 'price' | 'image' | 'store' | 'category'>

/**
 * The facts the inputs filled in, one line each: a tick (keep it or not), what it is, its value, where it came
 * from and how sure it is. A fact with a field of its own (name, price, picture, store, category) is edited in its
 * field — its row then says "you changed it"; the others are edited here (tap the value).
 */
export function FactList({ facts, fields, onToggle, onEdit }: {
  facts: readonly Fact[]
  fields: FactFields
  onToggle: (key: FactKey) => void
  onEdit: (key: EditableKey, text: string) => void
}) {
  const [editing, setEditing] = useState<EditableKey | null>(null)
  if (!facts.length) return null
  return (
    <div className="rounded-row border border-line bg-surface-2 px-2.5 py-1.5" data-testid="shop-facts">
      <p className="section-label py-1">Filled in for you · untick what's wrong</p>
      <ul className="divide-y divide-line">
        {facts.map(f => (
          <FactRow key={f.key} fact={f} fields={fields} editing={editing === f.key}
            onToggle={() => onToggle(f.key)}
            onEditStart={FORM_FACTS.has(f.key) ? undefined : () => setEditing(f.key as EditableKey)}
            onEditEnd={text => { if (text != null) onEdit(f.key as EditableKey, text); setEditing(null) }} />
        ))}
      </ul>
    </div>
  )
}

function FactRow({ fact, fields, editing, onToggle, onEditStart, onEditEnd }: {
  fact: Fact
  fields: FactFields
  editing: boolean
  onToggle: () => void
  onEditStart?: () => void
  /** The text typed, or null when the edit was cancelled. */
  onEditEnd: (text: string | null) => void
}) {
  const kept = factKept(fact, fields)
  // A form fact the owner typed over: the field holds the owner's own value now.
  const changed = fact.on && !kept && FORM_FACTS.has(fact.key)
  const id = `fact-${fact.key}`
  return (
    <li className="py-1">
      <div className="flex min-h-[32px] items-center gap-2">
        <input id={id} type="checkbox" checked={kept} onChange={onToggle} className="h-4 w-4 shrink-0 accent-accent-500" />
        <label htmlFor={id} className="w-[4.5rem] shrink-0 text-meta font-medium text-fg-muted">{FACT_LABEL[fact.key]}</label>
        <span className={cx('min-w-0 flex-1 text-body', kept ? 'text-fg' : 'text-fg-muted line-through decoration-fg-faint')}>
          {fact.key === 'image'
            ? <img src={fact.value} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-control bg-surface object-contain" />
            : onEditStart && !editing
              ? <button type="button" onClick={onEditStart} className="block w-full min-w-0 text-left" aria-label={`Edit ${FACT_LABEL[fact.key]}`}>
                  <Truncate>{factText(fact)}</Truncate>
                </button>
              : !editing && <Truncate>{factText(fact)}</Truncate>}
        </span>
        <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 text-meta text-fg-muted">
          <Truncate className="min-w-0">{changed ? 'you changed it' : fact.edited ? 'edited by you' : fact.source.label}</Truncate>
          {!changed && !fact.edited && (
            <span data-tone={CONFIDENCE_TONE[fact.confidence]} className="tone-text shrink-0 font-semibold">· {fact.confidence}</span>
          )}
        </span>
      </div>
      {editing && <FactEditor fact={fact} onDone={onEditEnd} />}
    </li>
  )
}

/** The value as text to edit: one line, or the spec rows one "Name: value" a line. Enter or leaving the field keeps it, Esc drops it. */
function FactEditor({ fact, onDone }: { fact: Fact; onDone: (text: string | null) => void }) {
  const first = fact.key === 'specs' ? specsText(fact.value) : factText(fact).replace(/ days$/, '')
  const [text, setText] = useState(first)
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(null) }
    if (e.key === 'Enter' && fact.key !== 'specs') { e.preventDefault(); onDone(text) }
  }
  const label = `${FACT_LABEL[fact.key]} — edit`
  return fact.key === 'specs'
    ? <textarea autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={keys} onBlur={() => onDone(text)} aria-label={label}
        rows={Math.min(8, Math.max(3, fact.value.length))} className="input input-sm mt-1 resize-none text-meta" />
    : <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={keys} onBlur={() => onDone(text)} aria-label={label}
        inputMode={fact.key === 'ean' || fact.key === 'returnDays' || fact.key === 'prisjaktId' ? 'numeric' : undefined}
        className="input input-sm mt-1" />
}
