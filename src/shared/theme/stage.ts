// One meaning → one colour, everywhere (owner, 02.10.2026). Every feature's
// status enum maps onto a Stage first, and the Stage decides the tone, so
// "Watching", "Playing" and "In progress" are the same cyan, and "Completed"
// and "Done" the same green, on covers, popups, Games, Work and Projects.
// Pure and type-only (scripts/verify-status-stages.cjs).
import type { Tone } from '../ui/Tone'

export type Stage = 'idle' | 'planned' | 'upcoming' | 'active' | 'paused' | 'done' | 'dropped'

export const STAGE_TONE: Record<Stage, Tone> = {
  idle:     'neutral',   // not started: Unwatched, Backlog, To-do, Open, Pending
  planned:  'highlight', // wanted next: Wishlist, Planned
  upcoming: 'upcoming',  // not out yet: Coming soon
  active:   'info',      // in progress: Watching, Playing, In progress, Active
  paused:   'warn',      // waiting: Paused, On hold, Waiting
  done:     'success',   // finished: Completed, Done
  dropped:  'danger',    // given up: Dropped, Cancelled, Dismissed
}

/** Map a feature's own status enum to stages, then to tones, in one step. */
export function stageTones<K extends string>(stages: Record<K, Stage>): Record<K, Tone> {
  const out = {} as Record<K, Tone>
  for (const k of Object.keys(stages) as K[]) out[k] = STAGE_TONE[stages[k]]
  return out
}
