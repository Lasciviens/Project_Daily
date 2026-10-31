import { useState, type InputHTMLAttributes } from 'react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ChevronDown, Clock, Minus, Plus, Star, X } from 'lucide-react'
import { IconButton, Truncate, cx } from '../../../shared/ui'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { Time24Field } from '../../../shared/components/plan-modal/fields'
import { SLOT_OPTIONS, foodEmoji, sanitizeDecimal } from './foodLogUtils'
import { MacroWarningBadge } from './MacroWarningBadge'
import { checkMacroConsistency } from '../macroSanity'
import { amountUnit, basketTotals, portionSteps, type BasketItem } from '../foodBasket'
import type { IngredientLibraryItem, MealSlot } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared visual kit for the food-logging surfaces: the slot dropdown (one
//  compact control instead of a 5-pill row), and food thumbnails — real
//  product photos when the row has one (OFF/Kassalapp, migration 059), a
//  deterministic food emoji otherwise, so every tile reads visually.
// ─────────────────────────────────────────────────────────────────────────────

// One compact dropdown for the meal slot — replaces the pill row that ate a
// full line of the header area on phones.
/**
 * The time a food was eaten (181; owner, 31.10.2026: "log times for food section so I can see on my diary"):
 * one compact button with the time ("🕒 21:27") that opens the hour and minute as the app's own 24 h chips (never
 * the device's AM/PM) — compact enough to sit beside the meal in the logger's header on a phone. `auto` says the
 * time is the automatic one (now for today, the meal's usual time for another day) until it is changed.
 * `header`: the logger's header size (beside SlotSelect); otherwise a sheet row's chip.
 */
export function FoodTimeField({ value, onChange, auto, header = false }: { value: string; onChange: (t: string) => void; auto?: boolean; header?: boolean }) {
  return (
    <Popover>
      <PopoverButton
        aria-label={`Eaten at ${value}${auto ? ', the time it is logged' : ''} — change`}
        title={auto ? 'The time it is logged — change it if you ate earlier' : 'When it was eaten'}
        className={header
          ? 'flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface-2 px-3 text-body font-medium tabular-nums text-fg transition-colors hover:border-line-strong data-[open]:border-line-strong'
          : chipClass('set')}
      >
        <Clock aria-hidden className={header ? 'h-4 w-4 text-fg-faint' : undefined} />{value}
      </PopoverButton>
      <PopoverPanel anchor={{ to: 'bottom end', gap: 6, padding: 12 }} className="menu z-toast flex flex-col gap-1.5 p-2.5">
        <p className="px-0.5 text-meta text-fg-muted">When you ate it</p>
        <Time24Field size="sm" value={value} onChange={onChange} />
      </PopoverPanel>
    </Popover>
  )
}

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
        <Truncate lines={2} className="w-full text-center text-meta font-medium leading-tight text-fg-2">{title}</Truncate>
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

// A number field that keeps what the user typed ("1.", "0.") while reporting
// the parsed value — binding a parsed number straight to `value` swallowed the
// decimal point, so 1.5 could not be typed.
export function DecimalInput({ value, onValue, ...rest }: {
  value: number | null
  onValue: (v: number | null) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if ((text === '' ? null : Number(text)) !== value) setText(value == null ? '' : String(value))
  }
  return (
    <input {...rest} inputMode="decimal" value={text}
      onChange={e => { const t = sanitizeDecimal(e.target.value); setText(t); onValue(t === '' ? null : Number(t)) }} />
  )
}

// One basket line, the same in the logger and the recipe builder: ONE row on
// every width (owner, 06.10.2026) with an always-typeable amount (owner,
// 07.10.2026); − / + step it by one portion when the food has a preset.
export function BasketRow({ item, onGrams, onRemove, showProtein = false }: {
  item: BasketItem
  onGrams: (raw: string) => void
  onRemove: () => void
  /** Adds the row's protein from `sm` up (the recipe builder). */
  showProtein?: boolean
}) {
  const f = item.ingredient
  const unit = amountUnit(f.unit)
  const steps = portionSteps(item)
  const t = basketTotals([item])
  const portionHint = steps ? ` · ${steps.count} × ${steps.label}` : ''
  return (
    <div className="flex min-h-[48px] items-center gap-1.5 sm:gap-2">
      <span className="max-sm:hidden"><FoodThumb name={f.name} group={f.food_group} imageUrl={f.image_url} size={28} /></span>
      <Truncate className="min-w-0 flex-1 text-body text-fg">{f.name}</Truncate>
      <div className="flex shrink-0 items-center" title={`${Math.round(item.grams)} ${unit}${portionHint}`}>
        {steps && (
          <IconButton label="One portion less" className="h-9 w-8 sm:w-9" onClick={() => onGrams(String(Math.max(1, steps.count - 1) * steps.size))}><Minus /></IconButton>
        )}
        <input value={item.grams || ''} onChange={e => onGrams(e.target.value)} inputMode="decimal" aria-label={`${f.name} amount in ${unit}${portionHint}`}
          aria-invalid={!(item.grams > 0)}
          className={cx('input w-14 px-1.5 text-right tabular-nums sm:w-16', !(item.grams > 0) && 'border-danger')} />
        <span className="ml-1 text-meta text-fg-muted">{unit}</span>
        {steps && (
          <IconButton label="One portion more" className="h-9 w-8 sm:w-9" onClick={() => onGrams(String((steps.count + 1) * steps.size))}><Plus /></IconButton>
        )}
      </div>
      <span className="w-[3.25rem] shrink-0 text-right text-meta text-fg-muted tabular-nums sm:w-14">{Math.round(t.kcal)} kcal</span>
      {showProtein && <span className="hidden w-20 shrink-0 text-right text-meta text-fg-muted tabular-nums sm:block">{Math.round(t.protein)} g protein</span>}
      <IconButton label={`Remove ${f.name}`} className="h-9 w-8 shrink-0 text-fg-faint hover:text-danger sm:w-9" onClick={onRemove}><X /></IconButton>
    </div>
  )
}

// A saved meal's portion in the basket ("Køfte · 3 pieces": the amount opens
// the portion sheet) or a dish's one-off line (no amount — it can only be
// taken out). Same one-row geometry as BasketRow.
export function PortionBasketRow({ title, amount, kcal, imageUrl, onAmount, onRemove }: {
  title: string
  /** "3 pieces"; omitted for a one-off line. */
  amount?: string
  kcal: number
  imageUrl?: string | null
  onAmount?: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex min-h-[48px] items-center gap-1.5 sm:gap-2">
      <span className="max-sm:hidden"><FoodThumb name={title} imageUrl={imageUrl} size={28} /></span>
      <Truncate className="min-w-0 flex-1 text-body text-fg">{title}</Truncate>
      {amount && onAmount && (
        <button type="button" onClick={onAmount} aria-label={`${title}: ${amount} — change the amount`}
          className={chipClass('add')}>{amount}</button>
      )}
      <span className="min-w-[3.25rem] shrink-0 whitespace-nowrap text-right text-meta text-fg-muted tabular-nums sm:min-w-14">{Math.round(kcal)} kcal</span>
      <IconButton label={`Remove ${title}`} className="h-9 w-8 shrink-0 text-fg-faint hover:text-danger sm:w-9" onClick={onRemove}><X /></IconButton>
    </div>
  )
}

// A library food in the search results: the row adds it, the warning badge
// sits beside it — a div, not a button, since MacroWarningBadge is itself a
// Popover button and a <button> can't nest another one.
export function FoodMatchRow({ food, onAdd, showProtein = false }: {
  food: IngredientLibraryItem
  onAdd: () => void
  /** "· 23 g protein" after the kcal (the recipe builder). */
  showProtein?: boolean
}) {
  const macroCheck = checkMacroConsistency(food.calories, food.protein_g, food.carbs_g, food.fat_g)
  return (
    <div className="row row-interactive min-h-[56px] px-1">
      <button type="button" onClick={onAdd} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <FoodThumb name={food.name} group={food.food_group} imageUrl={food.image_url} size={40} />
        <span className="min-w-0 flex-1">
          <Truncate className="text-body font-medium text-fg">{food.name}</Truncate>
          <span className="block text-meta text-fg-muted">
            {food.calories != null && `${Math.round(food.calories)} kcal`}
            {showProtein && food.protein_g != null && ` · ${Math.round(food.protein_g)} g protein`}
            {food.calories != null && ` · 100${amountUnit(food.unit)}`}
            {food.serving_label && ` · ${food.serving_label}`}
          </span>
        </span>
        {/* The row's visual add affordance — inside the button so tapping it adds. */}
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-600"><Plus className="h-4 w-4" aria-hidden /></span>
      </button>
      <MacroWarningBadge result={macroCheck} />
    </div>
  )
}
