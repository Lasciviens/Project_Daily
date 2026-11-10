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
  /** Migration 138: the name of the money chain this thing carries (see chainModel.chainNameHolder). */
  chain_name?:      string | null
  // Migration 191 — absent before it is applied. Kept only while bought (the database clears the first three otherwise).
  /** How it was bought: online (at a distance — the right to cancel applies from a business) or in a shop. */
  bought_channel?:       ShopBoughtChannel | null
  /** The day Arrived was tapped (yyyy-mm-dd): on or after the purchase's Oslo day, not after today. */
  arrived_on?:           string | null
  /** The last day of an extra warranty (yyyy-mm-dd). */
  extra_warranty_until?: string | null
  /** Where the receipt is, as text (≤ 2 000 characters). */
  receipt_note?:         string | null
  /** The day a marketplace search was last opened for this wish ("Search opened 10.11.2026"). Set by the app. */
  search_opened_on?:     string | null
}

/** How a thing was bought (migration 191). */
export type ShopBoughtChannel = 'online' | 'in_store'

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
  /** not_allowed: the link's site may not be read (shop_site_policies, migration 188) — it was never fetched. */
  status:      'ok' | 'no_price' | 'blocked' | 'error' | 'not_allowed'
  /** Why the last check read nothing (the price shown is then the last one read). */
  error:       string | null
  source:      'prisjakt' | 'store' | null
  name:        string | null
  image:       string | null
  /** The lowest price last read (Prisjakt: the cheapest new offer, since 188). */
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
  /** The last different price before `low` of the same kind, and when it was seen. */
  prev_low:    number | null
  prev_at:     string | null
  /** What low/high/offers cover (migration 188): Prisjakt's new offers, its mixed figures, a shop's own page; null = read before 188. */
  condition:       'new' | 'mixed' | 'unknown' | null
  /** The cheapest used / refurbished offer in Prisjakt's offer list. */
  used_low:        number | null
  refurbished_low: number | null
  /** Migration 191: Prisjakt's new offers at the last read of its offer list, one per shop, cheapest first (≤ 50); null = none read. */
  new_offers?:     ShopNewOffer[] | null
}

/** One shop's cheapest new offer on Prisjakt (shop_price_watch.new_offers, migration 191). */
export interface ShopNewOffer {
  /** Prisjakt's number for the shop. */
  shop_id:   number
  /** The shop's name as Prisjakt's offer row gives it; null when it gave none. */
  shop_name: string | null
  price:     number
  currency:  string
  /** Whether that shop has it in stock; null = Prisjakt didn't say. */
  in_stock:  boolean | null
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
  /** What `low` covers (as ShopPriceWatch.condition); null = read before 188, when a Prisjakt low could be a used or refurbished price. */
  condition:       'new' | 'mixed' | 'unknown' | null
  used_low:        number | null
  refurbished_low: number | null
  /** Migration 190: whether this read said in stock (a shop's own page); null for Prisjakt's new-offer reads, before 190 and when the page didn't say. Absent before 190. */
  in_stock?:       boolean | null
}

/**
 * What a Needs-a-look row's signal is (migration 190's allow-list — signalStates.SHOP_SIGNALS and the
 * database's CHECK change together; verify-shop-signals compares them).
 */
export type ShopSignal =
  | 'at_target' | 'lowest_seen' | 'back_in_stock' | 'fake_before' | 'deal_day' | 'cheaper_returnable'
  | 'return_closing' | 'complaint_ending' | 'old_value' | 'old_wish' | 'tidy_up' | 'price_match'

/**
 * What the owner did with one Needs-a-look row (shop_signal_states, migration 190): snoozed until a day
 * (it comes back on that day), or Got it for one signature (it comes back when the row's facts change).
 * One row per thing (null = the whole page, the tidy-up), signal and subject (a deal day's slug).
 */
export interface ShopSignalState {
  id:            string
  user_id:       string
  item_id:       string | null
  signal:        ShopSignal
  /** What a row about no thing is about: a deal day's slug (each deal day its own row); null otherwise. */
  subject:       string | null
  /** Got it's signature (signalStates.signalSignature); null = no Got it. */
  signature:     string | null
  /** yyyy-mm-dd: not shown before this day; null = not snoozed. */
  snoozed_until: string | null
  /** When Got it was said (the database's clock); set exactly when `signature` is. */
  dismissed_at:  string | null
  created_at:    string
  updated_at:    string
}

/** A state as it is written back (Undo): the row's own fields; null = no row. */
export type ShopSignalStateFields = Pick<ShopSignalState, 'signature' | 'snoozed_until' | 'dismissed_at'> & Partial<Pick<ShopSignalState, 'id' | 'created_at'>>

/** One write's answer: the row as it was (null = none) and as it is now (null = gone). Undo writes `before` back. */
export interface ShopSignalWrite {
  before: ShopSignalState | null
  after:  ShopSignalState | null
  /** There was a row before, but not one this app can read back (a newer database, a malformed field): no exact Undo. */
  beforeUnknown: boolean
}

/**
 * A deal day as a repeating rule (shop_deal_days, migration 190): a fixed day and month, or the n-th
 * weekday of a month (ISO 1 = Monday … 7 = Sunday; nth 1–4 or -1 = the last), plus an offset, lasting
 * `length_days`. The day each year: dealDays.ts.
 */
export interface ShopDealDay {
  id:          string
  /** Stable: a signature names the deal by it ("black_friday"). */
  slug:        string
  name:        string
  rule_kind:   'fixed' | 'nth_weekday'
  month:       number
  day:         number | null
  weekday:     number | null
  nth:         number | null
  offset_days: number
  length_days: number
  source_url:  string | null
  /** yyyy-mm-dd */
  checked_on:  string
  created_at:  string
  updated_at:  string
  /** Migration 191: this account's own version replaces the shared row (shop_deal_day_edits). */
  edited?:     boolean
}

/**
 * The owner's own version of a deal day (shop_deal_day_edits, migration 191), by slug: one of shop_deal_days'
 * slugs replaces it for this account (`off` = turned off), any other is a deal day of the owner's own.
 */
export interface ShopDealDayEdit {
  id:          string
  user_id:     string
  slug:        string
  name:        string
  rule_kind:   'fixed' | 'nth_weekday'
  month:       number
  day:         number | null
  weekday:     number | null
  nth:         number | null
  offset_days: number
  length_days: number
  off:         boolean
  source_url:  string | null
  created_at:  string
  updated_at:  string
}

/** A deal day as the owner sees it: the shared row (`source`, null for one of their own), their edit, and what counts. */
export interface ShopDealDayRow {
  slug:      string
  source:    ShopDealDay | null
  own:       ShopDealDayEdit | null
  /** What Needs a look counts: the edit when there is one (null when it is turned off), else the shared row. */
  effective: ShopDealDay | null
}

// ── Stores, marketplaces and their rules (migration 191) ─────────────────────

export type ShopStoreKind = 'shop' | 'marketplace' | 'price_site' | 'refurbisher'
/** Where a row's facts come from: a seed (a page read that came with the app), a page read, the owner, Ask AI. */
export type ShopRuleOrigin = 'seed' | 'page' | 'owner' | 'ask_ai'
export type ShopStoreRuleKind = 'open_purchase' | 'return' | 'seasonal_return' | 'price_match' | 'price_protection'
export type ShopRuleExclusion = 'campaign' | 'black_friday' | 'outlet' | 'marketplace_seller' | 'used'
export type ShopRulePayout = 'money' | 'gift_card'
/** price_match: `listed` stores or `any`; price_protection: the store's `own` price or `any`. */
export type ShopRuleAgainst = 'listed' | 'any' | 'own'

/** A store's facts as its source gave them (what Reset to the source goes back to). */
export interface ShopStoreFacts {
  kind:        ShopStoreKind
  name:        string
  country:     string
  currency:    string
  hosts:       string[]
  search_url:  string | null
  ad_template: string | null
  ad_language: string | null
  source_url:  string | null
  /** yyyy-mm-dd */
  read_on:     string | null
}

export interface ShopStore extends ShopStoreFacts {
  id:           string
  user_id:      string
  seed_key:     string | null
  /** The owner's member tier at this store (a rule with the same tier applies to them). */
  member_tier:  string | null
  hidden:       boolean
  origin:       Exclude<ShopRuleOrigin, 'ask_ai'>
  /** What the source said; null for a store the owner made. */
  source:       ShopStoreFacts | null
  /** The owner made it, or its facts differ from `source` — never overwritten by a seed or a page read. */
  owner_edited: boolean
  edited_at:    string | null
  created_at:   string
  updated_at:   string
}

/** A rule's facts as its source gave them. */
export interface ShopStoreRuleFacts {
  kind:           ShopStoreRuleKind
  /** A short name ("Christmas returns"); null = named by its kind. */
  label:          string | null
  days:           number | null
  /** Only for members of this tier (the store's `member_tier`); null = everyone. */
  member_tier:    string | null
  /** seasonal_return: bought from–to (MM-DD; to before from = across the year end) … */
  window_from:    string | null
  window_to:      string | null
  /** … returned by this day (MM-DD), the first after `window_to`. */
  return_until:   string | null
  exclusions:     ShopRuleExclusion[]
  payout:         ShopRulePayout | null
  against:        ShopRuleAgainst | null
  /** price_match against `listed` stores: their ids. */
  against_stores: string[] | null
  /** The store's own words. */
  words:          string | null
  source_url:     string | null
  /** yyyy-mm-dd */
  read_on:        string | null
  off:            boolean
}

export interface ShopStoreRule extends ShopStoreRuleFacts {
  id:           string
  user_id:      string
  store_id:     string
  seed_key:     string | null
  origin:       ShopRuleOrigin
  source:       ShopStoreRuleFacts | null
  owner_edited: boolean
  edited_at:    string | null
  created_at:   string
  updated_at:   string
}

/** One rule of Norway's consumer law (shop_law_rules, migration 191), citing its law. */
export interface ShopLawRule {
  id:           string
  slug:         string
  country:      'NO'
  /** cancel = angrerett, complaint = reklamasjon. */
  kind:         'cancel' | 'complaint'
  /** distance = online, by phone or away from the shop. */
  channel:      'distance' | 'in_store' | 'any'
  seller:       'business' | 'private'
  gives_right:  boolean
  days:         number | null
  years:        number | null
  /** complaint: true = the rule for things meant to last considerably longer; null = one rule for all. */
  long_lasting: boolean | null
  /** receipt: the day the goods came into the consumer's hands (angrerett); delivery: when it was taken over (reklamasjon). */
  counts_from:  'receipt' | 'delivery' | null
  /** The last day moves past a weekend or a public holiday. */
  to_workday:   boolean
  name:         string
  summary:      string
  law:          string
  law_url:      string
  /** yyyy-mm-dd */
  checked_on:   string
}

/**
 * One thing's price figures from its clean history (shop_price_stats, migration 190): condition `new` or
 * `unknown` only — `mixed` and reads from before 188 are left out — in the last clean read's currency.
 */
export interface ShopPriceStats {
  item_id:       string
  /** The currency of every figure here (the last clean read's); null when that read named none. */
  currency:      string | null
  /** How many clean reads the figures come from (all of the two years kept). */
  points:        number
  low_all:       number
  high_all:      number
  /** The last 60 days (null when nothing was read in them); `high_60d` is what a "before" price is checked against. */
  points_60d:    number
  /** The first clean read in the 60 days: where the window's history really starts (null when none). */
  first_60d:     string | null
  low_60d:       number | null
  high_60d:      number | null
  /** The last clean read. */
  last_price:    number
  last_in_stock: boolean | null
  last_at:       string
  /** In stock at the last read after an out-of-stock read in the last 30 days, and since when. */
  back_in_stock: boolean
  restocked_at:  string | null
  /** The last 60 days in 12 steps of 5 days, oldest first: each step's lowest, null = no read then. */
  spark:         (number | null)[]
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
  chain_name?:      string | null
  /** Migration 191: a purchase's own facts (a write of one before 191 says so by name). */
  bought_channel?:       ShopBoughtChannel | null
  arrived_on?:           string | null
  extra_warranty_until?: string | null
  receipt_note?:         string | null
  search_opened_on?:     string | null
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
