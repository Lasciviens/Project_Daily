// What a status change of a linked plan did to its thing (211's ledger; 216's watches) — ONE helper for the tick, the
// reopen and the cancel, so each says the same and sends a watch change to Trakt the same way.
import type { QueryClient } from '@tanstack/react-query'
import { fetchEffectTarget, fetchTickEffects } from '../../items/linkApi'
import { isWatch, type TickOutcome } from '../../items/tickMessage'
import { updateTask } from '../api/tasksApi'
import type { Task, TaskStatus } from '../types'

export interface StatusChange { task: Task; outcomes: TickOutcome[] }

/** Only a task that plans an app-owned thing can have an effect (a wishlist thing, a wish, a project phase; 216: a
 *  movie, one episode of a show). */
const mayHaveEffect = (t: Task) => !!(t.shop_item_id || t.wish_item_id || t.project_phase_id || t.movie_entry_id
  || (t.tv_entry_id && t.link_episode != null))

/**
 * The status write and what it did: the effects are read BEFORE an untick (the database forgets an undone one) and
 * AFTER a tick, then each thing as it is now. `wasDone` false skips the read before a write that can't untick.
 * `completed_at` lets Undo tick again at the tick's own time (the watch comes back at its date).
 */
export async function changeStatusWithEffects(id: string, patch: { status: TaskStatus; completed_at?: string }, wasDone = true): Promise<StatusChange> {
  const ticking = patch.status === 'done'
  const before = ticking || !wasDone ? [] : await fetchTickEffects(id).catch(() => [])
  const task = await updateTask(id, patch)
  const effects = ticking ? (mayHaveEffect(task) ? await fetchTickEffects(id).catch(() => []) : []) : before
  const outcomes = await Promise.all(effects.map(async e => ({ effect: e, now: await fetchEffectTarget(e).catch(() => ({ title: null, status: null })) })))
  return { task, outcomes }
}

/** A watch was added or removed (216): the outbox holds it for Trakt — send it soon, as the Media page does (loaded on
 *  use: the Trakt client stays out of every page's first load). */
export function sendWatchesSoon(qc: QueryClient, outcomes: readonly TickOutcome[]): void {
  if (!outcomes.some(o => isWatch(o.effect))) return
  void import('../../media/trakt/traktAutoSync').then(m => m.scheduleTraktSync(qc), () => undefined)
}
