import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../../app/store'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../../shared/query'
import { mapRowsInCache, putRowsInCache } from '../../../../shared/query/cachePatch'
import { describeClaude } from '../../../ai/claude/claudeApi'
import { tidyThing } from '../../../ai/claude/featureJobs'
import { ClaudeJobError } from '../../../ai/claude/claudeApi'
import { updateShopItem } from '../../api/shopApi'
import { usePreferredHosts, useProductPicture } from '../../hooks/useProductPicture'
import { categoryPath } from '../../shopModel'
import { readTidySuggestion, tidyCategories, tidyInputFor, tidyWorstCost } from '../../tidyModel'
import type { PagePicture } from '../../productPicture'
import type { ShopCategory, ShopItem } from '../../types'

/**
 * Find picture — a part of the one body (RecordBody), in every mode (owner, 24.11.2026). Code first, the AI last:
 *   1. the thing's own pages (its link, a read receipt's product pages) are read through shop-price `read` only
 *      (`useProductPicture`: site policies, robots.txt, the hour's reuse, address checks) — free;
 *   2. only when none gave a picture, and only on the owner's tap with the most it could cost on the button, the AI's web
 *      search (the `shop_tidy` job — the same one Tidy up uses; only its product pages are kept here) names pages, which
 *      are read the same way.
 * The picture is a suggestion: nothing is written until the owner taps Use (the add's draft takes it as a fact; a saved thing
 * writes `image_url` with Undo, `useSavePicture`).
 */
export function useFindPicture({ item, pages, named = true, categories }: {
  /** The thing as it stands (a draft's view when adding). */
  item: ShopItem
  /** Its own pages to read first, free: its link, a receipt line's product pages. */
  pages: readonly string[]
  named?: boolean
  categories: readonly ShopCategory[]
}) {
  const readPicture = useProductPicture()
  const preferred = usePreferredHosts()
  const [state, setState] = useState<'idle' | 'reading' | 'searching' | 'done'>('idle')
  const [found, setFound] = useState<PagePicture | null>(null)
  const [freeTried, setFreeTried] = useState(false)
  const [costUsd, setCostUsd] = useState<number | null>(null)
  const free = pages.length > 0 && !freeTried
  // The worst case of one search, from the job's own prices — asked only once the search is what the button does.
  const describe = useQuery({ queryKey: qk.claude.describe(), queryFn: describeClaude, staleTime: STALE.default, enabled: !free && state !== 'reading' })
  const cats = useMemo(() => tidyCategories(categories), [categories])
  const pathOf = useMemo(() => (id: string | null) => {
    const p = categoryPath(id, categories)
    return p.subName ? `${p.topName} / ${p.subName}` : p.topName
  }, [categories])
  const worstUsd = useMemo(() => {
    const about = describe.data
    const job = about?.jobs.find(j => j.name === 'shop_tidy')
    const price = about?.prices.models.find(m => m.model === job?.defaults.model)
    if (!about || !job || !price) return null
    return tidyWorstCost(
      { webSearchUsdEach: about.prices.webSearchUsdEach, longPromptOverTokens: about.prices.longPromptOverTokens, longPromptMultiplier: about.prices.longPromptMultiplier, model: price },
      { instructions: job.instructions.length, input: JSON.stringify(tidyInputFor(item, cats, pathOf)).length }, job.defaults.maxOutputTokens,
    )
  }, [describe.data, item, cats, pathOf])

  async function find() {
    if (state === 'reading' || state === 'searching' || !item.title.trim()) return
    if (free) {
      setState('reading')
      const p = await readPicture(pages, item.title, named)
      setFreeTried(true)
      setFound(p)
      setState('done')
      return
    }
    setState('searching')
    try {
      const hosts = await preferred()
      const { result, costUsd: cost } = await tidyThing({ ...tidyInputFor(item, cats, pathOf), ...(hosts.length ? { preferred_hosts: hosts } : {}) })
      setCostUsd(cost)
      const s = readTidySuggestion(result, item, new Set(cats.map(c => c.id)))
      if (!s?.page_urls?.length) setFound({ image: null, host: null, note: 'The search found no product page — no picture.' })
      else setFound(await readPicture(s.page_urls, item.title, s.page_named))
    } catch (e) {
      setFound({ image: null, host: null, note: e instanceof ClaudeJobError || e instanceof Error ? e.message : 'The search failed — try again later.' })
    }
    setState('done')
  }

  return {
    /** What the button does next: read the thing's own pages (free) or search with the AI (costs). */
    free, worstUsd, costUsd, busy: state === 'reading' || state === 'searching', searching: state === 'searching',
    found, find, dismiss: () => setFound(null),
  }
}

/** A saved thing's picture from Find picture: `image_url` through the Shop's own update, "Picture saved · Undo" writing the old one back. */
export function useSavePicture() {
  const qc = useQueryClient()
  const put = useMutationWithFeedback({
    action: 'undo_shop_picture',
    successMessage: 'Picture put back',
    mutationFn: ({ id, image }: { id: string; image: string | null }) => updateShopItem(id, { image_url: image }),
    onSuccess: (row: ShopItem) => putRowsInCache(qc, qk.shop.items(), [row]),
    invalidates: [qk.shop.items()],
  })
  return useMutationWithFeedback({
    action: 'save_shop_picture',
    silent: 'its own toast reports it with Undo ("Picture saved · Undo")',
    mutationFn: ({ item, image }: { item: ShopItem; image: string }) => updateShopItem(item.id, { image_url: image }),
    onSuccess: (row: ShopItem, { item }) => {
      mapRowsInCache<ShopItem>(qc, qk.shop.items(), new Set([row.id]), () => row)
      toast.undo('Picture saved', () => put.mutate({ id: item.id, image: item.image_url ?? null }))
    },
    invalidates: [qk.shop.items()],
  })
}
