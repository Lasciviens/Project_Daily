import { useState, useSyncExternalStore } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CalendarDays } from 'lucide-react'
import { cx } from '../ui'
import { DateCalendar } from './DateCalendar'

const COARSE = '(pointer: coarse)'
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia(COARSE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => window.matchMedia(COARSE).matches,
    () => false,
  )
}

interface Props {
  value:       string             // YYYY-MM-DD or ''
  onChange:    (v: string) => void // emits YYYY-MM-DD or ''
  className?:  string
  placeholder?: string
  min?:        string             // YYYY-MM-DD
  max?:        string             // YYYY-MM-DD
  'aria-label'?: string
}

function isoToDisplay(iso: string): string {
  if (!iso || iso.length !== 10) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function digitsToIso(digits: string): string {
  if (digits.length < 8) return ''
  const d = digits.slice(0, 2)
  const m = digits.slice(2, 4)
  const y = digits.slice(4, 8)
  const date = new Date(`${y}-${m}-${d}`)
  if (isNaN(date.getTime())) return ''
  return `${y}-${m}-${d}`
}

// Auto-formats digits → DD.MM.YYYY as user types
function formatDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}

export function DateInput({ value, onChange, className, placeholder, min, max, 'aria-label': ariaLabel }: Props) {
  const coarse = useCoarsePointer()
  const [display, setDisplay] = useState(() => isoToDisplay(value))
  // Re-sync when the parent changes `value` (adjust-during-render, not an effect).
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setDisplay(isoToDisplay(value))
  }

  function inRange(iso: string): boolean {
    return (!min || iso >= min) && (!max || iso <= max)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatDisplay(e.target.value)
    setDisplay(formatted)
    const digits = formatted.replace(/\D/g, '')
    if (digits.length === 8) {
      const iso = digitsToIso(digits)
      if (iso && inRange(iso)) onChange(iso)
    } else if (!formatted) {
      onChange('')
    }
  }

  function handleBlur() {
    const digits = display.replace(/\D/g, '')
    const iso = digitsToIso(digits)
    if (iso && inRange(iso)) {
      setDisplay(isoToDisplay(iso))
      onChange(iso)
    } else if (!display) {
      onChange('')
    } else {
      // Revert to last valid value
      setDisplay(isoToDisplay(value))
    }
  }

  // Touch screens: the field itself opens the calendar (no keyboard, so no
  // caret drawn at the sheet's pre-animation position — a real iOS bug).
  // Mouse/keyboard: type DD.MM.YYYY, or open the calendar from the icon.
  const full = /(^|\s)w-full(\s|$)/.test(className ?? '')
  const panel = (close: () => void) => (
    <PopoverPanel anchor="bottom start" modal={false}
      className="z-toast rounded-menu border border-line-strong bg-surface p-2 shadow-menu [--anchor-gap:6px] [--anchor-padding:8px]">
      <DateCalendar value={value} min={min} max={max} onPick={iso => { setDisplay(isoToDisplay(iso)); onChange(iso); close() }} />
    </PopoverPanel>
  )

  if (coarse) {
    return (
      <Popover className={cx('relative', full ? 'block w-full' : 'inline-block')}>
        {({ close }) => (
          <>
            <PopoverButton aria-label={ariaLabel ?? 'Pick a date'}
              className={cx(className, 'inline-flex items-center justify-between gap-2 text-left tabular-nums', full && 'w-full')}>
              <span className={display ? undefined : 'text-fg-faint'}>{display || (placeholder ?? 'DD.MM.YYYY')}</span>
              <CalendarDays className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            </PopoverButton>
            {panel(close)}
          </>
        )}
      </Popover>
    )
  }

  return (
    <Popover className={cx('relative items-center gap-1', full ? 'flex w-full' : 'inline-flex')}>
      {({ close }) => (
        <>
          <input
            type="text"
            inputMode="numeric"
            value={display}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder ?? 'DD.MM.YYYY'}
            aria-label={ariaLabel}
            className={cx(className, full && 'min-w-0 flex-1')}
          />
          <PopoverButton aria-label="Open calendar"
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover hover:text-fg">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </PopoverButton>
          {panel(close)}
        </>
      )}
    </Popover>
  )
}
