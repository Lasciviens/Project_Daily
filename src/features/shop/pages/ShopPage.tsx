import { useState } from 'react'
import { useShopCategories, useShopItems } from '../hooks/useShop'
import { ShopAIBox } from '../components/ShopAIBox'
import { ShopItemCard } from '../components/ShopItemCard'
import { AddShopItemModal } from '../components/AddShopItemModal'
import { FoodTabs } from '../../personal/components/PersonalLayout'
import { Sheet } from '../../../shared/components/Sheet'
import { haptic } from '../../../shared/utils/haptics'

// Rendered inside PersonalLayout's flex-1 Outlet slot — h-full (not a
// viewport calc) so it exactly fills whatever height that slot has left
// (nav + Personal tab bar above). The two panes fill it so nothing on this
// page grows taller than its container or scrolls as a whole.
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

  const bySub = new Map<string, typeof items>()
  for (const item of visibleItems) {
    const arr = bySub.get(item.category_id) ?? []
    arr.push(item)
    bySub.set(item.category_id, arr)
  }

  const isLoading = catsLoading || itemsLoading

  return (
    <div className="w-full h-full flex flex-col sm:flex-row overflow-hidden">
      {/* Left pane — AI chat, fixed width, desktop-only. On mobile the chat
          used to be a permanent ~42vh block that ate the first screenful even
          when empty; it's now collapsed behind a compact "✦ Sor" bar that
          opens the box in a bottom sheet (below), so the wishlist owns the
          full screen by default. */}
      <div className="hidden sm:block sm:h-full sm:w-[380px] sm:flex-shrink-0 sm:border-r border-ink-200 bg-cream-50">
        <ShopAIBox />
      </div>

      {/* Right pane — categories + wishlist, its own scroll */}
      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-ink-900">Shop</h1>
            <p className="hidden sm:block text-xs text-ink-400 mt-0.5">Wishlist — things you're planning to buy</p>
          </div>
          {/* PersonalTabs live in each page's FIRST header row, far right —
              same spot on Daily/Shop/Food, no extra row, no jumping. */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setAddOpen(true)}
              aria-label="Add item"
              className="min-h-[44px] min-w-[44px] px-0 sm:px-4 bg-accent-500 text-white text-sm font-semibold rounded-xl hover:bg-accent-600 transition-colors flex-shrink-0 flex items-center justify-center gap-1"
            >
              <span aria-hidden className="text-lg leading-none sm:hidden">＋</span>
              <span className="hidden sm:inline">+ Add item</span>
            </button>
            <FoodTabs />
          </div>
        </div>

        {/* Top-category filter pills */}
        {tops.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            <button
              onClick={() => setActiveTop(null)}
              className={`text-xs px-3 min-h-[44px] rounded-full border font-medium transition-colors ${
                !activeTop ? 'bg-accent-500 text-white border-accent-500' : 'border-ink-200 text-ink-600 hover:border-accent-300'
              }`}
            >All</button>
            {tops.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTop(t.id)}
                className={`text-xs px-3 min-h-[44px] rounded-full border font-medium transition-colors ${
                  activeTop === t.id ? 'bg-accent-500 text-white border-accent-500' : 'border-ink-200 text-ink-600 hover:border-accent-300'
                }`}
              >{t.name}</button>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-cream-200 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && categories.length === 0 && (
          <div className="text-center py-14 border border-dashed border-ink-200 rounded-xl">
            <p className="text-2xl mb-2">🛍️</p>
            <p className="text-ink-600 font-medium text-sm">No categories yet</p>
            <p className="text-ink-400 text-xs mt-1">Tell the AI what you're planning to buy, or add an item manually</p>
          </div>
        )}

        {!isLoading && visibleItems.length === 0 && categories.length > 0 && (
          <p className="text-sm text-ink-400 py-6 text-center">Nothing here yet</p>
        )}

        <div className="space-y-6">
          {tops.filter(t => visibleTopIds.includes(t.id)).map(top => {
            const topSubs = subs.filter(s => s.parent_id === top.id).filter(s => (bySub.get(s.id) ?? []).length > 0)
            if (topSubs.length === 0) return null
            return (
              <div key={top.id}>
                <h2 className="text-xs font-bold uppercase tracking-wider text-ink-400 mb-2">{top.name}</h2>
                <div className="space-y-4">
                  {topSubs.map(sub => (
                    <div key={sub.id}>
                      <p className="text-[11px] font-semibold text-ink-500 mb-1.5">{sub.name}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {(bySub.get(sub.id) ?? []).map(item => <ShopItemCard key={item.id} item={item} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile-only docked bar that opens the chat as a bottom sheet */}
      <button
        onClick={() => { haptic('light'); setAiOpen(true) }}
        className="press-feedback sm:hidden flex-shrink-0 flex items-center gap-2 min-h-[48px] px-4 border-t border-ink-200 bg-cream-50 text-accent-700 text-sm font-semibold"
      >
        <span aria-hidden>✦</span>
        <span>Ask</span>
        <span className="ml-auto text-xs font-normal text-ink-400">Shopping assistant</span>
      </button>

      <AddShopItemModal open={addOpen} onClose={() => setAddOpen(false)} />

      {/* The AIBox lives here only for mobile — desktop keeps the left pane. */}
      <Sheet open={aiOpen} onClose={() => setAiOpen(false)} size="lg">
        <div className="h-[75vh]">
          <ShopAIBox onClose={() => setAiOpen(false)} />
        </div>
      </Sheet>
    </div>
  )
}
