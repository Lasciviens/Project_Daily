// What a tick of a linked plan says (owner-critic, 26.11.2026: the tick says what happened). Pure — verify-plan-this.
// 211's ledger is the database's; the browser reads the effects of the task and their things after the write.

/** One effect a done plan had on its thing (task_link_effects). 216: a movie or episode plan's watch (`after.watch_id`;
 *  an episode also `after.season` / `after.episode`). */
export interface TickEffect {
  effect: 'shop_bought' | 'wish_done' | 'phase_done' | 'movie_watched' | 'episode_watched'
  target_id: string
  before: { status?: string | null }
  after?: { watch_id?: string | null; watched_at?: string | null; season?: number | null; episode?: number | null } | null
}

/** A movie or episode plan's watch (216). */
export const isWatch = (e: TickEffect) => e.effect === 'movie_watched' || e.effect === 'episode_watched'
const pad = (n: number) => String(n).padStart(2, '0')
/** "S01E03 marked watched" — short; the show's title is in the task's own row. */
const episodeDone = (e: TickEffect) => (e.after?.season != null && e.after?.episode != null
  ? `S${pad(e.after.season)}E${pad(e.after.episode)} marked watched` : 'episode marked watched')
/** The thing as it is now; for a movie or an episode also whether the tick's watch is still there. */
export interface EffectTarget { title: string | null; status: string | null; watchLeft?: boolean }
/** An effect with its thing after the write. */
export interface TickOutcome { effect: TickEffect; now: EffectTarget }

/** Done: "Task done · Kettle bought — check it in Shop" / "· wish fulfilled" / "· phase done" / "· Dune marked watched" /
 *  "· S01E03 marked watched";
 *  plain "Task done" else. */
export function doneMessage(outcomes: readonly TickOutcome[]): string {
  const parts = outcomes.map(({ effect, now }) => effect.effect === 'shop_bought'
    ? `${now.title ? `${now.title} bought` : 'bought'} — check it in Shop`
    : effect.effect === 'movie_watched' ? `${now.title ?? 'movie'} marked watched`
    : effect.effect === 'episode_watched' ? episodeDone(effect)
    : effect.effect === 'wish_done' ? 'wish fulfilled' : 'phase done')
  return ['Task done', ...parts].join(' · ')
}

/** Reopened or cancelled (`lead`): what was undone ("back on the wishlist", "wish open again", "phase open again",
 *  "watch removed"), or that the owner's own change was kept (the database undoes an effect only while the thing still
 *  holds what it set). A watch whose follow-up read failed says nothing rather than guess. */
export function reopenMessage(outcomes: readonly TickOutcome[], lead = 'Task reopened'): string {
  const parts = outcomes.flatMap(({ effect, now }) => {
    // A movie or an episode: the tick's watch is gone (removed), or the owner had changed it (kept).
    if (isWatch(effect)) return now.watchLeft === undefined ? [] : [now.watchLeft ? 'your watch kept' : 'watch removed']
    const undone = (now.status ?? null) === (effect.before.status ?? null)
    if (effect.effect === 'shop_bought') return [undone ? 'back on the wishlist' : 'your purchase kept']
    if (effect.effect === 'wish_done') return [undone ? 'wish open again' : 'your wish kept']
    return [undone ? 'phase open again' : 'phase kept']
  })
  return [lead, ...parts].join(' · ')
}

/** The tick's own time of a watch the untick removed (216) — Undo ticks the plan again at it, so the watch comes back
 *  at its date. Null when no watch was removed (none, kept, or unknown). */
export function removedWatchAt(outcomes: readonly TickOutcome[]): string | null {
  const o = outcomes.find(x => isWatch(x.effect) && x.now.watchLeft === false && !!x.effect.after?.watched_at)
  return o?.effect.after?.watched_at ?? null
}
