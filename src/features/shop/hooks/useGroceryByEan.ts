import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { searchGroceries } from '../api/groceryApi'
import { scanMatch, type GroceryHit } from '../groceryModel'

// STAND-IN until food-search's `grocery_ean` mode is merged: the grocery a barcode is, looked up through
// Kassalapp's search (it takes an EAN as the query) and kept only when a hit carries that very EAN — the quick
// list's scan does the same (useScanLookup, the same cache entry). The real hook asks Kassalapp by EAN.

/** The grocery product with this EAN (Kassalapp), null when there is none; off while `ean` is null. */
export function useGroceryByEan(ean: string | null) {
  return useQuery({
    queryKey: qk.shop.grocerySearch((ean ?? '').toLowerCase()),
    queryFn: () => searchGroceries(ean as string),
    enabled: !!ean,
    staleTime: STALE.hour,
    retry: false,
    select: (hits: GroceryHit[]): GroceryHit | null => scanMatch(hits, ean ?? ''),
  })
}
