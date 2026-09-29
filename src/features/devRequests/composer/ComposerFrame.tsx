import { useEffect, type CSSProperties, type HTMLAttributes, type Ref } from 'react'
import { ChevronDown, GripVertical, Minus, PenLine, Sparkles, X } from 'lucide-react'
import { Button, IconButton, SegmentedControl, cx } from '../../../shared/ui'
import type { ComposerTab } from '../devRequestRules'

// The composer's chrome: the title bar, the Request | Prompt switch, the
// minimised pill and the touch pick bar. Every root carries
// data-dev-request-ui so picking never captures the composer itself, and
// vt-pin-composer (one of them at a time) so a page's view transition slides
// the page under it while it stays put, like the rest of the chrome.
// Landmarks (role="region"), not dialogs: nothing about them is modal, and
// pages treat an open [role=dialog] as owning the keyboard.

/** The classes every composer root carries. */
export const COMPOSER_ROOT = 'vt-pin-composer'

/** Above the phone tab bar (the installed-iOS short-viewport gap included). */
export const ABOVE_TABBAR = 'calc(var(--app-tabbar-h) + env(safe-area-inset-bottom) - var(--ios-viewport-gap, 0px))'

export function ComposerHeader({ title, dirty, phone, onMinimize, onClose, dragProps }: {
  title: string
  /** 'Unsaved' / 'Edited' marker, or null. */
  dirty: string | null
  phone: boolean
  onMinimize: () => void
  onClose: () => void
  dragProps?: HTMLAttributes<HTMLElement>
}) {
  return (
    <header
      {...dragProps}
      tabIndex={dragProps ? 0 : undefined}
      title={dragProps ? 'Drag to move · double-click to reset · Alt + arrow keys to nudge' : undefined}
      className="flex min-h-[48px] shrink-0 select-none items-center gap-1 border-b border-line pl-3 pr-1.5"
    >
      {!phone && <GripVertical className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />}
      <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-fg">{title}</h2>
      {dirty && (
        <span className="flex shrink-0 items-center gap-1 pr-1 text-meta text-fg-muted">
          <span data-tone="warn" className="tone-dot" aria-hidden />{dirty}
        </span>
      )}
      <IconButton label="Minimise" onClick={onMinimize}>{phone ? <ChevronDown /> : <Minus />}</IconButton>
      <IconButton label="Close — the draft is kept" onClick={onClose}><X /></IconButton>
    </header>
  )
}

export function ComposerTabs({ tab, onChange }: { tab: ComposerTab; onChange: (t: ComposerTab) => void }) {
  return (
    <div className="shrink-0 px-3 pt-2.5">
      <SegmentedControl
        fullWidth
        size="sm"
        value={tab}
        onChange={onChange}
        options={[{ value: 'request', label: 'Request' }, { value: 'prompt', label: 'Prompt' }]}
      />
    </div>
  )
}

// While the pill sits above the phone tab bar, <main> keeps that strip free
// (index.css), so the last row of a page — or Shop's docked assistant bar —
// never ends up under it.
const PILL_ATTR = 'data-dev-request-pill'

/** The minimised composer: one tap brings it back. */
export function ComposerPill({ label, prompt, dirty, phone, onOpen, pillRef }: {
  label: string
  prompt: boolean
  dirty: boolean
  phone: boolean
  onOpen: () => void
  pillRef?: Ref<HTMLButtonElement>
}) {
  useEffect(() => {
    if (!phone) return
    const root = document.documentElement
    root.setAttribute(PILL_ATTR, '')
    return () => root.removeAttribute(PILL_ATTR)
  }, [phone])
  const style: CSSProperties | undefined = phone ? { bottom: `calc(${ABOVE_TABBAR} + 12px)` } : undefined
  return (
    <button
      ref={pillRef}
      type="button"
      data-dev-request-ui=""
      onClick={onOpen}
      style={style}
      aria-label={`Open the request composer: ${label}${dirty ? ' (unsaved)' : ''}`}
      className={cx(
        COMPOSER_ROOT,
        'press-feedback fixed flex min-h-[44px] max-w-[min(18rem,calc(100vw-32px))] items-center gap-2 rounded-full border border-line-strong bg-surface py-2 pl-3.5 pr-4 text-ui font-semibold text-fg shadow-menu',
        phone ? 'right-4 z-chrome' : 'bottom-6 right-6 z-float',
      )}
    >
      {prompt ? <Sparkles className="h-4 w-4 shrink-0 text-accent-600" aria-hidden /> : <PenLine className="h-4 w-4 shrink-0 text-accent-600" aria-hidden />}
      <span className="truncate">{label}</span>
      {dirty && <span data-tone="warn" className="tone-dot shrink-0" aria-hidden />}
    </button>
  )
}

/**
 * Touch screens pick in two steps: tap to select, then Wider / Use this.
 * Phones show it docked above the tab bar (in place of the composer), touch
 * tablets inside the composer window.
 */
export function PickBar({ label, onWider, onUse, onCancel, docked }: {
  label: string | null
  onWider: () => void
  onUse: () => void
  onCancel: () => void
  docked: boolean
}) {
  return (
    <div
      data-dev-request-ui=""
      role={docked ? 'region' : undefined}
      aria-label={docked ? 'Pick on page' : undefined}
      style={docked ? { bottom: `calc(${ABOVE_TABBAR} + 8px)` } : undefined}
      className={docked
        ? cx(COMPOSER_ROOT, 'fixed inset-x-3 z-float flex flex-col gap-2 rounded-card border border-line-strong bg-surface p-3 shadow-menu')
        : 'flex shrink-0 flex-col gap-2 border-b border-line bg-accent-50 px-3 py-2.5'}
    >
      <div className="min-w-0" aria-live="polite">
        <p className="text-meta text-fg-muted">{label ? 'Selected' : 'Tap anything on the page — scrolling still works'}</p>
        {label && <p className="truncate text-body font-semibold text-fg">{label}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onWider} disabled={!label} className="ml-auto">Wider</Button>
        <Button size="sm" variant="primary" onClick={onUse} disabled={!label}>Use this</Button>
      </div>
    </div>
  )
}

/** Tablet/desktop banner while picking. */
export function PickingBanner({ onStop }: { onStop: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-accent-50 px-3 py-2 text-meta text-accent-700">
      <span className="min-w-0 flex-1">Click anything to add it · <span className="kbd">↑</span> wider · <span className="kbd">Esc</span> stops</span>
      <Button size="sm" variant="ghost" onClick={onStop}>Stop</Button>
    </div>
  )
}
