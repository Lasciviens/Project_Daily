import { ExternalLink } from 'lucide-react'
import { SOURCES, type SourceId } from '../../plan/sources'

/** A compact "Sources: A · B" line — every piece of science guidance on the
 *  Training tabs names where it comes from, linked to the paper. */
export function SourceNote({ ids, prefix = 'Sources' }: { ids: readonly SourceId[]; prefix?: string }) {
  if (ids.length === 0) return null
  return (
    <p className="text-meta text-fg-muted">
      {prefix}:{' '}
      {ids.map((id, i) => {
        const s = SOURCES[id]
        return (
          <span key={id}>
            {i > 0 && <span aria-hidden> · </span>}
            <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.citation} className="inline-flex items-center gap-0.5 font-medium text-accent-600 hover:underline">
              {s.short}<ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          </span>
        )
      })}
    </p>
  )
}

/** The full citations, for an InfoBubble or a "Science" disclosure. */
export function SourceList({ ids }: { ids: readonly SourceId[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {ids.map(id => {
        const s = SOURCES[id]
        return (
          <li key={id} className="text-meta leading-relaxed text-fg-muted">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-600 hover:underline">{s.short}</a>{' — '}{s.citation}
          </li>
        )
      })}
    </ul>
  )
}
