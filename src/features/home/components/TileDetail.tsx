import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'

/**
 * The popup a glance tile opens: the widget's own content, plus a link to the
 * feature's page. The link REPLACES the popup's history entry, so one Back
 * from the page returns to Home (the MoreSheet precedent).
 */
export function TileDetail({ open, onClose, title, to, openLabel, children }: {
  open: boolean
  onClose: () => void
  title: string
  /** The feature's page. */
  to: string
  /** e.g. "Open Training". */
  openLabel: string
  children: ReactNode
}) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={(
        <div className="flex justify-end">
          <Link to={to} replace className="btn-secondary">
            {openLabel} <ChevronRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      )}
    >
      {children}
    </ModalShell>
  )
}
