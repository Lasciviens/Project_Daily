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
import type { MediaRef, MediaType } from '../../features/media/types'
import type { TrainingPlanRef } from '../../features/training/api/trainingPlanApi'

export type EntityModalRequest =
  // One item (migration 155): these four open the same Add sheet (plan-modal/
  // PlanEntityModals) — a task, a one-off block, a repeat; the kind only says
  // which row the id names and what a new item starts with.
  | { kind: 'task'; id?: string; defaults?: PlanDefaults; config?: PlanModalConfig; source?: PlanSource; onSaved?: (r: PlanResult) => void }
  | { kind: 'time-block'; id?: string; defaults?: PlanDefaults; config?: PlanModalConfig; source?: PlanSource; onSaved?: (r: PlanResult) => void }
  /** `occurrenceDate`: the day of the repeat it was opened on — the sheet then offers This day | All days. */
  | { kind: 'schedule-block'; id?: string; occurrenceDate?: string; defaults?: PlanDefaults; config?: PlanModalConfig; source?: PlanSource; onSaved?: (r: PlanResult) => void }
  /** A one-off block by id, opened as its task's item when it has one. */
  | { kind: 'plan-block'; blockId: string }
  // Food.
  /** Log food (basket logger). `query` prefills the search box; `groupId` opens a dish (its rows) as Edit meal. */
  | { kind: 'food-log'; date: string; slot?: MealSlot; query?: string; groupId?: string }
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
  /** `sequence`: the list it was opened from, in on-screen order — the popup's previous / next. */
  | { kind: 'media'; tmdbId: number; mediaType: MediaType; sequence?: MediaRef[] }
  /** One training session: a logged Hevy workout (`workoutId`) or a planned
   *  one (`plan` — a recurring occurrence has no row, so it carries its day). */
  | { kind: 'training-session'; workoutId?: string; plan?: { kind: 'block' | 'recurring'; id: string; date: string }; taskId?: string }
  // Move or skip one planned training session — the same sheets from every
  // view (features/training/modals/TrainingPlanSheets). Skip also takes a
  // missed routine with no plan (Training → Missed sessions).
  | { kind: 'training-plan-move'; plan: TrainingPlanRef }
  | { kind: 'training-plan-skip'; plan?: TrainingPlanRef; missed?: { routineId: string; title: string; dueDate: string; weekStart: string } }
  /** One exercise (a Hevy template): its picture and demo, muscles and Hevy's
   *  own history of it. `title` is prefill for one the library here lacks. */
  | { kind: 'exercise'; templateId: string; title?: string }
  /** One Apple Health workout (Health → Workouts), with its matching Hevy session. */
  | { kind: 'health-workout'; id: string }
  /** Log or edit a Hevy body measurement; `date` opens that day's row (default today). */
  | { kind: 'body-measurement'; date?: string }
  | { kind: 'wish'; id: string }
  /** A Shop item: open by `id` (a wishlist row as its record), or add one (`defaults` picks the list, a title, a category, a store, a general wish). */
  | { kind: 'shop-item'; id?: string; defaults?: { list?: 'wishlist' | 'quick'; title?: string; categoryId?: string; platform?: string; general?: boolean } }
  /** Sell or give away one of your things (with its accessories), and where the money goes. */
  | { kind: 'shop-sell'; id: string }
  /** A thing's money chain: what earlier sales passed on, and "Try other prices". */
  | { kind: 'shop-chain'; id: string }
  /** Quick-add accessories to one of your things (or to a wish). */
  | { kind: 'shop-accessory'; itemId: string }
  /** Add a model to a general wish ("a tablet with a pen" → iPad Air). */
  | { kind: 'shop-model'; wishId: string }
  /** Add something you own (or had) from before the app, with ≈ dates. */
  | { kind: 'shop-own'; had?: boolean }
  /** Build a money chain in one go (bought → sold → bought…); `fromId`: go on from that saved thing that left. */
  | { kind: 'shop-chain-builder'; fromId?: string }
  | { kind: 'project-item'; projectId: string; id?: string; phaseId?: string }
  | { kind: 'memory'; id: string }
  /** One book in the Books library (books, migration 126). */
  | { kind: 'book'; id: string }
  /** Undo one save of the activity log (its transaction): the preview, then the undo (migrations 150/151). */
  | { kind: 'undo-save'; txId: number }
  // Generic.
  | { kind: 'confirm'; title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; resolve: (ok: boolean) => void }

export type ModalKind = EntityModalRequest['kind']
export type RequestOf<K extends ModalKind> = Extract<EntityModalRequest, { kind: K }>

/** What every registered modal receives. It never receives a row — it loads by id. */
export interface EntityModalProps<K extends ModalKind> {
  request: RequestOf<K>
  onClose: () => void
}
