import { format, addDays } from 'date-fns'

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
