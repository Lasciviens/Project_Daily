import { useMemo, useState } from 'react'
import { Pencil, Plus, RotateCcw } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, IconButton, MetaLine, Truncate, cx, useChartColors } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { chainFor, chainPath, type ChainNode, type ChainOverrides } from '../../chainModel'
import { ChainNameForm } from './ChainName'
import { add, complete, DISPOSAL_LABEL, minus, negate, PAID_BACK, valueNowOf, ZERO, type Amount, type MoneyCtx } from '../../ownModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import type { ShopItem, ShopItemLink } from '../../types'

/**
 * A money chain, one compact line per thing (with its accessories): its days,
 * − what it cost, + what came back (or "still yours" and what it could sell
 * for), and the running result — what the chain has made (+) or cost you (−)
 * so far, so the last line is the header's answer. A profit is green (owner,
 * 09.11.2026). "Try other prices" turns every amount into an input and
 * replays the maths live; nothing is saved. The pencil beside the title
 * names the chain.
 */
export function ChainPopup({ id, items, links, ctx, onClose }: { id: string; items: ShopItem[]; links: ShopItemLink[]; ctx: MoneyCtx; onClose: () => void }) {
  const modal = useEntityModal()
  const c = useChartColors()
  const [what, setWhat] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [over, setOver] = useState<ChainOverrides>({})
  const real = useMemo(() => chainFor(id, items, links, ctx), [id, items, links, ctx])
  const tried = useMemo(() => (Object.keys(over).length ? chainFor(id, items, links, ctx, { overrides: over }) : null), [id, items, links, ctx, over])
  const chain = tried ?? real
  if (!real || !chain) return null
  const things = chain.nodes.filter(n => n.state !== 'wish')
  // The running result, thing by thing: money back less money out (+ = ahead), the header's sign.
  const running = things.reduce<Amount[]>((acc, n) => [...acc, add(acc[acc.length - 1] ?? ZERO, minus(n.got ?? ZERO, n.paid))], [])
  const top = Math.max(1, ...running.filter(complete).map(r => Math.abs(r.nok)))
  const delta = tried && complete(tried.net) && complete(real.net) ? tried.net.nok - real.net.nok : null
  const set = (nodeId: string, key: 'paidNok' | 'gotNok', v: number | null) =>
    setOver(o => { const n = { ...o, [nodeId]: { ...o[nodeId], [key]: v ?? undefined } }; if (n[nodeId].paidNok === undefined && n[nodeId].gotNok === undefined) delete n[nodeId]; return n })
  const profit = complete(chain.net) && Math.round(chain.net.nok) < 0
  const last = things[things.length - 1]
  const final = last && last.state === 'held' && chain.linear && things.length > 1 ? last : null
  // The chain can go on from its last thing once that has left and its money went nowhere yet.
  const tail = real.nodes.filter(n => n.state !== 'wish').pop()
  const goOn = tail && tail.state === 'gone' && !real.edges.some(e => e.from === tail.id) ? tail : null
  const named = things.length > 1

  return (
    <ModalShell onClose={onClose} title={named ? real.name ?? 'Money chain' : 'Try other prices'} subtitle={chainPath(real)} size="lg"
      headerActions={named && !renaming && (
        <IconButton label={real.name ? 'Rename the chain' : 'Name this chain'} onClick={() => setRenaming(true)} className="shrink-0 text-fg-muted">
          <Pencil aria-hidden />
        </IconButton>
      )}
      footer={
        <div className="flex items-center gap-2">
          {what && Object.keys(over).length > 0 && <Button variant="ghost" icon={<RotateCcw />} onClick={() => setOver({})}>Reset</Button>}
          {!what && goOn && (
            <Button variant="ghost" icon={<Plus />} onClick={() => { onClose(); modal.open({ kind: 'shop-chain-builder', fromId: goOn.id }) }}>
              Add what its money bought
            </Button>
          )}
          <Button onClick={onClose} className="ml-auto">Close</Button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        {renaming && <ChainNameForm chain={real} onDone={() => setRenaming(false)} />}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div>
            <p className="section-label">{profit ? 'Profit' : 'Net cost'}</p>
            <p className="text-kpi font-bold tabular-nums text-fg">
              {complete(chain.net)
                ? <span data-tone={profit ? 'success' : undefined} className={cx(profit && 'tone-text')}>{money(Math.abs(chain.net.nok))}</span>
                : <AmountText amount={chain.net} />}
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

        <p className="-mb-3 flex justify-between gap-3 text-meta text-fg-muted">
          <span>{named ? 'Thing by thing' : 'The thing'}</span>
          <span>{named ? 'Result so far' : 'Result'}</span>
        </p>
        <ol aria-label="The things in the chain" className="-mx-1 flex flex-col divide-y divide-line">
          {things.map((n, i) => (
            <li key={n.id} className={cx('flex flex-col gap-1 px-1 py-2', n.projected && 'rounded-row bg-surface-2')}>
              <ThingLine node={n} running={running[i]} onOpen={() => modal.open({ kind: 'shop-item', id: n.id })} ctx={ctx} />
              <RunningBar running={running[i]} top={top} colors={[c.series[0], c.series[1]]} />
              {what && (
                <div className="grid grid-cols-2 gap-2 text-meta">
                  <label className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-fg-muted">Paid</span>
                    <DecimalInput value={over[n.id]?.paidNok ?? null} onValue={v => set(n.id, 'paidNok', v)} placeholder={complete(real.nodes.find(x => x.id === n.id)?.paid ?? n.paid) ? String(Math.round((real.nodes.find(x => x.id === n.id) ?? n).paid.nok)) : 'Unknown'} className="input input-sm border-dashed tabular-nums" aria-label={`Paid for ${n.item.title}, NOK`} />
                  </label>
                  <label className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-fg-muted">{n.state === 'gone' ? 'Got back' : 'Would sell for'}</span>
                    <DecimalInput value={over[n.id]?.gotNok ?? null} onValue={v => set(n.id, 'gotNok', v)} placeholder={n.got && complete(n.got) ? String(Math.round(n.got.nok)) : n.state === 'held' ? 'Still yours' : 'Unknown'} className="input input-sm border-dashed tabular-nums" aria-label={`Got back for ${n.item.title}, NOK`} />
                  </label>
                </div>
              )}
            </li>
          ))}
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

/**
 * One thing on one line: its name (and accessories), its days, − what it
 * cost, + what came back — or "still yours" with what it could sell for —
 * and on the right what the chain has made (+, green) or cost (−) so far.
 */
function ThingLine({ node: n, running, ctx, onOpen }: { node: ChainNode; running: Amount; ctx: MoneyCtx; onOpen: () => void }) {
  const value = n.state === 'held' && !n.projected ? valueNowOf(n.item, ctx) : null
  const from = n.bought ? `${n.item.approx_dates ? '≈ ' : ''}${formatDate(n.bought)}` : 'Bought'
  const back = n.state === 'held'
    ? 'still yours'
    : n.got && (Math.round(n.got.nok) !== 0 || !complete(n.got) || PAID_BACK.includes(n.item.disposal ?? 'other'))
      ? <AmountText amount={n.got} signed bare unknown="got back: unknown" />
      : DISPOSAL_LABEL[n.item.disposal ?? 'other'].toLowerCase()
  const ahead = complete(running) && Math.round(running.nok) > 0
  const accessories = n.accessories.length
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-baseline gap-3 text-left">
      <span className="min-w-0 flex-1">
        <Truncate as="span" className="block text-body font-semibold text-fg">
          {n.item.title}{accessories > 0 && <span className="font-normal text-fg-muted"> + {accessories} accessor{accessories === 1 ? 'y' : 'ies'}</span>}
        </Truncate>
        <MetaLine as="span" className="block text-meta tabular-nums text-fg-muted" items={[
          `${from} → ${n.left ? formatDate(n.left) : 'now'}`,
          <AmountText key="p" amount={negate(n.paid)} bare unknown="price missing" />,
          back,
          value && <span key="v">could sell for <AmountText amount={value} bare /></span>,
        ]} />
      </span>
      <span data-tone={ahead ? 'success' : undefined} className={cx('shrink-0 text-body font-semibold tabular-nums', ahead ? 'tone-text' : 'text-fg')}>
        <AmountText amount={running} signed />
      </span>
    </button>
  )
}

/** How far ahead (+) or behind (−) the chain is after a thing, on one scale — in chart colours, never the accent. */
function RunningBar({ running, top, colors }: { running: Amount; top: number; colors: [string, string] }) {
  const n = complete(running) ? Math.round(running.nok) : 0
  return (
    <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-surface-2">
      {n !== 0 && <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round((Math.abs(n) / top) * 100))}%`, background: n > 0 ? colors[1] : colors[0] }} />}
    </span>
  )
}
