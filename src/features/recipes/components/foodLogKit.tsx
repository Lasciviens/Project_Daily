import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
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
      <ListboxButton className="min-h-[44px] pl-3 pr-2 rounded-xl border border-ink-200 bg-cream-100 text-sm font-medium text-ink-800 flex items-center gap-1.5 hover:border-accent-300 transition-colors shrink-0">
        <span>{current.icon}</span>
        <span>{current.label}</span>
        <span className="text-ink-300 text-xs">▾</span>
      </ListboxButton>
      <ListboxOptions anchor="bottom end" className="z-[80] mt-1 w-44 rounded-xl border border-ink-200 bg-cream-50 shadow-lg p-1 focus:outline-none">
        {SLOT_OPTIONS.map(o => (
          <ListboxOption key={o.id} value={o.id}
            className="flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-sm text-ink-700 data-[focus]:bg-accent-50 data-[selected]:font-semibold cursor-pointer">
            <span>{o.icon}</span>{o.label}
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
        className={`rounded-lg object-cover bg-cream-100 shrink-0 ${boxClass} ${className}`} />
    )
  }
  return (
    <span style={sizeClass ? undefined : { width: size, height: size, fontSize: size * 0.55 }}
      className={`rounded-lg bg-cream-100 grid place-items-center shrink-0 leading-none ${sizeClass ? 'text-base sm:text-lg' : ''} ${boxClass} ${className}`}>
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
    <div className="relative rounded-2xl border border-ink-100 bg-cream-100/50 hover:border-accent-300 hover:bg-cream-100 transition-colors">
      <button type="button" onClick={onAdd}
        className="w-full p-2 flex flex-col items-center gap-1.5 min-h-[96px] press-feedback">
        <FoodThumb name={title} group={group} imageUrl={imageUrl} sizeClass={sizeClass} />
        <span className="text-[11px] font-medium text-ink-700 leading-tight text-center line-clamp-2 w-full">{title}</span>
        {calories != null && calories > 0 && (
          <span className="text-[10px] text-ink-400 tabular-nums">{Math.round(calories)} kcal</span>
        )}
      </button>
      <button type="button" onClick={onToggleFavorite} aria-label={isFavorite ? 'Remove favourite' : 'Add favourite'}
        title={isFavorite ? 'Remove favourite' : 'Add favourite'}
        className={`absolute top-1 left-1 w-6 h-6 rounded-full flex items-center justify-center text-xs leading-none transition-colors ${
          isFavorite ? 'bg-accent-500 text-white' : 'bg-cream-50/90 border border-ink-200 text-ink-400 hover:text-accent-600'
        }`}>
        {isFavorite ? '★' : '☆'}
      </button>
      {onHide && (
        <button type="button" onClick={onHide} aria-label="Remove from Recent" title="Remove from Recent"
          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-cream-50/90 border border-ink-200 text-ink-400 hover:text-red-500 flex items-center justify-center text-[11px] leading-none">
          ✕
        </button>
      )}
    </div>
  )
}
