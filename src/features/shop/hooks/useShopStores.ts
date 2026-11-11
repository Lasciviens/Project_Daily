import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { putRowsInCache, removeRowsFromCache } from '../../../shared/query/cachePatch'
import {
  addStoreRule, fetchDealDayRows, fetchLawRules, fetchShopStores, fetchSitePolicyHosts, fetchStoreRules, putDealDayEdit, putShopStore, putStoreRule,
  removeOwnStoreRule, resetDealDay, resetShopStore, resetStoreRule, saveDealDayEdit, updateShopStore, updateStoreRule,
  type DealDayInput, type RowChange, type StorePatch,
} from '../api/shopStoresApi'
import type { StoreRulePatch } from '../storeRows'
import type { ShopDealDayEdit, ShopStore, ShopStoreRule, ShopStoreRuleFacts } from '../types'

// Stores, marketplaces and their rules, Norway's law and the owner's deal days (migration 191). Each write answers
// the row before and after: the cached list takes the after at once, and the toast's Undo writes `before` back
// exactly (the database then works out owner_edited again, so an Undo is never "edited" by itself).

/** The account's stores and marketplaces. storeRules.storeOfLink says which one a link is on. */
export function useShopStores() {
  return useQuery({ queryKey: qk.shop.stores(), queryFn: fetchShopStores, staleTime: STALE.default })
}

/** The account's store rules (each store's: storeRules.rulesInForce). */
export function useStoreRules() {
  return useQuery({ queryKey: qk.shop.storeRules(), queryFn: fetchStoreRules, staleTime: STALE.default })
}

/** Norway's consumer law (changed only by a migration). */
export function useLawRules() {
  return useQuery({ queryKey: qk.shop.lawRules(), queryFn: fetchLawRules, staleTime: STALE.day })
}

/** The hosts whose terms forbid apps to read them (188): storeRules.storeSitePolicy says whether a store is one. */
export function useSitePolicyHosts() {
  return useQuery({ queryKey: qk.shop.sitePolicies(), queryFn: fetchSitePolicyHosts, staleTime: STALE.day })
}

/** Each deal day with the owner's own version and what counts (Needs a look reads `useDealDays`, the counted ones). */
export function useDealDayRows() {
  return useQuery({ queryKey: qk.shop.dealDayRows(), queryFn: fetchDealDayRows, staleTime: STALE.default })
}

// ── A rule ───────────────────────────────────────────────────────────────────

type PutRuleVars = { rule: ShopStoreRule; done: string }

/** Writes a rule back exactly — the Undo of an edit and of a reset; `done` is what it says. */
function usePutStoreRule() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'put_shop_store_rule',
    successMessage: (_: ShopStoreRule, v: PutRuleVars) => v.done,
    mutationFn:     (v: PutRuleVars) => putStoreRule(v.rule),
    onSuccess:      (after: ShopStoreRule) => putRowsInCache(qc, qk.shop.storeRules(), [after]),
    invalidates:    [qk.shop.storeRules()],
  })
}

/** Edit a rule: "Rule saved — yours now, never overwritten · Undo" (or the caller's words: "… turned off"). */
export function useEditStoreRule() {
  const qc = useQueryClient()
  const put = usePutStoreRule()
  return useMutationWithFeedback({
    action:      'edit_shop_store_rule',
    silent:      'its own toast reports it with Undo ("Rule saved — yours now, never overwritten · Undo")',
    mutationFn:  (v: { id: string; patch: StoreRulePatch; done?: string }) => updateStoreRule(v.id, v.patch),
    onSuccess:   (r: RowChange<ShopStoreRule>, v: { id: string; patch: StoreRulePatch; done?: string }) => {
      putRowsInCache(qc, qk.shop.storeRules(), [r.after])
      const words = v.done ?? (r.after.owner_edited ? 'Rule saved — yours now, never overwritten' : 'Rule saved — the same as its source again')
      toast.undo(words, () => put.mutate({ rule: r.before, done: 'Edit undone' }))
    },
    invalidates: [qk.shop.storeRules()],
  })
}

/** Reset a rule to its source: "Back to Elkjøp's page · Undo" (the source named by the caller). */
export function useResetStoreRule() {
  const qc = useQueryClient()
  const put = usePutStoreRule()
  return useMutationWithFeedback({
    action:      'reset_shop_store_rule',
    silent:      'its own toast reports it with Undo ("Back to its source · Undo")',
    mutationFn:  (v: { id: string }) => resetStoreRule(v.id),
    onSuccess:   (r: RowChange<ShopStoreRule>) => {
      putRowsInCache(qc, qk.shop.storeRules(), [r.after])
      toast.undo('Back to its source', () => put.mutate({ rule: r.before, done: 'Reset undone' }))
    },
    invalidates: [qk.shop.storeRules()],
  })
}

/** Add a rule of the owner's own: "Rule added · Undo" (the Undo takes it away again). */
export function useAddStoreRule() {
  const qc = useQueryClient()
  const remove = useMutationWithFeedback({
    action:         'remove_shop_store_rule',
    successMessage: 'Rule taken away again',
    mutationFn:     (id: string) => removeOwnStoreRule(id),
    onSuccess:      (_: void, id: string) => removeRowsFromCache(qc, qk.shop.storeRules(), new Set([id])),
    invalidates:    [qk.shop.storeRules()],
  })
  return useMutationWithFeedback({
    action:      'add_shop_store_rule',
    silent:      'its own toast reports it with Undo ("Rule added · Undo")',
    mutationFn:  (v: { storeId: string; facts: ShopStoreRuleFacts }) => addStoreRule(v.storeId, v.facts),
    onSuccess:   (rule: ShopStoreRule) => {
      qc.setQueryData<ShopStoreRule[]>(qk.shop.storeRules(), rows => (rows ? [...rows, rule] : rows))
      toast.undo('Rule added — yours, never overwritten', () => remove.mutate(rule.id))
    },
    invalidates: [qk.shop.storeRules()],
  })
}

// ── A store ──────────────────────────────────────────────────────────────────

type PutStoreVars = { store: ShopStore; done: string }

function usePutShopStore() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'put_shop_store',
    successMessage: (_: ShopStore, v: PutStoreVars) => v.done,
    mutationFn:     (v: PutStoreVars) => putShopStore(v.store),
    onSuccess:      (after: ShopStore) => putRowsInCache(qc, qk.shop.stores(), [after]),
    invalidates:    [qk.shop.stores()],
  })
}

/** Edit a store — its member tier too: "Elkjøp saved · Undo" (or the caller's words: "Elkjøp hidden"). */
export function useEditShopStore() {
  const qc = useQueryClient()
  const put = usePutShopStore()
  return useMutationWithFeedback({
    action:      'edit_shop_store',
    silent:      'its own toast reports it with Undo ("Elkjøp saved · Undo")',
    mutationFn:  (v: { id: string; patch: StorePatch; done?: string }) => updateShopStore(v.id, v.patch),
    onSuccess:   (r: RowChange<ShopStore>, v: { id: string; patch: StorePatch; done?: string }) => {
      putRowsInCache(qc, qk.shop.stores(), [r.after])
      toast.undo(v.done ?? `${r.after.name} saved`, () => put.mutate({ store: r.before, done: 'Edit undone' }))
    },
    invalidates: [qk.shop.stores()],
  })
}

/** Reset a store's facts to its source (its member tier stays): "Elkjøp back to its source · Undo". */
export function useResetShopStore() {
  const qc = useQueryClient()
  const put = usePutShopStore()
  return useMutationWithFeedback({
    action:      'reset_shop_store',
    silent:      'its own toast reports it with Undo ("Elkjøp back to its source · Undo")',
    mutationFn:  (v: { id: string }) => resetShopStore(v.id),
    onSuccess:   (r: RowChange<ShopStore>) => {
      putRowsInCache(qc, qk.shop.stores(), [r.after])
      toast.undo(`${r.after.name} back to its source`, () => put.mutate({ store: r.before, done: 'Reset undone' }))
    },
    invalidates: [qk.shop.stores()],
  })
}

// ── A deal day ───────────────────────────────────────────────────────────────

type PutDealVars = { slug: string; edit: ShopDealDayEdit | null; done: string }

function usePutDealDayEdit() {
  return useMutationWithFeedback({
    action:         'put_shop_deal_day_edit',
    successMessage: (_: void, v: PutDealVars) => v.done,
    mutationFn:     (v: PutDealVars) => putDealDayEdit(v.slug, v.edit),
    invalidates:    [qk.shop.dealDays()],
  })
}

/** Edit a deal day (190's or one of the owner's own): "Black Friday saved — yours now · Undo". */
export function useEditDealDay() {
  const put = usePutDealDayEdit()
  return useMutationWithFeedback({
    action:      'edit_shop_deal_day',
    silent:      'its own toast reports it with Undo ("Black Friday saved — yours now · Undo")',
    mutationFn:  (v: DealDayInput & { done?: string }) => saveDealDayEdit(v),
    onSuccess:   (r: { before: ShopDealDayEdit | null; after: ShopDealDayEdit }, v: DealDayInput & { done?: string }) => {
      toast.undo(v.done ?? `${r.after.name} saved — yours now`, () => put.mutate({ slug: v.slug, edit: r.before, done: 'Edit undone' }))
    },
    invalidates: [qk.shop.dealDays()],
  })
}

/** Reset a deal day: the owner's version goes and the app's rule counts again ("Black Friday back to the app's rule · Undo"). */
export function useResetDealDay() {
  const put = usePutDealDayEdit()
  return useMutationWithFeedback({
    action:      'reset_shop_deal_day',
    silent:      'its own toast reports it, with Undo when it took a version away',
    mutationFn:  (v: { slug: string; name: string }) => resetDealDay(v.slug),
    onSuccess:   (r: { before: ShopDealDayEdit | null }, v: { slug: string; name: string }) => {
      const before = r.before
      if (before) toast.undo(`${v.name} back to the app's rule`, () => put.mutate({ slug: v.slug, edit: before, done: 'Reset undone' }))
      else toast.success(`${v.name} is the app's rule already`)
    },
    invalidates: [qk.shop.dealDays()],
  })
}
