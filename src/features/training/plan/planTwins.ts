// A second plan of the same training session on the same day — pure, import-
// free apart from the (also pure) agenda projection; verified by
// scripts/verify-training-plan.cjs.
//
// Why: the schedule can hold the same session twice — the weekly ⟳ template
// for Tuesday AND a one-off "Lower A" planned for that Tuesday (from Missed
// sessions → Plan it, Routines → Plan, Next, Daily's Training card). Nothing
// stopped the second one, so Home, Daily and Training all showed the session
// twice. Saving a training plan now asks first when the day already has the
// same session (same routine, else the same name).

import { projectRecurringBlocksForDay, type RecurringBlockLike } from '../../daily/components/dayAgendaProjection'

export interface PlanTwinBlock {
  id: string
  title: string
  date: string
  start_time?: string | null
  category?: string | null
  source_type?: string | null
  source_id?: string | null
}

export interface PlanTwin {
  kind: 'block' | 'recurring'
  title: string
  /** 'HH:MM' or null. */
  startTime: string | null
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const hhmm = (hour: number) => {
  const total = Math.round(hour * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The plan already on `date` for the same session, or null. A one-off block
 * matches by its routine (training_session source) or, without one, by name;
 * a recurring template by name (it carries no routine). `excludeBlockId` is
 * the block being edited, which is never its own twin.
 */
export function findPlanTwin(input: {
  date: string
  title: string
  routineId?: string | null
  excludeBlockId?: string | null
  blocks: readonly PlanTwinBlock[]
  /** Training templates only. */
  templates: readonly RecurringBlockLike[]
}): PlanTwin | null {
  const { date, routineId, excludeBlockId } = input
  const name = norm(input.title)
  if (!name && !routineId) return null
  for (const b of input.blocks) {
    if (b.date !== date || b.id === excludeBlockId) continue
    if (b.category && b.category !== 'training') continue
    const sameRoutine = !!routineId && b.source_type === 'training_session' && b.source_id === routineId
    if (sameRoutine || (name && norm(b.title) === name)) {
      return { kind: 'block', title: b.title, startTime: b.start_time?.slice(0, 5) ?? null }
    }
  }
  if (!name) return null
  const weekday = new Date(`${date}T00:00:00`).getDay()
  const hit = projectRecurringBlocksForDay(date, weekday, [...input.templates])
    .find(p => !p.spillover && norm(p.title) === name)
  return hit ? { kind: 'recurring', title: hit.title, startTime: hhmm(hit.startHour) } : null
}

/** "⟳ Lower A is already on your weekly plan that day at 16:45." */
export function planTwinMessage(t: PlanTwin): string {
  const at = t.startTime ? ` at ${t.startTime}` : ''
  return t.kind === 'recurring'
    ? `⟳ ${t.title} is already on your weekly plan that day${at}.`
    : `${t.title} is already planned that day${at}.`
}
