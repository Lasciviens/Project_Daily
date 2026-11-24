import { useState } from 'react'
import { Copy, Flag } from 'lucide-react'
import { toast, useUIStore } from '../../../app/store'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { useDevRequestDrafts } from '../../devRequests/devRequestDraftStore'
import { isDraftEmpty } from '../../devRequests/devRequestRules'
import { parseDescription } from '../../devRequests/devRequestMarks'
import { copyText } from './chatClipboard'
import { chatReportDraft, REPORT_LINE_MAX } from './chatTranscript'
import type { ChatTurn } from './chatRules'

// Report and Copy for Ask AI (owner, 24.11.2026: "send such chats to the developer"). Report opens the Dev Requests window
// with a draft (the chat as plain text, the chat's id, the owner's one line); nothing is saved until the owner taps Save
// there. Copy puts plain text on the clipboard. Both use only what is on screen, cleaned (chatTranscript.ts).

/** A small copy button for one message. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <IconButton label={label} onClick={() => copyText(text)} className="!h-7 !w-7 text-fg-faint [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9 [&_svg]:!h-3.5 [&_svg]:!w-3.5">
      <Copy aria-hidden />
    </IconButton>
  )
}

/** A small Report button: opens the report sheet for the chat, or for one answer of it. */
export function ReportButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <IconButton label={label} onClick={onClick} className="!h-7 !w-7 text-fg-faint [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9 [&_svg]:!h-3.5 [&_svg]:!w-3.5">
      <Flag aria-hidden />
    </IconButton>
  )
}

/**
 * The report sheet: one line on what went wrong, and what the draft will hold (read-only, selectable). Draft puts it in
 * the Dev Requests window and closes Ask AI so the window is in front; the owner reads it there and saves.
 */
export function ChatReportSheet({ turns, chatId, answerKey, onClose }: { turns: readonly ChatTurn[]; chatId: string | null; answerKey: string | null; onClose: () => void }) {
  const [line, setLine] = useState('')
  const closeAI = useUIStore(s => s.closeAI)
  const [at] = useState(() => formatDateTime(new Date()))
  const draft = chatReportDraft({ turns, chatId, line, answerKey, at })
  const toDraft = () => {
    const store = useDevRequestDrafts.getState()
    // An unsaved request in the window is the owner's: never overwritten.
    if (!isDraftEmpty(store.newDraft)) { toast.info('Your open request has text in it — save or discard it first, then try again'); return }
    // The window reads [[…]] lines as marks: the draft breaks them up, and this is the second look with the window's own parser.
    const parsed = parseDescription(draft.description)
    if (parsed.marks.length || parsed.reviews.length || parsed.recheck || parsed.checkpoints.length) { toast.error('This chat can’t be sent: its text holds something the request window would read as a mark'); return }
    store.patchNewDraft({ title: draft.title, description: draft.description, page: 'other', category: 'bug', priority: 'medium', attachContext: false })
    onClose()
    closeAI()
    store.openComposer({ kind: 'new' })
  }
  return (
    <ModalShell onClose={onClose} title="Report" subtitle={answerKey ? 'This answer, with the chat around it' : 'This chat'} size="md" compact
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" icon={<Flag />} onClick={toDraft} title="Open it as a Dev Request draft; you save it there">Draft</Button>
        </div>
      )}>
      <label className="block text-meta font-medium text-fg-muted" htmlFor="chat-report-line">What went wrong?</label>
      <input id="chat-report-line" value={line} onChange={e => setLine(e.target.value.slice(0, REPORT_LINE_MAX))} placeholder="One line, in your words" className="input mt-1 w-full max-w-md" autoComplete="off" data-autofocus />
      <p className="mt-3 text-meta text-fg-muted">The draft holds the chat as plain text and its id. Nothing is saved until you tap Save in the request window.</p>
      <pre className="mt-1.5 max-h-64 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-control border border-line bg-surface-2 px-2.5 py-2 font-sans text-meta text-fg-2">{draft.description}</pre>
    </ModalShell>
  )
}
