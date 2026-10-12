import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useShopCategories, useShopItem, useShopItems } from '../hooks/useShop'
import { useShopLinks, useShopMoney } from '../hooks/useShopMoney'
import { ChainBuilder } from '../components/chain/ChainBuilder'
import type { ShopItem } from '../types'

// The chain builder (its own chunk: it is the biggest Shop popup). With
// `fromId` it goes on from that saved thing, which it waits for.

function Builder({ from, onClose }: { from: ShopItem | null; onClose: () => void }) {
  const { data: items = [] } = useShopItems()
  const { data: links = [] } = useShopLinks()
  const { data: categories = [] } = useShopCategories()
  const { ctx } = useShopMoney()
  return <ChainBuilder from={from} items={items} links={links} categories={categories} ctx={ctx} onClose={onClose} />
}

function FromSaved({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useShopItem(id)
  const item = useFirstLoaded(query.data, query) as ShopItem | null | undefined
  if (!item) return <EntityModalPending query={query} what="item" onClose={onClose} />
  return <Builder from={item} onClose={onClose} />
}

export function ShopChainBuilderModal({ request, onClose }: EntityModalProps<'shop-chain-builder'>) {
  return request.fromId ? <FromSaved id={request.fromId} onClose={onClose} /> : <Builder from={null} onClose={onClose} />
}
