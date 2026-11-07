import { Suspense, useEffect } from 'react'
import { useUIStore } from '../../app/store'
import { CommandPalette } from '../../app/shell/shellParts'
import { ModalShell } from '../modals'

// The palette's body (CommandPalette.tsx) loads on demand, preloaded in idle
// time after start: the shell's first download holds the shortcut and the dialog.

/**
 * ⌘K palette: jump to a page, find a task (opens its editor), or quick-add
 * with "add <title>". A centred palette on wide screens, a sheet on phones.
 */
export function CommandBar() {
  const isOpen = useUIStore(s => s.isCommandBarOpen)
  const openBar = useUIStore(s => s.openCommandBar)
  const closeBar = useUIStore(s => s.closeCommandBar)

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) closeBar()
        else openBar()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, openBar, closeBar])

  return (
    <ModalShell
      open={isOpen}
      onClose={closeBar}
      size="lg"
      bodyClassName="p-0"
      panelClassName="sm:mt-[12vh] sm:self-start"
      ariaLabel="Search or jump to"
    >
      {/* Mounted only while open, so the query and task reads reset with it. */}
      <Suspense fallback={<div aria-busy="true" className="min-h-[56px]" />}>
        <CommandPalette onClose={closeBar} />
      </Suspense>
    </ModalShell>
  )
}
