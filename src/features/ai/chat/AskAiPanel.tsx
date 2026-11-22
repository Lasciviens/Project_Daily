import { useState } from 'react'
import { ArrowDown, History, MessageSquarePlus, Sparkles, SendHorizontal, Square } from 'lucide-react'
import { useUIStore } from '../../../app/store'
import { SideDrawer } from '../../../shared/modals/SideDrawer'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { Button, IconButton } from '../../../shared/ui'
import { useKeyboardInset, useStickToBottom } from '../hooks/useChatViewport'
import { ChatHistory } from './ChatHistory'
import { ChatTurnView } from './ChatTurnView'
import { CHAT_TEXT_MAX } from './chatRules'
import { useAskAi, useConversations } from './useAskAi'

// Ask AI (phase 4a): the chat on Claude. A drawer on wide screens, a bottom sheet on phones. The answer streams in; what it
// looked up is shown as it happens; rows it cites are links to your own rows; a write it proposes is a card you confirm.
// Text only for now (photos, voice, the coach chat and your own instructions come in 4b).

const SUGGESTIONS = [
  'What is on my plan today?',
  'How is my week going so far?',
  'What have I eaten today against my targets?',
  'Find my tasks and notes about the dentist',
]

export function AskAIPanel() {
  const open = useUIStore(s => s.isAIOpen)
  const close = useUIStore(s => s.closeAI)
  const phone = useBreakpoint() === 'phone'
  const chat = useAskAi()
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [input, setInput] = useState('')
  const conversations = useConversations(open && view === 'history')
  const { inset, visibleHeight } = useKeyboardInset(open)
  const { scrollRef, atBottom, onScroll, scrollToBottom } = useStickToBottom([chat.turns, chat.busy])
  // The sheet lifts above the on-screen keyboard (iOS does not shrink the layout viewport).
  const phoneStyle = inset > 0 ? { bottom: inset, height: Math.min(visibleHeight - 8, window.innerHeight * 0.88) } : undefined

  const send = (text: string) => {
    if (!text.trim() || chat.busy || chat.wall === 'full') return
    setInput('')
    setView('chat')
    void chat.send(text)
  }
  const retry = () => { if (chat.lastText) { void chat.send(chat.lastText) } }
  const empty = chat.turns.length === 0
  const failedLast = !chat.busy && chat.turns.length > 0 && chat.turns[chat.turns.length - 1].error !== null
  const startNew = () => { chat.newChat(); setView('chat'); setInput('') }

  return (
    <SideDrawer
      open={open}
      onClose={close}
      phoneStyle={phoneStyle}
      title={<span className="inline-flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-control bg-accent-500 text-on-accent"><Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden /></span>{view === 'history' ? 'Chats' : 'Ask AI'}</span>}
      headerActions={(
        <>
          <IconButton label={view === 'history' ? 'Back to the chat' : 'Your chats'} aria-pressed={view === 'history'} onClick={() => setView(v => (v === 'history' ? 'chat' : 'history'))}><History strokeWidth={1.9} aria-hidden /></IconButton>
          <IconButton label="New chat" onClick={startNew} disabled={empty && view === 'chat'}><MessageSquarePlus strokeWidth={1.9} aria-hidden /></IconButton>
        </>
      )}
    >
      {view === 'history' ? (
        <div className="scroll-y min-h-0 flex-1 overflow-y-auto">
          <ChatHistory items={conversations.data ?? []} loading={conversations.isLoading} activeId={chat.conversationId}
            onOpen={id => { void chat.open(id).then(() => setView('chat')) }} onNew={startNew} />
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={onScroll} className="scroll-y relative min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
            {empty && (
              <div className="py-2">
                <p className="mb-3 text-body text-fg-muted">What can I look up for you? I can read your plan, week, food and notes, and propose a task or a food line for you to confirm.</p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map(s => (
                    <button key={s} type="button" onClick={() => send(s)} className="min-h-[44px] w-full rounded-row border border-line bg-surface-2 px-3 py-2 text-left text-body text-fg-2 transition-colors [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {chat.turns.map(t => <ChatTurnView key={t.key} turn={t} onDecide={(id, d) => { void chat.decide(id, d) }} />)}
            {failedLast && chat.lastText && (
              <div className="flex justify-start"><Button size="sm" onClick={retry}>Try again</Button></div>
            )}
          </div>
          {!atBottom && !empty && (
            <button type="button" onClick={() => scrollToBottom('smooth')} aria-label="Jump to newest message"
              className="absolute bottom-24 right-4 z-10 flex min-h-[44px] items-center gap-1 rounded-full border border-line-strong bg-surface px-3 text-meta font-semibold text-fg-2 shadow-float">
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />Newest
            </button>
          )}
          <div className="shrink-0 border-t border-line px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 md:pb-3">
            {chat.wall !== 'ok' && (
              <div data-tone="warn" className="tone-soft mb-2 flex items-center gap-2 rounded-row py-1.5 pl-3 pr-1.5 text-body">
                <span className="tone-text min-w-0 flex-1 py-1">{chat.wall === 'full' ? 'This chat is full. Start a new chat to keep going.' : 'This chat is getting long. A new chat answers faster and cheaper.'}</span>
                <Button size="sm" variant={chat.wall === 'full' ? 'primary' : 'secondary'} onClick={startNew}>New chat</Button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                data-autofocus
                value={input}
                onChange={e => setInput(e.target.value.slice(0, CHAT_TEXT_MAX))}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !phone) { e.preventDefault(); send(input) } }}
                placeholder={chat.wall === 'full' ? 'Start a new chat to ask more' : 'Ask anything…'}
                aria-label="Message"
                rows={1}
                disabled={chat.wall === 'full'}
                className="input max-h-32 flex-1 resize-none py-2.5 disabled:opacity-50"
                onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px` }}
              />
              {chat.busy ? (
                <button type="button" onClick={chat.stop} aria-label="Stop" className="btn-secondary h-11 w-11 shrink-0 !px-0"><Square className="h-[16px] w-[16px]" aria-hidden /></button>
              ) : (
                <button type="button" onClick={() => send(input)} disabled={!input.trim() || chat.wall === 'full'} aria-label="Send" className="btn-primary h-11 w-11 shrink-0 !px-0 disabled:opacity-40">
                  <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                </button>
              )}
            </div>
            <p className="mt-1.5 hidden text-micro text-fg-faint md:block">Enter to send · Shift+Enter for a new line</p>
          </div>
        </>
      )}
    </SideDrawer>
  )
}
