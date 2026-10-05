import { useRef, useState } from 'react'
import { ImagePlus, Link2, Search } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { useLookupBookMeta, useUpdateBook } from '../hooks/useLibrary'
import { useUploadBookCover } from '../hooks/useKoboControl'
import type { Book } from '../types'
import { BookCover } from './BookCover'

const SOURCE_LABEL: Record<string, string> = { device: 'From the book file', upload: 'Uploaded', lookup: 'Found online', url: 'From a link' }

/** The cover: upload one, paste a link, or look it up online (Nasjonalbiblioteket → Open Library). */
export function BookCoverEditor({ book }: { book: Book }) {
  const upload = useUploadBookCover()
  const update = useUpdateBook()
  const lookup = useLookupBookMeta()
  const input = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const saveLink = () => {
    const url = (link ?? '').trim()
    if (!/^https:\/\/\S+$/i.test(url)) { setLinkError('Paste a link that starts with https://'); return }
    setLink(null)
    setLinkError(null)
    update.mutate({ id: book.id, patch: { cover_url: url, cover_source: 'url' } })
  }
  return (
    <div className="flex flex-col gap-2">
      <BookCover book={book} className="mx-auto w-32 md:w-full" />
      {book.cover_url && book.cover_source && <p className="text-center text-micro text-fg-muted">{SOURCE_LABEL[book.cover_source] ?? ''}</p>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate({ bookId: book.id, file: f, previous: book.cover_source === 'upload' || book.cover_source === 'device' ? book.cover_url : null }) }} />
      <Button size="sm" icon={<ImagePlus />} loading={upload.isPending} onClick={() => input.current?.click()}>Upload a cover</Button>
      {link === null ? (
        <Button size="sm" icon={<Link2 />} onClick={() => setLink('')}>Cover from a link</Button>
      ) : (
        <form className="flex gap-1" onSubmit={e => { e.preventDefault(); saveLink() }}>
          <input autoFocus className="input min-h-[44px] min-w-0 flex-1" placeholder="https://…" value={link} aria-label="Cover link"
            onChange={e => setLink(e.target.value)} />
          <Button size="sm" type="submit" variant="primary">Use</Button>
        </form>
      )}
      {linkError && <p className="text-micro text-danger">{linkError}</p>}
      <Button size="sm" icon={<Search />} loading={lookup.isPending} onClick={() => lookup.mutate(book.id)}>
        {book.meta_checked_at ? 'Look up details again' : 'Find cover and details'}
      </Button>
    </div>
  )
}
