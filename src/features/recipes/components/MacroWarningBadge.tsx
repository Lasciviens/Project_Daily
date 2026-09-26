import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import type { MacroConsistency } from '../macroSanity'

// A small warn-tone "this nutrition data looks inconsistent" indicator — tap/
// hover for the exact numbers. Renders nothing when there's nothing to flag
// (null result, or a consistent one), so a call site can wire it in
// unconditionally without its own guard. Same Popover pattern as InfoBubble.
export function MacroWarningBadge({ result }: { result: MacroConsistency | null }) {
  if (!result || !result.inconsistent) return null
  const direction = result.deltaKcal > 0 ? 'higher than' : 'lower than'
  return (
    <Popover className="relative inline-block align-middle">
      <PopoverButton
        aria-label={`Nutrition data looks inconsistent — declared calories are ${result.deltaPct}% off from protein/carbs/fat`}
        className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-warn text-[10px] font-bold leading-none text-surface after:absolute after:-inset-3 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn/40"
      >
        !
      </PopoverButton>
      <PopoverPanel
        anchor="bottom start"
        className="z-popover w-72 max-w-[85vw] rounded-menu border border-line-strong bg-surface p-3 text-meta leading-relaxed text-fg-2 shadow-menu [--anchor-gap:4px]"
      >
        <p className="mb-1 font-semibold text-warn">Nutrition data looks inconsistent</p>
        <p>
          Declared <strong className="text-fg">{result.calories} kcal</strong>, but {result.proteinG}g protein × 4 + {result.carbsG}g carbs × 4 + {result.fatG}g fat × 9
          {' ≈ '}<strong className="text-fg">{result.atwaterKcal} kcal</strong> — {result.deltaPct}% {direction} what the macros imply.
        </p>
        <p className="mt-1.5 text-fg-muted">
          Usually a source-data error, not something wrong with your entry. Worth double-checking before you trust it.
        </p>
      </PopoverPanel>
    </Popover>
  )
}
