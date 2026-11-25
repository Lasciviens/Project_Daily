// Personal → Month: one short line per kind under each date (owner, 25.11.2026:
// "Bigger calendar. Text under dates about the insight. I want to see overview
// on my month."; "Also some checkbox to hide or show categories."). Pure: each
// line is worked out from its feature's own reads and rules — the task counts
// from taskRules, the training mark from Training's calendar, the watches from
// the year review, the money from Shop's Stats — and nothing is stored.
// scripts/verify-month-lines.cjs runs it.

import { add, minus, ZERO, type Amount } from '../shop/ownModel'
import { amountWords } from '../shop/components/shopFormat'
import { DAY_MARK_LABEL, type DayMark } from '../training/components/calendar/monthGridModel'

/** The kinds, in the order their lines stand in every day. */
export const MONTH_KINDS = ['tasks', 'training', 'plans', 'media', 'money'] as const
export type MonthKind = typeof MONTH_KINDS[number]

/** The checkbox's word, its tooltip, and the category tint of its dot (THEME §2.5 — an identity, never a status). */
export const MONTH_KIND: Record<MonthKind, { label: string; tip: string; tint: 1 | 2 | 3 | 4 | 5 }> = {
  tasks:    { label: 'Tasks',    tip: 'Tasks — open and done on each day', tint: 1 },
  training: { label: 'Training', tip: 'Training — trained, planned or missed', tint: 2 },
  plans:    { label: 'Plans',    tip: 'Plans — the day\'s slots', tint: 3 },
  media:    { label: 'Media',    tip: 'Media — films and episodes watched', tint: 4 },
  money:    { label: 'Money',    tip: 'Money — spent in Shop (purchases and costs, less refunds)', tint: 5 },
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "3 open · 2 done", "3 open", "2 done" — or nothing on a day with neither. */
export function tasksText(open: number, done: number): string | null {
  const parts = [open > 0 && `${open} open`, done > 0 && `${done} done`].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** "Trained" (×N for more than one workout), else the day's plan mark in Training's own words ("Planned", "Missed plan"). */
export function trainingText(sessions: number, mark: DayMark | null): string | null {
  if (sessions > 0) return sessions === 1 ? DAY_MARK_LABEL.done : `${DAY_MARK_LABEL.done} ×${sessions}`
  return mark ? DAY_MARK_LABEL[mark] : null
}

/** "2 plans" — the app's own slots (Google Calendar's events went with it, 25.11.2026). */
export function plansText(slots: number): string | null {
  return slots > 0 ? plural(slots, 'plan') : null
}

/** "1 film · 3 episodes". */
export function mediaText(films: number, episodes: number): string | null {
  const parts = [films > 0 && plural(films, 'film'), episodes > 0 && plural(episodes, 'episode')].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** Shop's own wording of a sum ("3 290 NOK", "−1 490 NOK", "… + 40 USD pending"); a price missing is "Amount unknown". */
export function moneyText(spent: Amount | null | undefined): string | null {
  if (!spent) return null
  return amountWords(spent) ?? 'Amount unknown'
}

/** The app's own slots per day (a training slot is the training line's). */
export function plansByDay(slots: readonly { date: string; category: string }[]): Map<string, { slots: number }> {
  const out = new Map<string, { slots: number }>()
  for (const s of slots) if (s.category !== 'training') out.set(s.date, { slots: (out.get(s.date)?.slots ?? 0) + 1 })
  return out
}

/** Films and episodes watched per day (each watch on its own day, as the year review reads them). */
export function mediaByDay(watches: readonly { day: string; kind: 'movie' | 'episode' }[]): Map<string, { films: number; episodes: number }> {
  const out = new Map<string, { films: number; episodes: number }>()
  for (const w of watches) {
    const d = out.get(w.day) ?? { films: 0, episodes: 0 }
    if (w.kind === 'movie') d.films++
    else d.episodes++
    out.set(w.day, d)
  }
  return out
}

/** Money spent per day, as Shop's Stats counts a month's spent: purchases and extra costs, less refunds; a sale is money in, not spent. */
export function moneyByDay(events: readonly { day: string; kind: 'bought' | 'cost' | 'sold' | 'refund'; amount: Amount }[]): Map<string, Amount> {
  const out = new Map<string, Amount>()
  for (const e of events) {
    if (e.kind === 'sold') continue
    const before = out.get(e.day) ?? ZERO
    out.set(e.day, e.kind === 'refund' ? minus(before, e.amount) : add(before, e.amount))
  }
  return out
}

/** One day's facts per kind; a kind that is not read (or has nothing) is left out. */
export interface MonthDayFacts {
  tasks?:    { open: number; done: number }
  training?: { sessions: number; mark: DayMark | null }
  plans?:    { slots: number }
  media?:    { films: number; episodes: number }
  money?:    Amount
}

/** Every kind's line for one day (null: nothing that day). */
export function dayTexts(f: MonthDayFacts): Record<MonthKind, string | null> {
  return {
    tasks:    f.tasks ? tasksText(f.tasks.open, f.tasks.done) : null,
    training: f.training ? trainingText(f.training.sessions, f.training.mark) : null,
    plans:    f.plans ? plansText(f.plans.slots) : null,
    media:    f.media ? mediaText(f.media.films, f.media.episodes) : null,
    money:    moneyText(f.money),
  }
}

export interface MonthSlotLine { kind: MonthKind; text: string | null }

/**
 * The day's lines in fixed slots: one per shown kind, always in MONTH_KINDS'
 * order, an empty slot kept (null text) — so a kind stands on the same line in
 * every day and nothing moves when a read lands. A hidden kind has no slot.
 */
export function shownSlots(texts: Record<MonthKind, string | null>, hidden: readonly MonthKind[]): MonthSlotLine[] {
  return MONTH_KINDS.filter(k => !hidden.includes(k)).map(kind => ({ kind, text: texts[kind] }))
}

/** What a day's button reads aloud and shows on hover: the date, then each shown line ("Wed 25.11.2026 — Tasks: 3 open; Training: Trained"). */
export function dayAccessibleName(dateLabel: string, slots: readonly MonthSlotLine[]): string {
  const said = slots.filter(s => s.text).map(s => `${MONTH_KIND[s.kind].label}: ${s.text}`)
  return said.length ? `${dateLabel} — ${said.join('; ')}` : dateLabel
}

// ── The device's choice of kinds ────────────────────────────────────────────
// Stored as the HIDDEN kinds, so a kind added later shows by default.

/** The stored text as hidden kinds; anything else (an old or hand-edited value) is none hidden. */
export function hiddenOf(raw: string | null): MonthKind[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return MONTH_KINDS.filter(k => v.includes(k))
  } catch {
    return []
  }
}

/** Show or hide one kind; the list stays in MONTH_KINDS' order with no repeats. */
export function toggleHidden(hidden: readonly MonthKind[], kind: MonthKind): MonthKind[] {
  const next = hidden.includes(kind) ? hidden.filter(k => k !== kind) : [...hidden, kind]
  return MONTH_KINDS.filter(k => next.includes(k))
}
