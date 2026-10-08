import { useRef, useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, Truncate } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { middayIso } from '../../../media/watchedWhen'
import { useCreateShopItem } from '../../hooks/useShop'
import { useFillRatesNow } from '../../hooks/useShopMoney'
import { boughtOn } from '../../ownModel'
import { currencyOf } from '../../shopModel'
import { MoneyEditor } from '../record/factKit'
import type { ShopCurrency, ShopItem } from '../../types'

/**
 * Quick-add accessories to a thing (or to a wish: then they are wishes too).
 * "Add another" keeps the sheet open with the day and store, so a console's
 * case, card and grip go in one after another.
 */
export function AccessorySheet({ parent, onClose }: { parent: ShopItem; onClose: () => void }) {
  const create = useCreateShopItem()
  const fill = useFillRatesNow()
  const owned = parent.status === 'bought'
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>(currencyOf(parent))
  const [day, setDay] = useState(boughtOn(parent) ?? todayStr())
  const [store, setStore] = useState(parent.platform ?? '')
  const [added, setAdded] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)

  async function save(another: boolean) {
    const t = title.trim()
    if (!t) return
    try {
      await create.mutateAsync({
        quiet: true,
        input: {
          title: t, price, currency, platform: store.trim() || null, list: 'wishlist', category_id: parent.category_id,
          region: parent.region, accessory_of: parent.id, status: owned ? 'bought' : 'wishlist',
          ...(owned ? { bought_at: middayIso(day), approx_dates: !!parent.approx_dates } : {}),
        },
      })
    } catch { return }
    if (owned && currency !== 'NOK' && price != null) fill()
    setAdded(a => [...a, t])
    if (!another) { onClose(); return }
    setTitle(''); setPrice(null)
    input.current?.focus()
  }

  return (
    <ModalShell onClose={onClose} title="Add an accessory" subtitle={parent.title} size="sm" dismissible={!create.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose} disabled={create.isPending}>{added.length ? 'Done' : 'Cancel'}</Button>
          <Button onClick={() => { void save(true) }} disabled={!title.trim()} loading={create.isPending} className="ml-auto">Add another</Button>
          <Button variant="primary" onClick={() => { void save(false) }} disabled={!title.trim()} loading={create.isPending}>Add</Button>
        </div>
      }>
      <form onSubmit={e => { e.preventDefault(); void save(true) }} className="flex flex-col gap-3">
        <div>
          <label htmlFor="acc-title" className="field-label">Accessory</label>
          <input ref={input} id="acc-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Case, memory card, controller…" autoFocus className="input" enterKeyHint="next" />
        </div>
        <div>
          <span className="field-label">{owned ? 'Paid' : 'Price'} <span className="font-normal text-fg-faint">(0 if it came with it)</span></span>
          <MoneyEditor label="Price" amount={price} currency={currency} onAmount={setPrice} onCurrency={setCurrency} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {owned && (
            <div>
              <span className="field-label">Bought on</span>
              <DateInput value={day} onChange={d => d && setDay(d)} max={todayStr()} aria-label="Bought on" className="input w-[10rem] tabular-nums" />
            </div>
          )}
          <div>
            <label htmlFor="acc-store" className="field-label">Store</label>
            <input id="acc-store" value={store} onChange={e => setStore(e.target.value)} className="input" />
          </div>
        </div>
        {added.length > 0 && (
          <p className="text-meta text-success">Added: <Truncate as="span">{added.join(', ')}</Truncate></p>
        )}
        <button type="submit" hidden />
      </form>
    </ModalShell>
  )
}
