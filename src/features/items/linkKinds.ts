// What a task plans (210's link columns), in one registry (Phase 3 A2): each kind's label and icon, its column on
// tasks, and who closes its plan (owner, 25.11.2026):
//   · tick — app-owned: ticking does it once, unticking undoes it (211's ledger: a wishlist thing bought as a draft,
//     a wish fulfilled);
//   · sync — an outside sync records it and closes the plan; the app never writes a record of its own (Hevy,
//     Trakt, Kobo, Steam / PSN / RP6 / ES-DE); a hand tick only closes the task;
//   · hand — a plan the owner ticks (football).
// The Plan buttons build their requests in `planThis.ts` (heavier imports); this module stays small, so the item
// screen's Linked chip can read it.
import { BookOpen, Clapperboard, Dumbbell, Gamepad2, ShoppingBag, Sparkles, Trophy, Tv, type LucideIcon } from 'lucide-react'
import type { Task } from '../todo/types'
import type { ItemLink, ItemLinkKind } from './itemTypes'

export interface LinkKindDef {
  kind: ItemLinkKind
  /** One word, the chip's (Short buttons). */
  label: string
  icon: LucideIcon
  /** The task's column (210). */
  column: 'movie_entry_id' | 'tv_entry_id' | 'shop_item_id' | 'wish_item_id' | 'football_plan_id' | 'game_id' | 'book_id' | 'hevy_routine_id'
  closedBy: 'tick' | 'sync' | 'hand'
}

export const LINK_KINDS: Record<ItemLinkKind, LinkKindDef> = {
  movie:     { kind: 'movie', label: 'Movie', icon: Clapperboard, column: 'movie_entry_id', closedBy: 'sync' },
  tv:        { kind: 'tv', label: 'Show', icon: Tv, column: 'tv_entry_id', closedBy: 'sync' },
  shop_item: { kind: 'shop_item', label: 'Shop', icon: ShoppingBag, column: 'shop_item_id', closedBy: 'tick' },
  wish:      { kind: 'wish', label: 'Wish', icon: Sparkles, column: 'wish_item_id', closedBy: 'tick' },
  football:  { kind: 'football', label: 'Match', icon: Trophy, column: 'football_plan_id', closedBy: 'hand' },
  game:      { kind: 'game', label: 'Game', icon: Gamepad2, column: 'game_id', closedBy: 'sync' },
  book:      { kind: 'book', label: 'Book', icon: BookOpen, column: 'book_id', closedBy: 'sync' },
  training:  { kind: 'training', label: 'Routine', icon: Dumbbell, column: 'hevy_routine_id', closedBy: 'sync' },
}

/** A task's link as the database keeps it (one column at most, `tasks_one_link`). */
export interface TaskLink { kind: ItemLinkKind; id: string; season?: number; episode?: number }

type LinkColumns = Pick<Task, 'movie_entry_id' | 'tv_entry_id' | 'link_season' | 'link_episode' | 'shop_item_id' | 'wish_item_id'
  | 'football_plan_id' | 'game_id' | 'book_id' | 'hevy_routine_id'>

/** The thing a task plans, read from its columns — never from source_type / source_id (a label). */
export function taskLinkOf(task: Partial<LinkColumns> | null | undefined): TaskLink | null {
  if (!task) return null
  for (const def of Object.values(LINK_KINDS)) {
    const id = task[def.column]
    if (typeof id === 'string' && id) {
      return def.kind === 'tv' && task.link_season != null && task.link_episode != null
        ? { kind: 'tv', id, season: task.link_season, episode: task.link_episode }
        : { kind: def.kind, id }
    }
  }
  return null
}

/** "S01E02" for an episode plan. */
export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

/** The link the item screen shows: the saved task's own (its columns), else a new plan's (the caller's source.link;
 *  a match not recorded yet has none to open). */
export function screenLinkOf(task: Partial<Task> | null | undefined, link: ItemLink | null | undefined): TaskLink | null {
  if (task) return taskLinkOf(task)
  return link && 'id' in link ? { kind: link.kind, id: link.id, season: link.season, episode: link.episode } : null
}
