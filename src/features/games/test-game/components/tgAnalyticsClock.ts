import { useSyncExternalStore } from 'react'

// "Today" for the Analytics windows, as an external store: rendering stays
// pure (no Date.now() in a component), and a screen left open past midnight
// moves its windows on by itself instead of freezing on the day it opened.

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

let today = startOfDay(Date.now())
const listeners = new Set<() => void>()
let timer: number | undefined

function check() {
  const t = startOfDay(Date.now())
  if (t === today) return
  today = t
  listeners.forEach(l => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) timer = window.setInterval(check, 60_000)
  // The module may have loaded days ago in a long-lived tab.
  check()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.clearInterval(timer)
  }
}

/** Local midnight of the current day, in ms. */
export function useToday(): number {
  return useSyncExternalStore(subscribe, () => today, () => today)
}

const REDUCE = '(prefers-reduced-motion: reduce)'

function subscribeMotion(onChange: () => void) {
  const q = window.matchMedia(REDUCE)
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

/** Chart entry animations run in JS, out of reach of the stylesheet's reduced-motion rule. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCE).matches, () => true)
}
