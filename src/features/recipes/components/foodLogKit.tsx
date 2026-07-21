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

// Photo-or-emoji thumbnail. `size` is the square edge in px.
export function FoodThumb({ name, group, imageUrl, size = 40, className = '' }: {
  name?: string | null
  group?: string | null
  imageUrl?: string | null
  size?: number
  className?: string
}) {
  if (imageUrl) {
    return (
      <img src={imageUrl} alt="" loading="lazy"
        style={{ width: size, height: size }}
        className={`rounded-lg object-cover bg-cream-100 shrink-0 ${className}`} />
    )
  }
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.55 }}
      className={`rounded-lg bg-cream-100 grid place-items-center shrink-0 leading-none ${className}`}>
      {foodEmoji(name, group)}
    </span>
  )
}
