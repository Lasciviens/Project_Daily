import { useState } from 'react'
import { Plus, ShoppingBag, Sparkles } from 'lucide-react'
import { useShopCategories, useShopItems } from '../hooks/useShop'
import { ShopAIBox } from '../components/ShopAIBox'
import { ShopItemCard } from '../components/ShopItemCard'
import { AddShopItemModal } from '../components/AddShopItemModal'
import { Sheet } from '../../../shared/components/Sheet'
import { Button, EmptyState, IconButton, PageContainer, PageHeader, SectionLabel, Skeleton } from '../../../shared/ui'
import { haptic } from '../../../shared/utils/haptics'
import type { ShopItem } from '../types'

// As many ≥ 17rem columns as fit, sharing the width: auto-fill with a fixed
// maximum counts by the maximum and leaves up to a column's worth empty.
const ITEM_GRID = 'grid grid-cols-1 gap-2 sm:gap-3 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]'

// A full-height route (`fullHeight` in src/app/navigation.ts): the page fills
// <main> exactly and each pane scrolls on its own, so the assistant's input
// stays pinned while the wishlist scrolls.
export function ShopPage() {
  const { data: categories = [], isLoading: catsLoading } = useShopCategories()
  const { data: items = [],      isLoading: itemsLoading } = useShopItems()
  const [activeTop, setActiveTop] = useState<string | null>(null)
  const [addOpen,   setAddOpen]   = useState(false)
  const [aiOpen,    setAiOpen]    = useState(false)

  const tops = categories.filter(c => !c.parent_id)
  const subs = categories.filter(c => c.parent_id)

  const visibleTopIds = activeTop ? [activeTop] : tops.map(t => t.id)
  const visibleSubIds = new Set(subs.filter(s => visibleTopIds.includes(s.parent_id!)).map(s => s.id))
  const visibleItems  = items.filter(i => i.status !== 'dropped' && visibleSubIds.has(i.category_id))

  const bySub = new Map<string, ShopItem[]>()
  for (const item of visibleItems) {
    const arr = bySub.get(item.category_id) ?? []
    arr.push(item)
    bySub.set(item.category_id, arr)
  }

  const isLoading = catsLoading || itemsLoading
  const openAssistant = () => { haptic('light'); setAiOpen(true) }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden lg:flex-row">
      {/* Assistant pane — a permanent column from lg; below that it opens in a sheet. */}
      <aside className="hidden border-r border-line bg-surface lg:block lg:h-full lg:w-[22rem] lg:shrink-0 2xl:w-[26rem]">
        <ShopAIBox />
      </aside>

      <div className="scroll-y min-h-0 min-w-0 flex-1 overflow-y-auto">
        <PageContainer>
          {/* One row on every width: categories scroll, the actions stay on the
              right (icon-only on a phone) — no separate action row, and the
              assistant opens from here instead of a card above the tab bar. */}
          <PageHeader title="Shop">
            <div className="flex items-center gap-2">
              <div role="tablist" aria-label="Category" className="scroll-x -mx-1 flex min-w-0 flex-1 gap-1.5 px-1">
                {tops.length > 0 && <>
                  <button type="button" role="tab" aria-selected={!activeTop} onClick={() => setActiveTop(null)} className="pill-tab shrink-0">All</button>
                  {tops.map(t => (
                    <button key={t.id} type="button" role="tab" aria-selected={activeTop === t.id} onClick={() => setActiveTop(t.id)} className="pill-tab shrink-0">
                      {t.name}
                    </button>
                  ))}
                </>}
              </div>
              <IconButton label="Ask the shopping assistant" bordered onClick={openAssistant} className="shrink-0 lg:hidden"><Sparkles /></IconButton>
              <Button variant="primary" icon={<Plus />} onClick={() => setAddOpen(true)} aria-label="Add item" className="shrink-0">
                <span className="max-sm:hidden">Add item</span>
              </Button>
            </div>
          </PageHeader>

          {isLoading ? (
            <div className={ITEM_GRID}>
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}
            </div>
          ) : categories.length === 0 ? (
            <EmptyState bordered icon={<ShoppingBag />} title="No categories yet"
              description="Tell the assistant what you're planning to buy, or add an item yourself."
              action={<Button icon={<Plus />} onClick={() => setAddOpen(true)}>Add item</Button>} />
          ) : visibleItems.length === 0 ? (
            <EmptyState title="Nothing here yet" description="Items you add to this category show up here." />
          ) : (
            <div className="flex flex-col gap-5">
              {tops.filter(t => visibleTopIds.includes(t.id)).map(top => {
                const topSubs = subs.filter(s => s.parent_id === top.id && (bySub.get(s.id) ?? []).length > 0)
                if (topSubs.length === 0) return null
                return (
                  <section key={top.id} className="flex flex-col gap-2 sm:gap-3">
                    <h2 className="text-lead font-semibold text-fg">{top.name}</h2>
                    {topSubs.map(sub => (
                      <div key={sub.id} className="flex flex-col gap-2">
                        <SectionLabel>{sub.name}</SectionLabel>
                        <div className={ITEM_GRID}>
                          {(bySub.get(sub.id) ?? []).map(item => <ShopItemCard key={item.id} item={item} />)}
                        </div>
                      </div>
                    ))}
                  </section>
                )
              })}
            </div>
          )}
        </PageContainer>
      </div>

      {addOpen && <AddShopItemModal onClose={() => setAddOpen(false)} />}

      <Sheet open={aiOpen} onClose={() => setAiOpen(false)} size="lg">
        <div className="h-[75dvh] sm:h-[70dvh]">
          <ShopAIBox onClose={() => setAiOpen(false)} />
        </div>
      </Sheet>
    </div>
  )
}
