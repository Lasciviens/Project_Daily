import { useMemo, useState } from 'react'
import { ArrowDown, Plus, RotateCcw } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, Truncate, cx } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { storeNames } from '../../shopModel'
import { complete, type MoneyCtx } from '../../ownModel'
import { chainPath } from '../../chainModel'
import { boughtToSell } from '../../statsModel'
import {
  copiedOf, draftChain, draftOutcome, draftProblems, draftRows, hasContent, ratePairs, resolveSteps, stepView,
} from '../../chainDraft'
import { useDayRates, useSaveShopChain } from '../../hooks/useShopChain'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import { ChainSummary } from './ChainSummary'
import { headline } from './chainText'
import { StepCard } from './StepCard'
import { useChainDraft } from './useChainDraft'
import type { ShopCategory, ShopItem, ShopItemLink } from '../../types'

const NONE = { items: [] as ShopItem[], links: [] as ShopItemLink[] }

/**
 * Build a money chain in one go (owner, 12.10.2026): bought → sold → bought →
 * sold…, every detail per thing, and the answer live as you type — what the
 * chain made or lost and how much of your own money went in. The numbers are
 * chainModel's own on the rows the save will write. Saving writes everything
 * in one transaction, then shows the saved chain. `from`: a saved thing that
 * left — the chain goes on from it.
 */
export function ChainBuilder({ from, items, links, categories, ctx, onClose }: {
  from: ShopItem | null
  items: ShopItem[]
  links: ShopItemLink[]
  categories: ShopCategory[]
  ctx: MoneyCtx
  onClose: () => void
}) {
  const modal = useEntityModal()
  const today = todayStr()
  const [nowIso] = useState(() => new Date().toISOString())
  const base = useMemo(() => (from ? copiedOf(from) : null), [from])
  const d = useChainDraft(from?.id ?? null, base, from?.sale_currency ?? from?.currency ?? 'NOK')
  const save = useSaveShopChain()
  const [tried, setTried] = useState(false)

  const steps = useMemo(() => resolveSteps(d.draft, base), [d.draft, base])
  const pairs = useMemo(() => ratePairs(d.draft, base), [d.draft, base])
  const { rates, loading } = useDayRates(pairs)
  const rows = useMemo(() => draftRows(d.draft, base, { mode: 'live', userId: '', nowIso, today, newId: () => '', rates }), [d.draft, base, nowIso, today, rates])
  const existing = useMemo(() => (from ? { items, links } : NONE), [from, items, links])
  const chain = useMemo(() => draftChain(d.draft, rows, existing, ctx), [d.draft, rows, existing, ctx])
  const outcome = useMemo(() => (chain ? draftOutcome(chain, ctx) : null), [chain, ctx])
  const head = headline(outcome)
  const problems = useMemo(() => draftProblems(d.draft, today), [d.draft, today])
  const stores = useMemo(() => storeNames(items), [items])
  const keys = new Set(d.draft.steps.map(s => s.key))
  const earlier = chain ? chain.nodes.filter(n => !keys.has(n.id) && n.state !== 'wish') : []

  async function close() {
    if (hasContent(d.draft) && !(await modal.confirm({ title: 'Discard this chain?', message: 'Nothing of it is saved yet.', confirmLabel: 'Discard', destructive: true }))) return
    d.forget()
    onClose()
  }

  async function submit() {
    if (problems.length) {
      setTried(true)
      d.openAll([...new Set(problems.map(p => p.key))])
      return
    }
    try { await save.mutateAsync({ draft: d.draft, base, today }) } catch { return }
    d.forget()
    onClose()
    modal.open({ kind: 'shop-chain', id: d.draft.steps[0].key })
  }

  const shown = (key: string) => problems.filter(p => p.key === key && (tried || !p.missing))
  const before = (i: number) => {
    if (i > 0) {
      const p = steps[i - 1]
      return { title: p.title.trim() || `thing ${i}`, saleCurrency: p.gotCurrency ?? p.currency, leftOn: p.left && p.leftOn ? p.leftOn : null }
    }
    return from ? { title: from.title, saleCurrency: from.sale_currency ?? from.currency ?? 'NOK', leftOn: from.disposed_on ?? null } : null
  }

  return (
    <ModalShell
      onClose={() => { void close() }}
      title={from ? `Go on from ${from.title}` : 'New money chain'}
      subtitle={chain && chain.nodes.length > 1 ? `${from && chain.name ? `${chain.name}: ` : ''}${chainPath(chain)}` : 'Bought → sold → bought: the whole chain at once'}
      size="xl"
      mobile="fullscreen"
      dismissible={!save.isPending}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <p className={cx('min-w-0 basis-full text-ui font-semibold tabular-nums sm:basis-auto sm:flex-1', head.sign == null ? 'text-fg-muted' : 'text-fg')} aria-live="polite">
            <Truncate as="span" className="block">{head.short}</Truncate>
          </p>
          {tried && problems.length > 0 && <p className="basis-full text-meta text-danger sm:basis-auto">Fill the marked fields first</p>}
          <Button onClick={() => { void close() }} disabled={save.isPending} className="ml-auto">Cancel</Button>
          <Button variant="primary" onClick={() => { void submit() }} loading={save.isPending}>Save chain</Button>
        </div>
      }
    >
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @[46rem]:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-3">
            {d.restored && (
              <div className="flex flex-wrap items-center gap-2 rounded-row bg-surface-2 px-3 py-2 text-meta text-fg-2">
                <span className="min-w-0 flex-1">Your unsaved chain from before is back.</span>
                <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={d.startOver}>Start over</Button>
                <Button size="sm" variant="ghost" onClick={d.dismissRestored}>OK</Button>
              </div>
            )}
            {!from && (
              <div>
                <label htmlFor="chain-name" className="field-label">Name <span className="font-normal normal-case tracking-normal text-fg-faint">(optional)</span></label>
                <input id="chain-name" value={d.draft.name} onChange={e => d.setName(e.target.value)} maxLength={80} placeholder="Handheld ladder…" className="input max-w-md" />
              </div>
            )}
            {earlier.length > 0 && (
              <div className="rounded-row border border-line bg-surface-2 p-3">
                <p className="section-label mb-1">Already in this chain</p>
                <ul className="flex flex-col gap-1 text-meta">
                  {earlier.map(n => (
                    <li key={n.id} className="flex flex-wrap items-baseline gap-x-2">
                      <Truncate as="span" className="min-w-0 flex-1 text-body text-fg-2">{n.item.title}</Truncate>
                      <span className="tabular-nums text-fg-muted">paid <AmountText amount={n.paid} />{n.got && <> · got <AmountText amount={n.got} /></>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ol className="flex flex-col">
              {steps.map((s, i) => {
                const view = stepView(chain, s.key)
                const next = steps[i + 1]
                const nextView = next ? stepView(chain, next.key) : null
                return (
                  <li key={s.key}>
                    <StepCard
                      s={s} index={i} before={before(i)} row={rows.items.find(r => r.id === s.key)} view={view}
                      problems={shown(s.key)} open={d.open.has(s.key)} canRemove={steps.length > 1}
                      categories={categories} stores={stores} today={today} ratesLoading={loading}
                      set={patch => d.update(i, patch)} onCopy={on => d.copy(i, on)} onToggle={() => d.toggle(s.key)} onRemove={() => d.remove(i)}
                    />
                    {next && (
                      <p className="flex items-start gap-2 py-1.5 pl-3 text-meta text-fg-muted">
                        <ArrowDown aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-faint" />
                        <span className="tabular-nums">{connector(s, next, view, nextView)}</span>
                      </p>
                    )}
                  </li>
                )
              })}
            </ol>
            <div>
              <Button icon={<Plus />} onClick={d.add}>Add next thing</Button>
              <p className="mt-1 text-meta text-fg-faint">Paid with the money from {steps[steps.length - 1]?.title.trim() || 'the last thing'} — you can change that.</p>
            </div>
          </div>
          <aside className="flex flex-col gap-3 @[46rem]:sticky @[46rem]:top-0 @[46rem]:self-start">
            <ChainSummary chain={chain} outcome={outcome} head={head} toSell={!!chain && boughtToSell(chain)} />
          </aside>
        </div>
      </div>
    </ModalShell>
  )
}

/** "1 800 from selling RP5 went into RP6 · + 1 000 of your own" (or why nothing moves yet). */
function connector(s: { title: string; left: boolean }, next: { title: string; fromPrev: boolean }, view: ReturnType<typeof stepView>, nextView: ReturnType<typeof stepView> | null): string {
  const a = s.title.trim() || 'it'
  const b = next.title.trim() || 'the next thing'
  if (!next.fromPrev) return `${b} was paid with other money`
  if (!s.left) return `${b} is paid with ${a}'s money once ${a} has left (it is still yours)`
  const into = nextView?.fromSales
  if (!view.node?.got || !into) return `${a}'s money went into ${b}`
  if (!complete(into)) return `${a}'s money went into ${b} (amount unknown so far)`
  if (Math.round(into.nok) === 0) return `Nothing came back from ${a}; what it cost moves on to ${b}`
  const own = nextView?.ownCash
  const extra = own && complete(own) && Math.round(own.nok) > 0 ? ` · + ${money(own.nok)} of your own` : ''
  const kept = complete(view.node.got) && Math.round(view.node.got.nok - into.nok) > 0 ? ` · ${money(view.node.got.nok - into.nok)} kept` : ''
  return `${money(into.nok)} from ${a} went into ${b}${extra}${kept}`
}
