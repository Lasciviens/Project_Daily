import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, TonePill, Truncate, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { chainFor, chainPath, type ChainOverrides } from '../../chainModel'
import { ChainName } from './ChainName'
import { complete, durationLabel, type MoneyCtx } from '../../ownModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import type { ShopItem, ShopItemLink } from '../../types'

/**
 * A money chain as a ledger: each thing (with its accessories) — paid, got
 * back, what it passed on — and the running net, whose last bar is the
 * answer. "Try other prices" turns every amount into an input and replays
 * the maths live; nothing is saved.
 */
export function ChainPopup({ id, items, links, ctx, onClose }: { id: string; items: ShopItem[]; links: ShopItemLink[]; ctx: MoneyCtx; onClose: () => void }) {
  const modal = useEntityModal()
  const [what, setWhat] = useState(false)
  const [over, setOver] = useState<ChainOverrides>({})
  const real = useMemo(() => chainFor(id, items, links, ctx), [id, items, links, ctx])
  const tried = useMemo(() => (Object.keys(over).length ? chainFor(id, items, links, ctx, { overrides: over }) : null), [id, items, links, ctx, over])
  const chain = tried ?? real
  if (!real || !chain) return null
  const things = chain.nodes.filter(n => n.state !== 'wish')
  const nets = things.reduce<number[]>((acc, n) => [...acc, (acc[acc.length - 1] ?? 0) + n.paid.nok - (n.got?.nok ?? 0)], [])
  const top = Math.max(1, ...nets.map(Math.abs))
  const delta = tried && complete(tried.net) && complete(real.net) ? tried.net.nok - real.net.nok : null
  const set = (nodeId: string, key: 'paidNok' | 'gotNok', v: number | null) =>
    setOver(o => { const n = { ...o, [nodeId]: { ...o[nodeId], [key]: v ?? undefined } }; if (n[nodeId].paidNok === undefined && n[nodeId].gotNok === undefined) delete n[nodeId]; return n })
  const profit = complete(chain.net) && chain.net.nok < 0
  const last = things[things.length - 1]
  const final = last && last.state === 'held' && chain.linear && things.length > 1 ? last : null

  return (
    <ModalShell onClose={onClose} title={things.length > 1 ? real.name ?? 'Money chain' : 'Try other prices'} subtitle={chainPath(real)} size="lg"
      footer={
        <div className="flex items-center gap-2">
          {what && Object.keys(over).length > 0 && <Button variant="ghost" icon={<RotateCcw />} onClick={() => setOver({})}>Reset</Button>}
          <Button onClick={onClose} className="ml-auto">Close</Button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        {things.length > 1 && <ChainName chain={real} renameOnly />}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div>
            <p className="section-label">{profit ? 'Profit' : 'Net cost'}</p>
            <p className="text-kpi font-bold tabular-nums text-fg">
              {complete(chain.net) ? money(Math.abs(chain.net.nok)) : <AmountText amount={chain.net} />}
              {delta != null && delta !== 0 && (
                <span className={cx('ml-2 text-body font-semibold', delta < 0 ? 'text-success' : 'text-warn')}>
                  {delta < 0 ? '−' : '+'}{money(Math.abs(delta))} vs real
                </span>
              )}
            </p>
            <p className="text-meta tabular-nums text-fg-muted">paid <AmountText amount={chain.paid} /> · got back <AmountText amount={chain.got} /></p>
          </div>
          <Button size="sm" variant={what ? 'primary' : 'secondary'} onClick={() => setWhat(w => !w)} className="ml-auto">{what ? 'Done trying' : 'Try other prices'}</Button>
        </div>
        {what && <p className="text-meta text-fg-muted">Change any price — what you paid, or what you got (a thing still yours: what you would sell it for). Nothing is saved.</p>}

        <ol className="flex flex-col">
          {things.map((n, i) => {
            const out = chain.edges.filter(e => e.used && e.from === n.id)
            const passed = n.result && complete(n.result) ? n.result.nok * n.passedOn : null
            return (
              <li key={n.id} className="flex flex-col">
                <div className={cx('rounded-row border border-line p-3', n.projected && 'border-dashed')}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: n.id })} className="min-h-[44px] min-w-0 flex-1 text-left">
                      <Truncate as="span" className="block text-ui font-semibold text-fg">{n.item.title}{n.accessories.length > 0 && <span className="font-normal text-fg-muted"> + {n.accessories.length} accessor{n.accessories.length === 1 ? 'y' : 'ies'}</span>}</Truncate>
                      <span className="block text-meta tabular-nums text-fg-muted">
                        {n.bought ? `${n.item.approx_dates ? '≈ ' : ''}${formatDate(n.bought)}` : ''}
                        {n.left ? ` → ${formatDate(n.left)}` : ' → now'}
                        {n.bought && <> · {durationLabel(n.bought, n.left ?? new Date().toISOString().slice(0, 10))}</>}
                      </span>
                    </button>
                    {n.state === 'held' && !n.projected && <TonePill tone="success">Yours</TonePill>}
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-meta tabular-nums">
                    <label className="flex flex-col">
                      <span className="text-fg-muted">Paid</span>
                      {what
                        ? <DecimalInput value={over[n.id]?.paidNok ?? null} onValue={v => set(n.id, 'paidNok', v)} placeholder={complete(real.nodes.find(x => x.id === n.id)?.paid ?? n.paid) ? String(Math.round((real.nodes.find(x => x.id === n.id) ?? n).paid.nok)) : 'Unknown'} className="input border-dashed tabular-nums" aria-label={`Paid for ${n.item.title}, NOK`} />
                        : <span className="text-body text-fg">−<AmountText amount={n.paid} /></span>}
                    </label>
                    <label className="flex flex-col">
                      <span className="text-fg-muted">{n.state === 'gone' ? 'Got back' : 'Would sell for'}</span>
                      {what
                        ? <DecimalInput value={over[n.id]?.gotNok ?? null} onValue={v => set(n.id, 'gotNok', v)} placeholder={n.got && complete(n.got) ? String(Math.round(n.got.nok)) : n.state === 'held' ? 'Still yours' : 'Unknown'} className="input border-dashed tabular-nums" aria-label={`Got back for ${n.item.title}, NOK`} />
                        : <span className="text-body text-fg">{n.got ? <>+<AmountText amount={n.got} /></> : <span className="text-fg-faint">still yours</span>}</span>}
                    </label>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.round((Math.abs(nets[i]) / top) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-micro tabular-nums text-fg-faint">Running net {money(nets[i])}</p>
                </div>
                {out.length > 0 && passed != null && (
                  <p className="py-1.5 pl-4 text-meta tabular-nums text-fg-muted">
                    ↓ {passed >= 0 ? `${money(passed)} it cost you` : `${money(-passed)} it made`} moves on{out.length > 1 ? `, shared by ${out.length} things` : ''}
                  </p>
                )}
                {out.length > 0 && passed == null && <p className="py-1.5 pl-4 text-meta text-fg-faint">↓ moves on (unknown until every price is known)</p>}
              </li>
            )
          })}
        </ol>
        {final && complete(final.carried) && complete(final.paid) && (
          <p className="text-body text-fg-2">
            {final.item.title} alone {money(final.paid.nok)}; the {things.length - 1 === 1 ? 'one' : `${things.length - 1}`} before it {final.carried.nok >= 0 ? `cost you ${money(final.carried.nok)}` : `made ${money(-final.carried.nok)}`} in the end.
          </p>
        )}
        {chain.flags.some(f => f.kind === 'over-allocated') && <p className="text-meta text-warn">The amounts on one sale's links add up to more than it brought — they were scaled down to fit.</p>}
      </div>
    </ModalShell>
  )
}
