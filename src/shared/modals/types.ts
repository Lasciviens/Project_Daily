// ─────────────────────────────────────────────────────────────────────────────
//  Entity modals — the typed request contract (docs/design/THEME.md §9).
//
//  Any component opens a popup with   useEntityModal().open({ kind, … })
//  and the ONE <ModalHost/> renders it. Rules:
//   1. A request carries ids and prefill only — never a row. The modal loads
//      its data by id through the feature's own query hook, so a stale row from
//      a list can never be saved back.
//   2. Writes go through the feature's mutation hooks (useMutationWithFeedback).
//      No supabase.* / raw api call inside a modal file.
//   3. Cache invalidation lives in the hook, not the modal.
//   4. `onSaved`-style callbacks only for cross-entity follow-ups.
//  Adding a kind = one line here + one line in registry.ts + the adapter.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlanDefaults, PlanModalConfig, PlanSource, PlanResult } from '../components/plan-modal'
import type { MealSlot } from '../../features/recipes/types'
import type { MediaType } from '../../features/media/types'

export type EntityModalRequest =
  // Tasks and schedule — every former UnifiedPlanModal mount.
  | { kind: 'task'; id?: string; defaults?: PlanDefaults; config?: PlanModalConfig; source?: PlanSource; onSaved?: (r: PlanResult) => void }
  | { kind: 'time-block'; id?: string; defaults?: PlanDefaults; config?: PlanModalConfig; source?: PlanSource; onSaved?: (r: PlanResult) => void }
  | { kind: 'schedule-block'; id?: string; defaults?: PlanDefaults; config?: PlanModalConfig; source?: PlanSource; onSaved?: (r: PlanResult) => void }
  /** Opens whatever editor a one-off block belongs to: its task when task-linked, else the block. */
  | { kind: 'plan-block'; blockId: string }
  // Food.
  /** Log food (basket logger). `query` prefills the search box. */
  | { kind: 'food-log'; date: string; slot?: MealSlot; query?: string }
  /** Edit one diary row, loaded by id. */
  | { kind: 'food-log-edit'; entryId: string; date: string }
  /** Plan a meal into a slot; with `entryId`, edit that planned row. */
  | { kind: 'meal-plan'; date: string; slot: MealSlot; entryId?: string }
  /** Recipe editor: create without `id`. */
  | { kind: 'recipe'; id?: string }
  | { kind: 'recipe-view'; id: string }
  /** Nutrition goals editor; `date` feeds the coach (default today). */
  | { kind: 'day-targets'; date?: string }
  // Other features.
  | { kind: 'media'; tmdbId: number; mediaType: MediaType }
  | { kind: 'hevy-workout'; id: string }
  | { kind: 'wish'; id: string }
  | { kind: 'project-item'; projectId: string; id?: string; phaseId?: string }
  | { kind: 'memory'; id: string }
  // Generic.
  | { kind: 'confirm'; title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; resolve: (ok: boolean) => void }

export type ModalKind = EntityModalRequest['kind']
export type RequestOf<K extends ModalKind> = Extract<EntityModalRequest, { kind: K }>

/** What every registered modal receives. It never receives a row — it loads by id. */
export interface EntityModalProps<K extends ModalKind> {
  request: RequestOf<K>
  onClose: () => void
}
