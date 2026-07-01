export type ShopPriority   = 'low' | 'medium' | 'high'
export type ShopRegion     = 'TR' | 'NO'
export type ShopStatus     = 'wishlist' | 'bought' | 'dropped'
export type ShopPriceSource = 'manual' | 'ai_estimate'
export type ShopSourceType  = 'manual' | 'ai'

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
  category_id:  string
  title:        string
  notes:        string | null
  price:        number | null
  price_source: ShopPriceSource | null
  platform:     string | null
  url:          string | null
  priority:     ShopPriority
  region:       ShopRegion | null
  planned_date: string | null
  status:       ShopStatus
  source_type:  ShopSourceType
  created_at:   string
  updated_at:   string
}

export interface CreateShopCategoryInput {
  name:       string
  parent_id?: string | null
}

export interface CreateShopItemInput {
  category_id:   string
  title:         string
  notes?:        string | null
  price?:        number | null
  price_source?: ShopPriceSource | null
  platform?:     string | null
  url?:          string | null
  priority?:     ShopPriority
  region?:       ShopRegion | null
  planned_date?: string | null
  source_type?:  ShopSourceType
}

export interface UpdateShopItemInput extends Partial<CreateShopItemInput> {
  status?: ShopStatus
}
