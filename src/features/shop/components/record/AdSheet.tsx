import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, cx } from '../../../../shared/ui'
import { toast } from '../../../../app/store'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useAddResaleDefaults, useAdTemplates, useChangeListing, useCreateListing, useUpdateAdTemplate } from '../../hooks/useShopResale'
import { CONDITION_LABEL } from '../../resaleEvidence'
import { isPrice, RESALE_CONDITIONS, twoDecimals } from '../../resaleRows'
import { categoryNamesOf, fillAd, templateFor, unknownFields, AD_FIELDS } from '../../resaleTexts'
import { adClipboardText, adFactsOf, adPriceOf, marketplaceLink, marketplacesOf } from '../../sellingModel'
import { boughtOn, isMine } from '../../ownModel'
import { MoneyEditor, Toggle } from './factKit'
import { AddressLink } from './AddressLink'
import type { ShopRecordModel } from './useShopRecord'
import type { ResaleCondition, ShopListing } from '../../resaleTypes'
import type { ShopCurrency } from '../../types'

/**
 * "Write the ad": the marketplace's template (Norwegian, the owner's own rows), filled from the thing with what the
 * owner picks here — condition, asking price, the day it was bought, the accessories that go with it — and editable.
 * Copy puts it on the clipboard; the app never posts it anywhere. The marketplace shows as a link out with its
 * address. "Mark it listed" keeps the ad on a new listing (Listed), or saves it to the open one.
 */
export function AdSheet({ r, listing, onClose }: { r: ShopRecordModel; listing: ShopListing | null; onClose: () => void }) {
  const { item, categories, accessories, today } = r
  const { data: templates = [], isLoading } = useAdTemplates()
  const defaults = useAddResaleDefaults()
  const create = useCreateListing()
  const change = useChangeListing()
  const markets = useMemo(() => marketplacesOf(templates), [templates])
  const [market, setMarket] = useState<string | null | undefined>(listing ? listing.marketplace : undefined)
  const where = market === undefined ? markets[0] ?? null : market
  const names = useMemo(() => categoryNamesOf(item.category_id, categories), [item.category_id, categories])
  const template = templateFor(templates, where, names)
  const start = adPriceOf(item, listing)
  const [condition, setCondition] = useState<ResaleCondition | null>('good')
  const [price, setPrice] = useState<number | null>(start.price)
  const [currency, setCurrency] = useState<ShopCurrency>((start.currency as ShopCurrency) ?? 'NOK')
  const mine = accessories.filter(a => isMine(a))
  const [withIt, setWithIt] = useState<Set<string>>(() => new Set(mine.map(a => a.id)))
  const [bought, setBought] = useState(!!boughtOn(item))
  const facts = adFactsOf(item, { condition, price, currency, bought, accessories: mine.filter(a => withIt.has(a.id)).map(a => a.title) })
  const filled = template ? fillAd(template, facts) : null
  // The text follows the choices until the owner edits it; then it stays theirs (Fill in again takes the template's).
  const [edited, setEdited] = useState<{ title: string; body: string } | null>(listing?.ad_text ? splitAd(listing.ad_text) : null)
  const title = edited?.title ?? filled?.title ?? item.title
  const body = edited?.body ?? filled?.body ?? ''
  const [editingTemplate, setEditingTemplate] = useState(false)
  const link = marketplaceLink(where)
  // A listing's price is below a billion with at most two decimals (192).
  const listable = price != null && isPrice(price) && twoDecimals(price)

  async function copy() {
    try {
      await navigator.clipboard.writeText(adClipboardText(title, body))
      toast.success(`Ad copied — paste it on ${where ?? 'the marketplace'}`)
    } catch {
      toast.error('Couldn\'t copy — select the text and copy it by hand')
    }
  }

  function keep() {
    const text = adClipboardText(title, body)
    if (listing) {
      change.mutate({ listing, patch: { ad_text: text, marketplace: where }, done: 'Ad saved to the listing', today }, { onSuccess: onClose })
    } else if (listable && price != null) {
      create.mutate({ input: { item_id: item.id, price, currency, marketplace: where, ad_text: text, status: 'listed' }, title: item.title, today }, { onSuccess: onClose })
    }
  }

  return (
    <ModalShell onClose={onClose} title="Write the ad" subtitle={item.title} size="lg" dismissible={!create.isPending && !change.isPending}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onClose} variant="ghost">Close</Button>
          <Button className="ml-auto" onClick={keep} disabled={!listing && !listable} loading={create.isPending || change.isPending}
            title={!listing && !listable ? 'Add an asking price (below a billion, at most two decimals) to list it' : undefined}>
            {listing ? 'Save to the listing' : 'Mark it listed'}
          </Button>
          <Button variant="primary" icon={<Copy />} onClick={() => void copy()} disabled={!body.trim()}>Copy the ad</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <div>
          <span className="field-label">Where</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Marketplace">
            {[...markets, null].map(m => (
              <button key={m ?? 'other'} type="button" role="radio" aria-checked={where === m} onClick={() => { setMarket(m); setEdited(null) }}
                className={cx('chip min-h-[36px] px-3', where === m ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'hover:bg-surface-hover')}>
                {m ?? 'Elsewhere'}
              </button>
            ))}
          </div>
          {link && <p className="mt-1 flex min-w-0 items-center gap-1 text-meta text-fg-muted">Post it yourself on <AddressLink url={link} /></p>}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="field-label">Condition</span>
            <select value={condition ?? ''} onChange={e => { setCondition((e.target.value || null) as ResaleCondition | null); setEdited(null) }} className="select max-w-xs">
              <option value="">Not said</option>
              {RESALE_CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="field-label">Asking price</span>
            <MoneyEditor label="Asking price" amount={price} currency={currency} onAmount={p => { setPrice(p); setEdited(null) }} onCurrency={c => { setCurrency(c); setEdited(null) }} />
            {start.from === 'estimate' && price === start.price && <span className="text-meta text-fg-muted">Your estimate</span>}
          </div>
        </div>
        <div className="flex flex-col">
          {boughtOn(item) && <Toggle checked={bought} onChange={v => { setBought(v); setEdited(null) }}>Say when it was bought ({item.approx_dates ? 'ca. ' : ''}{formatDate(boughtOn(item))})</Toggle>}
          {mine.map(a => (
            <Toggle key={a.id} checked={withIt.has(a.id)} onChange={v => { setWithIt(s => { const n = new Set(s); if (v) n.add(a.id); else n.delete(a.id); return n }); setEdited(null) }}>
              With it: {a.title}
            </Toggle>
          ))}
        </div>
        {isLoading ? null : !template ? (
          <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
            <span>No ad template{where ? ` for ${where}` : ''}.</span>
            <Button size="sm" variant="ghost" onClick={() => defaults.mutate()} loading={defaults.isPending}>Put back the default texts</Button>
          </div>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="field-label">Title</span>
          <input value={title} onChange={e => setEdited({ title: e.target.value, body })} className="input" aria-label="The ad's title" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Text</span>
          <textarea value={body} onChange={e => setEdited({ title, body: e.target.value })} rows={8} className="input resize-y" aria-label="The ad's text" />
        </label>
        <div className="flex flex-wrap items-center gap-x-2 text-meta text-fg-muted">
          {template && <span>{template.language === 'nb' ? 'In Norwegian' : 'In English'}, from your template{template.marketplace ? ` for ${template.marketplace}` : ''}.</span>}
          {edited && filled && <button type="button" className="font-semibold text-accent-600 hover:underline" onClick={() => setEdited(null)}>Fill in again</button>}
          {template && !editingTemplate && <button type="button" className="font-semibold text-accent-600 hover:underline" onClick={() => setEditingTemplate(true)}>Edit the template</button>}
        </div>
        {filled && filled.unknown.length > 0 && <p className="text-meta text-warn">The template names {filled.unknown.map(f => `{${f}}`).join(', ')}, which the app doesn't fill.</p>}
        {template && editingTemplate && <TemplateEditor id={template.id} title={template.title} body={template.body} onDone={() => { setEditingTemplate(false); setEdited(null) }} />}
      </div>
    </ModalShell>
  )
}

/** An ad kept on a listing back into its title and text (the first paragraph is the title). */
function splitAd(text: string): { title: string; body: string } {
  const i = text.indexOf('\n\n')
  return i < 0 ? { title: text.trim(), body: '' } : { title: text.slice(0, i).trim(), body: text.slice(i + 2).trim() }
}

/** The template itself, edited in place: its fields are {name}, {condition}, {bought}, {price} and {accessories}. */
function TemplateEditor({ id, title: t0, body: b0, onDone }: { id: string; title: string; body: string; onDone: () => void }) {
  const save = useUpdateAdTemplate()
  const [title, setTitle] = useState(t0)
  const [body, setBody] = useState(b0)
  const unknown = unknownFields(`${title}\n${body}`)
  return (
    <div className="flex flex-col gap-2 rounded-row bg-surface-2 p-2">
      <input value={title} onChange={e => setTitle(e.target.value)} className="input" aria-label="Template title" />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} className="input resize-y font-mono text-meta" aria-label="Template text" />
      <p className="text-meta text-fg-muted">Fields: {AD_FIELDS.map(f => `{${f}}`).join(' ')} — a line whose field has nothing to say is left out.</p>
      {unknown.length > 0 && <p className="text-meta text-warn">Not a field the app fills: {unknown.map(f => `{${f}}`).join(', ')}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" loading={save.isPending} disabled={!title.trim() || !body.trim()}
          onClick={() => save.mutate({ id, patch: { title, body } }, { onSuccess: onDone })}>Save the template</Button>
      </div>
    </div>
  )
}
