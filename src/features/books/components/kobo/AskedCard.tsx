import { MessageCircleQuestion, Trash2 } from 'lucide-react'
import { Card, CardHeader, IconButton, Truncate } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useAiNotes, useDeleteAiNote } from '../../hooks/useKoboControl'
import type { BookAiNote } from '../../types'

const ASK_LABEL: Record<BookAiNote['ask'], string> = {
  explain: 'Explain', translate: 'Translate', word: 'This word', character: 'Who is this?', free: 'Question',
}

/** Questions asked on the Kobo (select text → Ask Lasci's AI), newest first. */
export function AskedCard({ bookId, title = 'Asked on the Kobo' }: { bookId?: string; title?: string }) {
  const notes = useAiNotes(bookId)
  const remove = useDeleteAiNote()
  const rows = notes.data ?? []
  if (!bookId && rows.length === 0) {
    return (
      <Card>
        <CardHeader title={title} icon={<MessageCircleQuestion />} />
        <p className="text-meta text-fg-muted">While reading in KOReader, select text and tap “Ask Lasci's AI”. The answers are kept here.</p>
      </Card>
    )
  }
  if (rows.length === 0) return null
  return (
    <Card>
      <CardHeader title={title} icon={<MessageCircleQuestion />} subtitle={`${rows.length} ${rows.length === 1 ? 'question' : 'questions'}`} />
      <AskedList rows={rows} onDelete={id => remove.mutate(id)} showBook={!bookId} />
    </Card>
  )
}

export function AskedList({ rows, onDelete, showBook }: { rows: BookAiNote[]; onDelete: (id: string) => void; showBook: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map(n => (
        <li key={n.id} className="flex items-start gap-2 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-micro text-fg-muted">
              {ASK_LABEL[n.ask]} · {formatDate(n.created_at)}{showBook && n.book_title ? ` · ${n.book_title}` : ''}
            </p>
            <Truncate as="p" lines={2} className="text-meta italic text-fg-2">“{n.selection}”</Truncate>
            {n.question && <p className="text-meta text-fg">{n.question}</p>}
            <p className="whitespace-pre-line text-body text-fg">{n.answer}</p>
          </div>
          <IconButton label="Delete this question" onClick={() => onDelete(n.id)}><Trash2 /></IconButton>
        </li>
      ))}
    </ul>
  )
}
