import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../../app/store'
import { sendMessage, sendCoachMessage, AI_MODEL_OPTIONS } from '../api/aiApi'
import type { Message, AIModel } from '../api/aiApi'

// The AI performs real DB writes server-side (ai-proxy's db_insert/update/
// delete + create_task/plan_media/etc.), but the panel had NO cache
// invalidation — so "add a task", "schedule a workout", "create this recipe"
// succeeded in the DB yet nothing on screen updated until a full reload. After
// every completed turn we refresh every namespace the AI can write to. (Broad
// invalidation is cheap: TanStack only refetches queries that are actually
// mounted; keys that don't exist are no-ops.)
const AI_WRITE_NAMESPACES = [
  ['tasks'], ['schedule'], ['calendar'],
  ['recipes'], ['meal-plan'], ['recipe-ingredient-library'],
  ['shop'], ['projects'], ['movies'], ['tv'], ['media'],
]

const STORAGE_KEY = 'lasci-ai-chat'
const MODEL_KEY    = 'lasci-ai-model'

function readStoredModel(): AIModel {
  try {
    const raw = localStorage.getItem(MODEL_KEY)
    return (AI_MODEL_OPTIONS.some(o => o.id === raw) ? raw : 'auto') as AIModel
  } catch { return 'auto' }
}

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
interface ChatMessage extends Message { steps?: string[]; model?: string }

const SUGGESTIONS = [
  'What should I focus on today?',
  'Help me prioritize my tasks',
  'Suggest a schedule for my day',
  'What movies should I watch next?',
]

const COACH_SUGGESTIONS = [
  'Son 30 günümü değerlendir — nerede iyiyim, nerede kötüyüm?',
  'Programımı incele: hangi kaslar eksik kalıyor?',
  'Bu haftaki beslenmem ve kilom hedefe uygun mu?',
  'Back Day rutinimde ne değiştirirdin?',
]

export function AIPanel() {
  const { isAIOpen, closeAI } = useUIStore()
  const qc = useQueryClient()
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as ChatMessage[] : [] }
    catch { return [] }
  })
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [detailSteps, setDetailSteps] = useState<string[] | null>(null)
  const [model,       setModel]       = useState<AIModel>(readStoredModel)
  // Coach mode: replaces the generic assistant persona+context with the
  // blunt PT persona + a prepared 30-day training/health/nutrition JSON.
  const [coachMode,   setCoachMode]   = useState(false)
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

  function pickModel(next: AIModel) {
    setModel(next)
    try { localStorage.setItem(MODEL_KEY, next) } catch { /* quota */ }
  }

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
      const reply = await (coachMode ? sendCoachMessage(next, model) : sendMessage(next, model))
      setMessages(m => [...m, { role: 'assistant', content: reply.text, steps: reply.steps, model: reply.model }])
      // The turn may have written to the DB — refresh every AI-writable view.
      for (const key of AI_WRITE_NAMESPACES) qc.invalidateQueries({ queryKey: key })
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
        <div className="fixed inset-0 z-40 bg-ink-950/10" onClick={closeAI} />
      )}

      <div
        className={[
          'fixed z-50 bg-cream-50 flex flex-col border-ink-200',
          'bottom-0 left-0 right-0 h-[88vh] rounded-t-2xl border-t',
          'lg:left-auto lg:right-0 lg:top-14 lg:h-auto lg:bottom-0 lg:w-[520px] xl:w-[620px] lg:rounded-none lg:border-t-0 lg:border-l',
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
            {/* Model picker: "Auto" (default) lets the server's 4-model
                fallback chain pick whichever has capacity; picking one
                explicitly still falls back to the others on a 503 — this
                only sets which model the chain tries FIRST. */}
            <Listbox value={model} onChange={pickModel}>
              <div className="relative">
                <ListboxButton className="flex items-center gap-1 text-[10px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full font-medium hover:bg-green-100 transition-colors min-h-[24px]">
                  {AI_MODEL_OPTIONS.find(o => o.id === model)?.label ?? 'Auto'}
                  <span className="opacity-60">▾</span>
                </ListboxButton>
                <ListboxOptions anchor="bottom start" className="z-50 mt-1 w-56 rounded-lg border border-ink-200 bg-cream-50 shadow-lg py-1 text-xs">
                  {AI_MODEL_OPTIONS.map(o => (
                    <ListboxOption
                      key={o.id}
                      value={o.id}
                      className="px-3 py-2 cursor-pointer data-[focus]:bg-cream-100 min-h-[44px] flex flex-col justify-center"
                    >
                      <span className="font-medium text-ink-800">{o.label}</span>
                      <span className="text-[10px] text-ink-400">{o.hint}</span>
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>
            {/* Coach mode — blunt PT persona over a prepared 30-day
                training/health/nutrition JSON (see sendCoachMessage). */}
            <button
              onClick={() => setCoachMode(v => !v)}
              title="Koç modu: PT kimliği + son 30 günün antrenman/uyku/kilo/nutrition verisi hazır bağlam olarak"
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border transition-colors min-h-[24px] ${
                coachMode
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-cream-100 text-ink-500 border-ink-200 hover:border-orange-300'
              }`}
            >
              🏋️ Koç
            </button>
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
                {(coachMode ? COACH_SUGGESTIONS : SUGGESTIONS).map(s => (
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
                {msg.role === 'assistant' && (msg.model || (msg.steps && msg.steps.length > 0)) && (
                  <div className="flex items-center gap-2 px-1">
                    {/* Which model ACTUALLY answered — the fallback chain can
                        land somewhere other than the picked/preferred model,
                        and the user wants to see where it landed. */}
                    {msg.model && (
                      <span className="text-[10px] text-ink-300">{msg.model.replace('gemini-', '')}</span>
                    )}
                    {msg.steps && msg.steps.length > 0 && (
                      <button
                        onClick={() => setDetailSteps(msg.steps!)}
                        className="text-[11px] text-accent-600 hover:text-accent-700 underline underline-offset-2 min-h-[28px]"
                      >
                        Show detail ({msg.steps.length})
                      </button>
                    )}
                  </div>
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
        <DialogBackdrop className="fixed inset-0 bg-ink-950/30" />
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
