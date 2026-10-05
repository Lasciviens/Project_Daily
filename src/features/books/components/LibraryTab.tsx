import { useMemo, useState } from 'react'
import { BookOpen, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardHeader, EmptyState, PageBoard, SkeletonCard } from '../../../shared/ui'
import { LIBRARY_BOARD, LIBRARY_BROWSE_BOARD } from '../booksBoard'
import { READ_STATUS_LABEL, READ_STATUSES } from '../bookTones'
import { useLibrary } from '../hooks/useLibrary'
import { useAutoCoverLookup } from '../hooks/useAutoCoverLookup'
import { facets, type FacetKind } from '../libraryFacets'
import { matchesSearch, sortForLibrary, upNext, type LibrarySort } from '../readingAggregate'
import type { ReadStatus } from '../types'
import { BookTile } from './BookTile'
import { FacetView } from './library/FacetView'
import { NewsView } from './library/NewsView'
import { AddBook, Duplicates, ReadingNow, UpNext } from './library/pieces'

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'recent', label: 'Recently read' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
  { id: 'progress', label: 'Progress' },
  { id: 'added', label: 'Recently added' },
]

type View = 'books' | 'want' | FacetKind | 'news'
const FACET_VIEWS: { id: FacetKind; label: string }[] = [
  { id: 'author', label: 'Authors' },
  { id: 'collection', label: 'Collections' },
  { id: 'category', label: 'Categories' },
  { id: 'subject', label: 'Subjects' },
]
const VIEW_IDS: View[] = ['books', 'want', 'author', 'collection', 'category', 'subject', 'news']

/** Library: every book, what you want to read next, and the library by author, collection, category and subject. News stays apart. */
export function LibraryTab() {
  const { data: all = [], isLoading } = useLibrary(true, { includeNews: true })
  const books = useMemo(() => all.filter(b => b.kind !== 'news'), [all])
  const news = useMemo(() => all.filter(b => b.kind === 'news'), [all])
  const [params, setParams] = useSearchParams()
  const view: View = VIEW_IDS.includes(params.get('view') as View) ? params.get('view') as View : 'books'
  const open = params.get('group')
  const setView = (v: View) => setParams(p => { p.set('view', v); p.delete('group'); return p })
  const setOpen = (key: string | null) => setParams(p => { if (key) p.set('group', key); else p.delete('group'); return p })
  const [status, setStatus] = useState<ReadStatus | 'all'>('all')
  const [where, setWhere] = useState<'all' | 'kobo' | 'not'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('recent')
  useAutoCoverLookup(books)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: books.length }
    for (const b of books) if (b.read_status) c[b.read_status] = (c[b.read_status] ?? 0) + 1
    return c
  }, [books])
  const facetCounts = useMemo(() => Object.fromEntries(FACET_VIEWS.map(f => [f.id, facets(books, f.id).length])), [books])
  const wantCount = useMemo(() => upNext(books).length, [books])
  const shown = useMemo(() => sortForLibrary(books.filter(b =>
    (status === 'all' || b.read_status === status)
    && (where === 'all' || (where === 'kobo' ? b.on_device : !b.on_device))
    && matchesSearch(b, query)), sort), [books, status, where, query, sort])
  const reading = useMemo(() => sortForLibrary(books.filter(b => b.read_status === 'reading'), 'recent'), [books])
  const filtering = status !== 'all' || query.trim() !== '' || where !== 'all'

  const tools = (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] max-w-md flex-1">
          <span className="sr-only">Search books</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" aria-hidden />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title, author, collection"
            className="input min-h-[44px] w-full pl-9" />
        </label>
        {view === 'books' && (
          <select value={sort} onChange={e => setSort(e.target.value as LibrarySort)} aria-label="Sort books" className="input min-h-[44px] w-auto">
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        <AddBook />
      </div>
      <nav className="scroll-x -mx-1 flex gap-1.5 px-1 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Browse the library">
        <ViewPill id="books" label="All books" count={books.length} view={view} onSelect={setView} />
        <ViewPill id="want" label="Want to read" count={wantCount} view={view} onSelect={setView} />
        {FACET_VIEWS.map(f => <ViewPill key={f.id} id={f.id} label={f.label} count={facetCounts[f.id]} view={view} onSelect={setView} />)}
        <ViewPill id="news" label="News" count={news.length} view={view} onSelect={setView} />
      </nav>
      {view === 'books' && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="scroll-x -mx-1 flex gap-1.5 px-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by status">
            {(['all', ...READ_STATUSES] as const).map(s => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className="pill-tab shrink-0">
                {s === 'all' ? 'Any status' : READ_STATUS_LABEL[s]} <span className="tabular-nums opacity-70">{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by place">
            {([['all', 'Anywhere'], ['kobo', 'On the Kobo'], ['not', 'Not on the Kobo']] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={where === id} onClick={() => setWhere(id)} className="pill-tab shrink-0">{label}</button>
            ))}
          </div>
          <Duplicates books={books} />
        </div>
      )}
    </Card>
  )

  if (view !== 'books') {
    return (
      <PageBoard layout={LIBRARY_BROWSE_BOARD} stackGap="gap-4" sections={{
        tools,
        grid: isLoading ? <SkeletonCard />
          : view === 'want' ? <UpNext books={books.filter(b => matchesSearch(b, query))} limit={500} title="Want to read" />
            : view === 'news' ? <NewsView news={news} query={query} />
              : <FacetView books={books} kind={view} open={open} onOpen={setOpen} query={query} />,
      }} />
    )
  }
  return (
    <PageBoard layout={LIBRARY_BOARD} stackGap="gap-4" sections={{
      tools,
      reading: filtering || reading.length === 0 ? null : <ReadingNow books={reading} />,
      queue: <UpNext books={books} />,
      grid: (
        <Card>
          <CardHeader title={filtering ? `${shown.length} of ${books.length} books` : 'All books'} variant="label" icon={<BookOpen />} />
          {isLoading ? <SkeletonCard /> : books.length === 0 ? (
            <EmptyState icon={<BookOpen />} title="No books yet"
              description="Books appear here after the Kobo's first sync (the Lasci's Board plugin sends the whole library), or add one by hand." />
          ) : shown.length === 0 ? (
            <EmptyState icon={<Search />} title="No book matches" description="Try another word or filter." />
          ) : (
            <div className="@container"><ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-3 gap-y-4 @[34rem]:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]">
              {shown.map(b => <li key={b.id} className="min-w-0"><BookTile book={b} /></li>)}
            </ul></div>
          )}
        </Card>
      ),
    }} />
  )
}

function ViewPill({ id, label, count, view, onSelect }: { id: View; label: string; count: number; view: View; onSelect: (v: View) => void }) {
  return (
    <button type="button" aria-pressed={view === id} onClick={() => onSelect(id)} className="pill-tab shrink-0">
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}
