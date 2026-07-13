import { toast } from '../../../app/store'
import { useUpdateShopItem, useDeleteShopItem } from '../hooks/useShop'
import type { ShopItem } from '../types'

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-ink-300', medium: 'bg-accent-400', high: 'bg-red-400',
}
const REGION_FLAG: Record<string, string> = { TR: '🇹🇷', NO: '🇳🇴' }

export function ShopItemCard({ item }: { item: ShopItem }) {
  const update = useUpdateShopItem()
  const remove  = useDeleteShopItem()
  const isBought = item.status === 'bought'

  function toggleBought() {
    const tid = toast.loading(isBought ? 'Reopening…' : 'Marking bought…')
    update.mutate(
      { id: item.id, patch: { status: isBought ? 'wishlist' : 'bought' } },
      {
        onSuccess: () => { toast.dismiss(tid); toast.success(isBought ? 'Back on wishlist' : 'Marked bought ✓') },
        onError:   e  => { toast.dismiss(tid); toast.error((e as Error).message) },
      }
    )
  }

  function handleDelete() {
    const tid = toast.loading('Deleting…')
    remove.mutate(item.id, {
      onSuccess: () => { toast.dismiss(tid); toast.success('Deleted') },
      onError:   e  => { toast.dismiss(tid); toast.error((e as Error).message) },
    })
  }

  return (
    <div className={`rounded-xl border border-ink-200 bg-cream-50 p-3 flex flex-col gap-1.5 ${isBought ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${PRIORITY_DOT[item.priority]}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold text-ink-900 leading-snug ${isBought ? 'line-through' : ''}`}>
            {item.title}
            {item.source_type === 'ai' && <span className="ml-1.5 text-[10px] text-accent-500" title="Added via AI">✦</span>}
          </p>
          {item.notes && <p className="text-xs text-ink-400 mt-0.5 line-clamp-2">{item.notes}</p>}
        </div>
        {item.region && <span className="text-base flex-shrink-0" title={item.region}>{REGION_FLAG[item.region]}</span>}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-1">
        {item.platform && <span className="text-[10px] bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded-full">{item.platform}</span>}
        {item.price != null && (
          <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
            {item.price} {item.price_source === 'ai_estimate' ? '(est.)' : ''}
          </span>
        )}
        {item.planned_date && (
          <span className="text-[10px] bg-accent-50 text-accent-600 px-1.5 py-0.5 rounded-full">
            {new Date(item.planned_date + 'T00:00:00').toLocaleDateString('en-GB')}
          </span>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:text-blue-700 underline">
            Link ↗
          </a>
        )}
      </div>

      <div className="flex items-center gap-1 mt-1 pt-1.5 border-t border-ink-100">
        <button
          onClick={toggleBought}
          className="flex-1 min-h-[44px] text-[11px] font-medium rounded-lg transition-colors hover:bg-cream-100 text-ink-600"
        >
          {isBought ? '↩ Back to wishlist' : '✓ Mark bought'}
        </button>
        <button
          onClick={handleDelete}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors text-sm"
        >✕</button>
      </div>
    </div>
  )
}
