import { cx } from '../../ui'

// Shared class recipes for the plan editor's fields (kept out of fields.tsx so
// that file only exports components — fast refresh).

/** Every chip, choice and text button of the Add sheet and its pickers: one
 *  height (32px on every pointer), one radius, 14px icons (THEME §8, Add sheet).
 *  (cx doesn't merge classes: each recipe below sets its padding, size and
 *  colours once, so nothing depends on which of two clashing classes wins.) */
const SHAPE =
  'inline-flex h-8 max-w-full shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium tabular-nums ' +
  'transition-colors duration-100 disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0'
const CHIP = `${SHAPE} gap-1.5 px-2.5 text-body`
const TEXT_BUTTON = `${SHAPE} gap-1 px-1.5 text-meta hover:bg-surface-hover data-[open]:bg-surface-hover`

/** A selectable chip in a single-select row. `sm` is the Add sheet's chip size
 *  (its pickers: Today / Tomorrow, the lengths, the seasons); `md` is the
 *  older 36px pill (44px on touch). */
export function choiceClass(active: boolean, extra?: string, size: 'md' | 'sm' = 'md') {
  if (size === 'sm') {
    return cx(CHIP, active ? 'bg-accent-500 text-on-accent' : 'bg-surface-2 text-fg-2 hover:bg-surface-hover hover:text-fg', extra)
  }
  return cx(
    'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-full border px-3 text-body font-medium',
    'transition-colors duration-100 disabled:opacity-40 [@media(pointer:coarse)]:min-h-[44px]',
    active
      ? 'border-transparent bg-accent-500 text-on-accent'
      : 'border-line bg-surface-2 text-fg-2 hover:bg-surface-hover hover:text-fg',
    extra,
  )
}

/** A chip of the Add sheet (THEME §8, Add sheet):
 *    'set'    holds a value ("Thu 15.10.2026") — a soft fill, tap to change it;
 *    'add'    offers one ("Time", "Repeat") — a hairline outline, no fill;
 *  and its text buttons, no box until hovered (small text):
 *    'value'  a value on the facts line ("High priority", "Personal");
 *    'quiet'  offers a row or a step ("+ Notes", "+ Time");
 *    'remove' takes a value off ("No time", "Doesn't block"). */
export function chipClass(kind: 'set' | 'add' | 'value' | 'quiet' | 'remove', extra?: string) {
  return cx(
    kind === 'set' && `${CHIP} bg-surface-2 text-fg hover:bg-surface-hover data-[open]:bg-surface-hover data-[open]:ring-1 data-[open]:ring-accent-500/50`,
    kind === 'add' && `${CHIP} border border-line text-fg-muted hover:border-line-strong hover:text-fg data-[open]:border-accent-500`,
    kind === 'value' && `${TEXT_BUTTON} text-fg-2 hover:text-fg data-[open]:text-fg`,
    kind === 'quiet' && `${TEXT_BUTTON} text-fg-muted hover:text-fg data-[open]:text-fg`,
    kind === 'remove' && `${TEXT_BUTTON} text-fg-muted hover:text-danger`,
    extra,
  )
}

/** The floating panel a sheet chip opens (above the sheet, like DateInput's calendar).
 *  Headless UI caps its height at the room the anchor leaves; on a phone held
 *  sideways that is less than a month, so it scrolls. */
export const CHIP_PANEL_CLASS =
  'z-toast overflow-y-auto overscroll-contain rounded-menu border border-line-strong bg-surface p-2 shadow-menu [--anchor-gap:6px] [--anchor-padding:8px]'
