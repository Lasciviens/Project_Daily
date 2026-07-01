import { supabase } from '../../../integrations/supabase/client'
import type {
  ShopCategory, ShopItem, CreateShopCategoryInput, CreateShopItemInput, UpdateShopItemInput,
} from '../types'

// ─── Categories ───────────────────────────────────────────────────────────────

export async function fetchShopCategories(): Promise<ShopCategory[]> {
  const { data, error } = await supabase
    .from('shop_categories')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createShopCategory(input: CreateShopCategoryInput): Promise<ShopCategory> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('shop_categories')
    .insert({ user_id: user.id, name: input.name, parent_id: input.parent_id ?? null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteShopCategory(id: string): Promise<void> {
  const { error } = await supabase.from('shop_categories').delete().eq('id', id)
  if (error) throw error
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function fetchShopItems(): Promise<ShopItem[]> {
  const { data, error } = await supabase
    .from('shop_items')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createShopItem(input: CreateShopItemInput): Promise<ShopItem> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('shop_items')
    .insert({
      user_id:      user.id,
      category_id:  input.category_id,
      title:        input.title,
      notes:        input.notes ?? null,
      price:        input.price ?? null,
      price_source: input.price_source ?? (input.price != null ? 'manual' : null),
      platform:     input.platform ?? null,
      url:          input.url ?? null,
      priority:     input.priority ?? 'medium',
      region:       input.region ?? null,
      planned_date: input.planned_date ?? null,
      source_type:  input.source_type ?? 'manual',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateShopItem(id: string, patch: UpdateShopItemInput): Promise<void> {
  const { error } = await supabase
    .from('shop_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteShopItem(id: string): Promise<void> {
  const { error } = await supabase.from('shop_items').delete().eq('id', id)
  if (error) throw error
}
