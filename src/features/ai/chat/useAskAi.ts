import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { invalidate, qk, STALE } from '../../../shared/query'
import { shrinkPhoto } from '../claude/photoShrink'
import type { PhotoInput } from '../claude/featureRules'
import { ChatError, decideProposal, fetchChatSetup, fetchConversationRows, fetchConversations, fetchProposalArgs, removeCreatedRow, setChatDeleted, streamChat, type ChatSetup } from './chatApi'
import { applyChatEvent, CHAT_PHOTO_MAX_BYTES, newTurn, turnsFromStored, wallState, type CardState, type ChatEvent, type ChatMode, type ChatTurn } from './chatRules'

// Ask AI's state: the chat on screen (its turns, streamed in as they are written), the list of chats, the owner's Confirm /
// Cancel of a proposed write, and deleting a chat. The chat itself lives in the database (the function stores every message):
// this hook only draws it. UI → hook → api: components never touch the network.

export function useConversations(enabled: boolean) {
  return useQuery({ queryKey: qk.aiChat.conversations(), queryFn: fetchConversations, staleTime: STALE.live, enabled })
}

/** The owner's tap on a proposal. The function does the write (with the owner's own rights); the app refreshes what it may have changed. */
export function useDecideProposal() {
  return useMutationWithFeedback<Awaited<ReturnType<typeof decideProposal>> & { ok: true }, { id: string; decision: 'confirm' | 'cancel'; edits?: { title?: string; date?: string } }>({
    action: 'ai_chat_decide',
    mutationFn: async ({ id, decision, edits }) => {
      const out = await decideProposal(id, decision, edits)
      if (!out.ok) throw new ChatError(out.reason, out.message)
      return out
    },
    successMessage: r => (r.status === 'cancelled' ? 'Cancelled' : r.tool === 'add_task' ? 'Task added' : 'Food line logged'),
    // A confirmed write changes the owner's own tables (tasks, food), and the chat's proposals.
    invalidates: (r) => (r?.status === 'confirmed' ? ['aiWrite', 'aiChat'] : ['aiChat']),
  })
}

/** The card's Undo: takes back the row a confirmed proposal made. */
export function useUndoCreated() {
  return useMutationWithFeedback<void, { tool: string; id: string }>({
    action: 'ai_chat_undo_created',
    mutationFn: ({ tool, id }) => removeCreatedRow(tool, id),
    successMessage: 'Removed',
    invalidates: ['aiWrite'],
  })
}

/**
 * A photo for the chat, shrunk in the browser (the same job as the receipt's and the quick guess's: `shrinkPhoto`, with a
 * tighter byte limit because every photo stays in the stored chat). Nothing is sent here: the photo waits under the box
 * until the owner sends the message, so the hook is silent; a failure is toasted by the primitive. `logPayload: false`
 * keeps its bytes out of the error log.
 */
export function useChatPhoto() {
  return useMutationWithFeedback<PhotoInput, File>({
    action: 'ai_chat_photo',
    silent: 'the photo shows under the message box, ready to send',
    logPayload: false,
    mutationFn: file => shrinkPhoto(file, { maxBytes: CHAT_PHOTO_MAX_BYTES }),
  })
}

/** Deletes a chat (softly) or brings it back: the delete flow asks, reports "Chat deleted · Undo" and calls these. */
export function useDeleteChat() {
  return useMutationWithFeedback<{ id: string; title: string }, string>({
    action: 'ai_chat_delete', mutationFn: id => setChatDeleted(id, true), silent: 'the delete flow reports it', invalidates: ['aiChat'],
  })
}
export function useRestoreChat() {
  return useMutationWithFeedback<{ id: string; title: string }, string>({
    action: 'ai_chat_restore', mutationFn: id => setChatDeleted(id, false), silent: 'the delete flow reports it', invalidates: ['aiChat'],
  })
}

// The old Gemini panel kept its chat and model choice in the browser; nothing reads them now.
function clearOldPanelKeys() {
  try { localStorage.removeItem('lasci-ai-chat'); localStorage.removeItem('lasci-ai-model') } catch { /* storage may be blocked */ }
}

export interface AskAi {
  turns: ChatTurn[]
  conversationId: string | null
  busy: boolean
  wall: 'ok' | 'near' | 'full'
  lastText: string | null
  /** The kind of the chat on screen (a new chat takes the kind given to `newChat`). */
  mode: ChatMode
  /** What the chat was started with (frozen), once the function has made it; null for a chat not started yet. */
  setup: ChatSetup | null
  /** `wall`: the chat is full, nothing was sent or stored (the caller keeps the message in the box). */
  send: (text: string, photos?: readonly PhotoInput[]) => Promise<'sent' | 'wall'>
  /** Asks the last question again in the same place (no second bubble). */
  retry: () => Promise<void>
  /** Takes the last question and its failed answer out of the chat and returns the question, to edit it. */
  editLast: () => string | null
  newChat: (mode?: ChatMode) => void
  open: (id: string) => Promise<void>
  decide: (cardId: string, decision: 'confirm' | 'cancel', edits?: { title?: string; date?: string }) => Promise<void>
  undo: (cardId: string) => Promise<void>
  stop: () => void
}

export function useAskAi(): AskAi {
  const qc = useQueryClient()
  const decideMutation = useDecideProposal()
  const undoMutation = useUndoCreated()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wall, setWall] = useState<'ok' | 'near' | 'full'>('ok')
  const [lastText, setLastText] = useState<string | null>(null)
  const [mode, setMode] = useState<ChatMode>('chat')
  const [setup, setSetup] = useState<ChatSetup | null>(null)
  const modeRef = useRef<ChatMode>('chat')
  const photosRef = useRef<readonly PhotoInput[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const counter = useRef(0)
  const idRef = useRef<string | null>(null)
  const turnsRef = useRef<ChatTurn[]>([])
  const nextKey = (prefix: string) => `${prefix}${++counter.current}`
  useEffect(() => { turnsRef.current = turns }, [turns])

  // Leaving the screen ends a running answer (the function stops when the app goes away).
  useEffect(() => { clearOldPanelKeys() }, [])
  useEffect(() => () => abortRef.current?.abort(), [])

  const patchAnswer = useCallback((key: string, event: ChatEvent) => {
    setTurns(list => list.map(t => (t.key === key ? applyChatEvent(t, event) : t)))
  }, [])

  /** Reads what a proposal stores, so its card can show every field (and Confirm only appears once they are there). */
  const loadCard = useCallback(async (cardId: string) => {
    try {
      const [row] = await fetchProposalArgs([cardId])
      if (!row?.args) return
      setTurns(list => list.map(t => (t.cards.some(c => c.id === cardId) ? { ...t, cards: t.cards.map(c => (c.id === cardId ? { ...c, args: row.args } : c)) } : t)))
    } catch { /* the card stays without Confirm; History shows it again */ }
  }, [])

  /** One answer into the turn `answerKey` (a new one, or the failed one tried again). Returns whether the chat was full. */
  const run = useCallback(async (text: string, answerKey: string, userKey: string | null, photos: readonly PhotoInput[]): Promise<'sent' | 'wall'> => {
    setBusy(true)
    let hitWall = false
    const abort = new AbortController()
    abortRef.current = abort
    try {
      await streamChat({ conversationId: idRef.current, text, images: photos, mode: modeRef.current }, event => {
        if (event.event === 'start') {
          idRef.current = event.conversationId
          setConversationId(event.conversationId)
          // A chat the function just made: what it was started with is read once, so the panel can say which tools it has.
          if (event.isNew) void fetchChatSetup(event.conversationId).then(found => { if (idRef.current === event.conversationId) setSetup(found) }).catch(() => undefined)
          return
        }
        if (event.event === 'done') {
          idRef.current = event.conversationId
          setConversationId(event.conversationId)
          // The warning follows the answer's own prompt size, live.
          setWall(event.wall ? 'full' : wallState(event.promptTokens, 'open'))
        }
        if (event.event === 'proposal') void loadCard(event.card.id)
        if (event.event === 'error' && event.reason === 'wall') {
          // The function refused before storing anything: the message and its empty answer leave the chat.
          hitWall = true
          setWall('full')
          setTurns(list => list.filter(t => t.key !== answerKey && t.key !== userKey))
          return
        }
        patchAnswer(answerKey, event)
      }, abort.signal)
    } catch (error) {
      patchAnswer(answerKey, { event: 'error', reason: 'error', message: error instanceof Error ? error.message : 'Something went wrong.', conversationId: null, costUsd: 0, runId: null })
    } finally {
      // An answer that ended without `done` or `error` (the stream was cut) is closed, never left "typing".
      setTurns(list => list.map(t => (t.key === answerKey && t.streaming ? { ...t, streaming: false, error: t.text ? null : 'The answer was interrupted — try again.', errorReason: 'interrupted' } : t)))
      setBusy(false)
      abortRef.current = null
      void invalidate(qc, 'aiChat')
    }
    return hitWall ? 'wall' : 'sent'
  }, [loadCard, patchAnswer, qc])

  const send = useCallback(async (raw: string, photos: readonly PhotoInput[] = []): Promise<'sent' | 'wall'> => {
    const text = raw.trim()
    if (!text || busy) return 'sent'
    setLastText(text)
    photosRef.current = photos
    const answerKey = nextKey('a')
    const userKey = nextKey('u')
    setTurns(list => [...list, { ...newTurn(userKey, 'user', text), photos: photos.length, photoUrls: photos.map(p => `data:${p.media_type};base64,${p.data}`) }, newTurn(answerKey, 'assistant')])
    return run(text, answerKey, userKey, photos)
  }, [busy, run])

  const retry = useCallback(async () => {
    const list = turnsRef.current
    const last = list[list.length - 1]
    if (busy || !lastText || !last || last.role !== 'assistant') return
    // The failed answer is reset where it stands: no second bubble.
    setTurns(l => l.map(t => (t.key === last.key ? newTurn(last.key, 'assistant') : t)))
    await run(lastText, last.key, null, photosRef.current)
  }, [busy, lastText, run])

  const editLast = useCallback((): string | null => {
    const list = turnsRef.current
    const last = list[list.length - 1]
    const before = list[list.length - 2]
    if (busy || !last || last.role !== 'assistant' || !before || before.role !== 'user') return null
    setTurns(l => l.slice(0, -2))
    return before.text
  }, [busy])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const newChat = useCallback((kind: ChatMode = 'chat') => {
    abortRef.current?.abort()
    idRef.current = null
    modeRef.current = kind
    setMode(kind)
    setSetup(null)
    photosRef.current = []
    setConversationId(null)
    setTurns([])
    setWall('ok')
    setLastText(null)
  }, [])

  const open = useCallback(async (id: string) => {
    abortRef.current?.abort()
    const rows = await qc.fetchQuery({ queryKey: qk.aiChat.turns(id), queryFn: () => fetchConversationRows(id), staleTime: 0 })
    idRef.current = id
    setConversationId(id)
    modeRef.current = rows.setup?.mode ?? 'chat'
    setMode(modeRef.current)
    setSetup(rows.setup)
    photosRef.current = []
    setTurns(turnsFromStored(rows.messages, rows.proposals))
    setWall(wallState(rows.lastPromptTokens, rows.status))
    setLastText(null)
  }, [qc])

  const patchCard = useCallback((cardId: string, patch: Partial<{ state: CardState; resultId: string | null; date: string | null }>) => {
    setTurns(list => list.map(t => (t.cards.some(c => c.id === cardId) ? { ...t, cards: t.cards.map(c => (c.id === cardId ? { ...c, ...patch } : c)) } : t)))
  }, [])

  const decide = useCallback(async (cardId: string, decision: 'confirm' | 'cancel', edits?: { title?: string; date?: string }) => {
    patchCard(cardId, { state: 'busy' })
    try {
      const r = await decideMutation.mutateAsync({ id: cardId, decision, edits })
      patchCard(cardId, { state: r.status, resultId: r.resultId })
      // What was saved (an edited title or date included) is read back, so the card keeps saying what is in the row.
      if (r.status === 'confirmed') {
        try {
          const [row] = await fetchProposalArgs([cardId])
          if (row?.args) setTurns(list => list.map(t => (t.cards.some(c => c.id === cardId) ? { ...t, cards: t.cards.map(c => (c.id === cardId ? { ...c, args: row.args } : c)) } : t)))
        } catch { /* the card keeps its earlier fields */ }
      }
    } catch (error) {
      // The mutation toasted the reason. A card that was already decided or has expired shows that; any other failure can be tried again.
      const reason = error instanceof ChatError ? error.reason : 'error'
      patchCard(cardId, { state: reason === 'expired' ? 'expired' : reason === 'already_decided' ? 'confirmed' : reason === 'failed' ? 'failed' : 'pending' })
    }
  }, [decideMutation, patchCard])

  const undo = useCallback(async (cardId: string) => {
    const card = turnsRef.current.flatMap(t => t.cards).find(c => c.id === cardId)
    if (!card?.resultId) return
    try {
      await undoMutation.mutateAsync({ tool: card.tool, id: card.resultId })
      patchCard(cardId, { state: 'undone' })
    } catch { /* the mutation said why; the card stays */ }
  }, [patchCard, undoMutation])

  return { turns, conversationId, busy, wall, lastText, mode, setup, send, retry, editLast, newChat, open, decide, undo, stop }
}
