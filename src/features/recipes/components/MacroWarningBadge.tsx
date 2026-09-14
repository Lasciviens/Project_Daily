import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import type { MacroConsistency } from '../macroSanity'

// A small orange "this nutrition data looks inconsistent" indicator — tap/
// hover for the exact numbers. Renders nothing when there's nothing to flag
// (null result, or a consistent one), so a call site can wire it in
// unconditionally without its own guard. Same Popover pattern as the ℹ️
// InfoBubble (tap/hover, click-outside/Escape/focus handled by Headless UI —
// never hand-rolled), styled as a warning instead of an explanation.
export function MacroWarningBadge({ result }: { result: MacroConsistency | null }) {
  if (!result || !result.inconsistent) return null
  const direction = result.deltaKcal > 0 ? 'higher than' : 'lower than'
  return (
    <Popover className="relative inline-block align-middle">
      <PopoverButton
        aria-label={`Nutrition data looks inconsistent — declared calories are ${result.deltaPct}% off from protein/carbs/fat`}
        className="w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-none inline-flex items-center justify-center hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-300"
      >
        !
      </PopoverButton>
      <PopoverPanel
        anchor="bottom start"
        className="z-[70] w-72 max-w-[85vw] rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900 leading-relaxed shadow-lg [--anchor-gap:4px]"
      >
        <p className="font-semibold mb-1">⚠ Nutrition data looks inconsistent</p>
        <p>
          Declared <strong>{result.calories} kcal</strong>, but {result.proteinG}g protein × 4 + {result.carbsG}g carbs × 4 + {result.fatG}g fat × 9
          {' ≈ '}<strong>{result.atwaterKcal} kcal</strong> — {result.deltaPct}% {direction} what the macros imply.
        </p>
        <p className="mt-1.5 text-orange-700">
          Usually a source-data error, not something wrong with your entry. Worth double-checking before you trust it.
        </p>
      </PopoverPanel>
    </Popover>
  )
}
