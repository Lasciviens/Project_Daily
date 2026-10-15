import { cx } from '../../ui'

// Shared class recipes for the plan editor's fields (kept out of fields.tsx so
// that file only exports components — fast refresh).

/** A selectable chip in a single-select row (section, priority, duration…).
 *  `sm` keeps the height and takes SegmentedControl's small text, for a row
 *  that must stay on one line (priority). */
export function choiceClass(active: boolean, extra?: string, size: 'md' | 'sm' = 'md') {
  return cx(
    'inline-flex min-h-[36px] items-center justify-center rounded-full border font-medium',
    size === 'sm' ? 'gap-1 px-2.5 text-meta' : 'gap-1.5 px-3 text-body',
    'transition-colors duration-100 disabled:opacity-40 [@media(pointer:coarse)]:min-h-[44px]',
    active
      ? 'border-transparent bg-accent-500 text-on-accent'
      : 'border-line bg-surface-2 text-fg-2 hover:bg-surface-hover hover:text-fg',
    extra,
  )
}

/** Dashed "+ add something" placeholder button (due time, window). */
export const ADD_SLOT_CLASS =
  'w-full min-h-[44px] rounded-input border border-dashed border-line-strong bg-surface text-body text-fg-muted ' +
  'transition-colors hover:border-accent-500 hover:text-accent-600 disabled:opacity-40'

/** A chip of the Add sheet's "when" row and its "+" chips (THEME §8, Add sheet):
 *  'set' holds a value (tap to change it), 'add' offers one ("+ Time"). */
export function chipClass(kind: 'set' | 'add', extra?: string) {
  return cx(
    'inline-flex min-h-[34px] max-w-full items-center gap-1.5 rounded-full border px-3 text-body font-medium tabular-nums',
    'transition-colors duration-100 disabled:opacity-40 [@media(pointer:coarse)]:min-h-[40px] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
    kind === 'set'
      ? 'border-line bg-surface-2 text-fg hover:bg-surface-hover data-[open]:border-accent-500'
      : 'border-dashed border-line-strong bg-surface text-fg-muted hover:border-accent-500 hover:text-accent-600',
    extra,
  )
}

/** The floating panel a sheet chip opens (above the sheet, like DateInput's calendar).
 *  Headless UI caps its height at the room the anchor leaves; on a phone held
 *  sideways that is less than a month, so it scrolls. */
export const CHIP_PANEL_CLASS =
  'z-toast overflow-y-auto overscroll-contain rounded-menu border border-line-strong bg-surface p-2 shadow-menu [--anchor-gap:6px] [--anchor-padding:8px]'
