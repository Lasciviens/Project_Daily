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
        className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface-2 text-micro font-bold leading-none text-fg-muted ring-1 ring-line hover:bg-surface-hover hover:text-fg after:absolute after:-inset-3.5 after:content-['']"
      >
        i
      </PopoverButton>
      <PopoverPanel
        anchor="bottom start"
        className="z-popover w-72 max-w-[85vw] rounded-menu border border-line-strong bg-surface p-3 text-meta leading-relaxed text-fg-2 shadow-menu [--anchor-gap:4px]"
      >
        {children}
      </PopoverPanel>
    </Popover>
  )
}
