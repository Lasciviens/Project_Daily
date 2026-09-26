import { ExternalLink, RotateCcw, Check, Sparkles, X } from 'lucide-react'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { Card, IconButton, ToneDot, cx } from '../../../shared/ui'
import { useUpdateShopItem, useDeleteShopItem } from '../hooks/useShop'
import { REGION_FLAG, SHOP_PRIORITY_TONE } from '../shopMeta'
import type { ShopItem } from '../types'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

// Numbers carry units (THEME §11): the region decides the currency.
const CURRENCY: Record<string, string> = { NO: 'kr', TR: '₺' }
function formatShopPrice(price: number, region: string | null | undefined): string {
  const n = price.toLocaleString('en-GB', { maximumFractionDigits: 2 })
  const cur = region ? CURRENCY[region] : undefined
  return cur === '₺' ? `₺${n}` : cur ? `${n} ${cur}` : n
}

export function ShopItemCard({ item }: { item: ShopItem }) {
  const update = useUpdateShopItem()
  const remove = useDeleteShopItem()
  const isBought = item.status === 'bought'

  function toggleBought() {
    update.mutate({ id: item.id, patch: { status: isBought ? 'wishlist' : 'bought' } })
  }

  async function handleDelete() {
    const ok = await entityModal.confirm({
      title: `Delete "${item.title}"?`,
      message: 'This removes the item from your wishlist for good.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok) remove.mutate(item.id)
  }

  return (
    <Card padded={false} className={cx('flex flex-col', isBought && 'opacity-60')}>
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <ToneDot tone={SHOP_PRIORITY_TONE[item.priority]} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p className={`text-body font-semibold leading-snug text-fg ${isBought ? 'line-through' : ''}`}>
            {item.title}
            {item.source_type === 'ai' && <Sparkles aria-label="Added via AI" className="ml-1.5 inline h-3.5 w-3.5 align-[-2px] text-fg-faint" />}
          </p>
          {item.notes && <p className="mt-0.5 line-clamp-2 text-meta text-fg-muted">{item.notes}</p>}
        </div>
        {item.region && <span className="shrink-0 text-base leading-none" title={item.region}>{REGION_FLAG[item.region]}</span>}
      </div>

      {(item.platform || item.price != null || item.planned_date || item.url) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-3.5">
          {item.platform && <span className="chip">{item.platform}</span>}
          {item.price != null && (
            <span className="chip tabular-nums">{formatShopPrice(item.price, item.region)}{item.price_source === 'ai_estimate' ? ' (est.)' : ''}</span>
          )}
          {item.planned_date && (
            <span className="chip tabular-nums">{fmtDateEnGB(new Date(item.planned_date + 'T00:00:00'), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-[28px] items-center gap-1 text-meta font-semibold text-accent-600 hover:underline">
              Link <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      <div aria-hidden className="h-2 shrink-0" />
      {/* mt-auto pins the actions to the bottom when a row stretches the card. */}
      <div className="mt-auto flex items-center gap-1 border-t border-line px-1.5 py-1">
        <button type="button" onClick={toggleBought} disabled={update.isPending}
          className="btn-ghost btn-sm flex-1 justify-start gap-1.5 disabled:opacity-50">
          {isBought ? <RotateCcw aria-hidden className="h-4 w-4" /> : <Check aria-hidden className="h-4 w-4" />}
          {isBought ? 'Back to wishlist' : 'Mark bought'}
        </button>
        <IconButton label={`Delete ${item.title}`} onClick={handleDelete} className="text-fg-faint hover:!text-danger"><X /></IconButton>
      </div>
    </Card>
  )
}
