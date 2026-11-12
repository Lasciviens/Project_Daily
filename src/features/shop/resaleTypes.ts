import type { ShopCurrency } from './types'

// Resale and selling (migration 192): ad notes, trade-in quotes, the value history, listings, ad templates and
// hand-over checklists. Rows are checked where they enter (resaleRows.ts).

/** A thing's condition as an ad or a quote says it (192's CHECK; resaleRows.RESALE_CONDITIONS mirrors it). */
export type ResaleCondition = 'new' | 'like_new' | 'good' | 'fair' | 'for_parts'

/** Listed (the ad written) → For sale (the ad is up) → Sold (from the sale itself) or Withdrawn (taken down unsold). */
export type ListingStatus = 'listed' | 'for_sale' | 'sold' | 'withdrawn'

/** An ad template's language: Norwegian bokmål (the owner's default for ads) or English. */
export type AdLanguage = 'nb' | 'en'

/** "+ Note an ad": an ad for the same thing, pasted by hand. Its link is never fetched. */
export interface ShopAdNote {
  id:          string
  user_id:     string
  item_id:     string
  /** https only, never fetched — the owner opens it. */
  ad_url:      string
  /** The marketplace's host (finn.no), or null. */
  marketplace: string | null
  price:       number
  currency:    ShopCurrency
  condition:   ResaleCondition | null
  /** True: what the seller asks ("asking, not sold"). False: what it sold for. */
  asking:      boolean
  /** yyyy-mm-dd */
  noted_on:    string
  created_at:  string
  updated_at:  string
}

/** A trade-in quote the owner typed: what a dealer offered (the floor). */
export interface ShopTradeInQuote {
  id:         string
  user_id:    string
  item_id:    string
  dealer:     string
  amount:     number
  currency:   ShopCurrency
  condition:  ResaleCondition | null
  /** yyyy-mm-dd */
  quoted_on:  string
  note:       string | null
  created_at: string
  updated_at: string
}

/** One "Could sell for" with its day (kept by the database from shop_items.value_now; one per thing and day). */
export interface ShopValuePoint {
  id:         string
  user_id:    string
  item_id:    string
  /** yyyy-mm-dd */
  valued_on:  string
  value:      number
  currency:   ShopCurrency
  created_at: string
  updated_at: string
}

/** One step of a listing's price story: from `on` (yyyy-mm-dd) the price was `price`. */
export interface ListingPrice { on: string; price: number }

/** Selling a thing, with its dated price changes. */
export interface ShopListing {
  id:             string
  user_id:        string
  item_id:        string
  marketplace:    string | null
  /** The ad's link once it is up (https, never fetched). */
  ad_url:         string | null
  status:         ListingStatus
  /** yyyy-mm-dd — the ad was written. */
  listed_on:      string
  /** yyyy-mm-dd — the ad went up (set while for sale and after). */
  for_sale_on:    string | null
  /** yyyy-mm-dd — sold or taken down. */
  ended_on:       string | null
  currency:       ShopCurrency
  /** Oldest first: the first the asking price when listed, the last the price now (1–100). */
  prices:         ListingPrice[]
  ad_text:        string | null
  /** The thing's sale closed it (the sale's Undo opens it again). */
  closed_by_sale: boolean
  created_at:     string
  updated_at:     string
}

/** An ad's text per marketplace (null = any other) and category (null = any), with {name}, {condition}, … */
export interface ShopAdTemplate {
  id:          string
  user_id:     string
  marketplace: string | null
  category:    string | null
  language:    AdLanguage
  title:       string
  body:        string
  created_at:  string
  updated_at:  string
}

/** What to do before handing a thing over, per category: one step per line. */
export interface ShopHandoverChecklist {
  id:         string
  user_id:    string
  category:   string
  steps:      string
  created_at: string
  updated_at: string
}

export interface CreateAdNoteInput {
  item_id:      string
  ad_url:       string
  price:        number
  currency?:    ShopCurrency
  marketplace?: string | null
  condition?:   ResaleCondition | null
  asking?:      boolean
  noted_on?:    string
}

export interface CreateTradeInQuoteInput {
  item_id:    string
  dealer:     string
  amount:     number
  currency?:  ShopCurrency
  condition?: ResaleCondition | null
  quoted_on?: string
  note?:      string | null
}
export type UpdateTradeInQuoteInput = Partial<Omit<CreateTradeInQuoteInput, 'item_id'>>

export interface CreateListingInput {
  item_id:      string
  /** The asking price when listed (the price story's first step, on `listed_on`). */
  price:        number
  currency?:    ShopCurrency
  marketplace?: string | null
  ad_url?:      string | null
  ad_text?:     string | null
  /** yyyy-mm-dd; today when left out. */
  listed_on?:   string
  /** 'for_sale' when the ad is already up. */
  status?:      'listed' | 'for_sale'
}

/** What the app changes on a listing by hand — Sold comes only from recording the sale. */
export interface UpdateListingInput {
  marketplace?: string | null
  ad_url?:      string | null
  ad_text?:     string | null
  status?:      'listed' | 'for_sale' | 'withdrawn'
  prices?:      ListingPrice[]
  listed_on?:   string
  for_sale_on?: string | null
  ended_on?:    string | null
  currency?:    ShopCurrency
}

export interface CreateAdTemplateInput {
  marketplace?: string | null
  category?:    string | null
  language?:    AdLanguage
  title:        string
  body:         string
}
export type UpdateAdTemplateInput = Partial<CreateAdTemplateInput>

export interface CreateChecklistInput { category: string; steps: string }
export type UpdateChecklistInput = Partial<CreateChecklistInput>
