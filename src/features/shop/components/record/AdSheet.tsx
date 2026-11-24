import { useMemo, useState } from 'react'
import { Copy, Sparkles } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, cx } from '../../../../shared/ui'
import { toast } from '../../../../app/store'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useAddResaleDefaults, useAdTemplates, useChangeListing, useCreateListing, useUpdateAdTemplate } from '../../hooks/useShopResale'
import { conditionChoice } from '../../resaleEvidence'
import { isPrice, RESALE_CONDITIONS, twoDecimals } from '../../resaleRows'
import { categoryNamesOf, fillAd, templateFor, unknownFields, AD_FIELDS } from '../../resaleTexts'
import { adClipboardText, adFactsOf, adPriceOf, marketplaceLink, marketplacesOf } from '../../sellingModel'
import { boughtOn, isMine } from '../../ownModel'
import { MoneyEditor, Toggle } from '../shopEditors'
import { useImproveAd } from '../../../ai/claude/hooks/useAiFeatures'
import { costNote } from '../../../ai/claude/featureRules'
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
  const improve = useImproveAd()
  // The owner's condition words are kept per thing on this device (a convenience, never sent anywhere but to Improve).
  const notesKey = `shop:adCondition:${r.item.id}`
  const [condNotes, setCondNotes] = useState(() => { try { return localStorage.getItem(notesKey) ?? '' } catch { return '' } })
  const keepNotes = (v: string) => { setCondNotes(v); try { if (v) localStorage.setItem(notesKey, v); else localStorage.removeItem(notesKey) } catch { /* no storage: the words stay in the sheet */ } }
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
  // A change of the choices refills the text from the template; the text it replaces (an edit, an improved ad) comes back with Undo.
  function resetText() {
    if (!edited) return
    const previous = edited
    setEdited(null)
    toast.undo('The text was refilled from your choices', () => setEdited(previous))
  }
  const title = edited?.title ?? filled?.title ?? item.title
  const body = edited?.body ?? filled?.body ?? ''
  const [editingTemplate, setEditingTemplate] = useState(false)
  // A link out only to a host the owner's templates name: a listing's marketplace could be the assistant's look-alike.
  const link = marketplaceLink(where, markets)
  const named = where && markets.includes(where) ? where : 'the marketplace'
  // A listing's price is below a billion with at most two decimals (192).
  const listable = price != null && isPrice(price) && twoDecimals(price)

  async function copy() {
    try {
      await navigator.clipboard.writeText(adClipboardText(title, body))
      toast.success(`Ad copied — paste it on ${named}`)
    } catch {
      toast.error('Couldn\'t copy — select the text and copy it by hand')
    }
  }

  // "Improve": the text as it stands (the template's, or the owner's edit) rewritten with the owner's condition words, in the
  // language they are in (Norwegian for FINN). It lands in the editable text and Undo brings back what was there.
  async function improveIt() {
    const before = { title, body }
    try {
      const better = await improve.mutateAsync({ title, template: body, notes: condNotes })
      setEdited({ title, body: better.text })
      toast.undo(`Ad improved by AI${costNote(better.costUsd) ? ` (${costNote(better.costUsd)})` : ''} — read it before you copy it`, () => setEdited(before))
    } catch { /* the hook reports it */ }
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
          <Button className="ml-auto" onClick={keep} disabled={!listing && !listable} loading={create.isPending || change.isPending} aria-label={listing ? 'Save to the listing' : 'Mark it listed'}
            title={!listing && !listable ? 'Add an asking price (below a billion, at most two decimals) to list it' : listing ? 'Save to the listing' : 'Mark it listed'}>
            {listing ? 'Save' : 'Listed'}
          </Button>
          <Button variant="primary" icon={<Copy />} onClick={() => void copy()} disabled={!body.trim()} tip="Copy the ad">Copy</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <div>
          <span className="field-label">Where</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Marketplace">
            {[...markets, null].map(m => (
              <button key={m ?? 'other'} type="button" role="radio" aria-checked={where === m} onClick={() => { setMarket(m); resetText() }}
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
            <select value={condition ?? ''} onChange={e => { setCondition((e.target.value || null) as ResaleCondition | null); resetText() }} className="select max-w-xs">
              <option value="">Not said</option>
              {RESALE_CONDITIONS.map(c => <option key={c} value={c}>{conditionChoice(c)}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="field-label">Asking price</span>
            <MoneyEditor label="Asking price" amount={price} currency={currency} onAmount={p => { setPrice(p); resetText() }} onCurrency={c => { setCurrency(c); resetText() }} />
            {start.from === 'estimate' && price === start.price && <span className="text-meta text-fg-muted">Your estimate</span>}
          </div>
        </div>
        <div className="flex flex-col">
          {boughtOn(item) && <Toggle checked={bought} onChange={v => { setBought(v); resetText() }}>Say when it was bought ({item.approx_dates ? 'ca. ' : ''}{formatDate(boughtOn(item))})</Toggle>}
          {mine.map(a => (
            <Toggle key={a.id} checked={withIt.has(a.id)} onChange={v => { setWithIt(s => { const n = new Set(s); if (v) n.add(a.id); else n.delete(a.id); return n }); resetText() }}>
              With it: {a.title}
            </Toggle>
          ))}
        </div>
        {isLoading ? null : !template ? (
          <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
            <span>No ad template{where ? ` for ${where}` : ''}.</span>
            <Button size="sm" variant="ghost" onClick={() => defaults.mutate()} loading={defaults.isPending} tip="Defaults — put back the default texts">Defaults</Button>
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
        <div className="flex flex-wrap items-center gap-2">
          <input value={condNotes} onChange={e => keepNotes(e.target.value)} maxLength={1000} placeholder="Condition in your words: scratches, what is included…"
            aria-label="Condition, in your words" className="input input-sm min-w-0 flex-1" />
          <Button size="sm" icon={<Sparkles />} loading={improve.isPending} disabled={!condNotes.trim() || !body.trim()} onClick={() => { void improveIt() }}
            title="AI call: rewrites the text with your condition words, in their language — you read and edit it; nothing is added that you did not say">Improve</Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-meta text-fg-muted">
          {template && <span>{template.language === 'nb' ? 'In Norwegian' : 'In English'}, from your template{template.marketplace ? ` for ${template.marketplace}` : ''}.</span>}
          {edited && filled && <button type="button" className="font-semibold text-accent-600 hover:underline" onClick={() => resetText()} title="Refill — fill the ad in again">Refill</button>}
          {template && !editingTemplate && <button type="button" className="font-semibold text-accent-600 hover:underline" onClick={() => setEditingTemplate(true)} title="Template — edit it">Template</button>}
        </div>
        {filled && filled.unknown.length > 0 && <p className="text-meta text-warn">The template names {filled.unknown.map(f => `{${f}}`).join(', ')}, which the app doesn't fill.</p>}
        {template && editingTemplate && <TemplateEditor id={template.id} title={template.title} body={template.body} onDone={() => { setEditingTemplate(false); resetText() }} />}
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
          onClick={() => save.mutate({ id, patch: { title, body } }, { onSuccess: onDone })} tip="Save the template">Save</Button>
      </div>
    </div>
  )
}
