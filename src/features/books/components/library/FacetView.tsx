import { useMemo } from 'react'
import { ArrowLeft, BookOpen, Tablet } from 'lucide-react'
import { Card, EmptyState, TonePill, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { booksWith, collectionProgress, facets, type Facet, type FacetKind } from '../../libraryFacets'
import { matchesSearch } from '../../readingAggregate'
import type { Book } from '../../types'
import { BookCover } from '../BookCover'
import { BookTile } from '../BookTile'

const NOUN: Record<FacetKind, { one: string; many: string; empty: string }> = {
  author: { one: 'Author', many: 'authors', empty: 'No authors yet — they come from the Kobo, or type one in a book.' },
  collection: { one: 'Collection', many: 'collections', empty: 'No collections yet. Open a book and type its series under “Collection”, e.g. Harry Potter.' },
  category: { one: 'Category', many: 'categories', empty: 'No categories yet. Open a book and add one, e.g. Fantasy or Work; it then shows up here.' },
  subject: { one: 'Subject', many: 'subjects', empty: 'No subjects yet. They come from the book files (the Kobo sends them with plugin 1.2), or add them in a book.' },
}

/** Every author / collection / category / subject as a card; one opens to its books. */
export function FacetView({ books, kind, open, onOpen, query }: {
  books: Book[]; kind: FacetKind; open: string | null; onOpen: (key: string | null) => void; query: string
}) {
  const list = useMemo(() => facets(books, kind), [books, kind])
  const picked = open ? list.find(f => f.key === open) ?? null : null
  if (picked) return <FacetDetail facet={picked} kind={kind} books={booksWith(books, kind, picked.key)} onBack={() => onOpen(null)} />
  const q = query.trim().toLowerCase()
  const shown = q ? list.filter(f => f.label.toLowerCase().includes(q) || f.books.some(b => matchesSearch(b, query))) : list
  if (list.length === 0) return <Card><EmptyState icon={<BookOpen />} title={`No ${NOUN[kind].many} yet`} description={NOUN[kind].empty} /></Card>
  return (
    <Card>
      <p className="mb-3 text-meta text-fg-muted">{shown.length} {shown.length === 1 ? NOUN[kind].one.toLowerCase() : NOUN[kind].many}</p>
      <div className="@container">
        <ul className="grid grid-cols-1 gap-3 @[34rem]:grid-cols-2 @[56rem]:grid-cols-3 @[80rem]:grid-cols-4">
          {shown.map(f => <li key={f.key}><FacetCard facet={f} kind={kind} onOpen={() => onOpen(f.key)} /></li>)}
        </ul>
      </div>
    </Card>
  )
}

function FacetCard({ facet, kind, onOpen }: { facet: Facet; kind: FacetKind; onOpen: () => void }) {
  const p = collectionProgress(facet.books)
  return (
    <button type="button" onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-row border border-line bg-surface p-2.5 text-left transition-colors hover:bg-surface-hover">
      <div className="flex shrink-0 -space-x-4" aria-hidden>
        {facet.books.slice(0, 3).map(b => <BookCover key={b.id} book={b} size="sm" className="w-10 ring-2 ring-surface" />)}
      </div>
      <div className="min-w-0 flex-1">
        <Truncate as="p" className="text-body font-semibold text-fg">{facet.label}</Truncate>
        <p className="text-micro text-fg-muted">
          {p.total} {p.total === 1 ? 'book' : 'books'}
          {kind === 'collection' || p.finished > 0 ? ` · ${p.finished} read` : ''}
          {p.reading > 0 ? ` · ${p.reading} reading` : ''}
        </p>
        {kind === 'collection' && p.total > 1 && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-success" style={{ width: `${(p.finished / p.total) * 100}%` }} />
          </div>
        )}
      </div>
    </button>
  )
}

function FacetDetail({ facet, kind, books, onBack }: { facet: Facet; kind: FacetKind; books: Book[]; onBack: () => void }) {
  const p = collectionProgress(books)
  const modal = useEntityModal()
  return (
    <Card>
      <button type="button" onClick={onBack} className="mb-2 flex min-h-[44px] items-center gap-1.5 text-meta font-semibold text-accent-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All {NOUN[kind].many}
      </button>
      <p className="text-micro font-semibold uppercase tracking-wide text-fg-muted">{NOUN[kind].one}</p>
      <h2 className="text-title font-semibold text-fg">{facet.label}</h2>
      <p className="mb-4 text-meta text-fg-muted">{p.total} {p.total === 1 ? 'book' : 'books'} · {p.finished} read{p.reading ? ` · ${p.reading} reading` : ''}</p>
      {kind === 'collection' ? (
        <ol className="flex flex-col divide-y divide-line">
          {books.map((b, i) => (
            <li key={b.id}>
              <button type="button" onClick={() => modal.open({ kind: 'book', id: b.id })}
                className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left hover:bg-surface-hover">
                <span className="w-8 shrink-0 text-right text-meta font-semibold tabular-nums text-fg-muted">{b.series_index ?? i + 1}</span>
                <BookCover book={b} size="sm" className="w-9 shrink-0" />
                <span className="min-w-0 flex-1">
                  <Truncate as="span" className="block text-body font-medium text-fg">{b.title}</Truncate>
                  {b.author && <Truncate as="span" className="block text-micro text-fg-muted">{b.author}</Truncate>}
                </span>
                {b.on_device && <Tablet className="h-4 w-4 shrink-0 text-fg-muted" aria-label="On the Kobo" />}
                {b.read_status === 'finished' ? <TonePill tone="success">Read</TonePill>
                  : b.read_status === 'reading' ? <TonePill tone="info">{Math.round(b.progress_pct ?? 0)}%</TonePill> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="@container"><ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-3 gap-y-4 @[34rem]:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]">
          {books.map(b => <li key={b.id} className="min-w-0"><BookTile book={b} /></li>)}
        </ul></div>
      )}
    </Card>
  )
}
