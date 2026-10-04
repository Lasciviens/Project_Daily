import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button, Card, CardHeader, cx } from '../../../shared/ui'
import { ACCEPTED, INBOX_CAP_BYTES } from '../api/booksApi'
import { useSendToKobo } from '../hooks/useBooks'
import { megabytes } from './bookFormat'

/** Pick or drop files; each one becomes a delivery waiting in the Kobo inbox. */
export function SendToKoboCard({ waitingBytes }: { waitingBytes: number }) {
  const input = useRef<HTMLInputElement>(null)
  const send = useSendToKobo()
  const [over, setOver] = useState(false)

  async function sendAll(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      try { await send.mutateAsync(f) } catch { /* toasted by the hook; keep going with the rest */ }
    }
  }

  return (
    <Card>
      <CardHeader title="Send to Kobo" variant="label" icon={<Upload />}
        subtitle={`${waitingBytes ? `${megabytes(waitingBytes)} of ${megabytes(INBOX_CAP_BYTES)} waiting` : 'Nothing waiting'} · up to 50 MB per file`} />
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); void sendAll(e.dataTransfer.files) }}
        className={cx('flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors',
          over ? 'border-accent-500 bg-accent-50' : 'border-line')}>
        <p className="text-body text-fg-2">
          <span className="hidden sm:inline">Drop EPUB or PDF files here, or pick files to send.</span>
          <span className="sm:hidden">Pick EPUB or PDF files to send.</span>
        </p>
        <Button variant="primary" icon={<Upload />} loading={send.isPending} onClick={() => input.current?.click()}>Choose files</Button>
        <input ref={input} type="file" multiple accept={[...ACCEPTED, 'application/epub+zip', 'application/pdf'].join(',')} className="sr-only"
          onChange={e => { if (e.target.files?.length) void sendAll(e.target.files); e.target.value = '' }} />
        <p className="text-micro text-fg-muted">On the Kobo: KOReader → 🔍 → OPDS catalog → <strong>Sync all catalogs</strong>.</p>
      </div>
    </Card>
  )
}
