import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CalendarDays } from 'lucide-react'
import { cx } from '../ui'
import { formatDate } from '../utils/dateFormat'
import { DateCalendar } from './DateCalendar'
import {
  END, backspace, checkSlots, completeSlots, deleteForward, isEmptySlots, isSeparator, isoToSlots,
  pasteText, slotsFromText, slotsToText, typeDigit, typeSeparator,
} from './dateMask'
import type { MaskState, SlotsCheck } from './dateMask'

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

function problem(check: SlotsCheck, min?: string, max?: string): string | undefined {
  if (check.state === 'bad') return 'Not a real date'
  if (check.state === 'partial') return 'Type the whole date, DD.MM.YYYY'
  if (check.state !== 'out') return undefined
  if (min && max) return `Pick a date from ${formatDate(min)} to ${formatDate(max)}`
  return min ? `Pick ${formatDate(min)} or later` : `Pick ${formatDate(max)} or earlier`
}

/**
 * A date field. The text is always __.__.____: a key writes or clears one
 * digit and never moves the others (rules and tests: dateMask.ts). It takes
 * 07122026, 071226, 7.12.2026, 07.12.26, 7-12-2026 or 7/12/26, typed or
 * pasted. The value changes once the date is whole, real and inside min–max;
 * anything else shows red and is not saved.
 */
export function DateInput({ value, onChange, className, placeholder, min, max, 'aria-label': ariaLabel }: Props) {
  const coarse = useCoarsePointer()
  const inputRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)
  const [slots, setSlots] = useState(() => isoToSlots(value))
  const slotsRef = useRef(slots)
  const [focused, setFocused] = useState(false)
  // Re-sync when the parent changes `value` (adjust-during-render, not an effect).
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setSlots(isoToSlots(value))
  }

  // React rewrites the text after a change, which puts the caret at the end.
  useLayoutEffect(() => {
    slotsRef.current = slots
    const el = inputRef.current
    if (el && caretRef.current !== null && document.activeElement === el) el.setSelectionRange(caretRef.current, caretRef.current)
    caretRef.current = null
  })

  const check = checkSlots(slots, min, max)
  const shown = focused || !isEmptySlots(slots) ? slotsToText(slots) : ''
  const invalid = check.state === 'bad' || check.state === 'out' || (check.state === 'partial' && !focused)

  function emit(next: string) {
    const c = checkSlots(next, min, max)
    if (c.state === 'ok' && c.iso !== value) onChange(c.iso)
    else if (c.state === 'empty' && value) onChange('')
  }

  /** While typing, the value changes only once the last digit is in, so retyping a year never saves 1026 on the way to 1999. */
  function apply(next: MaskState, whole = false) {
    const el = inputRef.current
    if (el) {
      el.value = slotsToText(next.slots)
      el.setSelectionRange(next.caret, next.caret)
    }
    caretRef.current = next.caret
    slotsRef.current = next.slots
    setSlots(next.slots)
    if (whole || next.caret === END || isEmptySlots(next.slots)) emit(next.slots)
  }

  function finish() {
    const done = completeSlots(slotsRef.current)
    if (done !== slotsRef.current) {
      slotsRef.current = done
      setSlots(done)
    }
    emit(done)
  }

  const selection = (el: HTMLInputElement) => {
    const start = el.selectionStart ?? 0
    return [start, el.selectionEnd ?? start] as const
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
    const [start, end] = selection(e.currentTarget)
    const s = slotsRef.current
    let next: MaskState
    if (/^\d$/.test(e.key)) next = typeDigit(s, start, end, e.key)
    else if (isSeparator(e.key)) next = typeSeparator(s, start, end)
    else if (e.key === 'Backspace') next = backspace(s, start, end)
    else if (e.key === 'Delete') next = deleteForward(s, start, end)
    else if (e.key === 'Enter') { finish(); return }
    else {
      if (e.key.length === 1) e.preventDefault()
      return
    }
    e.preventDefault()
    apply(next)
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const [start, end] = selection(e.currentTarget)
    apply(pasteText(slotsRef.current, start, end, e.clipboardData.getData('text')), true)
  }

  function handleCut(e: ClipboardEvent<HTMLInputElement>) {
    const [start, end] = selection(e.currentTarget)
    if (start === end) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', e.currentTarget.value.slice(start, end))
    apply(backspace(slotsRef.current, start, end))
  }

  function handleDrop(e: DragEvent<HTMLInputElement>) {
    e.preventDefault()
    apply(pasteText(slotsRef.current, END, END, e.dataTransfer.getData('text')), true)
  }

  // Anything the keys above didn't handle (undo, autofill): read the text again.
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = slotsFromText(e.target.value)
    apply({ slots: next, caret: Math.min(e.target.selectionStart ?? END, END) }, true)
  }

  function handleFocus() {
    setFocused(true)
    if (isEmptySlots(slotsRef.current)) caretRef.current = 0
  }

  function handleBlur() {
    setFocused(false)
    finish()
  }

  // Touch screens: the field itself opens the calendar (no keyboard, so no
  // caret drawn at the sheet's pre-animation position — a real iOS bug).
  // Mouse/keyboard: type the date, or open the calendar from the icon.
  const full = /(^|\s)w-full(\s|$)/.test(className ?? '')
  const panel = (close: () => void) => (
    <PopoverPanel anchor="bottom start" modal={false}
      className="z-toast rounded-menu border border-line-strong bg-surface p-2 shadow-menu [--anchor-gap:6px] [--anchor-padding:8px]">
      <DateCalendar value={value} min={min} max={max} onPick={iso => { setSlots(isoToSlots(iso)); onChange(iso); close() }} />
    </PopoverPanel>
  )

  if (coarse) {
    return (
      <Popover className={cx('relative', full ? 'block w-full' : 'inline-block')}>
        {({ close }) => (
          <>
            <PopoverButton aria-label={ariaLabel ?? 'Pick a date'}
              className={cx(className, 'inline-flex items-center justify-between gap-2 text-left tabular-nums', full && 'w-full')}>
              <span className={shown ? undefined : 'text-fg-faint'}>{shown || (placeholder ?? 'DD.MM.YYYY')}</span>
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
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={shown}
            onKeyDown={handleKeyDown}
            onChange={handleChange}
            onPaste={handlePaste}
            onCut={handleCut}
            onDrop={handleDrop}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder ?? 'DD.MM.YYYY'}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            title={invalid ? problem(check, min, max) : undefined}
            className={cx(className, 'tabular-nums aria-[invalid=true]:border-danger', full && 'min-w-0 flex-1')}
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
