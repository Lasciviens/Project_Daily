// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's Labels row (owner, 31.10.2026: "My own labels"; the item
//  screen's point 6: no box): the task's labels as small chips (× takes one
//  off) and a field with no edges after them — type, Enter adds it; the
//  owner's labels are offered as they type (most used first, useTaskLabels).
//  What is stored is todo/taskLabels' rule (the database's, migration 180):
//  trimmed, at most 30 characters, each once, at most 10.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { Hash, Plus, X } from 'lucide-react'
import { Truncate } from '../../ui'
import { Row } from './ItemRows'
import { cleanLabel, cleanLabels, labelSuggestions, LABEL_MAX, LABELS_PER_TASK } from '../../../features/todo/taskLabels'
import { useTaskLabels } from '../../../features/todo/hooks/useTaskLabels'

export function LabelsRow({ value, onChange, mark }: { value: string[]; onChange: (labels: string[]) => void; mark?: ReactNode }) {
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const { data: known = [] } = useTaskLabels(focused)
  const typed = cleanLabel(query)
  const has = (list: readonly string[], l: string) => list.some(x => x.toLowerCase() === l.toLowerCase())
  const offered = focused ? labelSuggestions(known, query, value) : []
  const isNew = !!typed && !has(value, typed) && !has(offered, typed)

  function add(label: string) {
    onChange(cleanLabels([...value, label]))
    setQuery('')
  }
  const close = () => { setFocused(false); setQuery('') }

  return (
    <Row label="Labels" mark={mark} wide>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 py-1.5">
        {value.map(l => (
          <span key={l} className="inline-flex h-7 min-w-0 max-w-full items-center gap-0.5 rounded-full bg-surface-2 pl-2 pr-0.5 text-body text-fg-2">
            <Hash aria-hidden className="h-3 w-3 shrink-0 text-fg-muted" />
            <bdi className="min-w-0"><Truncate className="max-w-[9rem]">{l}</Truncate></bdi>
            <button type="button" onClick={() => onChange(value.filter(x => x !== l))} aria-label={`Remove the label ${l}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg">
              <X aria-hidden className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length < LABELS_PER_TASK && (
          <Combobox<string | null> value={null} onChange={l => { if (l) add(l) }} onClose={() => { if (!query) setFocused(false) }} immediate>
            <div className="relative min-w-0">
              <ComboboxInput
                aria-label="Add a label"
                placeholder={value.length ? 'Add' : 'Add label'}
                maxLength={LABEL_MAX + 10}
                value={query}
                onFocus={() => setFocused(true)}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  // Enter on a new word adds it (an offered one is picked by the combobox itself); Escape drops what is
                  // typed first.
                  if (e.key === 'Enter' && isNew && offered.length === 0) { e.preventDefault(); add(typed) }
                  if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') }
                }}
                // Leaving the field (another row, closing the screen) keeps what was typed: a label typed and never
                // Entered is added, never dropped without a word. Picking an option keeps the focus here, so it never adds twice.
                onBlur={() => { if (typed && !has(value, typed)) onChange(cleanLabels([...value, typed])); close() }}
                autoComplete="off"
                enterKeyHint="done"
                className="input-bare w-24 pb-0 text-right text-lead"
              />
              {(isNew || offered.length > 0) && (
                // Not modal (as the screen's other pickers): the rest of the screen stays one tap away while the list is open.
                <ComboboxOptions modal={false} anchor={{ to: 'bottom end', gap: 6, padding: 12 }} className="menu z-toast min-w-[12rem]">
                  {isNew && (
                    <ComboboxOption value={typed} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                      <Plus aria-hidden className="h-4 w-4 shrink-0" /><Truncate className="min-w-0 flex-1" fullText={`Add “${typed}”`}>Add “<bdi>{typed}</bdi>”</Truncate>
                    </ComboboxOption>
                  )}
                  {offered.map(l => (
                    <ComboboxOption key={l} value={l} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                      <Hash aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" /><bdi className="min-w-0 flex-1"><Truncate>{l}</Truncate></bdi>
                    </ComboboxOption>
                  ))}
                </ComboboxOptions>
              )}
            </div>
          </Combobox>
        )}
      </div>
    </Row>
  )
}
