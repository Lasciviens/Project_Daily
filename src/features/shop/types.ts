export type ShopPriority    = 'low' | 'medium' | 'high'
export type ShopRegion      = 'TR' | 'NO'
/**
 * To buy (`wishlist`) → Mine (`bought`) → (sold or gone: `bought` + disposal facts).
 * `dropped` = Not any more (a model of a general wish: Not chosen); `fulfilled` =
 * a general wish whose model was bought (migration 137).
 */
export type ShopStatus      = 'wishlist' | 'bought' | 'dropped' | 'fulfilled'
export type ShopPriceSource = 'manual' | 'ai_estimate'
export type ShopSourceType  = 'manual' | 'ai'
/** Which view a row lives on (migration 134): someday purchases or the short errand list. */
export type ShopList        = 'wishlist' | 'quick'
export type ShopCurrency    = 'NOK' | 'TRY' | 'EUR' | 'USD'
/** A normal item, or a general wish ("a tablet with a stylus, 5 000–8 000 NOK") whose models are rows of their own. */
export type ShopKind        = 'item' | 'general'
/** Why it is on the list: needed (tape running out) or just for fun. */
export type ShopReason      = 'need' | 'fun'
/** How a thing left: sold, traded in, returned (money back), given away, broke, lost, or something else. */
export type ShopDisposal    = 'sold' | 'traded_in' | 'returned' | 'given' | 'broken' | 'lost' | 'other'
/** Where a stored NOK rate came from: NOK itself, Norges Bank's rate of the day, or typed by hand. */
export type ShopFxSource    = 'fixed' | 'norges_bank' | 'manual'

export interface ShopCategory {
  id:         string
  user_id:    string
  name:       string
  parent_id:  string | null
  created_at: string
}

export interface ShopItem {
  id:           string
  user_id:      string
  /** A subcategory; optional since migration 134 (a quick-list "milk" has none). */
  category_id:  string | null
  title:        string
  notes:        string | null
  /** To buy: the expected price. Mine: what was paid (0 = came with it / a gift). */
  price:        number | null
  price_source: ShopPriceSource | null
  /** The store / where to buy it — where it was bought, once bought. */
  platform:     string | null
  url:          string | null
  priority:     ShopPriority
  region:       ShopRegion | null
  /** To buy: "buy on" — or "deal from" while waiting for a deal. */
  planned_date: string | null
  status:       ShopStatus
  source_type:  ShopSourceType
  created_at:   string
  updated_at:   string
  // Migration 134 — absent before it is applied (read as wishlist / from region / updated_at).
  list?:        ShopList
  currency?:    ShopCurrency | null
  bought_at?:   string | null
  task_id?:     string | null
  // Migration 137 — absent before it is applied.
  kind?:            ShopKind
  price_min?:       number | null
  price_max?:       number | null
  /** A general wish's must-haves, one per line. */
  requirements?:    string | null
  /** A model of this general wish. */
  option_for?:      string | null
  /** A model's answer per requirement (key: the requirement, folded). */
  meets?:           Record<string, boolean> | null
  /** An accessory of this item. */
  accessory_of?:    string | null
  reason?:          ShopReason | null
  wait_for_deal?:   boolean
  target_price?:    number | null
  deal_note?:       string | null
  /** A wishlist row to pick up on the next errand — shown in the quick list too, never moved. */
  errand?:          boolean
  image_url?:       string | null
  ean?:             string | null
  /** NOK per unit of `currency` on the day it was bought — frozen by the database (Norges Bank's, or typed); NULL = rate pending. */
  fx_nok?:          number | null
  fx_source?:       ShopFxSource | null
  /** The market price when it was bought (Prisjakt's lowest / the shop's own), for "Saved". */
  market_price?:    number | null
  market_currency?: ShopCurrency | null
  used?:            boolean
  got_as_gift?:     boolean
  for_resale?:      boolean
  /** False: bought for someone else or used up (a ticket) — spending only, never "Mine". */
  kept?:            boolean
  /** The bought / sold days are approximate (added from memory): shown "≈". */
  approx_dates?:    boolean
  serial?:          string | null
  /** "Can complain until" — Norway's reklamasjon (2 or 5 years) or a warranty. */
  warranty_until?:  string | null
  return_by?:       string | null
  /** "Could sell for", in `value_currency`, estimated on `value_on`. */
  value_now?:       number | null
  value_currency?:  ShopCurrency | null
  value_on?:        string | null
  disposed_on?:     string | null
  disposal?:        ShopDisposal | null
  /** Money got back (a sale, a trade-in, a refund); null with a sale = not known yet. */
  sale_price?:      number | null
  sale_currency?:   ShopCurrency | null
  sale_fx_nok?:     number | null
  sale_fx_source?:  ShopFxSource | null
  sold_to?:         string | null
  /** Rows sold together share one id (each row holds its share of the price). */
  sale_group?:      string | null
}

/**
 * "Paid with money from": `to_id` was (or will be) bought with what selling
 * `from_id` brought in. `amount` = how much of that money, in the sale's
 * currency; null = the rest, shared by the receivers' prices.
 */
export interface ShopItemLink {
  id:         string
  user_id:    string
  from_id:    string
  to_id:      string
  amount:     number | null
  created_at: string
}

/** One extra cost on a thing: a repair, shipping, a fee, AppleCare — a rebate is negative (migration 137). */
export interface ShopItemCost {
  id:         string
  user_id:    string
  item_id:    string
  label:      string
  amount:     number
  currency:   ShopCurrency
  /** yyyy-mm-dd */
  spent_on:   string
  /** NOK per unit of `currency` on that day (frozen by the database); NULL = rate pending. */
  fx_nok:     number | null
  fx_source:  ShopFxSource | null
  created_at: string
  updated_at: string
}

/** The last price read from a row's link (written by the shop-price function only). */
export interface ShopPriceWatch {
  item_id:     string
  user_id:     string
  /** The link that was read — a watch for an older link is ignored. */
  url:         string | null
  checked_at:  string
  status:      'ok' | 'no_price' | 'blocked' | 'error'
  /** Why the last check read nothing (the price shown is then the last one read). */
  error:       string | null
  source:      'prisjakt' | 'store' | null
  name:        string | null
  image:       string | null
  /** The lowest price last read (Prisjakt: the cheapest shop). */
  low:         number | null
  high:        number | null
  offers:      number | null
  currency:    string | null
  in_stock:    boolean | null
  /** A shop's struck-out "before" price. */
  was:         number | null
  return_days: number | null
  /** When a price was last read. */
  last_ok_at:  string | null
  /** The last different price before `low`, and when it was seen. */
  prev_low:    number | null
  prev_at:     string | null
}

/** One read of a row's link — the price history (migration 137). */
export interface ShopPricePoint {
  id:         string
  item_id:    string
  checked_at: string
  low:        number
  high:       number | null
  offers:     number | null
  currency:   string | null
  source:     string | null
}

export interface CreateShopCategoryInput {
  name:       string
  parent_id?: string | null
}

export interface CreateShopItemInput {
  category_id?:  string | null
  title:         string
  notes?:        string | null
  price?:        number | null
  price_source?: ShopPriceSource | null
  currency?:     ShopCurrency | null
  platform?:     string | null
  url?:          string | null
  priority?:     ShopPriority
  region?:       ShopRegion | null
  planned_date?: string | null
  source_type?:  ShopSourceType
  list?:         ShopList
  // Migration 137
  kind?:          ShopKind
  status?:        ShopStatus
  bought_at?:     string | null
  price_min?:     number | null
  price_max?:     number | null
  requirements?:  string | null
  option_for?:    string | null
  accessory_of?:  string | null
  reason?:        ShopReason | null
  image_url?:     string | null
  ean?:           string | null
  fx_nok?:        number | null
  got_as_gift?:   boolean
  used?:          boolean
  approx_dates?:  boolean
  disposed_on?:   string | null
  disposal?:      ShopDisposal | null
  sale_price?:    number | null
  sale_currency?: ShopCurrency | null
  sale_fx_nok?:   number | null
  sold_to?:       string | null
  kept?:          boolean
  for_resale?:    boolean
  return_by?:     string | null
  warranty_until?: string | null
  market_price?:  number | null
  market_currency?: ShopCurrency | null
  errand?:        boolean
  wait_for_deal?: boolean
  target_price?:  number | null
  deal_note?:     string | null
}

export interface UpdateShopItemInput extends Partial<CreateShopItemInput> {
  task_id?:         string | null
  meets?:           Record<string, boolean> | null
  serial?:          string | null
  value_now?:       number | null
  value_currency?:  ShopCurrency | null
  value_on?:        string | null
}

export interface CreateShopCostInput {
  item_id:   string
  label:     string
  amount:    number
  currency?: ShopCurrency
  spent_on?: string
  /** A rate typed by hand (kept as "manual"); otherwise the database looks it up. */
  fx_nok?:   number | null
}
