import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { X } from 'lucide-react'
import { useHistoryDismiss } from '../hooks/useHistoryDismiss'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { useModalDepth } from './ModalLayer'
import { usePopupTrail } from './popupTrail'
import { cx } from '../ui/cx'
import { Truncate } from '../ui/Truncate'

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE: Record<ModalSize, string> = {
  xs: 'sm:max-w-sm',     // confirms
  sm: 'sm:max-w-md',     // short forms
  md: 'sm:max-w-lg',     // default editor
  lg: 'sm:max-w-2xl',    // two-column editors
  xl: 'sm:max-w-4xl',    // rich detail views
}

export interface ModalShellProps {
  /** Controlled callers pass it; host-rendered modals omit it (always open). */
  open?: boolean
  onClose: () => void
  /** Renders the standard sticky header with a 44px close button. */
  title?: ReactNode
  subtitle?: ReactNode
  /** Extra header controls, left of the close button. */
  headerActions?: ReactNode
  /** Replaces the header (artwork, a photo). The close button floats over it. */
  hero?: ReactNode
  /** Sticky footer (actions); safe-area padded on phones. */
  footer?: ReactNode
  size?: ModalSize
  /** Phones: bottom sheet (default) or a full-screen page. */
  mobile?: 'sheet' | 'fullscreen'
  /** False while saving: backdrop, Esc, Back and drag are ignored. */
  dismissible?: boolean
  /** Stacking layer. Confirms sit above every other modal. */
  layer?: 'modal' | 'confirm'
  /** Extra class names on the scrolling body (padding etc.). Default `p-4 sm:p-5` (`compact`: tighter). */
  bodyClassName?: string
  /** A lighter chrome for a form sheet (the Add sheet, THEME §8): a smaller
   *  title with no hairline under it, a smaller close button, tighter padding. */
  compact?: boolean
  panelClassName?: string
  /** Accessible name when there is no `title` (e.g. the command palette). */
  ariaLabel?: string
  children: ReactNode
}

/**
 * The one popup chrome (THEME.md §8): bottom sheet with a drag handle on
 * phones, centered dialog from `sm:` up. Back closes only the top modal;
 * a nested modal always stacks above the one that opened it.
 */
export function ModalShell({
  open = true, onClose, title, subtitle, headerActions, hero, footer,
  size = 'md', mobile = 'sheet', dismissible = true, layer = 'modal',
  bodyClassName, panelClassName, ariaLabel, compact = false, children,
}: ModalShellProps) {
  const depth = useModalDepth()
  const close = () => { if (dismissible) onClose() }
  useHistoryDismiss(open, close)
  const { setPanelEl, setBodyEl, backdropRef, handleProps } = useSheetDrag(open && mobile === 'sheet' && dismissible, close)
  const panelEl = useRef<HTMLElement | null>(null)
  usePopupTrail(open, panelEl)
  const setPanel = useCallback((el: HTMLElement | null) => { panelEl.current = el; setPanelEl(el) }, [setPanelEl])
  const z: CSSProperties = { zIndex: layer === 'confirm' ? 'var(--z-confirm)' as unknown as number : `calc(var(--z-modal) + ${depth * 10})` as unknown as number }
  const full = mobile === 'fullscreen'

  const closeBtn = (
    <button type="button" onClick={close} aria-label="Close" className={cx('icon-btn shrink-0', compact ? '-mr-1.5 h-9 w-9 text-fg-muted' : '-mr-2')}>
      <X className={compact ? 'h-4 w-4' : 'h-[18px] w-[18px]'} aria-hidden />
    </button>
  )

  return (
    <Dialog open={open} onClose={close} className="relative" style={z} aria-label={title == null ? ariaLabel : undefined}>
      <DialogBackdrop
        ref={backdropRef}
        transition
        className="fixed inset-0 bg-scrim/55 transition duration-200 data-[closed]:opacity-0 dark:bg-scrim/75"
      />
      <div className={cx('fixed inset-0 flex justify-center', full ? 'items-stretch sm:items-center sm:p-4' : 'items-end sm:items-center sm:p-4')}>
        <DialogPanel
          ref={setPanel}
          transition
          className={cx(
            'relative flex w-full flex-col overflow-hidden border border-line bg-surface shadow-menu',
            'transition duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] data-[closed]:translate-y-full',
            'sm:rounded-card sm:duration-200 sm:data-[closed]:translate-y-2 sm:data-[closed]:scale-[0.98] sm:data-[closed]:opacity-0',
            full ? 'h-full max-h-none sm:h-auto sm:max-h-[88dvh]' : 'max-h-[92dvh] rounded-t-sheet sm:max-h-[88dvh]',
            SIZE[size], panelClassName,
          )}
        >
          {!full && (
            <div {...handleProps} className="flex shrink-0 justify-center pb-1 pt-2 sm:hidden">
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>
          )}

          {hero != null ? (
            <div className="relative shrink-0">
              {hero}
              <div className="absolute right-3 top-2 rounded-control bg-surface/90">{closeBtn}</div>
            </div>
          ) : title != null && (
            <header
              {...(full ? {} : handleProps)}
              className={cx(
                'flex shrink-0 items-center gap-3 px-4 sm:px-5',
                compact ? 'pb-1 sm:pt-3' : 'border-b border-line py-2.5',
                full && (compact ? 'pt-[calc(0.25rem+env(safe-area-inset-top))]' : 'pt-[calc(0.625rem+env(safe-area-inset-top))] sm:pt-2.5'),
              )}
            >
              <div className="min-w-0 flex-1">
                {/* User data (a recipe, a game): cut at the box, the rest on tap / hover. */}
                <DialogTitle className={cx('min-w-0 font-semibold text-fg', compact ? 'text-lead' : 'text-title')}><Truncate>{title}</Truncate></DialogTitle>
                {subtitle != null && <Truncate as="p" className="text-meta text-fg-muted">{subtitle}</Truncate>}
              </div>
              {headerActions}
              {closeBtn}
            </header>
          )}

          <div ref={setBodyEl} className={cx('scroll-y min-h-0 flex-1 overflow-y-auto', bodyClassName ?? (compact ? 'px-4 pb-4 pt-1.5 sm:px-5' : 'p-4 sm:p-5'))}>{children}</div>

          {footer != null && (
            <footer className={cx(
              'shrink-0 border-t border-line bg-surface px-4 sm:px-5',
              compact ? 'pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:pb-2.5' : 'pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3',
            )}>
              {footer}
            </footer>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
