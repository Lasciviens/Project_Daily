// What a tick of a linked plan says (owner-critic, 26.11.2026: the tick says what happened). Pure — verify-plan-this.
// 211's ledger is the database's; the browser reads the effects of the task and their things after the write.

/** One effect a done plan had on its thing (task_link_effects). */
export interface TickEffect { effect: 'shop_bought' | 'wish_done' | 'phase_done'; target_id: string; before: { status?: string | null } }
/** The thing as it is now. */
export interface EffectTarget { title: string | null; status: string | null }
/** An effect with its thing after the write. */
export interface TickOutcome { effect: TickEffect; now: EffectTarget }

/** Done: "Task done · Kettle bought — check it in Shop" / "· wish fulfilled" / "· phase done"; plain "Task done" else. */
export function doneMessage(outcomes: readonly TickOutcome[]): string {
  const parts = outcomes.map(({ effect, now }) => effect.effect === 'shop_bought'
    ? `${now.title ? `${now.title} bought` : 'bought'} — check it in Shop`
    : effect.effect === 'wish_done' ? 'wish fulfilled' : 'phase done')
  return ['Task done', ...parts].join(' · ')
}

/** Reopened: what was undone ("back on the wishlist", "wish open again", "phase open again"), or that the owner's own
 *  change was kept (the database undoes an effect only while the thing still holds what it set). */
export function reopenMessage(outcomes: readonly TickOutcome[]): string {
  const parts = outcomes.map(({ effect, now }) => {
    const undone = (now.status ?? null) === (effect.before.status ?? null)
    if (effect.effect === 'shop_bought') return undone ? 'back on the wishlist' : 'your purchase kept'
    if (effect.effect === 'wish_done') return undone ? 'wish open again' : 'your wish kept'
    return undone ? 'phase open again' : 'phase kept'
  })
  return ['Task reopened', ...parts].join(' · ')
}
