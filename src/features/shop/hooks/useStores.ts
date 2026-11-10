import type { StoreRow } from '../autofillModel'

// STAND-IN until migration 191 (shop_stores) is wired: its hook reads the rows — each store and marketplace with
// its hosts and its search-link pattern — from the database, so no store is named in code. These rows stand in
// for them with the same shape; only the add sheet's autofill reads them (a link's store, "Find it").
//   · Prisjakt and Elkjøp: their own search forms' addresses (seen in their pages, 10.11.2026; never fetched).
//   · Power and Jernia: no pattern — Power's search box is built by script, Jernia's runs on another service.
//   · Finn and Tise: links only, never read (their terms forbid apps); their patterns are NOT verified — 191's
//     rows decide them.
const STAND_IN: readonly StoreRow[] = [
  { id: 'stand-in-prisjakt', name: 'Prisjakt', kind: 'price_site', hosts: ['prisjakt.no'], searchPattern: 'https://www.prisjakt.no/search?query={q}' },
  { id: 'stand-in-elkjop', name: 'Elkjøp', kind: 'shop', hosts: ['elkjop.no'], searchPattern: 'https://www.elkjop.no/search?q={q}' },
  { id: 'stand-in-power', name: 'Power', kind: 'shop', hosts: ['power.no'], searchPattern: null },
  { id: 'stand-in-jernia', name: 'Jernia', kind: 'shop', hosts: ['jernia.no'], searchPattern: null },
  { id: 'stand-in-finn', name: 'Finn', kind: 'marketplace', hosts: ['finn.no'], searchPattern: 'https://www.finn.no/recommerce/forsale/search?q={q}' },
  { id: 'stand-in-tise', name: 'Tise', kind: 'marketplace', hosts: ['tise.com'], searchPattern: 'https://tise.com/search?q={q}' },
]

/** The stores and marketplaces (shop_stores, 191) — a query's `data`. STAND-IN: fixed rows, see above. */
export function useStores(): { data: readonly StoreRow[]; isLoading: boolean } {
  return { data: STAND_IN, isLoading: false }
}
