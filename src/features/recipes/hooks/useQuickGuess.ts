import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { mapRowsInCache, putRowsInCache, restoreCache, snapshotCache } from '../../../shared/query/cachePatch'
import { toast } from '../../../app/store'
import { addFoodLogEntries } from '../api/foodLogApi'
import { createQuickGuessItem, fetchQuickGuessItems, reorderQuickGuessItems, updateQuickGuessItem } from '../api/quickGuessApi'
import {
  DEFAULT_GUESSES, itemToPreset, recentGuesses,
  type GuessMacros, type GuessPreset, type QuickGuessInput, type QuickGuessItem, type RecentGuess,
} from '../quickGuess'
import { SLOT_OPTIONS } from '../components/foodLogUtils'
import type { MealSlot } from '../types'
import { useRecentFoods, useRemoveFoodLogEntries } from './useFoodLog'

export interface GuessLog extends GuessMacros {
  date: string
  slot: MealSlot
  /** The diary line's title ("Beer ×2"). */
  title: string
}

const byOrder = (items: QuickGuessItem[] | null) => items && [...items].sort((a, b) => a.sort_order - b.sort_order)

/** The owner's presets in order (quick_guess_items, migration 152); null before 152. */
export function useQuickGuessItems() {
  return useQuery({ queryKey: qk.quickGuess.list(), queryFn: fetchQuickGuessItems, staleTime: STALE.default, select: byOrder })
}

/**
 * What the Quick guess card offers: the owner's presets, or the built-in ones
 * while migration 152 isn't applied (the table is missing).
 */
export function useQuickGuessPresets(): { presets: readonly GuessPreset[]; isLoading: boolean; isError: boolean; refetch: () => void } {
  const q = useQuickGuessItems()
  const presets = useMemo(() => (q.data === null ? DEFAULT_GUESSES : (q.data ?? []).map(itemToPreset)), [q.data])
  return { presets, isLoading: q.isLoading, isError: q.isError, refetch: () => { void q.refetch() } }
}

/** Your own recent guesses: past one-off lines from the 30-day recents, your presets left out (quickGuess.recentGuesses). */
export function useRecentGuesses(presets: readonly GuessPreset[]): RecentGuess[] {
  const { data = [] } = useRecentFoods()
  return useMemo(() => recentGuesses(data, presets.map(p => p.title)), [data, presets])
}

/**
 * Logs a guess as a one-off diary line and says so with Undo: "Logged Beer ×2
 * · 430 kcal to snack · Undo". Undo removes that line through the delete flow
 * without asking (it was just added), and that toast can put it back.
 */
export function useLogGuess() {
  const remove = useRemoveFoodLogEntries()
  return useMutationWithFeedback({
    action: 'log_quick_guess',
    silent: 'its own toast with Undo reports the result',
    mutationFn: (g: GuessLog) => addFoodLogEntries([{
      date: g.date, meal_slot: g.slot, custom_title: g.title,
      calories: g.kcal, protein_g: g.protein, carbs_g: g.carbs, fat_g: g.fat, sugar_g: g.sugar,
    }]),
    invalidates: ['nutrition'],
    onSuccess: (ids, g) => {
      const slot = SLOT_OPTIONS.find(o => o.id === g.slot)?.label.toLowerCase() ?? g.slot
      toast.undo(`Logged ${g.title} · ${g.kcal} kcal to ${slot}`, () => {
        void remove.run(ids, { ask: false, title: `Remove “${g.title}”?`, done: `Removed ${g.title}` })
      })
    },
  })
}

/** Adds a preset (no id) or saves one; the stored row goes straight into the list. */
export function useSaveQuickGuess() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'save_quick_guess',
    successMessage: (item: QuickGuessItem, v: { id?: string }) => (v.id ? `Saved ${item.name}` : `Added ${item.name}`),
    mutationFn: ({ id, input }: { id?: string; input: QuickGuessInput }) => (id ? updateQuickGuessItem(id, input) : createQuickGuessItem(input)),
    onSuccess: (item, v) => {
      if (v.id) putRowsInCache(qc, qk.quickGuess.all, [item])
      else qc.setQueryData<QuickGuessItem[] | null>(qk.quickGuess.list(), old => (old ? [...old, item] : old))
    },
    invalidates: [qk.quickGuess.all],
  })
}

/** Writes new places; the list moves at once (it shows the order, so no toast). */
export function useMoveQuickGuess() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, readonly { id: string; sort_order: number }[], { snapshot: ReturnType<typeof snapshotCache> }>({
    action: 'reorder_quick_guess',
    silent: 'the list shows the new order',
    mutationFn: changes => reorderQuickGuessItems(changes),
    onMutate: async changes => {
      await qc.cancelQueries({ queryKey: qk.quickGuess.all })
      const snapshot = snapshotCache(qc, qk.quickGuess.all)
      const place = new Map(changes.map(c => [c.id, c.sort_order]))
      mapRowsInCache<QuickGuessItem>(qc, qk.quickGuess.all, new Set(place.keys()), r => ({ ...r, sort_order: place.get(r.id) ?? r.sort_order }))
      return { snapshot }
    },
    onError: (_e, _v, ctx) => { if (ctx) restoreCache(qc, ctx.snapshot) },
    invalidates: [qk.quickGuess.all],
  })
}

/** "Delete Beer?" → "Beer deleted · Undo" (the one delete flow, migration 144). */
export function useDeleteQuickGuess() {
  return useRowsDelete({ table: 'quick_guess_items', action: 'delete_quick_guess', invalidates: [qk.quickGuess.all], cache: qk.quickGuess.all })
}
