import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, Copy, ListOrdered, Plus, Tablet } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, Truncate } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useCreateBook, useMergeBooks, useSaveQueueOrder } from '../../hooks/useLibrary'
import { duplicatePairs, formatDuration, moveInQueue, upNext } from '../../readingAggregate'
import type { Book } from '../../types'
import { BookCover } from '../BookCover'

export function ReadingNow({ books }: { books: Book[] }) {
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
export function UpNext({ books, limit = 12, title = 'Up next' }: { books: Book[]; limit?: number; title?: string }) {
  const modal = useEntityModal()
  const queue = useMemo(() => upNext(books), [books])
  const save = useSaveQueueOrder()
  const move = (id: string, delta: number) => {
    const rows = moveInQueue(queue, id, delta)
    if (rows.length) save.mutate(rows)
  }
  return (
    <Card>
      <CardHeader title={title} variant="label" icon={<ListOrdered />} subtitle={queue.length ? `${queue.length} want to read` : undefined} />
      {queue.length === 0 ? (
        <p className="text-meta text-fg-muted">Mark a book “Want to read” and it lines up here.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {queue.slice(0, limit).map((b, i) => (
            <li key={b.id} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-meta tabular-nums text-fg-faint">{i + 1}</span>
              <button type="button" onClick={() => modal.open({ kind: 'book', id: b.id })}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left hover:bg-surface-hover">
                <BookCover book={b} size="sm" className="w-8 shrink-0" />
                <span className="min-w-0">
                  <Truncate as="span" className="block text-body font-medium text-fg">{b.title}</Truncate>
                  <span className="flex flex-wrap items-center gap-x-2 text-micro text-fg-muted">
                    {b.author && <Truncate as="span" className="min-w-0 max-w-full">{b.author}</Truncate>}
                    {b.on_device
                      ? <span className="inline-flex items-center gap-0.5 text-success"><Tablet className="h-3 w-3" aria-hidden />On the Kobo</span>
                      : <span>Not on the Kobo</span>}
                  </span>
                </span>
              </button>
              <IconButton label={`Move ${b.title} up`} disabled={i === 0 || save.isPending} onClick={() => move(b.id, -1)}><ArrowUp /></IconButton>
              <IconButton label={`Move ${b.title} down`} disabled={i === queue.length - 1 || save.isPending} onClick={() => move(b.id, 1)}><ArrowDown /></IconButton>
            </li>
          ))}
          {queue.length > limit && <li className="pl-7 text-micro text-fg-muted">+{queue.length - limit} more under Want to read</li>}
        </ol>
      )}
    </Card>
  )
}

export function AddBook() {
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
export function Duplicates({ books }: { books: Book[] }) {
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
