export type ShopPriority    = 'low' | 'medium' | 'high'
export type ShopRegion      = 'TR' | 'NO'
export type ShopStatus      = 'wishlist' | 'bought' | 'dropped'
export type ShopPriceSource = 'manual' | 'ai_estimate'
export type ShopSourceType  = 'manual' | 'ai'
/** Which view a row lives on (migration 134): someday purchases or the short errand list. */
export type ShopList        = 'wishlist' | 'quick'
export type ShopCurrency    = 'NOK' | 'TRY' | 'EUR' | 'USD'

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
  price:        number | null
  price_source: ShopPriceSource | null
  /** The store / where to buy it. */
  platform:     string | null
  url:          string | null
  priority:     ShopPriority
  region:       ShopRegion | null
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
}

export interface UpdateShopItemInput extends Partial<CreateShopItemInput> {
  status?:    ShopStatus
  bought_at?: string | null
  task_id?:   string | null
}
