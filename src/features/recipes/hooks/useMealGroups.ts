import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { toast } from '../../../app/store'
import { formatDate } from '../../../shared/utils/dateFormat'
import {
  copyMealGroup, fetchMealGroupRows, moveMealGroup, moveOutOfGroup, renameMealGroup, restorePlaces, saveDishEdit,
  undoDishEdit, ungroupMealGroup, type DishEditResult, type RowPlace,
} from '../api/mealGroupApi'
import type { LoggedFood } from '../api/foodLogApi'
import type { LogItem } from '../foodBasket'
import { SLOT_OPTIONS } from '../components/foodLogUtils'
import type { MealSlot } from '../types'
import { useRemoveFoodLogEntries } from './useFoodLog'

// The dish actions (Food point 5): every move, copy, ungroup and rename says
// what it did with Undo; the delete is the diary's own (asks, then Undo).

export interface Place { date: string; slot: MealSlot }

const slotWord = (s: MealSlot) => SLOT_OPTIONS.find(o => o.id === s)?.label.toLowerCase() ?? s

/** "lunch", or "lunch on 17.10.2026" when the day changes. */
export const placeText = (to: Place, fromDate?: string): string =>
  to.date === fromDate ? slotWord(to.slot) : `${slotWord(to.slot)} on ${formatDate(to.date)}`

/** The rows of one dish, for Edit meal's basket. */
export function useMealGroupRows(groupId: string | null | undefined) {
  return useQuery({
    queryKey: qk.foodLog.group(groupId ?? ''),
    queryFn: () => fetchMealGroupRows(groupId!),
    enabled: !!groupId,
    staleTime: STALE.live,
  })
}

/** Puts rows back where (and in which dish) they were — the Undo of a move, an ungroup, a "Move out of meal". */
function useRestorePlaces() {
  return useMutationWithFeedback({
    action: 'restore_meal_group_places',
    successMessage: (_: void, v: { places: readonly RowPlace[]; done: string }) => v.done,
    mutationFn: ({ places }: { places: readonly RowPlace[]; done: string }) => restorePlaces(places),
    invalidates: ['nutrition'],
  })
}

/** Move to (another meal or day): "Moved Taco plate to lunch · Undo". */
export function useMoveDish() {
  const restore = useRestorePlaces()
  return useMutationWithFeedback({
    action: 'move_meal_group',
    silent: 'its own toast with Undo reports the result',
    mutationFn: ({ groupId, to }: { groupId: string; to: Place; name: string; fromDate: string }) => moveMealGroup(groupId, to),
    invalidates: ['nutrition'],
    onSuccess: (before, v) => {
      toast.undo(`Moved ${v.name} to ${placeText(v.to, v.fromDate)}`, () => restore.mutate({ places: before, done: `${v.name} is back` }))
    },
  })
}

/** Copy to (today, a date): "Copied Taco plate to lunch on 17.10.2026 · Undo" — Undo removes the copy. */
export function useCopyDish() {
  const remove = useRemoveFoodLogEntries()
  return useMutationWithFeedback({
    action: 'copy_meal_group',
    silent: 'its own toast with Undo reports the result',
    mutationFn: ({ groupId, to }: { groupId: string; to: Place; name: string; fromDate: string }) => copyMealGroup(groupId, to),
    invalidates: ['nutrition'],
    onSuccess: (ids, v) => {
      if (ids.length === 0) { toast.warning(`${v.name} has nothing to copy`); return }
      toast.undo(`Copied ${v.name} to ${placeText(v.to, v.fromDate)}`, () => {
        void remove.run(ids, { ask: false, title: `Remove the copy of ${v.name}?`, done: `Removed the copy of ${v.name}` })
      })
    },
  })
}

/** Ungroup: the dish becomes its rows. */
export function useUngroupDish() {
  const restore = useRestorePlaces()
  return useMutationWithFeedback({
    action: 'ungroup_meal_group',
    silent: 'its own toast with Undo reports the result',
    mutationFn: ({ groupId }: { groupId: string; name: string }) => ungroupMealGroup(groupId),
    invalidates: ['nutrition'],
    onSuccess: (before, v) => toast.undo(`Ungrouped ${v.name}`, () => restore.mutate({ places: before, done: `${v.name} is one meal again` })),
  })
}

/** An item's "Move out of meal": it stays in the same meal, in no dish. */
export function useMoveOutOfDish() {
  const restore = useRestorePlaces()
  return useMutationWithFeedback({
    action: 'move_out_of_meal_group',
    silent: 'its own toast with Undo reports the result',
    mutationFn: ({ entryId }: { entryId: string; item: string; dish: string }) => moveOutOfGroup(entryId),
    invalidates: ['nutrition'],
    onSuccess: (before, v) => toast.undo(`Moved ${v.item} out of ${v.dish}`, () => restore.mutate({ places: before, done: `${v.item} is back in ${v.dish}` })),
  })
}

/** Rename (empty = the automatic name again): "Renamed to Taco plate · Undo". */
export function useRenameDish() {
  const putBack = useMutationWithFeedback({
    action: 'restore_meal_group_title',
    successMessage: 'Name put back',
    mutationFn: ({ groupId, title }: { groupId: string; title: string | null }) => renameMealGroup(groupId, title),
    invalidates: ['nutrition'],
  })
  return useMutationWithFeedback({
    action: 'rename_meal_group',
    silent: 'its own toast with Undo reports the result',
    mutationFn: ({ groupId, title }: { groupId: string; title: string | null; shown: string }) => renameMealGroup(groupId, title),
    invalidates: ['nutrition'],
    onSuccess: (before, v) => {
      const msg = v.title?.trim() ? `Renamed to ${v.title.trim()}` : `Named ${v.shown} again`
      toast.undo(msg, () => putBack.mutate({ groupId: v.groupId, title: before }))
    },
  })
}

/** Edit meal's Save: the dish as the basket holds it — "Saved Taco plate · Undo". */
export function useSaveDishEdit() {
  const undo = useMutationWithFeedback({
    action: 'undo_meal_group_edit',
    successMessage: (_: void, v: { result: DishEditResult; name: string }) => `${v.name} is as it was`,
    mutationFn: ({ result }: { result: DishEditResult; name: string }) => undoDishEdit(result),
    invalidates: ['nutrition'],
  })
  return useMutationWithFeedback({
    action: 'save_meal_group_edit',
    silent: 'its own toast with Undo reports the result',
    mutationFn: (input: {
      groupId: string; groupTitle: string | null; date: string; slot: MealSlot
      before: readonly LoggedFood[]; items: readonly LogItem[]; name: string
    }) => saveDishEdit(input),
    invalidates: ['nutrition'],
    onSuccess: (result, v) => toast.undo(`Saved ${v.name}`, () => undo.mutate({ result, name: v.name })),
  })
}
