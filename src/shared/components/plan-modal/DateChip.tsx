// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's date chip — "Thu 15.10.2026", "Starts Thu 15.10.2026" for a
//  repeat, or "No date". Tap: Today / Tomorrow / No date and a month to pick
//  from. The section follows the date (sheetRules.sectionForItem), so the panel
//  says where the item will be filed.
// ─────────────────────────────────────────────────────────────────────────────

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CalendarDays } from 'lucide-react'
import { DateCalendar } from '../DateCalendar'
import { chipClass, choiceClass, CHIP_PANEL_CLASS } from './fieldStyles'
import { displayDate } from './planModal.config'
import { sectionForItem } from '../../../features/items/sheetRules'
import { addDaysIso } from '../../../features/daily/recurrence'

const SECTION_LABEL = { inbox: 'Inbox', today: 'Today', backlog: 'Backlog' } as const

export function DateChip({ value, onChange, today, allowNone, prefix }: {
  value: string | null
  onChange: (date: string | null) => void
  today: string
  /** "No date" is offered (not for a repeat, which needs a start, nor for one day of it). */
  allowNone: boolean
  /** "Starts" for a repeat. */
  prefix?: string
}) {
  const tomorrow = addDaysIso(today, 1)
  const label = value ? `${prefix ? `${prefix} ` : ''}${displayDate(value)}` : 'No date'
  return (
    <Popover className="contents">
      {({ close }) => {
        const pick = (d: string | null) => { onChange(d); close() }
        const quick = (d: string | null, text: string) => (
          <button type="button" onClick={() => pick(d)} aria-pressed={value === d} className={choiceClass(value === d, undefined, 'sm')}>{text}</button>
        )
        return (
          <>
            <PopoverButton className={chipClass(value ? 'set' : 'add')} aria-label={`Date: ${label}`}>
              <CalendarDays aria-hidden />{label}
            </PopoverButton>
            <PopoverPanel anchor="bottom start" modal={false} className={CHIP_PANEL_CLASS}>
              <div className="mb-1 flex flex-wrap gap-1.5">
                {quick(today, 'Today')}
                {quick(tomorrow, 'Tomorrow')}
                {allowNone && quick(null, 'No date')}
              </div>
              <DateCalendar compact value={value ?? today} onPick={pick} />
              <p className="px-1 text-meta text-fg-muted">
                Goes to {SECTION_LABEL[sectionForItem({ date: value }, today)]}
              </p>
            </PopoverPanel>
          </>
        )
      }}
    </Popover>
  )
}
