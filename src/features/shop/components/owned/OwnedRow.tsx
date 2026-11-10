import type { LucideIcon } from 'lucide-react'
import { CornerDownRight } from 'lucide-react'
import { TonePill, Truncate, cx } from '../../../../shared/ui'
import { DISPOSAL_LABEL, type MoneyCtx } from '../../ownModel'
import { rowFacts, rowPrice, rowTag } from '../../ownedRow'
import { initialsOf, tintOf } from '../../wishTile'
import { imageOf } from '../shopFormat'
import { RowPicture } from '../tileKit'
import type { ShopItem, ShopPriceWatch } from '../../types'

interface Props {
  item: ShopItem
  /** The accessories bought for it: a line each under it. */
  accessories: readonly ShopItem[]
  /** Its money chain's name, when it is in one with another thing. */
  chain: string | null
  watch: ShopPriceWatch | null
  ctx: MoneyCtx
  today: string
  /** Its top category (the tint of a picture it doesn't have). */
  topId: string | null
  /** Its category's default picture (useCategoryPictures). */
  icon: LucideIcon | null
  /** The thing open in the side pane (marked as the one shown there). */
  picked: string | null
  onOpen: (id: string) => void
}

/**
 * One thing as a compact row (step A, 10.11.2026): its picture (its own, its
 * watch's, its category's default, else its initials), its name and what it
 * cost; under them its facts — "Elkjøp · 18 months · sells ≈ 2 400" — and at
 * most one tone tag ("Return tomorrow", "Complaint until 05.05.2030"). Every
 * row is the same two lines, so a column of them reads like a list; the
 * accessories bought for it follow as one line each. A tap opens its record.
 */
export function OwnedRow({ item, accessories, chain, watch, ctx, today, topId, icon, picked, onOpen }: Props) {
  const selected = picked === item.id
  const facts = rowFacts(item, accessories, ctx, today, chain)
  const tag = rowTag(item, watch, today)
  const price = rowPrice(item, ctx)
  const together = item.sale_group ? accessories.filter(a => a.sale_group === item.sale_group) : []
  return (
    <li>
      <button type="button" onClick={() => onOpen(item.id)} aria-current={selected || undefined}
        className={cx('flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors', selected ? 'bg-accent-50' : 'hover:bg-surface-hover')}>
        <RowPicture src={imageOf(item, watch)} icon={icon} initials={initialsOf(item.title)} tint={tintOf(topId)} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <Truncate as="span" className="min-w-0 flex-1 text-body font-medium text-fg">{item.title}</Truncate>
            <span className={cx('shrink-0 whitespace-nowrap text-body tabular-nums', price.pending ? 'text-fg-muted' : 'font-semibold text-fg')}
              title={price.pending ? 'Waiting for that day\'s exchange rate' : undefined}>
              {price.text}
            </span>
          </span>
          {/* Always as tall as a tag, so every row has one height. */}
          <span className="flex h-5 items-center gap-2">
            <Truncate as="span" fullText={facts.map(f => f.text).join(' · ')} className="min-w-0 flex-1 text-meta tabular-nums text-fg-muted">
              {facts.map((f, i) => (
                <span key={i}>{i > 0 && ' · '}<span className={f.tone === 'success' ? 'text-success' : undefined}>{f.text}</span></span>
              ))}
            </Truncate>
            {tag && <TonePill tone={tag.tone} className="shrink-0 tabular-nums">{tag.text}</TonePill>}
          </span>
        </span>
      </button>
      {accessories.length > 0 && (
        <ul className="pb-1">
          {accessories.map(a => (
            <li key={a.id}>
              <button type="button" onClick={() => onOpen(a.id)} aria-current={picked === a.id || undefined}
                className={cx('flex min-h-8 w-full items-center gap-1.5 py-1 pl-[3.25rem] pr-3 text-left text-meta transition-colors', picked === a.id ? 'bg-accent-50' : 'hover:bg-surface-hover')}>
                <CornerDownRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                <Truncate as="span" className="min-w-0 flex-1 text-fg-2">{a.title}</Truncate>
                {a.disposal && !together.includes(a) && <span className="shrink-0 text-fg-muted">{DISPOSAL_LABEL[a.disposal]}</span>}
                <span className="shrink-0 tabular-nums text-fg-muted">{rowPrice(a, ctx).text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
