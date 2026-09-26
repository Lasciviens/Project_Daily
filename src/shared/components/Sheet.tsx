import type { ReactNode } from 'react'
import { ModalShell } from '../modals/ModalShell'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Controlled bottom sheet / dialog for local UI sub-steps (filters, pickers).
 * A thin alias of ModalShell — entities (tasks, food entries, recipes…) open
 * through useEntityModal() instead. Body padding comes from `className`.
 */
export function Sheet({ open, onClose, title, children, className, footer, size = 'md' }: SheetProps) {
  return (
    <ModalShell open={open} onClose={onClose} title={title} footer={footer} size={size} bodyClassName={className ?? ''}>
      {children}
    </ModalShell>
  )
}
