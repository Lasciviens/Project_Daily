import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { SlidersHorizontal } from 'lucide-react'
import { IconButton } from '../../../shared/ui'
import { useCalendarStore } from '../../../app/store'
import { useCalendarList } from '../hooks/useCalendar'

// Which Google calendars the app reads (`selectedCalendarIds`, null = all of
// them — useCalendar's `useSelectedCalendarIds`). It lived on Personal's Week
// card until the Week tab went (owner, 23.11.2026); the month calendar, which
// shows the same calendars' days, carries it now. Shown only with more than one calendar.
export function CalendarFilter() {
  const { data: calList = [] } = useCalendarList()
  const { selectedCalendarIds, setSelectedCalendarIds } = useCalendarStore()
  if (calList.length <= 1) return null

  const isSelected = (id: string) => !selectedCalendarIds || selectedCalendarIds.includes(id)
  function toggle(id: string) {
    const current = selectedCalendarIds ?? calList.map(c => c.id)
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    setSelectedCalendarIds(next.length === calList.length ? null : next)
  }

  return (
    <Popover className="relative">
      <PopoverButton as={IconButton} size="sm" label="Calendars — pick which Google calendars show">
        <SlidersHorizontal />
      </PopoverButton>
      <PopoverPanel anchor="bottom end" modal={false}
        className="z-popover flex max-w-[min(22rem,85vw)] flex-wrap gap-1.5 rounded-menu border border-line-strong bg-surface p-2 shadow-menu [--anchor-gap:6px] [--anchor-padding:8px]">
        {calList.map(cal => (
          <button key={cal.id} type="button" aria-pressed={isSelected(cal.id)} onClick={() => toggle(cal.id)} className="pill-tab">
            {cal.summary}
          </button>
        ))}
      </PopoverPanel>
    </Popover>
  )
}
