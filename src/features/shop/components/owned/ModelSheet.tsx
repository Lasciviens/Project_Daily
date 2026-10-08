import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button } from '../../../../shared/ui'
import { logError } from '../../../../shared/utils/logError'
import { useCreateShopItem } from '../../hooks/useShop'
import { useQuietCheck } from '../../hooks/useShopPrices'
import { readPriceLink } from '../../api/shopPriceApi'
import { currencyOf, SHOP_CURRENCIES } from '../../shopModel'
import { MoneyEditor } from '../record/factKit'
import { ItemThumb } from '../shopKit'
import type { ShopCurrency, ShopItem } from '../../types'

/**
 * Add a model to a general wish. A Prisjakt or shop link fills the name,
 * price and picture, and the morning check keeps its price fresh.
 */
export function ModelSheet({ wish, onClose }: { wish: ShopItem; onClose: () => void }) {
  const create = useCreateShopItem()
  const check = useQuietCheck()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>(currencyOf(wish))
  const [image, setImage] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function read() {
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) { setNote('Paste a whole link, starting with https://'); return }
    setReading(true); setNote(null)
    try {
      const r = await readPriceLink(u)
      if (r.name && !title.trim()) setTitle(r.name)
      if (r.low != null) { setPrice(r.low); if (r.currency && SHOP_CURRENCIES.includes(r.currency as ShopCurrency)) setCurrency(r.currency as ShopCurrency) }
      if (r.image) setImage(r.image)
      setNote(r.status === 'ok' ? `${r.source === 'prisjakt' ? `Prisjakt: lowest of ${r.offers ?? 'several'} shops` : 'The shop\'s price'} — read just now.`
        : r.status === 'blocked' ? 'The site blocks automatic reads — type the price yourself.' : 'No price on that page — type it yourself.')
    } catch (e) {
      setNote((e as Error).message)
      logError(`shop_read_link: ${(e as Error).message}`, { action: 'shop_read_link' })
    } finally { setReading(false) }
  }

  async function save() {
    const t = title.trim()
    if (!t) return
    let row: ShopItem
    try {
      row = await create.mutateAsync({ input: {
        title: t, price, currency, url: url.trim() || null, image_url: image, list: 'wishlist',
        category_id: wish.category_id, region: wish.region, option_for: wish.id,
      } })
    } catch { return }
    if (row.url) check([row.id])
    onClose()
  }

  return (
    <ModalShell onClose={onClose} title="Add a model" subtitle={wish.title} size="sm" dismissible={!create.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose} className="ml-auto" disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => { void save() }} disabled={!title.trim()} loading={create.isPending}>Add model</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="model-url" className="field-label">Link <span className="font-normal text-fg-faint">(Prisjakt or a shop)</span></label>
          <div className="flex gap-2">
            <input id="model-url" type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} onBlur={() => { if (url.trim() && !title.trim()) void read() }}
              placeholder="https://www.prisjakt.no/product.php?p=…" className="input min-w-0 flex-1" autoFocus />
            <Button icon={<Link2 />} onClick={() => { void read() }} loading={reading} disabled={!url.trim()}>Read</Button>
          </div>
          {note && <p className="mt-1 text-meta text-fg-muted">{note}</p>}
        </div>
        <div className="flex items-start gap-3">
          {image && <ItemThumb src={image} />}
          <div className="min-w-0 flex-1">
            <label htmlFor="model-title" className="field-label">Model</label>
            <input id="model-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="iPad Air 11&quot; M3 128 GB" className="input" />
          </div>
        </div>
        <div>
          <span className="field-label">Price</span>
          <MoneyEditor label="Price" amount={price} currency={currency} onAmount={setPrice} onCurrency={setCurrency} />
        </div>
      </div>
    </ModalShell>
  )
}
