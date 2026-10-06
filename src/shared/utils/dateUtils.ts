import { format, addDays, parseISO } from 'date-fns'

// Canonical local-calendar-date helpers. Several places independently
// hand-rolled this (getFullYear/getMonth/getDate string-building, or
// toISOString().slice(0,10) which shifts to UTC and can land on the wrong
// day near midnight in non-UTC timezones) — use these instead.

export function formatLocalDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function todayStr(): string {
  return formatLocalDate(new Date())
}

export function tomorrowStr(): string {
  return formatLocalDate(addDays(new Date(), 1))
}

export function daysAgoStr(n: number): string {
  return formatLocalDate(addDays(new Date(), -n))
}

// Shift a date string by N days (negative = earlier). Used to compute a
// "buffer" day just before a range (e.g. yesterday, as a reference point for
// today's incomplete data) without re-deriving addDays/parseISO everywhere.
export function shiftDateStr(dateStr: string, days: number): string {
  return formatLocalDate(addDays(parseISO(dateStr), days))
}

// The local calendar day an ISO timestamp falls on ("2026-09-26T23:30:00Z" is
// the 27th in Oslo). Use this, never `iso.slice(0, 10)`, to file a workout,
// activity or reading under a day: slicing takes the UTC date, which is
// yesterday for anything logged between local midnight and 01:00/02:00.
export function localDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : formatLocalDate(d)
}

// Monday (yyyy-MM-dd) of the local week a local date falls in.
export function mondayOfStr(dateStr: string): string {
  const d = parseISO(dateStr)
  const back = (d.getDay() + 6) % 7
  return formatLocalDate(addDays(d, -back))
}
