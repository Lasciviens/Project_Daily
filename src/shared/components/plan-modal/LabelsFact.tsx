// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's labels (owner, 31.10.2026: "I should have an option to add
//  other labels" — "My own labels"): the task's labels on the facts line as
//  small chips (× takes one off) and "+ Label", which opens a field that
//  offers the owner's labels as they type (most used first, useTaskLabels)
//  and adds a new one on Enter. What is stored is todo/taskLabels' rule (the
//  database's, migration 180): trimmed, at most 30 characters, each once,
//  at most 10.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { Hash, Plus, X } from 'lucide-react'
import { chipClass } from './fieldStyles'
import { AddFact } from './ItemFacts'
import { cleanLabel, cleanLabels, labelSuggestions, LABEL_MAX, LABELS_PER_TASK } from '../../../features/todo/taskLabels'
import { useTaskLabels } from '../../../features/todo/hooks/useTaskLabels'

export function LabelsFact({ value, onChange }: { value: string[]; onChange: (labels: string[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const { data: known = [] } = useTaskLabels(adding)
  const typed = cleanLabel(query)
  const has = (list: readonly string[], l: string) => list.some(x => x.toLowerCase() === l.toLowerCase())
  const offered = labelSuggestions(known, query, value)
  const isNew = !!typed && !has(value, typed) && !has(offered, typed)

  function add(label: string) {
    onChange(cleanLabels([...value, label]))
    setQuery('')
    if (value.length + 1 >= LABELS_PER_TASK) setAdding(false)
  }
  const close = () => { setAdding(false); setQuery('') }

  return (
    <>
      {value.map(l => (
        <span key={l} className={chipClass('value', 'pr-0.5')}>
          <Hash aria-hidden />
          <span className="max-w-[10rem] truncate">{l}</span>
          <button type="button" onClick={() => onChange(value.filter(x => x !== l))} aria-label={`Remove the label ${l}`}
            className="grid h-6 w-6 place-items-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg">
            <X aria-hidden />
          </button>
        </span>
      ))}
      {value.length < LABELS_PER_TASK && (adding ? (
        <Combobox<string | null> value={null} onChange={l => { if (l) add(l) }} onClose={() => { if (!query) close() }} immediate>
          <div className="relative">
            <ComboboxInput
              autoFocus
              aria-label="Add a label"
              placeholder="Label"
              maxLength={LABEL_MAX + 10}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                // Enter on a new word adds it (an offered one is picked by the combobox itself); Escape on an empty field closes.
                if (e.key === 'Enter' && isNew && offered.length === 0) { e.preventDefault(); add(typed) }
                if (e.key === 'Escape' && !query) close()
              }}
              onBlur={() => { if (!query) close() }}
              autoComplete="off"
              className="input input-sm h-8 w-36"
            />
            {(isNew || offered.length > 0) && (
              <ComboboxOptions anchor={{ to: 'bottom start', gap: 6, padding: 12 }} className="menu z-toast min-w-[12rem]">
                {isNew && (
                  <ComboboxOption value={typed} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                    <Plus aria-hidden className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">Add “{typed}”</span>
                  </ComboboxOption>
                )}
                {offered.map(l => (
                  <ComboboxOption key={l} value={l} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                    <Hash aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" /><span className="min-w-0 flex-1 truncate">{l}</span>
                  </ComboboxOption>
                ))}
              </ComboboxOptions>
            )}
          </div>
        </Combobox>
      ) : <AddFact label="Label" onClick={() => setAdding(true)} />)}
    </>
  )
}
