import { useMemo, useState, type ReactNode } from 'react'
import { Copy, RotateCcw } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { toast } from '../../../../app/store'
import { useShopItem } from '../../hooks/useShop'
import { useWatchMap } from '../../hooks/useShopPrices'
import { useMoneyBack } from '../../hooks/useMoneyBack'
import { useLawRules, useShopStores, useStoreRules } from '../../hooks/useShopStores'
import { complaintLetter, letterFacts, storePageOf } from '../../complaintModel'
import { boughtDayOf, dateSource, deadlinesOf, type StoreCtx } from '../../purchaseModel'
import { currencyOf } from '../../shopModel'
import { MoneyEditor } from '../record/factKit'
import { DateFact, DeadlineWords } from '../purchase/purchaseKit'
import { SiteLink } from '../shopKit'
import { money } from '../shopFormat'
import type { Deadline } from '../../storeRules'
import type { ShopCurrency, ShopItem } from '../../types'

/** One numbered step: what to do, then its detail. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-2 text-micro tabular-nums text-fg-2">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-body font-semibold text-fg">{title}</h3>
        {children}
      </div>
    </li>
  )
}

/** A day the sheet shows: the record's own (the rules' named beside it, as the Purchase section does), else the rules'. */
function Why({ stored, rules, extra }: { stored: string | null | undefined; rules: Deadline | null; extra?: string }) {
  if (dateSource(stored, rules?.day) === 'own') {
    return <p className="text-meta text-fg-muted">Your own date{rules ? ` — the rules give ${formatDate(rules.day)}: ${rules.words.replace(/^\S+ by \S+ — /, '')}` : ''}.{extra ? ` ${extra}` : ''}</p>
  }
  return <DeadlineWords deadline={rules} notes={extra ? [extra] : []} />
}

/**
 * Something's wrong with a thing you own (Shop step C): the complaint right first — Complain by and, while it is
 * open, Return by, from the store's rules and Norway's law as the record's Purchase section counts them
 * (`purchaseModel.deadlinesOf`; a date set in Just bought wins, the rules' named beside it), the store's page
 * when the record has one — then the steps: complain in writing (the letter in Norwegian, filled in from the record
 * and what is wrong; edit it, copy it), let the store repair or replace it, or take a price cut or the money back
 * ("Got 500 back" records a rebate: saved).
 */
export function ComplaintSheet({ item: first, onClose }: { item: ShopItem; onClose: () => void }) {
  const today = todayStr()
  // The live row: a purchase day added in Just bought (opened from here) shows at once.
  const item = useShopItem(first.id).data ?? first
  const modal = useEntityModal()
  const watch = useWatchMap().get(item.id) ?? null
  const { data: stores = [] } = useShopStores()
  const { data: rules = [] } = useStoreRules()
  const { data: law = [] } = useLawRules()
  const ctx: StoreCtx = useMemo(() => ({ stores, rules, law }), [stores, rules, law])
  const { store, deadlines } = useMemo(() => deadlinesOf(item, ctx), [item, ctx])
  const back = useMoneyBack()
  const [problem, setProblem] = useState('')
  // The letter follows the facts and "What's wrong" until the owner edits it; then it is theirs.
  const [edited, setEdited] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [currency, setCurrency] = useState<ShopCurrency>(currencyOf(item))
  const complainBy = item.warranty_until ?? deadlines?.complaintBy?.day ?? null
  const returnBy = item.return_by ?? deadlines?.returnBy?.day ?? null
  const storeName = store?.name ?? item.platform
  const filled = useMemo(() => complaintLetter({ ...letterFacts(item), problem }), [item, problem])
  const letter = edited ?? filled
  // The record's link is the store's own page only when it is https and not a price site's (Prisjakt is told by its host).
  const storePage = storePageOf(item.url, watch?.source)

  async function copy() {
    try {
      await navigator.clipboard.writeText(letter)
      toast.success('Letter copied')
    } catch {
      toast.error('Could not copy — your browser blocked the clipboard')
    }
  }

  function gotBack() {
    if (!amount || amount <= 0) return
    back.mutate({ item_id: item.id, kind: 'claim', amount, currency }, { onSuccess: () => setAmount(null) })
  }

  return (
    <ModalShell open onClose={onClose} title="Something's wrong" subtitle={item.title} size="md"
      footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
      <div className="flex flex-col gap-4">
        <section aria-label="Your rights" className="flex flex-col gap-1.5">
          {boughtDayOf(item) || item.warranty_until ? (
            <DateFact label="Complain by" day={complainBy} today={today}>
              <Why stored={item.warranty_until} rules={deadlines?.complaintBy ?? null} />
            </DateFact>
          ) : (
            <p className="text-body text-fg-muted">
              No purchase day yet — add it in{' '}
              <button type="button" onClick={() => modal.open({ kind: 'shop-just-bought', id: item.id })} className="font-semibold text-accent-600 hover:underline">Just bought</button>
              {' '}to see how long you can complain.
            </p>
          )}
          {returnBy && returnBy >= today && (
            <DateFact label="Return by" day={returnBy} today={today}>
              <Why stored={item.return_by} rules={deadlines?.returnBy ?? null} extra="Often quicker than a complaint." />
            </DateFact>
          )}
          {storePage && (
            <p className="text-meta text-fg-muted">
              {storeName ? `${storeName}'s page for it: ` : 'The store\'s page: '}<SiteLink url={storePage} />
            </p>
          )}
        </section>

        <ol className="flex flex-col gap-4">
          <Step n={1} title="Complain in writing">
            <label className="flex flex-col gap-1">
              <span className="field-label">What's wrong?</span>
              <textarea value={problem} onChange={e => setProblem(e.target.value)} rows={2} placeholder="The left earbud stopped charging after 8 months"
                className="input resize-y" autoFocus />
            </label>
            <div className="flex items-center gap-2">
              <span className="field-label flex-1">The letter, in Norwegian</span>
              {edited != null && (
                <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setEdited(null)}>Fill in again</Button>
              )}
              <Button size="sm" variant="primary" icon={<Copy />} onClick={() => { void copy() }}>Copy</Button>
            </div>
            <textarea value={letter} onChange={e => setEdited(e.target.value)} rows={12} aria-label="The complaint letter" lang="nb"
              className={cx('input resize-y text-meta leading-relaxed', edited != null && 'border-line-strong')} />
            <p className="text-meta text-fg-muted">Send it to the store by email or its contact form, with the receipt. Keep their answer.</p>
          </Step>
          <Step n={2} title="Let the store repair it or replace it">
            <p className="text-meta text-fg-muted">The store chooses which; it must be free for you and done within a reasonable time.</p>
          </Step>
          <Step n={3} title="Or a price cut, or your money back">
            <p className="text-meta text-fg-muted">When it can&apos;t be fixed. What came back counts as saved in Stats.</p>
            <div className="flex flex-wrap items-center gap-2">
              <MoneyEditor label="Money back" amount={amount} currency={currency} onAmount={setAmount} onCurrency={setCurrency} />
              <Button size="sm" onClick={gotBack} loading={back.isPending} disabled={!amount || amount <= 0}>
                {amount && amount > 0 ? `Got ${money(amount, currency)} back` : 'Got money back'}
              </Button>
            </div>
          </Step>
        </ol>
      </div>
    </ModalShell>
  )
}
