// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's facts line (THEME §8, Add sheet): the values every item has
//  (priority, area, a Google Task's list — and a timed or repeating item's
//  category) read as small inline values that open a menu, the task's labels
//  (LabelsFact), and the optional rows wait as "+ Notes / + Deadline" text
//  buttons and open in place as a FactRow (a short label beside the field).
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Check, ListChecks, Palette, Plus, Tag } from 'lucide-react'
import { ToneDot, Truncate, type Tone } from '../../ui'
import { chipClass } from './fieldStyles'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import { PRIORITY_LABEL, PRIORITY_TONE } from '../../../features/todo/taskTones'
import type { TaskDomain, TaskPriority } from '../../../features/todo/types'
import type { TimeBlockCategory } from '../../../features/daily/types'
import { CATEGORY_LABELS } from './planModal.config'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'

interface Option<T extends string> { id: T; label: string; tone?: Tone }

const PRIORITIES: Option<TaskPriority>[] = (['low', 'medium', 'high'] as const)
  .map(id => ({ id, label: PRIORITY_LABEL[id], tone: PRIORITY_TONE[id] }))
const DOMAINS: Option<TaskDomain>[] = (['personal', 'work', 'media'] as const).map(id => ({ id, label: DOMAIN_LABEL[id] }))
const CATEGORIES: Option<TimeBlockCategory>[] = (Object.keys(CATEGORY_LABELS) as TimeBlockCategory[]).map(id => ({ id, label: CATEGORY_LABELS[id] }))

export function PriorityFact({ value, onChange }: { value: TaskPriority; onChange: (p: TaskPriority) => void }) {
  return (
    <FactMenu name="Priority" value={value} options={PRIORITIES} onChange={onChange}>
      <ToneDot tone={PRIORITY_TONE[value]} />{PRIORITY_LABEL[value]} priority
    </FactMenu>
  )
}

export function AreaFact({ value, onChange }: { value: TaskDomain; onChange: (d: TaskDomain) => void }) {
  return (
    <FactMenu name="Area" value={value} options={DOMAINS} onChange={onChange}>
      <Tag aria-hidden />{DOMAIN_LABEL[value]}
    </FactMenu>
  )
}

/** The slot's or repeat's category (the agenda groups and colours by it). */
export function CategoryFact({ value, onChange }: { value: TimeBlockCategory; onChange: (c: TimeBlockCategory) => void }) {
  return (
    <FactMenu name="Category" value={value} options={CATEGORIES} onChange={onChange}>
      <Palette aria-hidden />{CATEGORY_LABELS[value]}
    </FactMenu>
  )
}

/**
 * The Google Tasks list a Google Task goes to (owner, 31.10.2026: "+ Google list … did nothing" → a dropdown of
 * the lists): the task's own list as a value; the menu lists the Google lists and "New list…", which opens a
 * field for a name (made on Google when the item is saved). A name not on Google yet says "new".
 */
export function ListFact({ value, onPick, onNew }: {
  value: string
  onPick: (title: string) => void
  onNew: () => void
}) {
  const listsQ = useGoogleTaskLists()
  const lists = listsQ.data ?? []
  const name = value.trim()
  const known = (t: string) => lists.some(l => l.title.toLowerCase() === t.toLowerCase())
  // "new" only once the lists are there to compare with (before that every name would read as new).
  const isNew = !!name && listsQ.isSuccess && lists.length > 0 && !known(name)
  return (
    <Menu>
      {/* "List:" — beside the area ("Personal") the same word must not read as the same thing. */}
      <MenuButton className={chipClass('value')} aria-label={`Google Tasks list: ${name || 'not picked'}`} title="Google Tasks list">
        <ListChecks aria-hidden /><span className="font-normal text-fg-muted">List:</span>
        <Truncate className="max-w-[9rem]">{name || 'pick one'}</Truncate>
        {isNew && <span className="font-normal text-fg-muted">· new</span>}
      </MenuButton>
      <MenuItems anchor={{ to: 'bottom start', gap: 6, padding: 12 }} className="menu z-toast max-h-72 min-w-[12rem] overflow-y-auto">
        {lists.map(l => (
          <MenuItem key={l.id}>
            <button type="button" onClick={() => onPick(l.title)} className="menu-item">
              <Truncate className="min-w-0 flex-1">{l.title}</Truncate>
              {l.title.toLowerCase() === name.toLowerCase() && <Check className="h-4 w-4 shrink-0 text-accent-600" aria-label="Chosen" />}
            </button>
          </MenuItem>
        ))}
        {lists.length === 0 && <p className="px-3 py-2 text-meta text-fg-muted">Your Google lists show here once Google Tasks has synced.</p>}
        <MenuItem>
          <button type="button" onClick={onNew} className="menu-item">
            <Plus aria-hidden className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">New list…</span>
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}

/** "+ Notes": opens an optional row in place. */
export function AddFact({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={chipClass('quiet')}>
      <Plus aria-hidden />{label}
    </button>
  )
}

/** An opened optional row: a short label beside its field, not an uppercase label above it. */
export function FactRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-2">
      <Label htmlFor={htmlFor} className="flex h-8 items-center text-meta text-fg-muted">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function FactMenu<T extends string>({ name, value, options, onChange, children }: {
  name: string
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  /** What the line shows for the current value. */
  children: ReactNode
}) {
  const current = options.find(o => o.id === value)
  return (
    <Menu>
      <MenuButton className={chipClass('value')} aria-label={`${name}: ${current?.label ?? value}`} title={name}>
        {children}
      </MenuButton>
      <MenuItems anchor={{ to: 'bottom start', gap: 6, padding: 12 }} className="menu z-toast min-w-[10rem]">
        {options.map(o => (
          <MenuItem key={o.id}>
            <button type="button" onClick={() => onChange(o.id)} className="menu-item">
              {o.tone && <ToneDot tone={o.tone} />}
              <span className="min-w-0 flex-1">{o.label}</span>
              {o.id === value && <Check className="h-4 w-4 shrink-0 text-accent-600" aria-label="Chosen" />}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}
