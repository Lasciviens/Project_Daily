import { CornerDownRight } from 'lucide-react'
import { TonePill, Truncate, cx } from '../../../../shared/ui'
import { DISPOSAL_LABEL } from '../../ownModel'
import { rowPrice, rowTag } from '../../ownedRow'
import { initialsOf, tintOf } from '../../wishTile'
import { imageOf } from '../shopFormat'
import { RowPicture } from '../tileKit'
import type { OwnedRowProps } from './OwnedRow'

// Owned's other two ways to see the things (owner, 23.11.2026), beside the compact rows: "List" (one line each) and
// "Big pictures" (a grid of cards). Every one opens the thing's record on a tap, shows its accessories, and says how
// a thing left: the cards wear a banner with the word across the foot of the picture; a line's small picture wears an
// icon badge in its corner (the word in its title and in the line's accessible name).

/** An accessory's line under its thing: one line, a tap opens it. */
function AccessoryLines({ accessories, onOpen, together, inset }: {
  accessories: OwnedRowProps['accessories']; onOpen: (id: string) => void; together: OwnedRowProps['accessories']; inset: string
}) {
  if (!accessories.length) return null
  return (
    <ul className="pb-1">
      {accessories.map(a => (
        <li key={a.id}>
          <button type="button" onClick={() => onOpen(a.id)}
            className={cx('flex min-h-8 w-full items-center gap-1.5 py-1 pr-3 text-left text-meta transition-colors hover:bg-surface-hover', inset)}>
            <CornerDownRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
            <Truncate as="span" className="min-w-0 flex-1 text-fg-2">{a.title}</Truncate>
            {a.disposal && !together.includes(a) && <span className="shrink-0 text-fg-muted">{DISPOSAL_LABEL[a.disposal]}</span>}
            <span className="shrink-0 tabular-nums text-fg-muted">{rowPrice(a).text}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** One thing as one line: a small picture, its name, its one tag and what was paid. */
export function OwnedLine({ item, accessories, watch, listing, today, topId, icon, onOpen }: OwnedRowProps) {
  const tag = rowTag(item, watch, today, listing)
  const price = rowPrice(item)
  const together = item.sale_group ? accessories.filter(a => a.sale_group === item.sale_group) : []
  return (
    <li>
      <button type="button" onClick={() => onOpen(item.id)}
        className="flex min-h-[36px] w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-surface-hover">
        <RowPicture size="sm" src={imageOf(item, watch)} icon={icon} initials={initialsOf(item.title)} tint={tintOf(topId)} left={item.disposal} />
        <Truncate as="span" className="min-w-0 flex-1 text-body font-medium text-fg">{item.title}</Truncate>
        {item.disposal && <span className="sr-only">{DISPOSAL_LABEL[item.disposal]}</span>}
        {tag && <TonePill tone={tag.tone} className="shrink-0 tabular-nums">{tag.text}</TonePill>}
        <span className={cx('shrink-0 whitespace-nowrap text-body tabular-nums', price.pending ? 'text-fg-muted' : 'font-semibold text-fg')}
          title={price.pending ? 'Waiting for that day\'s exchange rate' : undefined}>
          {price.text}
        </span>
      </button>
      <AccessoryLines accessories={accessories} onOpen={onOpen} together={together} inset="pl-[2.9rem]" />
    </li>
  )
}

/** One thing as a card with a big picture: the picture (a ribbon when it left), its name, what was paid and its tag. */
export function OwnedCard({ item, accessories, watch, listing, today, topId, icon, onOpen }: OwnedRowProps) {
  const tag = rowTag(item, watch, today, listing)
  const price = rowPrice(item)
  const together = item.sale_group ? accessories.filter(a => a.sale_group === item.sale_group) : []
  return (
    <li className="card flex min-w-0 flex-col overflow-hidden">
      <button type="button" onClick={() => onOpen(item.id)}
        className="flex min-w-0 flex-1 flex-col gap-2 p-2 text-left transition-colors hover:bg-surface-hover">
        <RowPicture size="fill" src={imageOf(item, watch)} icon={icon} initials={initialsOf(item.title)} tint={tintOf(topId)}
          ribbon={item.disposal ? DISPOSAL_LABEL[item.disposal] : null} />
        <Truncate as="span" lines={2} className="block text-body font-medium text-fg">{item.title}</Truncate>
        <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cx('whitespace-nowrap text-body tabular-nums', price.pending ? 'text-fg-muted' : 'font-semibold text-fg')}
            title={price.pending ? 'Waiting for that day\'s exchange rate' : undefined}>
            {price.text}
          </span>
          {tag && <TonePill tone={tag.tone} className="tabular-nums">{tag.text}</TonePill>}
        </span>
      </button>
      <AccessoryLines accessories={accessories} onOpen={onOpen} together={together} inset="pl-3" />
    </li>
  )
}
