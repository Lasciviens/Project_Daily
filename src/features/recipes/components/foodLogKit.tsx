import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { ChevronDown, Star, X } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { SLOT_OPTIONS, foodEmoji } from './foodLogUtils'
import type { MealSlot } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared visual kit for the food-logging surfaces: the slot dropdown (one
//  compact control instead of a 5-pill row), and food thumbnails — real
//  product photos when the row has one (OFF/Kassalapp, migration 059), a
//  deterministic food emoji otherwise, so every tile reads visually.
// ─────────────────────────────────────────────────────────────────────────────

// One compact dropdown for the meal slot — replaces the pill row that ate a
// full line of the header area on phones.
export function SlotSelect({ value, onChange }: { value: MealSlot; onChange: (s: MealSlot) => void }) {
  const current = SLOT_OPTIONS.find(o => o.id === value) ?? SLOT_OPTIONS[0]
  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxButton className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface-2 pl-3 pr-2 text-body font-medium text-fg transition-colors hover:border-line-strong">
        <span aria-hidden>{current.icon}</span>
        <span>{current.label}</span>
        <ChevronDown aria-hidden className="h-4 w-4 text-fg-faint" />
      </ListboxButton>
      <ListboxOptions anchor="bottom end" className="menu w-44 [--anchor-gap:4px]">
        {SLOT_OPTIONS.map(o => (
          <ListboxOption key={o.id} value={o.id} className="menu-item data-[selected]:font-semibold data-[selected]:text-fg">
            <span aria-hidden>{o.icon}</span>{o.label}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}

// Photo-or-emoji thumbnail. `size` is the square edge in px — used as an
// inline style, so it's the same at every breakpoint. Pass `sizeClass`
// instead (Tailwind width/height utilities, e.g. "w-9 h-9 sm:w-11 sm:h-11")
// when a call site needs the thumbnail to shrink on mobile; it overrides
// `size`'s inline style entirely (an inline style always wins over a class,
// so the two can't be mixed at one call site).
export function FoodThumb({ name, group, imageUrl, size = 40, sizeClass, className = '' }: {
  name?: string | null
  group?: string | null
  imageUrl?: string | null
  size?: number
  sizeClass?: string
  className?: string
}) {
  const boxStyle = sizeClass ? undefined : { width: size, height: size }
  const boxClass = sizeClass ?? ''
  if (imageUrl) {
    return (
      <img src={imageUrl} alt="" loading="lazy"
        style={boxStyle}
        className={cx('shrink-0 rounded-lg bg-surface-2 object-cover', boxClass, className)} />
    )
  }
  return (
    <span style={sizeClass ? undefined : { width: size, height: size, fontSize: size * 0.55 }}
      className={cx('grid shrink-0 place-items-center rounded-lg bg-surface-2 leading-none', sizeClass && 'text-base sm:text-lg', boxClass, className)}>
      {foodEmoji(name, group)}
    </span>
  )
}

// One photo tile for the Recents/Favourites grids — the main body is the
// "add this" tap target, with a ★ favourite toggle and (Recent only) a ✕
// "remove from Recent" corner button as SIBLINGS of the inner button (never
// nested inside it — a <button> inside a <button> is invalid HTML and gets
// silently hoisted out by the parser, breaking the layout). Corner buttons
// stay at a compact 24px (`w-6 h-6`) rather than the mobile-first 44px
// minimum — the same deliberate exception this file's own `onEditRecipe` ✎
// button already uses on the saved-meal strip below, for the same reason: a
// secondary, occasional action layered on a dense photo grid, not the tile's
// primary tap target (which stays the full ≥44px card).
export function FoodTile({ title, imageUrl, group, calories, isFavorite, onAdd, onToggleFavorite, onHide, sizeClass = 'w-11 h-11' }: {
  title: string
  imageUrl?: string | null
  group?: string | null
  calories?: number | null
  isFavorite: boolean
  onAdd: () => void
  onToggleFavorite: () => void
  onHide?: () => void
  sizeClass?: string
}) {
  return (
    <div className="relative rounded-row border border-line bg-surface-2/60 transition-colors hover:border-accent-500/50 hover:bg-surface-2">
      <button type="button" onClick={onAdd}
        className="press-feedback flex min-h-[96px] w-full flex-col items-center gap-1.5 p-2">
        <FoodThumb name={title} group={group} imageUrl={imageUrl} sizeClass={sizeClass} />
        <span className="line-clamp-2 w-full text-center text-meta font-medium leading-tight text-fg-2">{title}</span>
        {calories != null && calories > 0 && (
          <span className="text-micro tabular-nums text-fg-muted">{Math.round(calories)} kcal</span>
        )}
      </button>
      <button type="button" onClick={onToggleFavorite} aria-label={isFavorite ? 'Remove favourite' : 'Add favourite'}
        aria-pressed={isFavorite} title={isFavorite ? 'Remove favourite' : 'Add favourite'}
        className={cx('absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full transition-colors',
          isFavorite ? 'bg-star text-surface' : 'border border-line bg-surface/90 text-fg-faint hover:text-star')}>
        <Star aria-hidden className={cx('h-3.5 w-3.5', isFavorite && 'fill-current')} />
      </button>
      {onHide && (
        <button type="button" onClick={onHide} aria-label="Remove from Recent" title="Remove from Recent"
          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface/90 text-fg-faint transition-colors hover:text-danger">
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
