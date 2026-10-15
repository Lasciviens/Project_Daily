// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's Google chip (owner, 15.10.2026): it always shows the actual
//  target — "Google Calendar · busy", "Google Tasks", "Not on Google" — never
//  "Auto". Tap: Google Calendar / Google Tasks / Tasks and Calendar / Not on
//  Google, each saying what it does for this item. Google Tasks can't repeat,
//  so a repeat shows it disabled with that reason; Both warns "Shows twice in
//  Google Calendar". The rules are sheetRules' (defaultGoogleTarget, …).
// ─────────────────────────────────────────────────────────────────────────────

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { CalendarDays, Check, ChevronDown, CloudOff, Layers, ListTodo } from 'lucide-react'
import type { GoogleTarget, ItemInput } from '../../../features/items/itemTypes'
import { googleChoices, googleTargetLabel, googleTargetProblem } from '../../../features/items/sheetRules'
import { chipClass } from './fieldStyles'

const ICON: Record<GoogleTarget, typeof CalendarDays> = { calendar: CalendarDays, tasks: ListTodo, both: Layers, none: CloudOff }

export function GoogleChip({ shape, target, onPick }: {
  shape: Pick<ItemInput, 'time' | 'durationMinutes' | 'repeat'>
  /** The target the item saves with (picked, or the default). */
  target: GoogleTarget
  onPick: (target: GoogleTarget) => void
}) {
  const Icon = ICON[target]
  const warning = googleTargetProblem({ repeat: shape.repeat, google: target })
  return (
    <>
      <Menu>
        <MenuButton className={chipClass('set')} aria-label={`Google: ${googleTargetLabel(shape, target)}`}>
          <Icon aria-hidden />{googleTargetLabel(shape, target)}<ChevronDown className="text-fg-faint" aria-hidden />
        </MenuButton>
        <MenuItems anchor={{ to: 'bottom start', gap: 6, padding: 12 }} className="menu z-toast w-[min(19rem,calc(100vw-24px))]">
          {googleChoices(shape).map(c => {
            const ChoiceIcon = ICON[c.target]
            return (
              <MenuItem key={c.target} disabled={!!c.disabled}>
                <button type="button" onClick={() => onPick(c.target)} className="menu-item items-start py-1.5 data-[disabled]:cursor-default data-[disabled]:opacity-50">
                  <ChoiceIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{c.label}</span>
                    <span className="text-micro font-normal text-fg-muted">{c.disabled ?? c.hint}</span>
                  </span>
                  {c.target === target && <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-label="Chosen" />}
                </button>
              </MenuItem>
            )
          })}
        </MenuItems>
      </Menu>
      {warning?.level === 'warning' && (
        <p data-tone="warn" className="tone-text basis-full text-meta">{warning.message}</p>
      )}
    </>
  )
}
