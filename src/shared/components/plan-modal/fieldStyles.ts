import { cx } from '../../ui'

// Shared class recipes for the plan editor's fields (kept out of fields.tsx so
// that file only exports components — fast refresh).

/** A selectable chip in a single-select row (section, priority, duration…). */
export function choiceClass(active: boolean, extra?: string) {
  return cx(
    'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-full border px-3 text-body font-medium',
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
