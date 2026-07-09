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

// Every calendar date from `from` to `to` inclusive — used to left-join
// sparse daily series so a chart still shows a gap for days with no data,
// instead of silently compressing the x-axis around only the days that have
// a value.
export function datesBetweenStr(from: string, to: string): string[] {
  const dates: string[] = []
  let d = parseISO(from)
  const end = parseISO(to)
  while (d <= end) {
    dates.push(formatLocalDate(d))
    d = addDays(d, 1)
  }
  return dates
}
