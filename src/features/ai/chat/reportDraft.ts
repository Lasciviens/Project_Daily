import { toast } from '../../../app/store'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { useDevRequestDrafts } from '../../devRequests/devRequestDraftStore'
import { isDraftEmpty } from '../../devRequests/devRequestRules'
import { parseDescription } from '../../devRequests/devRequestMarks'
import { chatReportDraft } from './chatTranscript'
import type { ChatTurn } from './chatRules'

/**
 * Report (owner, 24.11.2026: "send such chats to the developer"): puts the chat into the Dev Requests window as a new draft,
 * straight away — the window is the one place to read it, write what went wrong and tap Add request; nothing is saved
 * here. `closeAI` closes Ask AI so the window is in front (a right-edge drawer tucks it away). Returns whether it opened.
 */
export function openChatReport(input: { turns: readonly ChatTurn[]; chatId: string | null; answerKey: string | null; closeAI: () => void }): boolean {
  const store = useDevRequestDrafts.getState()
  // An unsaved request in the window is the owner's: never overwritten.
  if (!isDraftEmpty(store.newDraft)) { toast.info('Your open request has text in it — add or discard it first, then try again'); return false }
  const draft = chatReportDraft({ turns: input.turns, chatId: input.chatId, answerKey: input.answerKey, at: formatDateTime(new Date()) })
  // The window reads [[…]] lines as marks: the draft breaks them up, and this is the second look with the window's own parser.
  const parsed = parseDescription(draft.description)
  if (parsed.marks.length || parsed.reviews.length || parsed.recheck || parsed.checkpoints.length) { toast.error('This chat can’t be sent: its text holds something the request window would read as a mark'); return false }
  store.patchNewDraft({ title: draft.title, description: draft.description, page: 'other', category: 'bug', priority: 'medium', attachContext: false })
  input.closeAI()
  store.openComposer({ kind: 'new' })
  return true
}
