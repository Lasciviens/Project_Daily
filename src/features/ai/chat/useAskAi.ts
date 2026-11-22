import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { invalidate, qk, STALE } from '../../../shared/query'
import { ChatError, decideProposal, fetchConversationRows, fetchConversations, streamChat } from './chatApi'
import { applyChatEvent, newTurn, turnsFromStored, wallState, type CardState, type ChatEvent, type ChatTurn } from './chatRules'

// Ask AI's state: the chat on screen (its turns, streamed in as they are written), the list of chats, and the owner's
// Confirm / Cancel of a proposed write. The chat itself lives in the database (the function stores every message): this
// hook only draws it. UI → hook → api: components never touch the network.

export function useConversations(enabled: boolean) {
  return useQuery({ queryKey: qk.aiChat.conversations(), queryFn: fetchConversations, staleTime: STALE.live, enabled })
}

/** The owner's tap on a proposal. The function does the write (with the owner's own rights); the app refreshes what it may have changed. */
export function useDecideProposal() {
  return useMutationWithFeedback<{ status: 'confirmed' | 'cancelled'; summary: string }, { id: string; decision: 'confirm' | 'cancel' }>({
    action: 'ai_chat_decide',
    mutationFn: async ({ id, decision }) => {
      const out = await decideProposal(id, decision)
      if (!out.ok) throw new ChatError(out.reason, out.message)
      return out
    },
    successMessage: r => (r.status === 'confirmed' ? 'Saved' : 'Cancelled'),
    // A confirmed write changes the owner's own tables (tasks, food), and the chat's proposals.
    invalidates: (r) => (r?.status === 'confirmed' ? ['aiWrite', 'aiChat'] : ['aiChat']),
  })
}

export interface AskAi {
  turns: ChatTurn[]
  conversationId: string | null
  busy: boolean
  wall: 'ok' | 'near' | 'full'
  lastText: string | null
  send: (text: string) => Promise<void>
  newChat: () => void
  open: (id: string) => Promise<void>
  decide: (cardId: string, decision: 'confirm' | 'cancel') => Promise<void>
  stop: () => void
}

export function useAskAi(): AskAi {
  const qc = useQueryClient()
  const decideMutation = useDecideProposal()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wall, setWall] = useState<'ok' | 'near' | 'full'>('ok')
  const [lastText, setLastText] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const counter = useRef(0)
  const idRef = useRef<string | null>(null)
  const nextKey = (prefix: string) => `${prefix}${++counter.current}`

  // Leaving the screen ends a running answer (the function stops when the app goes away).
  useEffect(() => () => abortRef.current?.abort(), [])

  const patchAnswer = useCallback((key: string, event: ChatEvent) => {
    setTurns(list => list.map(t => (t.key === key ? applyChatEvent(t, event) : t)))
  }, [])

  const send = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setLastText(text)
    const answerKey = nextKey('a')
    setTurns(list => [...list, newTurn(nextKey('u'), 'user', text), newTurn(answerKey, 'assistant')])
    setBusy(true)
    const abort = new AbortController()
    abortRef.current = abort
    try {
      await streamChat({ conversationId: idRef.current, text }, event => {
        if (event.event === 'start') { idRef.current = event.conversationId; setConversationId(event.conversationId); return }
        if (event.event === 'done') { idRef.current = event.conversationId; setConversationId(event.conversationId); setWall(event.wall ? 'full' : 'ok') }
        if (event.event === 'error' && event.reason === 'wall') setWall('full')
        patchAnswer(answerKey, event)
      }, abort.signal)
    } catch (error) {
      patchAnswer(answerKey, { event: 'error', reason: 'error', message: error instanceof Error ? error.message : 'Something went wrong.', conversationId: null })
    } finally {
      // An answer that ended without `done` or `error` (the stream was cut) is closed, never left "typing".
      setTurns(list => list.map(t => (t.key === answerKey && t.streaming ? { ...t, streaming: false, error: t.text ? null : 'The answer was interrupted — try again.' } : t)))
      setBusy(false)
      abortRef.current = null
      void invalidate(qc, 'aiChat')
    }
  }, [busy, patchAnswer, qc])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const newChat = useCallback(() => {
    abortRef.current?.abort()
    idRef.current = null
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
    setTurns(turnsFromStored(rows.messages, rows.proposals))
    setWall(wallState(rows.lastPromptTokens, rows.status))
    setLastText(null)
  }, [qc])

  const decide = useCallback(async (cardId: string, decision: 'confirm' | 'cancel') => {
    const mark = (state: CardState) => setTurns(list => list.map(t => (t.cards.some(c => c.id === cardId) ? { ...t, cards: t.cards.map(c => (c.id === cardId ? { ...c, state } : c)) } : t)))
    mark('busy')
    try {
      const r = await decideMutation.mutateAsync({ id: cardId, decision })
      mark(r.status)
    } catch (error) {
      // The mutation toasted the reason. A card that was already decided or has expired shows that, any other failure can be tried again.
      const reason = error instanceof ChatError ? error.reason : 'error'
      mark(reason === 'expired' ? 'expired' : reason === 'already_decided' ? 'confirmed' : reason === 'failed' ? 'failed' : 'pending')
    }
  }, [decideMutation])

  return { turns, conversationId, busy, wall, lastText, send, newChat, open, decide, stop }
}
