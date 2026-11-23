import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { mapRowsInCache, putRowsInCache } from '../../../shared/query/cachePatch'
import { ClaudeJobError } from '../../ai/claude/claudeApi'
import { tidyThing } from '../../ai/claude/featureJobs'
import { updateShopItem } from '../api/shopApi'
import { readTidySuggestion, tidyCategories, tidyInputFor, tidyPatch, tidyUndoPatch, type TidyKey, type TidySuggestion } from '../tidyModel'
import type { ShopCategory, ShopItem, UpdateShopItemInput } from '../types'

// "Tidy up info" (tidyModel.ts): one call per thing, one at a time, then ONE save for every ticked field with ONE Undo.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A pause the owner's Stop cuts short. */
const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
})

/** The reasons that stop the whole run (a switch is off, the budget is out, the AI is not set up): asking again would only repeat them. */
const HALTS = new Set(['off', 'budget', 'not_configured'])
/** The per-minute cap clears itself: a wait and one more try, a few times, then the run stops with the function's own words. */
const BUSY_WAIT_MS = 20_000
const BUSY_TRIES = 3

export interface TidyRunResult {
  suggestions: Map<string, TidySuggestion>
  /** Things whose call failed for a reason of their own (they are skipped). */
  failed: number
  /** The owner pressed Stop. */
  stopped: boolean
  /** The function's own sentence when the run had to end early (a switch, the budget, a cap). */
  halted: string | null
  /** What the calls cost in all, from their own ledger rows. */
  costUsd: number
  /** At least one call searched the web. */
  searched: boolean
}

export interface TidyRunInput {
  rows: readonly ShopItem[]
  categories: readonly ShopCategory[]
  pathOf: (id: string | null) => string
  signal: AbortSignal
  /** Called before each call: how many are done, the total, and the thing's name. */
  onStep: (done: number, total: number, name: string) => void
  /** Called once a thing's suggestion is checked (so the review can fill while the rest is read). */
  onSuggestion: (id: string, s: TidySuggestion) => void
}

/** Reads each thing with the AI, one at a time. Every answer is checked again here; nothing is saved. */
export function useTidyRun() {
  return useMutationWithFeedback<TidyRunResult, TidyRunInput>({
    action: 'tidy_shop_things',
    silent: 'the review shows what was found; a stop is the function\'s own sentence there',
    logPayload: false,
    mutationFn: async ({ rows, categories, pathOf, signal, onStep, onSuggestion }) => {
      const list = tidyCategories(categories)
      const allowed = new Set(list.map(c => c.id))
      const suggestions = new Map<string, TidySuggestion>()
      let failed = 0, costUsd = 0, stopped = false, searched = false, halted: string | null = null
      // Two failures in a row end the run with the error's own sentence (a broken key or a down service would repeat it for every thing).
      let inARow = 0
      for (let i = 0; i < rows.length && !stopped && !halted; i++) {
        if (signal.aborted) { stopped = true; break }
        const row = rows[i]
        onStep(i, rows.length, row.title)
        for (let attempt = 1; ; attempt++) {
          try {
            const { result, costUsd: cost } = await tidyThing(tidyInputFor(row, list, pathOf))
            costUsd += cost ?? 0
            inARow = 0
            if (isObj(result) && result.searched === true) searched = true
            const s = readTidySuggestion(result, row, allowed)
            if (s) { suggestions.set(row.id, s); onSuggestion(row.id, s) }
          } catch (error) {
            if (error instanceof ClaudeJobError && HALTS.has(error.reason)) { halted = error.message }
            else if (error instanceof ClaudeJobError && error.reason === 'busy') {
              if (attempt < BUSY_TRIES) { await wait(BUSY_WAIT_MS, signal); if (!signal.aborted) continue }
              if (signal.aborted) stopped = true; else halted = error.message
            } else {
              failed++
              inARow++
              if (inARow >= 2) halted = error instanceof Error ? error.message : 'Two calls in a row failed.'
            }
          }
          break
        }
      }
      // A run that ended before it read anything is an error to say; one that read some is a result with its reason.
      if (halted && suggestions.size === 0 && failed === 0) throw new Error(halted)
      return { suggestions, failed, stopped, halted, costUsd, searched }
    },
  })
}

export interface TidyApplyInput {
  /** The things as they are now (read fresh at the tap), each with the suggestion and the ticked fields. */
  entries: { item: ShopItem; suggestion: TidySuggestion; keys: ReadonlySet<TidyKey> }[]
}

interface Written { item: ShopItem; patch: UpdateShopItemInput; after: ShopItem }

/**
 * Saves the ticked fields through the Shop's own update (`updateShopItem`: the title and category columns and the facts, never
 * a link, picture, price or date). "N things tidied · Undo": one Undo writes back, for every thing and exactly the fields
 * that were written, what was there before.
 */
export function useApplyTidy() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action: 'undo_tidy_shop_things',
    successMessage: (_d: void, v: Written[]) => `Put back · ${v.length} ${v.length === 1 ? 'thing' : 'things'}`,
    mutationFn: async (written: Written[]) => {
      for (const w of written) await updateShopItem(w.item.id, tidyUndoPatch(w.item, w.patch))
    },
    onSuccess: (_d, written) => {
      for (const w of written) mapRowsInCache<ShopItem>(qc, qk.shop.items(), new Set([w.item.id]), () => w.item)
    },
    invalidates: [qk.shop.items()],
  })
  return useMutationWithFeedback<{ written: Written[]; failed: string[] }, TidyApplyInput>({
    action: 'tidy_shop_save',
    silent: 'its toast with Undo reports the result',
    mutationFn: async ({ entries }) => {
      const written: Written[] = []
      const failed: string[] = []
      for (const { item, suggestion, keys } of entries) {
        const patch = tidyPatch(item, suggestion, keys)
        if (Object.keys(patch).length === 0) continue
        try { const after = await updateShopItem(item.id, patch); written.push({ item, patch, after }) } catch { failed.push(item.title) }
      }
      return { written, failed }
    },
    onSuccess: ({ written, failed }) => {
      // The rows the database answered with go straight into the cached lists, so an old name never shows until a refetch.
      if (written.length) putRowsInCache<ShopItem>(qc, qk.shop.items(), written.map(w => w.after))
      if (failed.length) toast.error(`${failed.length === 1 ? `“${failed[0]}” was` : `${failed.length} things were`} not saved — try again`)
      if (written.length) toast.undo(`${written.length} ${written.length === 1 ? 'thing' : 'things'} tidied`, () => undo.mutate(written))
    },
    invalidates: [qk.shop.items()],
  })
}
