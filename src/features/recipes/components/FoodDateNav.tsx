import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DateCalendar } from '../../../shared/components/DateCalendar'
import { formatDate } from '../../../shared/utils/dateFormat'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'

// Food's compact day picker: ‹ [Today | DD.MM.YYYY] › — the pill opens the
// month calendar. One narrow control, so it shares a row with "Log food" on a
// 402px phone (owner, 06.10.2026: fewer rows before the first meal).
export function FoodDateNav({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const isToday = value === todayStr()
  const arrow = 'grid h-11 w-9 place-items-center rounded-control text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg'
  return (
    <div className="flex items-center">
      <button type="button" aria-label="Previous day" className={arrow} onClick={() => onChange(shiftDateStr(value, -1))}>
        <ChevronLeft className="h-[18px] w-[18px]" aria-hidden />
      </button>
      <Popover className="relative">
        {({ close }) => (
          <>
            <PopoverButton aria-label={`Pick a day (${formatDate(value)})`}
              className="min-h-[44px] min-w-[7rem] rounded-control border border-line bg-surface px-3 text-ui font-semibold tabular-nums text-fg hover:border-line-strong">
              {isToday ? 'Today' : formatDate(value)}
            </PopoverButton>
            <PopoverPanel anchor="bottom start" modal={false}
              className="z-toast rounded-menu border border-line-strong bg-surface p-2 shadow-menu [--anchor-gap:6px] [--anchor-padding:8px]">
              <DateCalendar value={value} onPick={iso => { onChange(iso); close() }} />
              {!isToday && (
                <button type="button" onClick={() => { onChange(todayStr()); close() }}
                  className="mt-1 min-h-[44px] w-full rounded-control text-meta font-semibold text-accent-600 hover:bg-accent-50">
                  Back to today
                </button>
              )}
            </PopoverPanel>
          </>
        )}
      </Popover>
      <button type="button" aria-label="Next day" className={arrow} onClick={() => onChange(shiftDateStr(value, 1))}>
        <ChevronRight className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </div>
  )
}
