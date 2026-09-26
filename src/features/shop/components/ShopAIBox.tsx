import { useState, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SendHorizontal, Sparkles, X } from 'lucide-react'
import { sendShopMessage } from '../../ai/api/aiApi'
import type { Message } from '../../ai/api/aiApi'
import { toast } from '../../../app/store'
import { qk, invalidate } from '../../../shared/query'
import { Button, IconButton, cx } from '../../../shared/ui'

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
 *
 * `onClose` is supplied only when hosted in the mobile bottom-sheet (see
 * ShopPage) — it renders a dismiss button in the header. On desktop the box is
 * a permanent pane, so no close affordance is shown.
 */
export function ShopAIBox({ onClose }: { onClose?: () => void } = {}) {
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
    const next: Message[] = [...thread.map(({ role, content }) => ({ role, content })), { role: 'user', content: text.trim() }]
    setThread(prev => [...prev, { role: 'user', content: text.trim() }])
    setInput('')
    setSending(true)
    try {
      const res = await sendShopMessage(next)
      setThread(prev => [...prev, { role: 'assistant', content: res.text, replies: res.quickReplies }])
      // The assistant may have created categories or items.
      void invalidate(qc, qk.shop.all)
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line py-2 pl-4 pr-2">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600"><Sparkles className="h-4 w-4" /></span>
        <h2 className="flex-1 text-lead font-semibold text-fg">Shopping assistant</h2>
        {thread.length > 0 && <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>}
        {onClose && <IconButton label="Close" onClick={onClose}><X /></IconButton>}
      </header>

      {/* Message list — the only scrollable area */}
      <div ref={scrollRef} className="scroll-y flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
        {thread.length === 0 && (
          <p className="text-body leading-relaxed text-fg-muted">
            Tell me what you are planning to buy — a single item, something you
            are still thinking about, or a whole shopping list. If I am unsure
            which category it belongs to, I will ask and offer you options.
          </p>
        )}
        {thread.map((m, i) => (
          <div key={i} className={cx('flex flex-col gap-1.5', m.role === 'user' ? 'items-end' : 'items-start')}>
            <div className={cx(
              'max-w-[92%] whitespace-pre-wrap rounded-row px-3 py-2 text-body',
              m.role === 'user' ? 'bg-accent-500 text-on-accent' : 'bg-surface-2 text-fg',
            )}>
              {m.content}
            </div>
            {!!m.replies?.length && (
              <div className="flex max-w-[92%] flex-wrap gap-1.5">
                {m.replies.map(r => (
                  <button key={r} type="button" onClick={() => send(r)} disabled={sending}
                    className="min-h-[44px] rounded-full border border-accent-500/40 bg-surface px-3 text-body font-medium text-accent-600 transition-colors hover:bg-accent-50 disabled:opacity-50">
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-1 self-start rounded-row bg-surface-2 px-3 py-2.5" aria-label="Thinking">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-faint" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-faint [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-faint [animation-delay:300ms]" />
          </div>
        )}
      </div>

      {/* Input — pinned at the bottom, never scrolls away */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-3">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input) }}
          placeholder="Write a message"
          aria-label="Message the shopping assistant"
          disabled={sending}
          className="input flex-1 disabled:opacity-60"
        />
        <Button variant="primary" icon={<SendHorizontal />} onClick={() => send(input)} disabled={sending || !input.trim()} className="shrink-0">
          Send
        </Button>
      </div>
    </div>
  )
}
