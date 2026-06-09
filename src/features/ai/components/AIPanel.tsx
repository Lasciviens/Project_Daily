import { useState, useRef, useEffect, useCallback } from 'react'
import { useUIStore } from '../../../app/store'
import { sendMessage, getDailyUsage, RateLimitError, AINotConfiguredError, AIAuthError } from '../api/aiApi'
import type { Message, DailyUsage } from '../api/aiApi'

const SUGGESTIONS = [
  'What should I focus on today?',
  'Help me prioritize my tasks',
  'Suggest a schedule for my day',
  'What movies should I watch next?',
]

// ─── Usage bar ────────────────────────────────────────────────────────────────

function UsageBar({ usage }: { usage: DailyUsage }) {
  const pct  = Math.min(usage.count / usage.limit, 1)
  const left = Math.max(usage.limit - usage.count, 0)
  const color = pct >= 1 ? 'bg-red-400' : pct >= 0.75 ? 'bg-orange-400' : 'bg-green-400'

  return (
    <div className="flex items-center gap-1.5" title={`${usage.count}/${usage.limit} requests today`}>
      <div className="w-16 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-[9px] text-ink-400 tabular-nums">{left} left</span>
    </div>
  )
}

// ─── Error banners ────────────────────────────────────────────────────────────

function RateLimitBanner({ err }: { err: RateLimitError }) {
  const [countdown, setCountdown] = useState(err.retryAfterSec)

  useEffect(() => {
    if (countdown <= 0) return
    const id = setInterval(() => setCountdown(s => Math.max(s - 1, 0)), 1000)
    return () => clearInterval(id)
  }, [countdown])

  return (
    <div className="text-xs bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 space-y-1.5">
      <p className="font-semibold text-orange-700">Günlük limit doldu ({err.dailyLimit}/{err.dailyLimit})</p>
      <p className="text-orange-600">
        {countdown > 0
          ? `${countdown}s sonra tekrar dene — veya yarın sıfırlanır.`
          : 'Tekrar deneyebilirsin.'}
      </p>
      <p className="text-orange-500">
        Limiti kaldırmak için{' '}
        <a
          href="https://aistudio.google.com"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Google AI Studio
        </a>
        {' '}→ Billing'e kart ekle (~$0.10–$1/ay).
      </p>
    </div>
  )
}

function ConfigErrorBanner() {
  return (
    <div className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5 space-y-1">
      <p className="font-semibold text-yellow-700">AI yapılandırılmamış</p>
      <p className="text-yellow-600">
        Supabase Dashboard → Edge Functions → Secrets içine{' '}
        <code className="bg-yellow-100 px-1 rounded">GEMINI_API_KEY</code> ekle.
      </p>
    </div>
  )
}

function AuthErrorBanner() {
  return (
    <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
      <p className="font-semibold text-red-700">Oturum hatası</p>
      <p className="text-red-600">Sayfayı yenile ve tekrar giriş yap.</p>
    </div>
  )
}

function GenericErrorBanner({ message }: { message: string }) {
  return (
    <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      {message}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

type AppError = RateLimitError | AINotConfiguredError | AIAuthError | Error | null

export function AIPanel() {
  const { isAIOpen, closeAI } = useUIStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [appError, setAppError] = useState<AppError>(null)
  const [usage,    setUsage]    = useState<DailyUsage>(() => getDailyUsage())
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isAIOpen) {
      inputRef.current?.focus()
      setUsage(getDailyUsage())
    }
  }, [isAIOpen])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg: Message = { role: 'user', content: trimmed }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setLoading(true)
    setAppError(null)

    try {
      const reply = await sendMessage(next)
      setMessages(m => [...m, { role: 'assistant', content: reply }])
      setUsage(getDailyUsage())
    } catch (err) {
      setAppError(err instanceof Error ? err : new Error('Something went wrong'))
    } finally {
      setLoading(false)
    }
  }, [messages, loading])

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(input)
    }
  }

  const isRateLimited = appError instanceof RateLimitError

  return (
    <>
      {isAIOpen && (
        <div className="fixed inset-0 z-40 bg-ink-900/10" onClick={closeAI} />
      )}

      <div
        className={[
          'fixed z-50 bg-white flex flex-col border-ink-200',
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
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 bg-accent-500 rounded-md flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">✦</div>
            <h2 className="text-sm font-semibold text-ink-800">Ask AI</h2>
            <span className="text-[10px] bg-green-50 text-green-600 border border-green-200 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">Gemini</span>
            <UsageBar usage={usage} />
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setAppError(null) }}
                className="text-[11px] text-ink-400 hover:text-ink-600 px-2 py-1 rounded transition-colors duration-150"
              >
                Clear
              </button>
            )}
            <button
              onClick={closeAI}
              className="w-6 h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none rounded"
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
                    className="w-full text-left text-sm px-3 py-2 rounded-lg bg-cream-100 hover:bg-cream-200 text-ink-700 transition-colors duration-150"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-accent-500 text-white rounded-br-sm'
                    : 'bg-cream-100 text-ink-800 rounded-bl-sm'
                }`}
              >
                {msg.content}
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

          {appError instanceof RateLimitError      && <RateLimitBanner err={appError} />}
          {appError instanceof AINotConfiguredError && <ConfigErrorBanner />}
          {appError instanceof AIAuthError          && <AuthErrorBanner />}
          {appError && !(appError instanceof RateLimitError) && !(appError instanceof AINotConfiguredError) && !(appError instanceof AIAuthError) && (
            <GenericErrorBanner message={appError.message} />
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
              placeholder={isRateLimited ? 'Günlük limit doldu…' : 'Ask anything… (Enter to send)'}
              rows={1}
              disabled={isRateLimited}
              className="flex-1 resize-none input text-sm py-2 max-h-32 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ height: 'auto' }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = `${t.scrollHeight}px`
              }}
            />
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || loading || isRateLimited}
              className="flex-shrink-0 w-9 h-9 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 text-white rounded-lg flex items-center justify-center transition-colors duration-150"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 8L2 2l2 6-2 6 12-6z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-ink-300 mt-1.5">Shift+Enter for new line</p>
        </div>
      </div>
    </>
  )
}
