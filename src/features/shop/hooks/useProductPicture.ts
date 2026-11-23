import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { logError } from '../../../shared/utils/logError'
import { qk, STALE } from '../../../shared/query'
import { fetchPictureSources } from '../api/shopPictureApi'
import { readPriceLink } from '../api/shopPriceApi'
import { pageLink } from '../../ai/claude/featureRules'
import { pictureOf, preferredHosts, rankPages, samePage, type PagePicture } from '../productPicture'

/**
 * Reads a product's pages for its picture, quietly (a step of a bigger flow: the draft or the review shows the result or the
 * reason). Only through shop-price `read` — its site policies, robots.txt, once-an-hour reuse and address checks — never a
 * fetch of its own. The pages are ranked first by what earlier reads taught (`rankPages`: hosts that gave pictures first, hosts
 * that refused apps left out), then tried in order (at most 3) until one gives a picture; a page that is refused, blocked,
 * failed or about another product is passed over, and when none gives one the first one's reason is what is said. Each read
 * asks `forPicture`, so shop-price counts how it went on that host. A bad link, a refusal or a failure is an answer with no
 * picture, never an error.
 */
export function useProductPicture(): (urls: readonly string[], product: string, named?: boolean) => Promise<PagePicture> {
  const qc = useQueryClient()
  return useCallback(async (urls: readonly string[], product: string, named = true) => {
    const clean = urls.slice(0, 3).filter(u => pageLink(u))
    let sources: Awaited<ReturnType<typeof fetchPictureSources>> = []
    try { sources = await qc.fetchQuery({ queryKey: qk.shop.pictureSources(), queryFn: fetchPictureSources, staleTime: STALE.short }) } catch { /* no memory: the order the function gave */ }
    const { read, refused } = rankPages(clean, sources)
    let first: PagePicture | null = null
    for (const url of read) {
      let got: PagePicture
      try {
        const r = await readPriceLink(url, { forPicture: true })
        // The page the AI named is taken as it is; every other page (a search result) must show the same product.
        got = !(named && url === clean[0]) && !samePage(r.name, product) ? { image: null, host: null, note: null } : pictureOf(r)
      } catch (e) {
        logError(`shop_product_picture: ${(e as Error).message}`, { action: 'shop_product_picture' })
        got = pictureOf(null)
      }
      if (got.image) return got
      first ??= got
    }
    // Every page was one that refused apps before: nothing is read, and the owner is told in the shared words.
    if (!first && refused.length) return { image: null, host: refused[0], note: `${refused[0]} doesn't let apps read its pages — no picture.` }
    return first ?? { image: null, host: null, note: null }
  }, [qc])
}

/** The owner's best sites for the AI's search (a hint, never an address): from the same memory the ranking reads. Empty when there is none. */
export function usePreferredHosts(): () => Promise<string[]> {
  const qc = useQueryClient()
  return useCallback(async () => {
    try { return preferredHosts(await qc.fetchQuery({ queryKey: qk.shop.pictureSources(), queryFn: fetchPictureSources, staleTime: STALE.short })) } catch { return [] }
  }, [qc])
}
