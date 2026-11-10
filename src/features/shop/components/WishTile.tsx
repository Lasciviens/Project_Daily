import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Ban, CalendarPlus, Check, ListPlus, MoreHorizontal, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { MetaLine, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { approxOther, currencyOf, priceLabel } from '../shopModel'
import { SHOP_PRIORITY_TONE } from '../shopMeta'
import { complete, type Amount } from '../ownModel'
import { beltOf, dealOn, initialsOf, isClean, readPrice, spanOf, tintOf, type PriceFacts } from '../wishTile'
import { mixedWords, watchNote } from '../watchWords'
import { SiteLink } from './shopKit'
import { imageOf, money, num, webUrl } from './shopFormat'
import { HistoryBar, PictureWell } from './tileKit'
import type { ShopItem, ShopPriceWatch } from '../types'
import type { UsdRates } from '../../settings/subscriptionRules'
import type { Task } from '../../todo/types'

interface Props {
  item: ShopItem
  /** Its top category: the tint of a tile with no picture. */
  topId: string | null
  /** Its category's default picture, for a tile with no picture of its own (useCategoryPictures). */
  icon?: LucideIcon | null
  /** The task it was planned as, when loaded. */
  task?: Pick<Task, 'id' | 'due_date' | 'status'> | null
  today: string
  /** Today's rates, for "≈ 2 990 NOK" beside a price in another currency. */
  rates: UsdRates | null
  /** The link's last price read (shop-price). */
  watch?: ShopPriceWatch | null
  /** What its clean price history says (usePriceStats). */
  facts?: PriceFacts | null
  /** A planned sale's money towards it: what would still be needed. */
  afterSale?: { needed: Amount; from: string } | null
  onOpen: () => void
  onBought: () => void
  onPlan: () => void
  onOpenTask: () => void
  onMoveToQuick: () => void
  onDrop: () => void
  onDelete: () => void
}

/**
 * One wish as a picture tile: the picture (or its initials on the category's
 * tint), one belt, a two-line title, the price now with where it was read and
 * how it moved since the last read, the target, and today's place between the
 * lowest and highest seen. A check that read no price now says why in the
 * shared words (watchWords.watchNote): a refusal shows no price from the link. Bought is one tap; everything else is in ⋯. The
 * picture and the title open the record.
 */
export function WishTile({ item, topId, icon, task, today, rates, watch, facts, afterSale, onOpen, onBought, onPlan, onOpenTask, onMoveToQuick, onDrop, onDelete }: Props) {
  const read = watch && watch.url === item.url ? watch : null
  // A refused link (its site's terms or robots.txt) was never read: no price now, the row's own instead.
  const now = readPrice(item, read)
  // Why the last check read no price now, in the shared words — the site's own for a refusal.
  const note = read ? watchNote(item, read, today) : null
  const cur = currencyOf(item)
  const belt = beltOf(item, { watch: read, facts, today })
  const span = spanOf(facts)
  // Prisjakt's figures that may mix in used offers (mixed, or read before 188): ", new and used", never a belt.
  const mixed = !!now && !!read && !isClean(read) ? mixedWords(read) : ''
  const src = imageOf(item, read)
  const change = read && now && read.prev_low != null && read.prev_low !== now.amount ? now.amount - read.prev_low : null
  const deal = dealOn(item, today)
  const late = item.planned_date != null && item.planned_date < today && !item.wait_for_deal
  const taskDone = task?.status === 'done'
  const own = priceLabel(item)
  const shown = now ?? (item.price != null ? { amount: item.price, currency: cur } : null)
  const approx = shown && shown.currency !== 'NOK' ? approxOther(shown.amount, shown.currency, rates) : null
  // The price read from the link says where it was read; a typed price says where to buy it.
  const where = now
    ? (read?.source === 'prisjakt' ? <>on <SiteLink url={item.url}>Prisjakt</SiteLink></> : <>at <SiteLink url={item.url} /></>)
    : webUrl(item.url) ? <>at <SiteLink url={item.url} /></> : item.platform ? <>at {item.platform}</> : null
  const target = item.target_price == null ? null : now && now.currency !== cur ? money(item.target_price, cur) : num(item.target_price)

  return (
    <div className="card flex flex-col p-1.5">
      <button type="button" onClick={onOpen} className="flex flex-col rounded-row text-left">
        <PictureWell srcs={src ? [src] : []} icon={icon} initials={initialsOf(item.title)} tint={tintOf(topId)} belt={belt}
          corner={item.priority !== 'medium' && (
            <TonePill tone={SHOP_PRIORITY_TONE[item.priority]}>{item.priority === 'high' ? 'High' : 'Low'}<span className="sr-only"> priority</span></TonePill>
          )} />
        <Truncate as="span" lines={2} className="mx-1.5 mt-2 min-h-10 text-body font-semibold text-fg">
          {item.title}
          {item.source_type === 'ai' && <Sparkles aria-label="Added by the AI" className="ml-1 inline h-3.5 w-3.5 align-[-2px] text-fg-faint" />}
        </Truncate>
      </button>
      <div className="flex flex-col gap-0.5 px-1.5 pb-2 pt-0.5">
        <p className="flex flex-wrap items-baseline gap-x-1 text-meta text-fg-muted">
          <span className={cx('whitespace-nowrap text-ui tabular-nums', now || own ? 'font-semibold text-fg' : 'text-fg-muted')}>
            {now ? money(now.amount, now.currency) : own ?? 'No price yet'}
          </span>
          {/* From the link (or typed): of any length, so it may wrap — never out of the tile. */}
          {where && <span className="min-w-0 break-words">{where}{mixed}{item.region === 'TR' && <span title="Buy it in Turkey"> 🇹🇷</span>}</span>}
          {approx && <span className="whitespace-nowrap tabular-nums">{approx}</span>}
        </p>
        <MetaLine className="text-meta tabular-nums text-fg-muted" items={[
          change != null && (
            <span key="c" data-tone={change < 0 ? 'success' : 'warn'} className="tone-text" title={read?.prev_at ? `Since ${formatDate(read.prev_at)}` : undefined}>
              {change < 0 ? '↓' : '↑'} {num(Math.abs(change))}<span className="sr-only"> since the last read</span>
            </span>
          ),
          target != null && `target ${target}`,
          deal && belt !== 'deal' && 'Deal on',
          item.wait_for_deal && !deal && item.planned_date && `Deal from ${formatDate(item.planned_date)}`,
          item.planned_date && !item.wait_for_deal && <span key="b" className={late ? 'text-warn' : undefined}>Buy on {formatDate(item.planned_date)}</span>,
          item.task_id && (taskDone ? 'Task done' : `Task${task?.due_date ? ` ${formatDate(task.due_date)}` : ''}`),
          note && now && read && `read ${formatDate(read.last_ok_at ?? read.checked_at)}`,
          note && <span key="n" className={cx('break-words', note.warn && 'text-warn')}>{note.text}</span>,
          read && read.status === 'ok' && read.in_stock === false && <span key="s" className="text-warn">out of stock</span>,
        ]} />
        {item.wait_for_deal && item.deal_note && <Truncate as="p" className="text-meta text-fg-muted">{item.deal_note}</Truncate>}
        {afterSale && complete(afterSale.needed) && (
          <p className="break-words text-meta text-fg-muted">After selling {afterSale.from}: {money(Math.max(0, afterSale.needed.nok))} more</p>
        )}
        {span && now && read && isClean(read) && now.currency === span.currency && <span className="mt-1"><HistoryBar now={now.amount} span={span} /></span>}
      </div>

      <div className="mt-auto flex items-center gap-1 border-t border-line pt-1">
        <button type="button" onClick={onBought} className={cx('btn-ghost btn-sm min-w-0 flex-1 justify-center', taskDone && 'text-success')}>
          <Check aria-hidden className="h-4 w-4" /> Bought
        </button>
        <Menu as="div" className="shrink-0">
          <MenuButton className="icon-btn h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`More for ${item.title}`} title="More">
            <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
          </MenuButton>
          <MenuItems anchor="bottom end" transition
            className="menu w-56 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
            <MenuItem><button type="button" onClick={onOpen} className="menu-item"><Pencil aria-hidden className="h-4 w-4" /> Open and edit</button></MenuItem>
            <MenuItem>
              {item.task_id
                ? <button type="button" onClick={onOpenTask} className="menu-item"><ArrowRight aria-hidden className="h-4 w-4" /> Open the task</button>
                : <button type="button" onClick={onPlan} className="menu-item"><CalendarPlus aria-hidden className="h-4 w-4" /> Plan it as a task</button>}
            </MenuItem>
            <MenuItem><button type="button" onClick={onMoveToQuick} className="menu-item"><ListPlus aria-hidden className="h-4 w-4" /> Move to the quick list</button></MenuItem>
            <MenuItem><button type="button" onClick={onDrop} className="menu-item"><Ban aria-hidden className="h-4 w-4" /> Not any more</button></MenuItem>
            <div className="menu-sep" />
            <MenuItem><button type="button" onClick={onDelete} className="menu-item is-danger"><Trash2 aria-hidden className="h-4 w-4" /> Delete</button></MenuItem>
          </MenuItems>
        </Menu>
      </div>
    </div>
  )
}
