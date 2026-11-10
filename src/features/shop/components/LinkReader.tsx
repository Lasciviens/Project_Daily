import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { logError } from '../../../shared/utils/logError'
import { readPriceLink } from '../api/shopPriceApi'
import { SHOP_CURRENCIES } from '../shopModel'
import { readNote } from '../watchWords'
import type { ShopCurrency } from '../types'

/**
 * Paste a Prisjakt or shop link: its name, price and picture fill the form,
 * and a note says what was read and when (`readNote`) — or why there is no
 * price and what to do instead: a site that blocks apps with a browser check,
 * or one that doesn't let apps read it (never read; the form stays as it is).
 * The link is kept, and its price is checked every morning if the site lets
 * apps read it.
 */
export function LinkReader({ url, onUrl, onRead }: {
  url: string
  onUrl: (url: string) => void
  onRead: (r: { title: string | null; price: number | null; currency: ShopCurrency | null; image: string | null }) => void
}) {
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [readFor, setReadFor] = useState('')

  async function read(u = url.trim()) {
    if (!/^https?:\/\//i.test(u) || u === readFor) return
    setReading(true); setNote(null); setReadFor(u)
    try {
      const r = await readPriceLink(u)
      setNote(readNote(r))
      if (r.status === 'not_allowed') return
      const c = (r.currency ?? '').toUpperCase()
      onRead({ title: r.name, price: r.low, currency: SHOP_CURRENCIES.includes(c as ShopCurrency) ? c as ShopCurrency : null, image: r.image })
    } catch (e) {
      setNote((e as Error).message)
      logError(`shop_read_link: ${(e as Error).message}`, { action: 'shop_read_link' })
    } finally { setReading(false) }
  }

  return (
    <div>
      <label htmlFor="shop-link" className="field-label">Link <span className="font-normal text-fg-muted">(optional — Prisjakt or a shop)</span></label>
      <div className="flex max-w-xl gap-2">
        <input id="shop-link" type="url" inputMode="url" value={url} onChange={e => onUrl(e.target.value)}
          onPaste={e => { const t = e.clipboardData.getData('text').trim(); if (/^https?:\/\//i.test(t)) setTimeout(() => { void read(t) }, 0) }}
          onBlur={() => { void read() }} placeholder="Paste a link to fill the rest" className="input min-w-0 flex-1" />
        <Button icon={<Link2 />} onClick={() => { setReadFor(''); void read() }} loading={reading} disabled={!url.trim()}>Read</Button>
      </div>
      {note && <p className="mt-1 text-meta text-fg-muted">{note}</p>}
    </div>
  )
}
