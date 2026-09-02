import type { ReactNode } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'

// Extracted from WorkedMuscles.tsx (where it was first built and duplicated
// in waiting) into a shared component — every jargon term across the
// Progress decision engine needs the same "tap/hover the ⓘ for a plain
// explanation" affordance, so this is a genuine reuse promotion, not new
// logic. Popover handles focus/ARIA/click-outside/Escape per this repo's
// Headless UI convention — never hand-roll this.
export function InfoBubble({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <Popover className="relative inline-block align-middle">
      <PopoverButton
        aria-label={label ?? 'More information'}
        className="w-4 h-4 rounded-full bg-ink-200 text-ink-600 text-[10px] font-bold leading-none inline-flex items-center justify-center hover:bg-ink-300 focus:outline-none"
      >
        i
      </PopoverButton>
      <PopoverPanel
        anchor="bottom start"
        className="z-[70] w-72 max-w-[85vw] rounded-xl border border-ink-200 bg-cream-50 p-3 text-xs text-ink-600 leading-relaxed shadow-lg [--anchor-gap:4px]"
      >
        {children}
      </PopoverPanel>
    </Popover>
  )
}
