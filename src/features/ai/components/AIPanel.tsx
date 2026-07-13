import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useUIStore } from '../../../app/store'
import { sendMessage } from '../api/aiApi'
import type { Message } from '../api/aiApi'

const STORAGE_KEY = 'lasci-ai-chat'

// Minimal markdown → JSX: the model wraps emphasis in **bold**, which was
// rendering as literal asterisks since message content went straight to
// text. No markdown library needed for just this.
function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.+?\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  )
}

// Chat messages carry an optional activity trace (tool calls the AI ran),
// shown behind a "Show detail" link. The extra field is ignored by the backend.
interface ChatMessage extends Message { steps?: string[] }

const SUGGESTIONS = [
  'What should I focus on today?',
  'Help me prioritize my tasks',
  'Suggest a schedule for my day',
  'What movies should I watch next?',
]

export function AIPanel() {
  const { isAIOpen, closeAI } = useUIStore()
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as ChatMessage[] : [] }
    catch { return [] }
  })
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [detailSteps, setDetailSteps] = useState<string[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isAIOpen) inputRef.current?.focus()
  }, [isAIOpen])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Persist the conversation so it survives a page refresh.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)) } catch { /* quota */ }
  }, [messages])

  async function handleSend(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg: ChatMessage = { role: 'user', content: trimmed }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const reply = await sendMessage(next)
      setMessages(m => [...m, { role: 'assistant', content: reply.text, steps: reply.steps }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(input)
    }
  }

  return (
    <>
      {isAIOpen && (
        <div className="fixed inset-0 z-40 bg-ink-900/10" onClick={closeAI} />
      )}

      <div
        className={[
          'fixed z-50 bg-cream-50 flex flex-col border-ink-200',
          'bottom-0 left-0 right-0 h-[80vh] rounded-t-2xl border-t',
          'lg:left-auto lg:right-0 lg:top-14 lg:h-auto lg:bottom-0 lg:w-[420px] lg:rounded-none lg:border-t-0 lg:border-l',
          isAIOpen
            ? 'translate-y-0 lg:translate-x-0'
            : 'translate-y-full lg:translate-y-0 lg:translate-x-full',
          'transition-transform duration-200',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-accent-500 rounded-md flex items-center justify-center text-white text-[10px] font-bold">✦</div>
            <h2 className="text-sm font-semibold text-ink-800">Ask AI</h2>
            <span className="text-[10px] bg-green-50 text-green-600 border border-green-200 px-1.5 py-0.5 rounded-full font-medium">Gemini</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setError(null); try { localStorage.removeItem(STORAGE_KEY) } catch { /* */ } }}
                className="text-[11px] text-ink-400 hover:text-ink-600 min-h-[44px] px-2 py-1 rounded transition-colors duration-150"
              >
                Clear
              </button>
            )}
            <button
              onClick={closeAI}
              className="w-11 h-11 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none rounded"
            >
              ×
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
          {messages.length === 0 && !loading && (
            <div>
              <p className="text-sm text-ink-400 mb-4">What can I help you with?</p>
              <div className="space-y-2">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="w-full text-left text-sm px-3 py-2 min-h-[44px] rounded-lg bg-cream-100 hover:bg-cream-200 text-ink-700 transition-colors duration-150"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-accent-500 text-white rounded-br-sm'
                      : 'bg-cream-100 text-ink-800 rounded-bl-sm'
                  }`}
                >
                  {renderMarkdown(msg.content)}
                </div>
                {msg.role === 'assistant' && msg.steps && msg.steps.length > 0 && (
                  <button
                    onClick={() => setDetailSteps(msg.steps!)}
                    className="text-[11px] text-accent-600 hover:text-accent-700 underline underline-offset-2 px-1 min-h-[28px]"
                  >
                    Show detail ({msg.steps.length})
                  </button>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-cream-100 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-ink-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-ink-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-ink-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-ink-100 flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything… (Enter to send)"
              rows={1}
              className="flex-1 resize-none input text-sm py-2 max-h-32"
              style={{ height: 'auto' }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = `${t.scrollHeight}px`
              }}
            />
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-11 h-11 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 text-white rounded-lg flex items-center justify-center transition-colors duration-150"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 8L2 2l2 6-2 6 12-6z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-ink-300 mt-1.5">Shift+Enter for new line</p>
        </div>
      </div>

      {/* Activity-trace detail modal — what the AI did behind the scenes */}
      <Dialog open={detailSteps !== null} onClose={() => setDetailSteps(null)} className="relative z-[60]">
        <DialogBackdrop className="fixed inset-0 bg-ink-900/30" />
        <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <DialogPanel className="w-full sm:max-w-md max-h-[80vh] overflow-y-auto bg-cream-50 rounded-t-2xl sm:rounded-2xl border border-ink-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 sticky top-0 bg-cream-50">
              <h3 className="text-sm font-semibold text-ink-800">AI activity</h3>
              <button onClick={() => setDetailSteps(null)} className="w-9 h-9 flex items-center justify-center text-ink-400 hover:text-ink-700 text-lg">×</button>
            </div>
            <div className="px-4 py-3 space-y-1.5">
              {(detailSteps ?? []).map((s, i) => (
                <div key={i} className="text-xs font-mono text-ink-700 bg-cream-50 border border-ink-100 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words">
                  {s}
                </div>
              ))}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
