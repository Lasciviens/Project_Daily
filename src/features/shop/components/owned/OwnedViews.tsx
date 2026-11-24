import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { CornerDownRight, ShieldCheck, Undo2 } from 'lucide-react'
import { Skeleton, TonePill, Truncate, cx } from '../../../../shared/ui'
import { DISPOSAL_LABEL } from '../../ownModel'
import { cardTag, rowPrice, rowTag, type CardTag } from '../../ownedRow'
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

/**
 * One thing as a card with a big picture, the same size as every other card on the page (owner, 24.11.2026: "Every box
 * should have the same exact size!"): its width is the tiles' fixed track (`wishTile.TILE_REM`; half the row on a phone,
 * laid out by `PictureBlocks`) and its height comes from fixed parts only — the square picture (a ribbon when it left), the
 * name in two lines (cut by `Truncate`; a short name keeps the second line's room) and one line with what was paid and its
 * tag (the tag cut, never wrapped; the line keeps its room without one). The accessories are a count on the picture's
 * corner that lists them, so a thing with three of them is no taller than one with none.
 */
export function OwnedCard({ item, accessories, watch, listing, today, topId, icon, onOpen }: OwnedRowProps) {
  const tag = cardTag(item, watch, today, listing)
  const price = rowPrice(item)
  const together = item.sale_group ? accessories.filter(a => a.sale_group === item.sale_group) : []
  return (
    <div className="card relative flex min-w-0 flex-col overflow-hidden">
      <button type="button" onClick={() => onOpen(item.id)}
        className="flex min-w-0 flex-col gap-2 p-2 text-left transition-colors hover:bg-surface-hover">
        <RowPicture size="fill" src={imageOf(item, watch)} icon={icon} initials={initialsOf(item.title)} tint={tintOf(topId)}
          ribbon={item.disposal ? DISPOSAL_LABEL[item.disposal] : null} />
        <Truncate as="span" lines={2} className="h-10 text-body font-medium text-fg">{item.title}</Truncate>
        <span className="flex h-5 min-w-0 items-center gap-2">
          <span className={cx('shrink-0 whitespace-nowrap text-body tabular-nums', price.pending ? 'text-fg-muted' : 'font-semibold text-fg')}
            title={price.pending ? 'Waiting for that day\'s exchange rate' : undefined}>
            {price.text}
          </span>
          {tag && <CardTagPill tag={tag} />}
        </span>
      </button>
      {accessories.length > 0 && <CardAccessories accessories={accessories} together={together} onOpen={onOpen} />}
    </div>
  )
}

/** A card's loading copy from the card's own fixed parts: the square picture, the two-line name, the price line. */
export function OwnedCardSkeleton() {
  return (
    <div aria-hidden className="card flex flex-col gap-2 p-2">
      <Skeleton rounded="rounded-row" className="aspect-square w-full" />
      <span className="flex h-10 flex-col justify-center gap-1.5"><Skeleton className="h-3.5 w-11/12" /><Skeleton className="h-3.5 w-2/3" /></span>
      <span className="flex h-5 items-center"><Skeleton className="h-4 w-1/2" /></span>
    </div>
  )
}

/**
 * A card's one tag, cut and never wrapped. A date tag fits a 12rem card as an icon and its whole date (`cardTag`): the
 * words ("Return by 03.01.2027") are its title and what a screen reader reads.
 */
function CardTagPill({ tag }: { tag: CardTag }) {
  const Icon = tag.icon === 'return' ? Undo2 : tag.icon === 'complaint' ? ShieldCheck : null
  return (
    <span title={tag.short ? tag.text : undefined} className="flex min-w-0">
      <TonePill tone={tag.tone} className="min-w-0 tabular-nums">
        {Icon && <Icon aria-hidden className="h-3 w-3 shrink-0" />}
        {tag.short
          ? <><span aria-hidden>{tag.short}</span><span className="sr-only">{tag.text}</span></>
          : <Truncate as="span">{tag.text}</Truncate>}
      </TonePill>
    </span>
  )
}

/** A card's accessories: their count over the picture's top-left corner; a tap lists them, each opening its own record. */
function CardAccessories({ accessories, together, onOpen }: {
  accessories: OwnedRowProps['accessories']; together: OwnedRowProps['accessories']; onOpen: (id: string) => void
}) {
  const names = accessories.map(a => a.title).join(', ')
  const label = `${accessories.length} ${accessories.length === 1 ? 'accessory' : 'accessories'}: ${names}`
  // After the card's own button in the page's order: the thing first, then its accessories (its corner is only where it sits).
  return (
    <Menu>
      <MenuButton title={label} aria-label={label}
        className="absolute left-3 top-3 inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface px-2 text-meta font-semibold tabular-nums text-fg-2 shadow-float transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-surface-hover">
        <CornerDownRight aria-hidden className="h-3.5 w-3.5 text-fg-muted" />
        {accessories.length}
      </MenuButton>
      <MenuItems anchor="bottom start" className="menu w-[min(16rem,calc(100vw-24px))] [--anchor-gap:4px]">
        <p className="menu-label">Accessories</p>
        {accessories.map(a => (
          <MenuItem key={a.id}>
            <button type="button" onClick={() => onOpen(a.id)} className="menu-item">
              <CornerDownRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
              <Truncate as="span" className="min-w-0 flex-1">{a.title}</Truncate>
              {a.disposal && !together.includes(a) && <span className="shrink-0 text-meta text-fg-muted">{DISPOSAL_LABEL[a.disposal]}</span>}
              <span className="shrink-0 text-meta tabular-nums text-fg-muted">{rowPrice(a).text}</span>
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}
