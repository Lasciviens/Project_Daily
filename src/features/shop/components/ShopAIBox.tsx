import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sendShopMessage } from '../../ai/api/aiApi'
import type { Message } from '../../ai/api/aiApi'
import { toast } from '../../../app/store'

/**
 * Shop-page prompt box — separate from the app-wide ✦ Ask AI panel, scoped to
 * shopping categorization only (see SHOP_SYSTEM_PROMPT in aiApi.ts).
 * Keeps a short conversation so the AI can ask a clarifying question about
 * where to file an item and continue once the user replies.
 */
export function ShopAIBox() {
  const [thread, setThread]   = useState<Message[]>([])
  const [input,  setInput]    = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    const next: Message[] = [...thread, { role: 'user', content: text }]
    setThread(next)
    setInput('')
    setSending(true)
    try {
      const reply = await sendShopMessage(next)
      setThread([...next, { role: 'assistant', content: reply }])
      // Cheap and harmless — refresh so any created category/item shows up.
      qc.invalidateQueries({ queryKey: ['shop'] })
    } catch (err) {
      toast.error((err as Error).message ?? 'AI request failed')
      setThread(thread)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function reset() {
    setThread([]); setInput('')
  }

  return (
    <div className="rounded-xl border border-accent-200 bg-accent-50/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-accent-700">✦ What are you planning to buy?</p>
        {thread.length > 0 && (
          <button onClick={reset} className="text-[11px] text-ink-400 hover:text-ink-600 min-h-[28px]">Clear</button>
        )}
      </div>

      {thread.length > 0 && (
        <div className="flex flex-col gap-2 mb-3 max-h-56 overflow-y-auto">
          {thread.map((m, i) => (
            <div
              key={i}
              className={`text-sm px-3 py-2 rounded-xl max-w-[90%] ${
                m.role === 'user' ? 'bg-accent-500 text-white self-end' : 'bg-white border border-ink-200 text-ink-800 self-start'
              }`}
            >
              {m.content}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          placeholder='e.g. "PS5 kolu almayı planlıyorum, 500 TL civarı"'
          disabled={sending}
          className="flex-1 min-h-[44px] bg-white border border-ink-200 rounded-xl px-3 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="min-h-[44px] px-4 bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50"
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
