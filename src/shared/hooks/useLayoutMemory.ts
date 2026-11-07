import { useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
//  Layout memory — what a surface looked like when its data last landed, kept
//  on this device, so its next loading copy has that shape (THEME.md §5). A
//  loading copy taller than its content moves the page as much as a shorter
//  one, and only the owner's own data says which it will be: a row that comes
//  with the data (Work's overdue count), a count of lines (the brief) or a
//  list's height (DayAgenda's day). With nothing remembered (the first visit,
//  a new device) the caller's fallback holds, which reserves only what every
//  outcome shows.
//  One localStorage entry of numbers and flags — no titles, no content —
//  cleared at sign-out (security/accountState.ts).
// ─────────────────────────────────────────────────────────────────────────────

const STORE_KEY = 'lasci.layoutMemory'
/** Entries kept, the last used: a few weeks of days (DayAgenda) and the flags every visit reads. */
const MAX_ENTRIES = 120
/** A remembered number is a count or a size in rem; anything past this is not one this app draws. */
const MAX_NUMBER = 400
/** The app's keys are short ("dayList:2026-11-07:1"); a longer one came from somewhere else. */
const MAX_KEY = 100

type Remembered = number | boolean
let memory: Map<string, Remembered> | null = null

const valid = (v: unknown): v is Remembered =>
  typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_NUMBER)
const validKey = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY

function load(): Map<string, Remembered> {
  if (memory) return memory
  memory = new Map()
  try {
    // Device storage is input: only [short string, number | boolean] pairs are read back.
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
    if (Array.isArray(raw)) {
      for (const entry of raw.slice(-MAX_ENTRIES)) {
        if (Array.isArray(entry) && validKey(entry[0]) && valid(entry[1])) memory.set(entry[0], entry[1])
      }
    }
  } catch { /* unreadable: start empty */ }
  return memory
}

/** What `key` was the last time it was remembered on this device. */
export function rememberedLayout(key: string): Remembered | undefined {
  return load().get(key)
}

export function rememberLayout(key: string, value: Remembered): void {
  if (!validKey(key) || !valid(value)) return
  const m = load()
  const changed = m.get(key) !== value
  // Every remember moves the key to the end, so the oldest dropped are the least recently used — a flag that
  // never changes (Football's filter row) outlives a few weeks of day keys. Storage is written only when a value
  // changes (KeepRoom remembers on every render); that write carries the order along.
  m.delete(key)
  m.set(key, value)
  if (!changed) return
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value as string)
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...m])) } catch { /* full or blocked: kept for this visit only */ }
}

/** Sign-out: the counts belong to the account. */
export function forgetLayouts(): void {
  memory = new Map()
  try { localStorage.removeItem(STORE_KEY) } catch { /* */ }
}

/**
 * Whether a row that comes with the data shows (`shown`, once `ready`). While it loads: whether it showed last
 * time, else `fallback` — so its room is kept only where it will most likely be filled. `ready` is an answer to
 * plan the next visit by: loaded and not failed (`!isLoading && !isError`) — a failed read is never learned as
 * "nothing there".
 */
export function useRememberedFlag(key: string, shown: boolean, ready: boolean, fallback = false): boolean {
  useEffect(() => { if (ready) rememberLayout(key, shown) }, [key, shown, ready])
  if (ready) return shown
  const last = rememberedLayout(key)
  return typeof last === 'boolean' ? last : fallback
}

/** A count that comes with the data (lines, rows), the same way: the last one while it loads. */
export function useRememberedCount(key: string, count: number, ready: boolean, fallback: number): number {
  useEffect(() => { if (ready) rememberLayout(key, count) }, [key, count, ready])
  if (ready) return count
  const last = rememberedLayout(key)
  return typeof last === 'number' ? last : fallback
}
