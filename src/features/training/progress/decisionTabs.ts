// Which exercises each decision-table tab lists — pure (sucrase-verified in
// scripts/verify-progress-engine.cjs §22), so the component only renders.
//
// Recent changes and All exercises list EVERY current-program exercise the
// engine evaluated, including one with a single session so far. They used
// to drop an exercise twice over: 'INSUFFICIENT_DATA' (one logged session —
// a newly added exercise) was cut from both tabs, and Recent also required
// "something moved" — a lift repeated at the same load and reps, or one
// whose only movement was a record (records are hidden since 2026-09-27),
// vanished from Recent even though it was trained yesterday.

import { visibleEvents } from '../progress-engine/copy'
import type { ExerciseProgressResult } from '../progress-engine/types'

export type DecisionTab = 'recent' | 'increase' | 'building' | 'attention' | 'all'

export const RECENT_DAYS = 14

export function daysAgo(today: string, days: number): string {
  const d = new Date(today + 'T00:00:00')
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Something actually moved in the latest pair: the load, the reps, or a
 *  completed target / progression streak (records are not shown anywhere).
 *  An exercise with one session has nothing to compare, so nothing moved. */
export function hasRecentChange(d: ExerciseProgressResult): boolean {
  return d.observedTransition === 'LOAD_INCREASED' || d.observedTransition === 'LOAD_DECREASED'
    || d.repDelta === 'REP_INCREASE' || d.repDelta === 'REP_DECLINE'
    || visibleEvents(d.events).some(e => e.emphasis === 'primary')
}

/** Shown as a neutral "No change" pill on the Recent tab: compared with last
 *  time, the load and reps held (a first session gets its own action pill). */
export function isUnchanged(d: ExerciseProgressResult): boolean {
  return d.currentAction !== 'INSUFFICIENT_DATA' && !hasRecentChange(d)
}

export function filterByTab(decisions: readonly ExerciseProgressResult[], tab: DecisionTab, today: string): ExerciseProgressResult[] {
  const withDecision = decisions.filter(d => d.currentAction !== 'INSUFFICIENT_DATA')
  const below = (d: ExerciseProgressResult) => d.rangeCompliance === 'BELOW_MINIMUM'
  switch (tab) {
    case 'increase':
      return withDecision.filter(d => d.currentAction === 'READY_TO_INCREASE')
    case 'building':
      return withDecision.filter(d => !below(d) && (d.currentAction === 'BUILD_AT_CURRENT_LOAD' || d.currentAction === 'CONFIRM_AT_CURRENT_LOAD' || d.currentAction === 'HOLD_STEADY'))
    case 'attention':
      return withDecision.filter(d => below(d) || d.currentAction === 'WATCH_FOR_PLATEAU' || d.currentAction === 'WATCH_FOR_REGRESSION' || d.currentAction === 'REVIEW_LOAD_REDUCTION')
    case 'recent': {
      const cutoff = daysAgo(today, RECENT_DAYS)
      return decisions.filter(d => (d.currentState.latest?.date ?? '') >= cutoff)
    }
    case 'all':
    default:
      return [...decisions]
  }
}
