import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button, Card, CardHeader, cx } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { ACCEPTED, INBOX_CAP_BYTES, MAX_FILE_BYTES, isAcceptedFile } from '../api/booksApi'
import { finalBytes, openBookFile, partialMd5, type OpenedFile } from '../epub/epubFile'
import { bookRowOf, draftFromMeta, normalizeDraft, opfEditOf, type Known, type SendDraft } from '../epub/sendDraft'
import { useSendPrepared } from '../hooks/useBooks'
import { useLibrary } from '../hooks/useLibrary'
import { knownValues } from '../libraryFacets'
import { megabytes } from './bookFormat'
import { SendReviewItem } from './send/SendReviewItem'

interface Item { key: string; opened: OpenedFile; draft: SendDraft }

/** Pick or drop files, check and fill in their details, then send — each one lands in the Kobo inbox. */
export function SendToKoboCard({ waitingBytes }: { waitingBytes: number }) {
  const input = useRef<HTMLInputElement>(null)
  const send = useSendPrepared()
  const [over, setOver] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const { data: books = [] } = useLibrary()
  const known: Known = useMemo(() => ({
    author: knownValues(books, 'author'), collection: knownValues(books, 'collection'),
    category: knownValues(books, 'category'), subject: knownValues(books, 'subject'),
  }), [books])
  // Cover previews are object URLs: let them go with their item.
  const urls = useRef(new Set<string>())
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u) }, [])

  async function pick(files: FileList | File[]) {
    setReading(true)
    try {
      for (const f of Array.from(files)) {
        if (!isAcceptedFile(f.name)) { toast.error(`${f.name}: only EPUB, KEPUB and PDF files can be sent.`); continue }
        if (f.size > MAX_FILE_BYTES) { toast.error(`${f.name} is larger than 50 MB — send it over USB or Calibre instead.`); continue }
        const opened = await openBookFile(f)
        if (opened.coverUrl) urls.current.add(opened.coverUrl)
        setItems(list => [...list, { key: `${f.name}-${f.size}-${f.lastModified}-${list.length}`, opened, draft: draftFromMeta(opened.meta, f.name, !!opened.epub) }])
      }
    } finally { setReading(false) }
  }
  const drop = (key: string) => setItems(list => {
    const it = list.find(i => i.key === key)
    if (it?.opened.coverUrl) { URL.revokeObjectURL(it.opened.coverUrl); urls.current.delete(it.opened.coverUrl) }
    return list.filter(i => i.key !== key)
  })

  async function sendOne(it: Item) {
    setBusy(it.key)
    try {
      const d = normalizeDraft(it.draft, known)
      let bytes = it.opened.bytes
      try { bytes = finalBytes(it.opened, opfEditOf(d)) }
      catch { toast.warning(`Could not write the details into ${it.opened.file.name}; it is sent unchanged.`) }
      await send.mutateAsync({ bytes, fileName: it.opened.file.name, md5: partialMd5(bytes), row: bookRowOf(d, it.opened.meta) })
      drop(it.key)
    } catch { /* the hook toasts the error; the item stays for another try */ } finally { setBusy(null) }
  }
  async function sendAll() { for (const it of items) await sendOne(it) }

  return (
    <Card>
      <CardHeader title="Send to Kobo" variant="label" icon={<Upload />}
        subtitle={`${waitingBytes ? `${megabytes(waitingBytes)} of ${megabytes(INBOX_CAP_BYTES)} waiting` : 'Nothing waiting'} · up to 50 MB per file`} />
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files) }}
        className={cx('flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors',
          over ? 'border-accent-500 bg-accent-50' : 'border-line')}>
        <p className="text-body text-fg-2">
          <span className="hidden sm:inline">Drop EPUB or PDF files here, or pick files.</span>
          <span className="sm:hidden">Pick EPUB or PDF files.</span>
          {' '}You can check and fill in their details before they are sent.
        </p>
        <Button variant="primary" icon={<Upload />} loading={reading} onClick={() => input.current?.click()}>Choose files</Button>
        <input ref={input} type="file" multiple accept={[...ACCEPTED, 'application/epub+zip', 'application/pdf'].join(',')} className="sr-only"
          onChange={e => { if (e.target.files?.length) void pick(e.target.files); e.target.value = '' }} />
        <p className="text-micro text-fg-muted">A sent file downloads by itself the next time the Kobo’s Wi-Fi comes on.</p>
      </div>
      {items.length > 0 && (
        <section className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex-1 text-body font-semibold text-fg">Check before sending ({items.length})</h3>
            {items.length > 1 && <Button size="sm" loading={!!busy} onClick={() => { void sendAll() }}>Send all {items.length}</Button>}
          </div>
          <ul className="flex flex-col gap-3">
            {items.map(it => (
              <SendReviewItem key={it.key} opened={it.opened} draft={it.draft} known={known} books={books}
                sending={busy === it.key}
                onChange={p => setItems(list => list.map(x => (x.key === it.key ? { ...x, draft: { ...x.draft, ...p } } : x)))}
                onSend={() => { void sendOne(it) }} onRemove={() => drop(it.key)} />
            ))}
          </ul>
        </section>
      )}
    </Card>
  )
}
