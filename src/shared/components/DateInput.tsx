import { useState, useEffect } from 'react'

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
  return `${d}/${m}/${y}`
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

// Auto-formats digits → DD/MM/YYYY as user types
function formatDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

export function DateInput({ value, onChange, className, placeholder, min, max, 'aria-label': ariaLabel }: Props) {
  const [display, setDisplay] = useState(() => isoToDisplay(value))

  useEffect(() => {
    setDisplay(isoToDisplay(value))
  }, [value])

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

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder ?? 'DD/MM/YYYY'}
      aria-label={ariaLabel}
      className={className}
    />
  )
}
