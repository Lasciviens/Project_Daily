import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { removeRowsFromCache } from '../../../shared/query/cachePatch'
import type { RemovedAdded } from '../api/shopCategoryApi'
import type { ShopCategory } from '../types'

// The taxonomy and the writes load on their own, as the default pictures do (the Shop page's 390 kB budget):
// pure modules only, so the page's header asks for them without pulling anything else out of the shared code.
type Taxonomy = typeof import('../shopTaxonomy')
let taxonomy: Taxonomy | null = null
let pending: Promise<void> | null = null
const loadTaxonomy = () => (pending ??= import('../shopTaxonomy').then(m => { taxonomy = m }, () => { pending = null }))
const loadApi = () => import('../api/shopCategoryApi')

const byName = (a: ShopCategory, b: ShopCategory) => a.name.localeCompare(b.name, 'nb')

/**
 * "Add the suggested categories (34)" — the Shop header's ⋯ and the picker's Suggested group (owner,
 * 10.11.2026: added once, on the owner's tap, with Undo). `count` is what the pickers suggest now
 * (`suggestedPlan`; null until the taxonomy is in); `add` makes them all (`addSuggestedCategories`, worked out
 * again from a fresh read), puts the rows into the cached list and says "34 categories added · Undo". Undo
 * removes exactly those rows, and only the ones still empty and as made — "32 categories removed · 2 kept, in
 * use now: Phones, Electronics" (a warning: some stay). `add` answers the rows made, or null when the write
 * failed (its toast said why).
 */
export function useAddSuggestedCategories(categories: readonly ShopCategory[]) {
  const qc = useQueryClient()
  const [, settled] = useState(0)
  useEffect(() => {
    if (taxonomy) return
    let live = true
    void loadTaxonomy().then(() => { if (live) settled(n => n + 1) })
    return () => { live = false }
  }, [])
  const count = taxonomy ? taxonomy.suggestedPlan(categories).count : null

  const undo = useMutationWithFeedback({
    action:         'remove_added_shop_categories',
    successMessage: (r: RemovedAdded & { words: string }) => (r.kept.length ? undefined : r.words),
    mutationFn:     async (made: ShopCategory[]) => {
      const api = await loadApi()
      const r = await api.removeAddedCategories(made)
      return { ...r, words: api.undoneWords(r) }
    },
    onSuccess:      (r: RemovedAdded & { words: string }) => {
      removeRowsFromCache(qc, qk.shop.categories(), new Set(r.removed))
      if (r.kept.length) toast.warning(r.words, 8000)
    },
    invalidates:    [qk.shop.categories()],
  })
  const add = useMutationWithFeedback({
    action:         'add_suggested_shop_categories',
    successMessage: ({ rows }: { rows: ShopCategory[]; words: string }) => (rows.length ? undefined : 'Nothing new to add'),
    mutationFn:     async () => {
      const api = await loadApi()
      const rows = await api.addSuggestedCategories()
      return { rows, words: api.addedWords(rows.length) }
    },
    onSuccess:      ({ rows, words }: { rows: ShopCategory[]; words: string }) => {
      if (!rows.length) return
      const made = new Set(rows.map(r => r.id))
      qc.setQueryData<ShopCategory[]>(qk.shop.categories(), list => (list ? [...list.filter(r => !made.has(r.id)), ...rows].sort(byName) : list))
      toast.undo(words, () => undo.mutate(rows))
    },
    invalidates:    [qk.shop.categories()],
  })
  async function run(): Promise<ShopCategory[] | null> {
    try { return (await add.mutateAsync()).rows } catch { return null }
  }
  return { count, add: run, busy: add.isPending }
}
