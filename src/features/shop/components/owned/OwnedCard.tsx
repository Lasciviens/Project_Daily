import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowRightLeft, ChevronDown, HandCoins, Link2, MoreHorizontal, Plus, Trash2, Undo2 } from 'lucide-react'
import { TonePill, Truncate, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import {
  add, boughtOn, complete, costOf, DISPOSAL_LABEL, durationLabel, gotOf, minus, perMonth, valueAgeDays, valueNowOf, VALUE_STALE_DAYS, ZERO,
  type MoneyCtx,
} from '../../ownModel'
import { finalCostOf, type Chain } from '../../chainModel'
import { AmountText, ItemThumb } from '../shopKit'
import { imageOf, money } from '../shopFormat'
import { PaidText } from './PaidText'
import { finalCostWords } from '../shopFormat'
import type { ShopItem, ShopPriceWatch } from '../../types'

interface Props {
  item: ShopItem
  accessories: ShopItem[]
  chain: Chain | null
  watch: ShopPriceWatch | null
  ctx: MoneyCtx
  today: string
  onOpen: () => void
  onSell: () => void
  onUndoSale: () => void
  onAccessory: () => void
  onChain: () => void
  onDelete: () => void
}

/**
 * One thing you have or had: what it cost and when, how long you have had it,
 * what it costs per month of use, what it could sell for, and the accessories
 * riding with it. A loss on a thing you use is its cost of use — neutral.
 */
export function OwnedCard({ item, accessories, chain, watch, ctx, today, onOpen, onSell, onUndoSale, onAccessory, onChain, onDelete }: Props) {
  const [showAcc, setShowAcc] = useState(false)
  const gone = !!item.disposal
  const from = boughtOn(item)
  const held = from ? durationLabel(from, item.disposed_on ?? today) : null
  // What left in the same sale counts with it: its cost and its share of the money.
  const together = item.sale_group ? accessories.filter(a => a.sale_group === item.sale_group) : []
  const per = perMonth(item, ctx, today, accessories)
  const value = valueNowOf(item, ctx)
  const age = valueAgeDays(item, today)
  const final = chain ? finalCostOf(chain, item.id) : null
  const got = gone ? add(gotOf(item) ?? ZERO, ...together.map(a => gotOf(a) ?? ZERO)) : null
  const result = gone && got ? minus(add(costOf(item, ctx), ...together.map(a => costOf(a, ctx))), got) : null
  const linked = chain && chain.nodes.length > 1 ? chain.nodes.filter(n => n.state !== 'wish').length : 0
  const deadline = !gone && item.return_by && item.return_by >= today ? item.return_by : null

  return (
    <div className={cx('card flex flex-col gap-2 p-3', gone && 'bg-surface-2')}>
      <div className="flex items-start gap-3">
        <ItemThumb src={imageOf(item, watch)} />
        <button type="button" onClick={onOpen} className="min-h-[44px] min-w-0 flex-1 self-stretch text-left">
          <Truncate as="span" lines={2} className="block text-ui font-semibold leading-snug text-fg">{item.title}</Truncate>
          <span className="mt-0.5 block text-meta tabular-nums text-fg-muted">
            <PaidText item={item} />
            {from && <> · {item.approx_dates ? '≈ ' : ''}{formatDate(from)}</>}
            {item.platform && <> · {item.platform}</>}
          </span>
        </button>
        <Menu as="div" className="-mr-1 -mt-1 shrink-0">
          <MenuButton className="icon-btn" aria-label={`More for ${item.title}`} title="More">
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition className="menu w-56 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
            {gone
              ? <MenuItem><button type="button" onClick={onUndoSale} className="menu-item"><Undo2 aria-hidden className="h-4 w-4" /> Undo: still mine</button></MenuItem>
              : <MenuItem><button type="button" onClick={onSell} className="menu-item"><HandCoins aria-hidden className="h-4 w-4" /> Sell or give away</button></MenuItem>}
            {!gone && <MenuItem><button type="button" onClick={onAccessory} className="menu-item"><Plus aria-hidden className="h-4 w-4" /> Add an accessory</button></MenuItem>}
            <MenuItem><button type="button" onClick={onChain} className="menu-item"><ArrowRightLeft aria-hidden className="h-4 w-4" /> {linked > 1 ? 'Money chain' : 'Try other prices'}</button></MenuItem>
            <div className="menu-sep" />
            <MenuItem><button type="button" onClick={onDelete} className="menu-item is-danger"><Trash2 aria-hidden className="h-4 w-4" /> Delete</button></MenuItem>
          </MenuItems>
        </Menu>
      </div>

      <div className="flex flex-col gap-0.5 text-meta tabular-nums">
        {gone ? (
          <>
            <span className="text-fg-2">
              {DISPOSAL_LABEL[item.disposal ?? 'other']} {item.disposed_on ? formatDate(item.disposed_on) : ''}
              {item.sold_to && <> to {item.sold_to}</>}
              {got && (item.sale_price != null || !complete(got)) && <> · got <AmountText amount={got} />{together.length > 0 && ` with ${together.length} accessor${together.length === 1 ? 'y' : 'ies'}`}</>}
            </span>
            {held && result && (
              <span className="text-fg-muted">
                Kept {held} · {complete(result) && result.nok < 0 ? <>made <span className={item.for_resale ? 'text-success' : 'text-fg-2'}>{money(-result.nok)}</span></> : <>cost you <AmountText amount={result} className="text-fg-2" /></>}
                {per && complete(result) && result.nok > 0 && <> (≈ {money(per.nok)}/month)</>}
              </span>
            )}
          </>
        ) : (
          <>
            {held && <span className="text-fg-2">Owned {held}{per && <span className="text-fg-muted"> · ≈ {money(per.nok)}/month</span>}</span>}
            {value && (
              <span className={cx(age != null && age > VALUE_STALE_DAYS ? 'text-warn' : 'text-fg-muted')}>
                Could sell for <AmountText amount={value} /> · {formatDate(item.value_on)}
                {age != null && age > VALUE_STALE_DAYS && ' · update it'}
              </span>
            )}
          </>
        )}
        {final && (
          <span className="text-fg-muted">
            Final cost <AmountText amount={final.total} className="font-semibold text-fg" />
            {complete(final.own) && complete(final.carried) && <> ({finalCostWords(final.own.nok, final.carried.nok)})</>}
          </span>
        )}
      </div>

      {(linked > 1 || accessories.length > 0 || deadline || (!gone && item.warranty_until && item.warranty_until >= today)) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {linked > 1 && (
            <button type="button" onClick={onChain} className="chip min-h-[44px] gap-1 hover:bg-surface-hover" title="The things this money chain joins">
              <Link2 aria-hidden className="h-3 w-3" /> Chain · {linked}
            </button>
          )}
          {accessories.length > 0 && (
            <button type="button" aria-expanded={showAcc} onClick={() => setShowAcc(s => !s)} className="chip min-h-[44px] gap-1 hover:bg-surface-hover">
              {accessories.length} accessor{accessories.length === 1 ? 'y' : 'ies'}
              <ChevronDown aria-hidden className={cx('h-3 w-3 transition-transform', showAcc && 'rotate-180')} />
            </button>
          )}
          {deadline && <TonePill tone={deadline <= addDaysIso(today, 7) ? 'warn' : 'neutral'} className="tabular-nums">Return by {formatDate(deadline)}</TonePill>}
          {!gone && !deadline && item.warranty_until && item.warranty_until >= today && (
            <span className="chip tabular-nums max-sm:hidden">Can complain until {formatDate(item.warranty_until)}</span>
          )}
        </div>
      )}
      {showAcc && (
        <ul className="ml-1 flex flex-col divide-y divide-line rounded-row border border-line">
          {accessories.map(a => (
            <li key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 text-meta">
              <Truncate as="span" className="min-w-0 flex-1 text-fg-2">{a.title}</Truncate>
              <span className="shrink-0 tabular-nums text-fg-muted"><PaidText item={a} /></span>
              {a.disposal && !together.includes(a) && <span className="shrink-0 text-fg-faint">{DISPOSAL_LABEL[a.disposal]}</span>}
            </li>
          ))}
        </ul>
      )}

      {!gone && (
        <div className="mt-auto flex items-center gap-1 border-t border-line pt-1.5">
          <button type="button" onClick={onSell} className="btn-ghost btn-sm flex-1 justify-center">
            <HandCoins aria-hidden className="h-4 w-4" /> Sell or give away
          </button>
          <button type="button" onClick={onAccessory} className="btn-ghost btn-sm flex-1 justify-center text-accent-600">
            <Plus aria-hidden className="h-4 w-4" /> Accessory
          </button>
        </div>
      )}
    </div>
  )
}

function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}
