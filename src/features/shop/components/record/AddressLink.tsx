import { ExternalLink } from 'lucide-react'
import { Truncate, cx } from '../../../../shared/ui'
import { isAdUrl } from '../../resaleRows'
import { linkAddress } from '../../sellingModel'

/**
 * A link out that shows where it goes (never fetched: the owner opens it). Only an ad link 192 would keep (https, a
 * plain host, printable ASCII — `isAdUrl`); the host shows in full and only the path is cut, so a long look-alike
 * host can never hide the real one at its end (security review, 11.11.2026).
 */
export function AddressLink({ url, className }: { url: string; className?: string }) {
  const href = isAdUrl(url) ? url : null
  const parts = href ? linkAddress(href) : null
  if (!href || !parts) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer"
      className={cx('inline-flex min-w-0 max-w-full items-center font-medium text-accent-600 hover:underline', className)}>
      <span className="max-w-full shrink-0 break-all">{parts.host}</span>
      {parts.path && <Truncate as="span" className="min-w-0">{parts.path}</Truncate>}
      <ExternalLink aria-hidden className="ml-1 h-3 w-3 shrink-0" />
    </a>
  )
}
