import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useShopCategories, useShopItem, useShopItems } from '../hooks/useShop'
import { useShopLinks, useShopMoney } from '../hooks/useShopMoney'
import { SellSheet } from '../components/owned/SellSheet'
import { AccessorySheet } from '../components/owned/AccessorySheet'
import { ModelSheet } from '../components/owned/ModelSheet'
import { OwnSheet } from '../components/owned/OwnSheet'
import { ChainPopup } from '../components/owned/ChainPopup'
import type { ShopItem } from '../types'

// Shop's popups beside the record (types.ts): each loads its rows by id from
// the shared Shop queries and writes through the Shop hooks.

function useRow(id: string) {
  const query = useShopItem(id)
  return { query, item: useFirstLoaded(query.data, query) as ShopItem | null | undefined }
}

export function ShopSellModal({ request, onClose }: EntityModalProps<'shop-sell'>) {
  const { query, item } = useRow(request.id)
  const { data: items = [] } = useShopItems()
  const { data: categories = [] } = useShopCategories()
  const { ctx } = useShopMoney()
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return <SellSheet item={item} items={items} categories={categories} ctx={ctx} onClose={onClose} />
}

export function ShopChainModal({ request, onClose }: EntityModalProps<'shop-chain'>) {
  const { query, item } = useRow(request.id)
  const { data: items = [] } = useShopItems()
  const { data: links = [] } = useShopLinks()
  const { ctx } = useShopMoney()
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return <ChainPopup id={item.id} items={items} links={links} ctx={ctx} onClose={onClose} />
}

export function ShopAccessoryModal({ request, onClose }: EntityModalProps<'shop-accessory'>) {
  const { query, item } = useRow(request.itemId)
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return <AccessorySheet parent={item} onClose={onClose} />
}

export function ShopModelModal({ request, onClose }: EntityModalProps<'shop-model'>) {
  const { query, item } = useRow(request.wishId)
  if (!item) return <EntityModalPending query={query} what="wish" onClose={onClose} />
  return <ModelSheet wish={item} onClose={onClose} />
}

export function ShopOwnModal({ request, onClose }: EntityModalProps<'shop-own'>) {
  const { data: items = [] } = useShopItems()
  const { data: categories = [] } = useShopCategories()
  return <OwnSheet had={!!request.had} items={items} categories={categories} onClose={onClose} />
}
