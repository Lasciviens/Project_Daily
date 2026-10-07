import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowRight, Ban, CalendarPlus, Check, ExternalLink, ListPlus, MoreHorizontal, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { ToneDot, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { UsdRates } from '../../settings/subscriptionRules'
import { approxOther, currencyOf, priceLabel } from '../shopModel'
import { REGION_FLAG, SHOP_PRIORITY_TONE } from '../shopMeta'
import type { ShopItem } from '../types'
import type { Task } from '../../todo/types'

interface Props {
  item: ShopItem
  /** The task it was planned as, when loaded. */
  task?: Pick<Task, 'id' | 'due_date' | 'status'> | null
  rates: UsdRates | null
  today: string
  onEdit: () => void
  onBought: () => void
  onPlan: () => void
  onOpenTask: () => void
  onMoveToQuick: () => void
  onDrop: () => void
  onDelete: () => void
}

/** One wishlist row: what, how much, where and when — and the two everyday actions. */
export function ShopItemCard({ item, task, rates, today, onEdit, onBought, onPlan, onOpenTask, onMoveToQuick, onDrop, onDelete }: Props) {
  const price = priceLabel(item)
  const approx = item.price != null ? approxOther(item.price, currencyOf(item), rates) : null
  const late = item.planned_date != null && item.planned_date < today
  const taskDone = task?.status === 'done'

  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        <ToneDot tone={SHOP_PRIORITY_TONE[item.priority]} className="mt-[7px]" />
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <span className="block text-ui font-semibold leading-snug text-fg">
            {item.title}
            {item.source_type === 'ai' && <Sparkles aria-label="Added by the AI" className="ml-1.5 inline h-3.5 w-3.5 align-[-2px] text-fg-faint" />}
          </span>
          {item.notes && <Truncate as="span" lines={2} className="mt-0.5 block text-meta text-fg-muted">{item.notes}</Truncate>}
        </button>
        {item.region && <span className="mt-0.5 shrink-0 text-base leading-none" title={item.region === 'TR' ? 'Buy it in Turkey' : 'Buy it in Norway'}>{REGION_FLAG[item.region]}</span>}

        <Menu as="div" className="-mr-1 -mt-1 shrink-0">
          <MenuButton className="icon-btn" aria-label={`More for ${item.title}`} title="More">
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition
            className="menu w-52 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
            <MenuItem><button type="button" onClick={onEdit} className="menu-item"><Pencil aria-hidden className="h-4 w-4" /> Edit</button></MenuItem>
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

      {(price || item.platform || item.planned_date || item.task_id || item.url) && (
        <div className="ml-4 flex flex-wrap items-center gap-1.5">
          {price && (
            <span className="chip tabular-nums" title={approx ?? undefined}>
              {price}
              {approx && <span className="ml-1 font-normal text-fg-faint">{approx}</span>}
            </span>
          )}
          {item.platform && <span className="chip">{item.platform}</span>}
          {item.planned_date && (
            <TonePill tone={late ? 'warn' : 'neutral'} className="tabular-nums">Buy on {formatDate(item.planned_date)}</TonePill>
          )}
          {item.task_id && (
            <button type="button" onClick={onOpenTask} title="Open the task this purchase was planned as" className="min-h-[28px]">
              <TonePill tone={taskDone ? 'success' : 'info'} className="tabular-nums">
                {taskDone ? <><Check aria-hidden className="h-3 w-3" /> Task done</> : <><ArrowRight aria-hidden className="h-3 w-3" /> Task{task?.due_date ? ` · ${formatDate(task.due_date)}` : ''}</>}
              </TonePill>
            </button>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-[28px] items-center gap-1 text-meta font-semibold text-accent-600 hover:underline">
              Link <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1 border-t border-line pt-1.5">
        <button type="button" onClick={onBought} className={cx('btn-ghost btn-sm flex-1 justify-center', taskDone && 'text-success')}>
          <Check aria-hidden className="h-4 w-4" /> Bought
        </button>
        {!item.task_id && (
          <button type="button" onClick={onPlan} title="Put the purchase on a day as a task — the item stays here"
            className="btn-ghost btn-sm flex-1 justify-center text-accent-600">
            <CalendarPlus aria-hidden className="h-4 w-4" /> Plan it
          </button>
        )}
      </div>
    </div>
  )
}
