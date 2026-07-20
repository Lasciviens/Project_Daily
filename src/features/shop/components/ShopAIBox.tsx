import { useState, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sendShopMessage } from '../../ai/api/aiApi'
import type { Message } from '../../ai/api/aiApi'
import { toast } from '../../../app/store'

interface ThreadEntry extends Message {
  replies?: string[]
}

/**
 * Shop chat panel — fixed-height two-pane layout (see ShopPage): this is the
 * left pane. Scoped to shopping conversation/categorization via
 * sendShopMessage/SHOP_SYSTEM_PROMPT, separate from the app-wide Ask AI panel.
 * Renders ask_clarifying_question's options as tappable buttons (real Gemini
 * function call, not a text-parsed convention) so common yes/no/pick-one
 * answers are a tap, not a retype.
 */
export function ShopAIBox() {
  const [thread, setThread]   = useState<ThreadEntry[]>([])
  const [input,  setInput]    = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [thread])

  async function send(text: string) {
    if (!text.trim() || sending) return
    const next: Message[] = [...thread.map(({ replies, ...m }) => m), { role: 'user', content: text.trim() }]
    setThread(prev => [...prev, { role: 'user', content: text.trim() }])
    setInput('')
    setSending(true)
    try {
      const res = await sendShopMessage(next)
      setThread(prev => [...prev, { role: 'assistant', content: res.text, replies: res.quickReplies }])
      qc.invalidateQueries({ queryKey: ['shop'] })
    } catch (err) {
      toast.error((err as Error).message ?? 'AI request failed')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function reset() {
    setThread([]); setInput('')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 flex-shrink-0">
        <p className="text-sm font-semibold text-accent-700">✦ Shopping Assistant</p>
        {thread.length > 0 && (
          <button onClick={reset} className="text-[11px] text-ink-400 hover:text-ink-600 min-h-[44px] px-2">Clear</button>
        )}
      </div>

      {/* Message list — the only scrollable area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {thread.length === 0 && (
          <p className="text-xs text-ink-400 leading-relaxed">
            Ne almayı planladığını anlat — tek bir ürün olabilir, düşündüğün bir şey olabilir,
            ya da bütün bir alışveriş listesi. Kategori konusunda emin olmazsam
            sana seçenek sunarak soracağım.
          </p>
        )}
        {thread.map((m, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`text-sm px-3 py-2 rounded-xl max-w-[92%] whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-accent-500 text-white' : 'bg-cream-100 text-ink-800'
              }`}
            >
              {m.content}
            </div>
            {!!m.replies?.length && (
              <div className="flex flex-wrap gap-1.5 max-w-[92%]">
                {m.replies.map(r => (
                  <button
                    key={r}
                    onClick={() => send(r)}
                    disabled={sending}
                    className="text-xs px-3 min-h-[44px] rounded-full border border-accent-300 text-accent-700 bg-cream-50 hover:bg-accent-50 transition-colors disabled:opacity-50"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <p className="text-xs text-ink-300">…</p>}
      </div>

      {/* Input — pinned at the bottom, never scrolls away */}
      <div className="flex items-center gap-2 px-3 py-3 border-t border-ink-100 flex-shrink-0">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input) }}
          placeholder="Mesaj yaz…"
          disabled={sending}
          className="flex-1 min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
        />
        <button
          onClick={() => send(input)}
          disabled={sending || !input.trim()}
          className="min-h-[44px] px-4 bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50 flex-shrink-0"
        >
          {sending ? '…' : 'Gönder'}
        </button>
      </div>
    </div>
  )
}
