import { useCallback } from 'react'
import { logError } from '../../../shared/utils/logError'
import { readPriceLink } from '../api/shopPriceApi'
import { pageLink } from '../../ai/claude/featureRules'
import { pictureOf, samePage, type PagePicture } from '../productPicture'

/**
 * Reads a product's pages for its picture, quietly (a step of a bigger flow: the draft or the review shows the result or the
 * reason). Only through shop-price `read` — its site policies, robots.txt, once-an-hour reuse and address checks — never a
 * fetch of its own. The pages are tried in order (at most 3) until one gives a picture; a page that is refused, blocked, failed
 * or about another product is passed over, and when none gives one the first one's reason is what is said. A bad link, a
 * refusal or a failure is an answer with no picture, never an error.
 */
export function useProductPicture(): (urls: readonly string[], product: string) => Promise<PagePicture> {
  return useCallback(async (urls: readonly string[], product: string) => {
    let first: PagePicture | null = null
    for (const [i, url] of urls.slice(0, 3).entries()) {
      if (!pageLink(url)) continue
      let got: PagePicture
      try {
        const r = await readPriceLink(url)
        // The first page is the one the AI named for this product; a later one is a search result that must show the same product.
        got = i > 0 && !samePage(r.name, product) ? { image: null, host: null, note: null } : pictureOf(r)
      } catch (e) {
        logError(`shop_product_picture: ${(e as Error).message}`, { action: 'shop_product_picture' })
        got = pictureOf(null)
      }
      if (got.image) return got
      first ??= got
    }
    return first ?? { image: null, host: null, note: null }
  }, [])
}
