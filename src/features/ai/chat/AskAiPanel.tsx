import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Copy, Flag, History, MessageSquarePlus, Sparkles, SendHorizontal, Square } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../../app/store'
import { confirmDelete } from '../../../shared/modals/deleteFlow'
import { SideDrawer } from '../../../shared/modals/SideDrawer'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { Button, IconButton } from '../../../shared/ui'
import type { PhotoInput } from '../claude/featureRules'
import { useAiSettings, useChatInstructions, useClaudeDescribe, useToolSettings } from '../claude/hooks/useClaude'
import { chatToolModes } from '../claude/ledgerRules'
import { useKeyboardInset, useStickToBottom } from '../hooks/useChatViewport'
import { ChatHistory } from './ChatHistory'
import { ChatTurnView } from './ChatTurnView'
import { AttachPhoto, ChatSetupNote, MicButton, PhotoStrip } from './ChatExtras'
import { openChatReport } from './reportDraft'
import { copyText } from './chatClipboard'
import { chatCopyText } from './chatTranscript'
import { chatIntro, CHAT_IMAGES_PER_CHAT, CHAT_IMAGES_PER_MESSAGE, CHAT_TEXT_MAX, joinSpoken, voiceTagOf } from './chatRules'
import { useAskAi, useChatPhoto, useConversations, useDeleteChat, useRestoreChat } from './useAskAi'
import { useSpeechInput, useVoiceLanguage } from './useSpeechInput'
import type { ConversationListItem } from './chatApi'

// Ask AI: the chat on Claude. A drawer on wide screens, a bottom sheet on phones. The answer streams in; what it looked up
// is shown as it happens; rows it cites are links to your own rows; a write it proposes is a card you confirm. Phase 4b adds
// photos (shrunk here, kept in the chat), a microphone that fills the box, and the coach chat that Training → Coach opens.

export function AskAIPanel() {
  const open = useUIStore(s => s.isAIOpen)
  const close = useUIStore(s => s.closeAI)
  const phone = useBreakpoint() === 'phone'
  const chat = useAskAi()
  const qc = useQueryClient()
  const del = useDeleteChat()
  const restore = useRestoreChat()
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [input, setInput] = useState('')
  const [photos, setPhotos] = useState<PhotoInput[]>([])
  const photo = useChatPhoto()
  const typedBeforeSpeech = useRef('')
  const [voiceLanguage, setVoiceLanguage] = useVoiceLanguage()
  const speech = useSpeechInput(spoken => setInput(joinSpoken(typedBeforeSpeech.current, spoken).slice(0, CHAT_TEXT_MAX)), voiceTagOf(voiceLanguage))
  const boxRef = useRef<HTMLTextAreaElement>(null)
  // The box grows with the words and shrinks back to one line when they are sent or cleared.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.height = 'auto'
    if (input !== '') el.style.height = `${el.scrollHeight}px`
  }, [input])
  // Training → Coach asks for a coach chat: one is started unless the chat on screen already is one.
  const request = useUIStore(s => s.aiRequest)
  const handledRequest = useRef(request?.n ?? 0)
  const { newChat, mode } = chat
  useEffect(() => {
    if (!request || request.n === handledRequest.current) return
    handledRequest.current = request.n
    if (mode !== 'coach') newChat('coach')
    setView('chat')
  }, [request, mode, newChat])
  const conversations = useConversations(open && view === 'history')
  const { inset, visibleHeight } = useKeyboardInset(open)
  const { scrollRef, atBottom, onScroll, scrollToBottom } = useStickToBottom([chat.turns, chat.busy])
  // Report: the whole chat (null) or one answer (its key, marked in the draft) straight into the Dev Requests window.
  const report = (answerKey: string | null) => { openChatReport({ turns: chat.turns, chatId: chat.conversationId, answerKey, closeAI: close }) }
  // Why text could not be selected on the iPhone: Headless UI's scroll lock (Dialog, iOS only) listens on the document and
  // cancels every touchmove that is not inside a scroll area that can scroll right now — a short chat, a card, a bubble —
  // and a cancelled touch also stops iOS's own text gestures (select, drag the handles, the Copy menu). Touches inside the
  // chat stop here, before they reach that listener; the chat area contains its own overscroll (`scroll-y`), and the
  // document behind never scrolls in this app (the shell's main is the scroller), so nothing behind moves.
  const [chatBody, setChatBody] = useState<HTMLDivElement | null>(null)
  const setChatArea = (el: HTMLDivElement | null) => { scrollRef.current = el; setChatBody(el) }
  useEffect(() => {
    if (!chatBody) return
    const keep = (e: TouchEvent) => e.stopPropagation()
    chatBody.addEventListener('touchmove', keep, { passive: true })
    return () => chatBody.removeEventListener('touchmove', keep)
  }, [chatBody])
  // What a chat has: a started chat shows what it began with (frozen); a new one shows what it WILL begin with, from Settings now.
  const about = useClaudeDescribe()
  const toolRows = useToolSettings()
  const words = useChatInstructions()
  const savedSettings = useAiSettings()
  const keptDays = typeof savedSettings.data?.log_days === 'number' ? savedSettings.data.log_days : 30
  const plannedTools = useMemo(() => {
    if (!about.data || !toolRows.isSuccess) return null
    const modes = chatToolModes(about.data.chat.tools, toolRows.data)
    return about.data.chat.tools.filter(t => t.chats.includes(chat.mode) && modes[t.name] !== 'off').map(t => t.name)
  }, [about.data, toolRows.isSuccess, toolRows.data, chat.mode])
  const activeTools = chat.setup ? chat.setup.toolNames : plannedTools
  const intro = activeTools ? chatIntro(chat.mode, activeTools) : null
  const photosInChat = chat.turns.reduce((n, t) => n + t.photos, 0)
  const photoRoom = Math.min(CHAT_IMAGES_PER_MESSAGE - photos.length, CHAT_IMAGES_PER_CHAT - photosInChat - photos.length)
  const photoWhy = photoRoom > 0 ? null : photos.length >= CHAT_IMAGES_PER_MESSAGE ? `At most ${CHAT_IMAGES_PER_MESSAGE} photos in a message` : `A chat holds at most ${CHAT_IMAGES_PER_CHAT} photos: start a new chat`
  const coach = chat.mode === 'coach'
  // The sheet lifts above the on-screen keyboard (iOS does not shrink the layout viewport).
  const phoneStyle = inset > 0 ? { bottom: inset, height: Math.min(visibleHeight - 8, window.innerHeight * 0.88) } : undefined

  const send = (text: string) => {
    if (!text.trim() || chat.busy || chat.wall === 'full') return
    speech.stop()
    const sentPhotos = photos
    setInput('')
    setPhotos([])
    setView('chat')
    void chat.send(text, sentPhotos).then(r => { if (r === 'wall') { setInput(text); setPhotos(sentPhotos) } })
  }
  const retry = () => { void chat.retry() }
  // After a refusal the same words would be refused again: the question comes back into the box to be changed.
  const editQuestion = () => { const q = chat.editLast(); if (q !== null) setInput(q) }
  // The delete flow: asks, deletes (softly: the function keeps the chat for 7 days), says "Chat deleted · Undo".
  const deleteChat = async (item: ConversationListItem) => {
    const outcome = await confirmDelete({
      title: 'Delete this chat?', message: `"${item.title}" and its answers leave your list.`,
      remove: () => del.mutateAsync(item.id), restore: s => restore.mutateAsync(s.id).then(() => undefined), done: 'Chat deleted', restored: 'Chat restored',
    })
    if (outcome === 'deleted' && item.id === chat.conversationId) chat.newChat(chat.mode)
    void qc.invalidateQueries({ queryKey: ['ai-chat', 'conversations'] })
  }
  const empty = chat.turns.length === 0
  const failedLast = !chat.busy && chat.turns.length > 0 && chat.turns[chat.turns.length - 1].error !== null
  // What was typed stays: starting a new chat is often the way out of a full one, with the question still to ask.
  const startNew = () => { chat.newChat(chat.mode); setPhotos([]); setView('chat') }

  return (
    <SideDrawer
      open={open}
      onClose={close}
      phoneStyle={phoneStyle}
      title={<span className="inline-flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-control bg-accent-500 text-on-accent"><Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden /></span>{view === 'history' ? 'Chats' : coach ? 'Coach' : 'Ask AI'}</span>}
      headerActions={(
        <>
          <IconButton label={view === 'history' ? 'Back to the chat' : 'Your chats'} aria-pressed={view === 'history'} onClick={() => setView(v => (v === 'history' ? 'chat' : 'history'))}><History strokeWidth={1.9} aria-hidden /></IconButton>
          <IconButton label="New chat" onClick={startNew} disabled={empty && view === 'chat'}><MessageSquarePlus strokeWidth={1.9} aria-hidden /></IconButton>
          {view === 'chat' && (
            <>
              <IconButton label="Copy chat (the whole conversation as text)" onClick={() => copyText(chatCopyText(chat.turns, chat.conversationId))} disabled={empty}><Copy strokeWidth={1.9} aria-hidden /></IconButton>
              <IconButton label="Report this chat (a Dev Request draft)" onClick={() => report(null)} disabled={empty || chat.busy}><Flag strokeWidth={1.9} aria-hidden /></IconButton>
            </>
          )}
        </>
      )}
    >
      {view === 'history' ? (
        <div className="scroll-y min-h-0 flex-1 overflow-y-auto">
          <ChatHistory items={conversations.data ?? []} loading={conversations.isLoading} activeId={chat.conversationId}
            onOpen={id => { void chat.open(id).then(() => setView('chat')) }} onNew={startNew} onDelete={item => { void deleteChat(item) }} />
        </div>
      ) : (
        <>
          {/* The chat and its "Newest" button share one box, so the button sits at the chat's own bottom edge — never over the
              message box (sideways on a phone, the box is taller than the old fixed offset and the button covered Send). */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={setChatArea} onScroll={onScroll} className="scroll-y relative min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">
            {empty && chat.wall !== 'full' && (
              <div className="py-2">
                {activeTools && <div className="mb-2"><ChatSetupNote mode={chat.mode} toolNames={activeTools} ownerInstructions={chat.setup ? chat.setup.ownerInstructions : words.data ?? ''} planned={!chat.setup} /></div>}
                {intro && <p className="mb-3 text-body text-fg-muted">{intro.text}</p>}
                <div className="flex flex-col gap-2">
                  {(intro?.suggestions ?? []).map(s => (
                    <button key={s} type="button" onClick={() => send(s)} className="w-full rounded-row border border-line bg-surface-2 px-3 py-2.5 text-left text-body text-fg-2 transition-colors [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {!empty && chat.setup && <ChatSetupNote mode={chat.setup.mode} toolNames={chat.setup.toolNames} ownerInstructions={chat.setup.ownerInstructions} planned={false} />}
            {chat.turns.map(t => <ChatTurnView key={t.key} turn={t} onDecide={(id, d, edits) => { void chat.decide(id, d, edits) }} onUndo={id => { void chat.undo(id) }} onReport={report} reportOff={chat.busy} />)}
            {failedLast && chat.lastText && (
              <div className="flex justify-start gap-2">
                {chat.turns[chat.turns.length - 1].errorReason === 'declined'
                  ? <Button size="sm" onClick={editQuestion}>Edit your question</Button>
                  : <Button size="sm" onClick={retry}>Try again</Button>}
              </div>
            )}
          </div>
          {!atBottom && !empty && (
            <button type="button" onClick={() => scrollToBottom('smooth')} aria-label="Newest message" title="Newest message"
              className="absolute bottom-3 right-4 z-10 flex items-center gap-1 rounded-full border border-line-strong bg-surface px-3 py-2 text-meta font-semibold text-fg-2 shadow-float">
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />Newest
            </button>
          )}
          </div>
          <div className="shrink-0 border-t border-line px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 md:pb-3 [@media(max-height:500px)]:pb-[calc(0.5rem+env(safe-area-inset-bottom))] [@media(max-height:500px)]:pt-2">
            {chat.wall !== 'ok' && (
              <div data-tone="warn" className="tone-soft mb-2 flex items-center gap-2 rounded-row py-1.5 pl-3 pr-1.5 text-body">
                <span className="tone-text min-w-0 flex-1 py-1">{chat.wall === 'full' ? 'This chat is full. Start a new chat to keep going.' : 'This chat is getting long. A new chat answers faster and cheaper.'}</span>
                <Button size="sm" variant={chat.wall === 'full' ? 'primary' : 'secondary'} onClick={startNew}>New chat</Button>
              </div>
            )}
            <PhotoStrip photos={photos} onRemove={i => setPhotos(list => list.filter((_, at) => at !== i))} firstInChat={photosInChat === 0} days={keptDays} />
            {speech.problem && <p role="alert" data-tone="warn" className="tone-text mb-1.5 text-meta">{speech.problem}</p>}
            {/* A phone held sideways (a short screen): photo and voice sit beside the box, so the chat keeps its few lines. */}
            <div className="flex flex-col [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:items-end [@media(max-height:500px)]:gap-1">
            <div className="flex min-w-0 items-end gap-2 [@media(max-height:500px)]:flex-1">
              <textarea
                ref={boxRef}
                data-autofocus
                value={input}
                onChange={e => setInput(e.target.value.slice(0, CHAT_TEXT_MAX))}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !phone) { e.preventDefault(); send(input) } }}
                placeholder={chat.wall === 'full' ? 'Start a new chat to ask more' : photos.length ? 'Say what to look at…' : coach ? 'Ask your coach…' : 'Ask anything…'}
                aria-label="Message"
                rows={1}
                disabled={chat.wall === 'full'}
                className="input max-h-32 flex-1 resize-none py-2.5 disabled:opacity-50"
              />
              {chat.busy ? (
                <button type="button" onClick={chat.stop} aria-label="Stop" className="btn-secondary h-11 w-11 shrink-0 !px-0"><Square className="h-[16px] w-[16px]" aria-hidden /></button>
              ) : (
                <button type="button" onClick={() => send(input)} disabled={!input.trim() || chat.wall === 'full'} aria-label="Send" className="btn-primary h-11 w-11 shrink-0 !px-0 disabled:opacity-40">
                  <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                </button>
              )}
            </div>
            {/* Photo and voice sit under the box, so the words keep the full width on a phone. */}
            <div className="mt-1 flex items-center gap-1 [@media(max-height:500px)]:order-first [@media(max-height:500px)]:mt-0">
              <AttachPhoto onFile={f => { void photo.mutateAsync(f).then(p => setPhotos(list => (list.length < CHAT_IMAGES_PER_MESSAGE ? [...list, p] : list)), () => undefined) }}
                loading={photo.isPending} disabled={photoRoom <= 0 || chat.busy || chat.wall === 'full'} why={photoWhy} />
              {speech.supported && <MicButton listening={speech.listening} language={voiceLanguage} onLanguage={setVoiceLanguage} disabled={chat.busy || chat.wall === 'full'} onToggle={() => { if (!speech.listening) typedBeforeSpeech.current = input; speech.toggle() }} />}
            </div>
            </div>
            {/* Only where Enter sends (a phone's Enter is a new line). */}
            {!phone && <p className="mt-1.5 hidden text-micro text-fg-faint md:block">Enter to send · Shift+Enter for a new line</p>}
          </div>
        </>
      )}
    </SideDrawer>
  )
}
