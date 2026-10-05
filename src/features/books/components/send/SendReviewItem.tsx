import { AlertTriangle, BookOpen, Send, Tablet, X } from 'lucide-react'
import { Button, IconButton, TonePill, cx } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import { useEntityModal } from '../../../../shared/modals'
import { LANGUAGES, findDuplicate, languageCode, missingFields, type Known, type SendDraft } from '../../epub/sendDraft'
import type { OpenedFile } from '../../epub/epubFile'
import type { Book } from '../../types'
import { SuggestInput, TagInput } from '../SuggestInput'
import { megabytes } from '../bookFormat'

const MISSING_LABEL = { title: 'Title', author: 'Author', language: 'Language' } as const

/** One picked file before it is sent: its cover and details, editable, with what is missing. */
export function SendReviewItem({ opened, draft, onChange, onSend, onRemove, known, books, sending }: {
  opened: OpenedFile
  draft: SendDraft
  onChange: (p: Partial<SendDraft>) => void
  onSend: () => void
  onRemove: () => void
  known: Known
  books: Book[]
  sending: boolean
}) {
  const modal = useEntityModal()
  const missing = missingFields(draft)
  const sameFile = books.find(b => b.koreader_md5 === opened.md5) ?? null
  const dup = sameFile ? null : findDuplicate(books, draft)
  const lang = languageCode(draft.language)
  const field = (k: 'author' | 'language') => cx(missing.includes(k) && '[&_input]:border-warn')
  return (
    <li className="rounded-card border border-line bg-surface p-3 sm:p-4">
      <div className="flex gap-3 sm:gap-4">
        <div className="w-20 shrink-0 sm:w-28">
          {opened.coverUrl
            ? <img src={opened.coverUrl} alt="" className="aspect-[2/3] w-full rounded-control border border-line object-cover" />
            : <div className="grid aspect-[2/3] w-full place-items-center rounded-control border border-dashed border-line bg-surface-2 text-fg-faint"><BookOpen className="h-6 w-6" aria-hidden /></div>}
          <p className="mt-1 break-words text-micro text-fg-muted">{megabytes(opened.file.size)}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 break-words text-micro text-fg-muted">{opened.file.name}</p>
            <IconButton label={`Do not send ${opened.file.name}`} onClick={onRemove}><X /></IconButton>
          </div>
          {missing.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-meta text-fg-2">
              <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />
              Missing: {missing.map(m => <TonePill key={m} tone="warn">{MISSING_LABEL[m]}</TonePill>)}
            </p>
          )}
          {sameFile && (
            <p className="rounded-control bg-surface-2 px-2.5 py-1.5 text-meta text-fg-2">
              This file is already in your library as{' '}
              <button type="button" className="font-semibold text-accent-600 underline-offset-2 hover:underline" onClick={() => modal.open({ kind: 'book', id: sameFile.id })}>{sameFile.title}</button>.
              {' '}Its details are filled in below; sending updates that book.
            </p>
          )}
          {dup && !dup.koreader_md5 && (
            <label className="flex min-h-[44px] items-start gap-2 rounded-control bg-surface-2 px-2.5 py-1.5 text-meta text-fg-2">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent-500))]" checked={draft.asBookId === dup.id}
                onChange={e => onChange({ asBookId: e.target.checked ? dup.id : null })} />
              <span>
                “{dup.title}” is already in your library without a file. <span className="font-semibold text-fg">Send as that book</span>, so it stays one book with its status and notes.
              </span>
            </label>
          )}
          {dup && dup.koreader_md5 && (
            <p className="flex flex-wrap items-center gap-1.5 rounded-control bg-surface-2 px-2.5 py-1.5 text-meta text-fg-2">
              <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />
              You already have
              <button type="button" className="font-semibold text-accent-600 underline-offset-2 hover:underline" onClick={() => modal.open({ kind: 'book', id: dup.id })}>{dup.title}</button>
              {dup.on_device ? <span className="inline-flex items-center gap-0.5"><Tablet className="h-3 w-3" aria-hidden />on the Kobo</span> : null}
              as another file. Sending adds a second copy.
            </p>
          )}
          <label className="flex flex-col gap-1"><span className="field-label">Title</span>
            <input className="input min-h-[44px]" value={draft.title} onChange={e => onChange({ title: e.target.value })} /></label>
          <div className="grid gap-3 @container sm:grid-cols-2">
            <div className={cx('flex flex-col gap-1', field('author'))}><span className="field-label">Author</span>
              <SuggestInput label="Author" value={draft.author} values={known.author} placeholder="Start typing — your library suggests names" onChange={v => onChange({ author: v })} /></div>
            <label className={cx('flex flex-col gap-1', field('language'), missing.includes('language') && '[&_select]:border-warn')}><span className="field-label">Language</span>
              <select className="input min-h-[44px]" value={lang} onChange={e => onChange({ language: e.target.value })}>
                <option value="">Not set</option>
                {lang && !LANGUAGES.some(l => l.code === lang) && <option value={lang}>{lang}</option>}
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select></label>
            <div className="flex flex-col gap-1"><span className="field-label">Collection (series)</span>
              <SuggestInput label="Collection" value={draft.series} values={known.collection} placeholder="e.g. Harry Potter" onChange={v => onChange({ series: v })} /></div>
            <label className="flex flex-col gap-1"><span className="field-label">Number in collection</span>
              <input className="input min-h-[44px]" inputMode="decimal" value={draft.seriesIndex} disabled={!draft.series.trim()} onChange={e => onChange({ seriesIndex: e.target.value })} /></label>
          </div>
          <div className="flex flex-col gap-1"><span className="field-label">Categories</span>
            <TagInput label="Categories" value={draft.categories} values={known.category} placeholder="e.g. Fantasy" onChange={v => onChange({ categories: v })} /></div>
          <div className="flex flex-col gap-1"><span className="field-label">Subjects</span>
            <TagInput label="Subjects" value={draft.subjects} values={known.subject} placeholder="e.g. Magic" onChange={v => onChange({ subjects: v })} /></div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex min-h-[44px] items-center gap-2 text-body text-fg">
              <span>Mark as</span>
              <select className="input min-h-[40px] w-auto" value={draft.status} onChange={e => onChange({ status: e.target.value as SendDraft['status'] })}>
                <option value="want">Want to read</option>
                <option value="reading">Reading</option>
              </select>
            </label>
            {opened.epub ? (
              <label className="flex min-h-[44px] items-center gap-2 text-body text-fg">
                <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent-500))]" checked={draft.writeIntoFile} onChange={e => onChange({ writeIntoFile: e.target.checked })} />
                Write these details into the file
                <HelpTip label="About writing details into the file">
                  <p>The Kobo shows the title, author and series stored inside the book file. On: your corrections go into the file before it is sent, so the Kobo shows them too. Off: the file is sent unchanged and your details are kept in the app only.</p>
                  <p className="mt-2">The text of the book is never changed.</p>
                </HelpTip>
              </label>
            ) : opened.problem && <p className="text-micro text-fg-muted">{opened.problem}</p>}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" icon={<Send />} loading={sending} disabled={!draft.title.trim()} onClick={onSend}>Send to Kobo</Button>
          </div>
        </div>
      </div>
    </li>
  )
}
