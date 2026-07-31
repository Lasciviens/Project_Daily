/* eslint-disable react-refresh/only-export-components -- the chip component and
   the window math it produces are one contract, consumed together by the wishes
   feature; splitting them would separate a value from the only thing that reads it. */
import { useState } from 'react'
import { endOfMonth, format, parseISO } from 'date-fns'
import { DateInput } from './DateInput'
import { todayStr } from '../utils/dateUtils'

// One-tap capture of a *reminder period* (never a deadline) as CONCRETE dates.
// This is the whole capture story on a phone: DateInput has no calendar popup,
// so typing a range costs 16 digit taps — a season chip costs one.
//
// Windows are Northern-hemisphere / Oslo. "This <season>" means the season we
// are currently inside, otherwise the UPCOMING one — so tapping "This winter"
// in July stores 1 Dec of this year → end of Feb next year. End-of-February is
// computed with real date math (endOfMonth), never a hardcoded '02-28', so a
// leap year yields 29 Feb.

export interface DateWindow {
  start: string   // 'yyyy-MM-dd'
  end:   string   // 'yyyy-MM-dd'
  label: string
}

interface SeasonDef {
  label:      string
  startMonth: number   // 1-12
  endMonth:   number   // 1-12; < startMonth means the season crosses New Year
}

const SEASONS: SeasonDef[] = [
  { label: '❄️ This winter', startMonth: 12, endMonth: 2  },
  { label: '🌸 This spring', startMonth: 3,  endMonth: 5  },
  { label: '☀️ This summer', startMonth: 6,  endMonth: 8  },
  { label: '🍂 This autumn', startMonth: 9,  endMonth: 11 },
]

function seasonForAnchorYear(s: SeasonDef, year: number): DateWindow {
  const crossesYear = s.endMonth < s.startMonth
  const start = new Date(year, s.startMonth - 1, 1)
  const end   = endOfMonth(new Date(crossesYear ? year + 1 : year, s.endMonth - 1, 1))
  return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd'), label: s.label }
}

// Soonest-first, so the chip row reads as a timeline.
export function seasonWindows(today: string): DateWindow[] {
  const year = Number(today.slice(0, 4))
  return SEASONS
    .map(s => {
      // Three anchors always cover both the season we may be inside (which can
      // have started last year) and the next occurrence.
      const candidates = [year - 1, year, year + 1].map(y => seasonForAnchorYear(s, y))
      return candidates.find(c => today >= c.start && today <= c.end)
          ?? candidates.find(c => c.start > today)!
    })
    .sort((a, b) => a.start.localeCompare(b.start))
}

// en-GB, day-first. The year is omitted while both ends sit in this year or the
// next — every chip window does, and "1 Dec – 28 Feb" reads better than the
// full form. Anything further out shows the year on BOTH ends (never a mixed
// "1 Dec 2029 – 28 Feb", which reads as a typo).
export function windowRangeLabel(start: string | null, end: string | null): string | null {
  if (!start && !end) return null
  const curYear = Number(todayStr().slice(0, 4))
  const isNear  = (iso: string) => {
    const y = Number(iso.slice(0, 4))
    return y === curYear || y === curYear + 1
  }
  const withYear = ![start, end].filter(Boolean).every(iso => isNear(iso as string))
  const day = (iso: string) => format(parseISO(iso), withYear ? 'd MMM yyyy' : 'd MMM')

  if (start && !end) return `From ${day(start)}`
  if (!start && end) return `Until ${day(end)}`
  const sameMonth = start!.slice(0, 7) === end!.slice(0, 7)
  return sameMonth
    ? `${Number(start!.slice(8, 10))} – ${day(end!)}`
    : `${day(start!)} – ${day(end!)}`
}

const CHIP_BASE = 'px-3 min-h-[44px] rounded-xl border text-sm font-medium transition-colors'
const CHIP_ON   = 'bg-accent-500 text-white border-accent-500'
const CHIP_OFF  = 'border-ink-200 text-ink-600 hover:bg-cream-50'

interface WindowValue {
  start: string | null
  end:   string | null
  label: string | null
}

export function WindowChips({ value, onChange, className }: {
  value:     WindowValue
  onChange:  (v: WindowValue) => void
  className?: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const windows  = seasonWindows(todayStr())
  const matched  = windows.find(w => w.start === value.start && w.end === value.end)
  const isCustom = (!!value.start || !!value.end) && !matched
  const showPicker = pickerOpen || isCustom
  const hasValue = !!value.start || !!value.end || !!value.label

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {windows.map(w => (
          <button
            key={w.label} type="button"
            onClick={() => { setPickerOpen(false); onChange({ start: w.start, end: w.end, label: w.label }) }}
            className={`${CHIP_BASE} ${matched?.label === w.label ? CHIP_ON : CHIP_OFF}`}
          >{w.label}</button>
        ))}
        <button
          type="button"
          onClick={() => setPickerOpen(o => !o)}
          className={`${CHIP_BASE} ${isCustom ? CHIP_ON : CHIP_OFF}`}
        >📅 Pick dates…</button>
        {hasValue && (
          <button
            type="button"
            onClick={() => { setPickerOpen(false); onChange({ start: null, end: null, label: null }) }}
            className={`${CHIP_BASE} ${CHIP_OFF}`}
          >✕ No period</button>
        )}
      </div>

      {showPicker && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-ink-500">
            From
            <DateInput
              value={value.start ?? ''}
              onChange={v => onChange({ start: v || null, end: value.end, label: null })}
              aria-label="Period start"
              className="mt-1 block min-h-[44px] w-full max-w-[9rem] rounded-xl border border-ink-200 bg-cream-50 px-3 text-sm text-ink-900"
            />
          </label>
          <label className="text-xs font-medium text-ink-500">
            To
            <DateInput
              value={value.end ?? ''}
              onChange={v => onChange({ start: value.start, end: v || null, label: null })}
              aria-label="Period end"
              className="mt-1 block min-h-[44px] w-full max-w-[9rem] rounded-xl border border-ink-200 bg-cream-50 px-3 text-sm text-ink-900"
            />
          </label>
        </div>
      )}

      {hasValue && (
        <p className="mt-2 text-xs text-ink-500">
          {value.label ?? windowRangeLabel(value.start, value.end)}
          <span className="ml-1">· a reminder period, not a deadline</span>
        </p>
      )}
    </div>
  )
}
