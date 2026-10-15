// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's facts line (THEME §8, Add sheet): the values every item has
//  (priority, area) read as small inline values that open a menu, and the
//  optional rows wait as "+ Notes / + Deadline / + Google list" text buttons
//  and open in place as a FactRow (a short label beside the field).
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Check, Plus, Tag } from 'lucide-react'
import { ToneDot, type Tone } from '../../ui'
import { chipClass } from './fieldStyles'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import { PRIORITY_LABEL, PRIORITY_TONE } from '../../../features/todo/taskTones'
import type { TaskDomain, TaskPriority } from '../../../features/todo/types'

interface Option<T extends string> { id: T; label: string; tone?: Tone }

const PRIORITIES: Option<TaskPriority>[] = (['low', 'medium', 'high'] as const)
  .map(id => ({ id, label: PRIORITY_LABEL[id], tone: PRIORITY_TONE[id] }))
const DOMAINS: Option<TaskDomain>[] = (['personal', 'work', 'media'] as const).map(id => ({ id, label: DOMAIN_LABEL[id] }))

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
