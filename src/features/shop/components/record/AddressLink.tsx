import { ExternalLink } from 'lucide-react'
import { Truncate, cx } from '../../../../shared/ui'
import { webUrl } from '../shopFormat'

/** "finn.no/recommerce/…" — a link's address without https:// and www., cut by Truncate where it shows. */
const address = (url: string) => url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')

/** A link out that shows where it goes (never fetched: the owner opens it). */
export function AddressLink({ url, className }: { url: string; className?: string }) {
  const href = webUrl(url)
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer"
      className={cx('inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-accent-600 hover:underline', className)}>
      <Truncate as="span" className="min-w-0">{address(href)}</Truncate>
      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
    </a>
  )
}
