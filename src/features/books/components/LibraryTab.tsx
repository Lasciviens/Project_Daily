import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, Copy, ListOrdered, Plus, Search } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, IconButton, PageBoard, SkeletonCard, Truncate } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { formatDate } from '../../../shared/utils/dateFormat'
import { LIBRARY_BOARD } from '../booksBoard'
import { READ_STATUS_LABEL, READ_STATUSES } from '../bookTones'
import { useCreateBook, useLibrary, useMergeBooks, useSaveQueueOrder } from '../hooks/useLibrary'
import { useAutoCoverLookup } from '../hooks/useAutoCoverLookup'
import { duplicatePairs, formatDuration, matchesSearch, moveInQueue, sortForLibrary, upNext, type LibrarySort } from '../readingAggregate'
import type { Book, ReadStatus } from '../types'
import { BookCover } from './BookCover'
import { BookTile } from './BookTile'

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'recent', label: 'Recently read' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
  { id: 'progress', label: 'Progress' },
  { id: 'added', label: 'Recently added' },
]

/** Library: what you are reading, what is next, and every book. */
export function LibraryTab() {
  const { data: books = [], isLoading } = useLibrary()
  const [status, setStatus] = useState<ReadStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [onKobo, setOnKobo] = useState(false)
  useAutoCoverLookup(books)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: books.length }
    for (const b of books) c[b.read_status] = (c[b.read_status] ?? 0) + 1
    return c
  }, [books])
  const shown = useMemo(() => sortForLibrary(books.filter(b =>
    (status === 'all' || b.read_status === status) && (!onKobo || b.on_device) && matchesSearch(b, query)), sort),
  [books, status, onKobo, query, sort])
  const reading = useMemo(() => sortForLibrary(books.filter(b => b.read_status === 'reading'), 'recent'), [books])
  const filtering = status !== 'all' || query.trim() !== '' || onKobo

  return (
    <PageBoard layout={LIBRARY_BOARD} stackGap="gap-4" sections={{
      tools: (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[12rem] max-w-md flex-1">
              <span className="sr-only">Search books</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" aria-hidden />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title, author, series"
                className="input min-h-[44px] w-full pl-9" />
            </label>
            <select value={sort} onChange={e => setSort(e.target.value as LibrarySort)} aria-label="Sort books" className="input min-h-[44px] w-auto">
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <AddBook />
          </div>
          <div className="scroll-x -mx-1 flex gap-1.5 px-1" role="group" aria-label="Filter by status">
            {(['all', ...READ_STATUSES] as const).map(s => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
                className="pill-tab shrink-0">
                {s === 'all' ? 'All' : READ_STATUS_LABEL[s]} <span className="tabular-nums opacity-70">{counts[s] ?? 0}</span>
              </button>
            ))}
            <button type="button" aria-pressed={onKobo} onClick={() => setOnKobo(v => !v)} className="pill-tab shrink-0">
              On the Kobo
            </button>
          </div>
          <Duplicates books={books} />
        </Card>
      ),
      reading: filtering || reading.length === 0 ? null : <ReadingNow books={reading} />,
      queue: <UpNext books={books} />,
      grid: (
        <Card>
          <CardHeader title={filtering ? `${shown.length} of ${books.length} books` : 'All books'} variant="label" icon={<BookOpen />} />
          {isLoading ? <SkeletonCard /> : books.length === 0 ? (
            <EmptyState icon={<BookOpen />} title="No books yet"
              description="Books appear here after the Kobo's first sync (the Lasci's Board plugin sends the whole library), or add one by hand." />
          ) : shown.length === 0 ? (
            <EmptyState icon={<Search />} title="No book matches" description="Try another word or status." />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-3 gap-y-4 @container sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]">
              {shown.map(b => <li key={b.id} className="min-w-0"><BookTile book={b} /></li>)}
            </ul>
          )}
        </Card>
      ),
    }} />
  )
}

function ReadingNow({ books }: { books: Book[] }) {
  const modal = useEntityModal()
  return (
    <Card>
      <CardHeader title="Reading now" variant="label" icon={<BookOpen />} />
      <ul className="grid grid-cols-1 gap-3 @container @[34rem]:grid-cols-2">
        {books.slice(0, 4).map(b => (
          <li key={b.id}>
            <button type="button" onClick={() => modal.open({ kind: 'book', id: b.id })}
              className="flex w-full items-center gap-3 rounded-control p-1 text-left hover:bg-surface-hover">
              <BookCover book={b} size="sm" className="w-14 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Truncate as="p" className="text-body font-semibold text-fg">{b.title}</Truncate>
                {b.author && <Truncate as="p" className="text-meta text-fg-muted">{b.author}</Truncate>}
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.min(b.progress_pct ?? 0, 100)}%` }} />
                </div>
                <p className="text-micro tabular-nums text-fg-muted">
                  {Math.round(b.progress_pct ?? 0)}%
                  {b.read_seconds ? ` · ${formatDuration(b.read_seconds)} read` : ''}
                  {b.last_read_at ? ` · last ${formatDate(b.last_read_at)}` : ''}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** The reading queue: want-to-read books in the order you will read them. */
function UpNext({ books }: { books: Book[] }) {
  const modal = useEntityModal()
  const queue = useMemo(() => upNext(books), [books])
  const save = useSaveQueueOrder()
  const move = (id: string, delta: number) => {
    const rows = moveInQueue(queue, id, delta)
    if (rows.length) save.mutate(rows)
  }
  return (
    <Card>
      <CardHeader title="Up next" variant="label" icon={<ListOrdered />} subtitle={queue.length ? `${queue.length} want to read` : undefined} />
      {queue.length === 0 ? (
        <p className="text-meta text-fg-muted">Mark a book “Want to read” and it lines up here.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {queue.slice(0, 12).map((b, i) => (
            <li key={b.id} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-meta tabular-nums text-fg-faint">{i + 1}</span>
              <button type="button" onClick={() => modal.open({ kind: 'book', id: b.id })}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left hover:bg-surface-hover">
                <BookCover book={b} size="sm" className="w-8 shrink-0" />
                <span className="min-w-0">
                  <Truncate as="span" className="block text-body font-medium text-fg">{b.title}</Truncate>
                  {b.author && <Truncate as="span" className="block text-micro text-fg-muted">{b.author}</Truncate>}
                </span>
              </button>
              <IconButton label={`Move ${b.title} up`} disabled={i === 0 || save.isPending} onClick={() => move(b.id, -1)}><ArrowUp /></IconButton>
              <IconButton label={`Move ${b.title} down`} disabled={i === queue.length - 1 || save.isPending} onClick={() => move(b.id, 1)}><ArrowDown /></IconButton>
            </li>
          ))}
          {queue.length > 12 && <li className="pl-7 text-micro text-fg-muted">+{queue.length - 12} more in the library</li>}
        </ol>
      )}
    </Card>
  )
}

function AddBook() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const create = useCreateBook()
  if (!open) return <Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>Add a book</Button>
  const submit = () => {
    if (!title.trim()) return
    create.mutate({ title: title.trim(), author: author.trim() || null, read_status: 'want' }, {
      onSuccess: () => { setTitle(''); setAuthor(''); setOpen(false) },
    })
  }
  return (
    <form className="flex w-full flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); submit() }}>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="input min-h-[44px] min-w-[10rem] max-w-md flex-1" />
      <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author (optional)" aria-label="Author" className="input min-h-[44px] min-w-[10rem] max-w-xs flex-1" />
      <Button type="submit" variant="primary" size="sm" loading={create.isPending} disabled={!title.trim()}>Add</Button>
      <Button type="button" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  )
}

/** "These look like the same book": a suggestion, never an automatic merge. */
function Duplicates({ books }: { books: Book[] }) {
  const pairs = useMemo(() => duplicatePairs(books), [books])
  const merge = useMergeBooks()
  const modal = useEntityModal()
  const describe = (b: Book) => `${b.source === 'manual' ? 'added by hand' : 'from the Kobo'}${b.read_seconds ? `, ${formatDuration(b.read_seconds)} read` : ''}`
  async function confirmMerge(keep: Book, drop: Book) {
    const ok = await modal.confirm({
      title: `Merge into one “${keep.title}”?`,
      message: `Keeps the one ${describe(keep)} and moves the reading history, notes and rating of the one ${describe(drop)} into it. The other row is deleted.`,
      confirmLabel: 'Merge',
    })
    if (ok) merge.mutate({ survivor: keep, loser: drop })
  }
  const [open, setOpen] = useState(false)
  if (pairs.length === 0) return null
  return (
    <div className="rounded-control border border-line bg-surface-2 px-3 py-1">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex min-h-[44px] w-full items-center gap-2 text-left text-meta text-fg">
        <Copy className="h-4 w-4 text-fg-muted" aria-hidden />
        {pairs.length === 1 ? 'Two books look like the same book' : `${pairs.length} pairs look like the same book`}
        <span className="ml-auto font-semibold text-accent-600">{open ? 'Hide' : 'Review'}</span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-2">
          {pairs.map(([a, b]) => {
            // Keep the copy with more reading data (or the one the Kobo knows).
            const keep = (b.read_seconds ?? 0) > (a.read_seconds ?? 0) || (!a.koreader_md5 && b.koreader_md5) ? b : a
            const drop = keep === a ? b : a
            return (
              <li key={`${a.id}-${b.id}`} className="flex flex-wrap items-center gap-2 text-meta">
                <Truncate className="min-w-0 flex-1 text-fg">{keep.title}{keep.author ? ` — ${keep.author}` : ''}</Truncate>
                <Button size="sm" loading={merge.isPending} onClick={() => { void confirmMerge(keep, drop) }}>Merge</Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
