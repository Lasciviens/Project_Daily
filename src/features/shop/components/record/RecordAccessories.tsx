import { Plus } from 'lucide-react'
import { Button, Card, CardHeader, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { add, boughtOn, costOf, DISPOSAL_LABEL, type MoneyCtx } from '../../ownModel'
import { AmountText } from '../shopKit'
import { PaidText } from '../owned/PaidText'
import type { ShopItem } from '../../types'

/**
 * The accessories on a thing (or planned for a wish): what each cost and when,
 * the ones that left with it or on their own, and "+ Accessory".
 */
export function RecordAccessories({ item, accessories, ctx, canAdd }: { item: ShopItem; accessories: ShopItem[]; ctx: MoneyCtx; canAdd: boolean }) {
  const modal = useEntityModal()
  if (!accessories.length && !canAdd) return null
  const total = add(...accessories.filter(a => a.status === 'bought').map(a => costOf(a, ctx)))
  return (
    <Card>
      <CardHeader title="Accessories" variant="label" className="mb-1"
        subtitle={accessories.some(a => a.status === 'bought') ? <>with them <AmountText amount={add(costOf(item, ctx), total)} /> in all</> : undefined}
        action={canAdd && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => modal.open({ kind: 'shop-accessory', itemId: item.id })}>Accessory</Button>} />
      {accessories.length === 0 ? (
        <p className="text-meta text-fg-muted">A case, a memory card, a controller — add what came with it or was bought for it. When you sell it, you choose which go along.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {accessories.map(a => {
            const day = boughtOn(a)
            return (
              <li key={a.id}>
                <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: a.id })} className="flex min-h-[44px] w-full items-center gap-2 rounded-row px-2 text-left hover:bg-surface-hover">
                  <span className="min-w-0 flex-1">
                    <Truncate as="span" className="block text-body text-fg-2">{a.title}</Truncate>
                    <span className="block text-meta text-fg-muted">
                      {a.status === 'bought' ? <>{day ? formatDate(day) : 'Bought'}{a.disposal && <> · {DISPOSAL_LABEL[a.disposal]}{a.disposed_on ? ` ${formatDate(a.disposed_on)}` : ''}</>}</> : 'To buy'}
                    </span>
                  </span>
                  <span className="shrink-0 text-meta tabular-nums text-fg-muted"><PaidText item={a} /></span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
