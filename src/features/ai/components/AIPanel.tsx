import { useState, useRef, useEffect } from 'react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Sparkles, ChevronDown, Dumbbell, Mic, Volume2, NotebookPen, Eraser, Camera, SendHorizontal, ArrowDown, X,
} from 'lucide-react'
import { useUIStore, toast } from '../../../app/store'
import { sendMessage, sendCoachMessage, AI_MODEL_OPTIONS } from '../api/aiApi'
import type { Message, AIModel } from '../api/aiApi'
import { useVoiceChat } from '../hooks/useVoiceChat'
import { useKeyboardInset, useStickToBottom } from '../hooks/useChatViewport'
import { fileToCompactDataUrl } from '../../../shared/utils/image'
import { SideDrawer } from '../../../shared/modals/SideDrawer'
import { ModalShell } from '../../../shared/modals'
import { invalidate } from '../../../shared/query'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { IconButton, cx } from '../../../shared/ui'

// The AI performs real DB writes server-side (ai-proxy's db_insert/update/
// delete + create_task/plan_media/etc.), so after every completed turn every
// view the assistant can write to is refreshed (the 'aiWrite' group). Broad
// invalidation is cheap: TanStack only refetches queries that are mounted.

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
  'Assess my last 30 days — where am I doing well, where badly?',
  'Review my program: which muscles are under-trained?',
  'Are this week\'s nutrition and bodyweight on track for my goal?',
  'What would you change in my Back Day routine?',
]

// One-tap "remember this" affordance for save_memory (aiApi.ts): a normal
// user-authored message down the SAME send path as any other turn, so the
// model's summary and its save_memory tool call land in the transcript like
// any other reply — nothing hidden. Text follows the voice-chat TR/EN chip
// (`voice.lang`), the one language setting this panel's chat content already
// has; the button chrome itself stays English per the project's UI-string rule.
const SUMMARIZE_AND_SAVE_EN = 'Summarize this conversation and save it to memory.'
const SUMMARIZE_AND_SAVE_TR = 'Bu konuşmayı özetle ve hafızaya kaydet.'

export function AIPanel() {
  const isAIOpen = useUIStore(s => s.isAIOpen)
  const closeAI = useUIStore(s => s.closeAI)
  const phone = useBreakpoint() === 'phone'
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
  // Attached photos (compact JPEG data URLs) sent with the next message —
  // Gemini reads them natively (meal/label photos etc.). Capped at 3.
  const [pendingImages, setPendingImages] = useState<string[]>([])
  // Hands-free voice chat: the reply is spoken aloud and the mic reopens when
  // it finishes, so speak → answer → speak again is one continuous loop.
  const [voiceMode, setVoiceMode] = useState(false)
  const [interim,   setInterim]   = useState('')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const fileRef   = useRef<HTMLInputElement>(null)
  // handleSend/voiceMode change every render; the speech handlers live outside
  // React's render cycle, so they read the latest value through refs.
  const sendRef      = useRef<(t: string) => void>(() => {})
  const voiceModeRef = useRef(false)

  const voice = useVoiceChat({
    onFinalTranscript: (text) => {
      // In voice mode a finished utterance IS the message; otherwise it just
      // dictates into the box so the user can edit before sending.
      if (voiceModeRef.current) sendRef.current(text)
      else setInput(prev => (prev.trim() ? prev.trim() + ' ' : '') + text)
    },
    onInterim: setInterim,
  })

  async function addImages(files: File[] | FileList | null) {
    if (!files?.length) return
    try {
      const urls = await Promise.all(Array.from(files).slice(0, 3).map(f => fileToCompactDataUrl(f)))
      setPendingImages(p => [...p, ...urls].slice(0, 3))
    } catch { toast.error('Could not read image') }
  }

  // Paste an image straight into the chat (copy a photo/screenshot → Cmd/Ctrl+V
  // on desktop, or the paste action on mobile) — attaches it like the 📷 button.
  function handlePaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
      .map(it => it.getAsFile())
      .filter((f): f is File => f != null)
    if (imgs.length) { e.preventDefault(); void addImages(imgs) }
  }

  // Lift the sheet above the on-screen keyboard (see useKeyboardInset) and keep
  // the newest message visible without hijacking a user who scrolled up.
  const { inset: kbInset, visibleHeight } = useKeyboardInset(isAIOpen)
  const { scrollRef, atBottom, onScroll, scrollToBottom } = useStickToBottom([messages, loading])

  // The drawer unmounts while closed; reopening lands on the newest message.
  useEffect(() => {
    if (!isAIOpen) return
    const id = requestAnimationFrame(() => scrollToBottom('auto'))
    return () => cancelAnimationFrame(id)
  }, [isAIOpen, scrollToBottom])

  // vh / bottom-0 measure the FULL screen on iOS even with the keyboard up —
  // that is what buried the input. Only when a keyboard is actually detected
  // (phones: the drawer is a bottom sheet there), drive the sheet from the
  // real visible viewport instead.
  const sheetStyle = kbInset > 0 && phone
    ? { bottom: kbInset, height: Math.max(260, visibleHeight - 24) }
    : undefined

  // When the keyboard opens the visible area shrinks under the last message —
  // snap to it so what you are replying to stays on screen.
  useEffect(() => {
    if (kbInset > 0) scrollToBottom('auto')
  }, [kbInset, scrollToBottom])

  // Persist the conversation so it survives a page refresh.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)) } catch { /* quota */ }
  }, [messages])

  // Refreshed every render (no dep array) so the speech callbacks above always
  // see the current conversation and voice-mode state. A closed panel counts as
  // voice-off, so the speak→listen loop can never continue behind the user.
  useEffect(() => {
    sendRef.current = (t: string) => { void handleSend(t) }
    voiceModeRef.current = voiceMode && isAIOpen
  })

  // Safety net for any close path that doesn't go through handleClose: stop the
  // hardware only (no setState — this is exactly the "sync an external system"
  // an effect is for). Depends on the two STABLE callbacks, not the `voice`
  // object, which is rebuilt every render and would re-run this endlessly.
  const { stopListening: voiceStop, cancelSpeak: voiceHush } = voice
  useEffect(() => {
    if (isAIOpen) return
    voiceStop()
    voiceHush()
  }, [isAIOpen, voiceStop, voiceHush])

  function handleClose() {
    voiceModeRef.current = false
    setVoiceMode(false)
    setInterim('')
    voiceStop()
    voiceHush()
    closeAI()
  }

  function toggleVoiceMode() {
    const next = !voiceMode
    setVoiceMode(next)
    voiceModeRef.current = next
    if (next) {
      // Must happen inside this tap: iOS only allows speech synthesis that a
      // real user gesture unlocked, and the reply is spoken much later.
      voice.primeAudio()
      if (voice.sttSupported) voice.startListening()
    } else {
      voice.cancelSpeak()
      voice.stopListening()
      setInterim('')
    }
  }

  function pickModel(next: AIModel) {
    setModel(next)
    try { localStorage.setItem(MODEL_KEY, next) } catch { /* quota */ }
  }

  async function handleSend(text: string) {
    const trimmed = text.trim()
    if ((!trimmed && !pendingImages.length) || loading) return

    const userMsg: ChatMessage = { role: 'user', content: trimmed, ...(pendingImages.length ? { images: pendingImages } : {}) }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setPendingImages([])
    setLoading(true)
    setError(null)

    try {
      const reply = await (coachMode ? sendCoachMessage(next, model) : sendMessage(next, model))
      setMessages(m => [...m, { role: 'assistant', content: reply.text, steps: reply.steps, model: reply.model }])
      // The turn may have written to the DB — refresh every AI-writable view.
      void invalidate(qc, 'aiWrite')
      // Voice mode: read the answer out, then hand the mic back for the next
      // turn. Re-checking the ref in the callback means switching voice off
      // mid-sentence ends the loop instead of reopening the mic.
      if (voiceModeRef.current && reply.text) {
        voice.speak(reply.text, () => { if (voiceModeRef.current) voice.startListening() })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // Resend the most recent user message after a failure, dropping the dead
  // turn so the conversation doesn't accumulate a stranded question.
  function retryLast() {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser || loading) return
    setMessages(m => {
      const idx = m.map(x => x.role).lastIndexOf('user')
      return idx >= 0 ? m.slice(0, idx) : m
    })
    setError(null)
    setTimeout(() => { void handleSend(lastUser.content) }, 0)
  }

  async function copyReply(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(c => (c === idx ? null : c)), 1500)
    } catch { toast.error('Could not copy') }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(input)
    }
  }

  const modelLabel = AI_MODEL_OPTIONS.find(o => o.id === model)?.label ?? 'Auto'

  const headerChips = (
    <div className="scroll-x flex items-center gap-2 px-4 pb-2.5 sm:px-5">
      {/* Model picker: "Auto" (default) lets the server's 4-model fallback
          chain pick whichever has capacity; picking one explicitly still falls
          back to the others on a 503 — it only sets which model goes FIRST. */}
      <Listbox value={model} onChange={pickModel}>
        <ListboxButton className={cx(CHIP, CHIP_IDLE)} aria-label={`Model: ${modelLabel}`}>
          <ToneLed />
          {modelLabel}
          <ChevronDown className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
        </ListboxButton>
        <ListboxOptions anchor={{ to: 'bottom start', gap: 6, padding: 12 }} className="menu w-60">
          {AI_MODEL_OPTIONS.map(o => (
            <ListboxOption key={o.id} value={o.id} className="menu-item flex-col !items-start justify-center !gap-0 py-1.5 data-[selected]:text-accent-700">
              <span className="font-semibold">{o.label}</span>
              <span className="text-meta font-normal text-fg-muted">{o.hint}</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
      {/* Coach mode — blunt PT persona over a prepared 30-day
          training/health/nutrition JSON (see sendCoachMessage). */}
      <button
        type="button"
        onClick={() => setCoachMode(v => !v)}
        aria-pressed={coachMode}
        title="Coach mode: PT persona + the last 30 days of training/sleep/weight/nutrition data as prepared context"
        className={cx(CHIP, coachMode ? CHIP_ON : CHIP_IDLE)}
      >
        <Dumbbell className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />Coach
      </button>
      {/* Hands-free voice chat: speak → it answers out loud → the mic reopens.
          Hidden entirely when the browser has neither half of the Web Speech API. */}
      {(voice.sttSupported || voice.ttsSupported) && (
        <>
          <button
            type="button"
            onClick={toggleVoiceMode}
            title={voice.sttSupported
              ? 'Voice chat: speak your message, hear the answer, mic reopens automatically'
              : 'Speak the answers out loud (this browser cannot listen)'}
            aria-pressed={voiceMode}
            className={cx(CHIP, voiceMode ? CHIP_ON : CHIP_IDLE)}
          >
            {voiceMode ? <Volume2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <Mic className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
            Voice
          </button>
          {voiceMode && (
            <button
              type="button"
              onClick={() => voice.setLang(voice.lang === 'tr-TR' ? 'en-US' : 'tr-TR')}
              title="Speech language (recognition + speaking)"
              className={cx(CHIP, CHIP_IDLE)}
            >
              {voice.lang === 'tr-TR' ? 'TR' : 'EN'}
            </button>
          )}
        </>
      )}
    </div>
  )

  const headerActions = messages.length > 0 && (
    <>
      <IconButton
        label="Summarize & save this conversation"
        onClick={() => handleSend(voice.lang === 'tr-TR' ? SUMMARIZE_AND_SAVE_TR : SUMMARIZE_AND_SAVE_EN)}
        disabled={loading}
        className="disabled:opacity-40"
      >
        <NotebookPen strokeWidth={1.9} aria-hidden />
      </IconButton>
      <IconButton
        label="Clear conversation"
        onClick={() => { setMessages([]); setError(null); try { localStorage.removeItem(STORAGE_KEY) } catch { /* */ } }}
      >
        <Eraser strokeWidth={1.9} aria-hidden />
      </IconButton>
    </>
  )

  return (
    <>
      <SideDrawer
        open={isAIOpen}
        onClose={handleClose}
        title={<span className="inline-flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-control bg-accent-500 text-on-accent"><Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden /></span>Ask AI</span>}
        headerActions={headerActions}
        headerExtra={headerChips}
        widthClassName="w-[32.5rem] xl:w-[38.75rem]"
        phoneStyle={sheetStyle}
      >
        {/* Messages */}
        <div ref={scrollRef} onScroll={onScroll} className="scroll-y relative min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {messages.length === 0 && !loading && (
            <div>
              <p className="mb-3 text-body text-fg-muted">What can I help you with?</p>
              <div className="flex flex-col gap-2">
                {(coachMode ? COACH_SUGGESTIONS : SUGGESTIONS).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSend(s)}
                    className="min-h-[44px] w-full rounded-row border border-line bg-surface-2 px-3 py-2 text-left text-body text-fg-2 transition-colors duration-100 [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[85%] flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {msg.images.map((src, k) => (
                      <img key={k} src={src} alt="" className="h-24 w-24 rounded-row border border-line object-cover" />
                    ))}
                  </div>
                )}
                {msg.content && (
                  <div
                    className={cx(
                      'whitespace-pre-wrap rounded-card px-3.5 py-2.5 text-body leading-relaxed',
                      msg.role === 'user' ? 'rounded-br-md bg-accent-500 text-on-accent' : 'rounded-bl-md bg-surface-2 text-fg',
                    )}
                  >
                    {renderMarkdown(msg.content)}
                  </div>
                )}
                {msg.role === 'assistant' && (msg.model || (msg.steps && msg.steps.length > 0)) && (
                  <div className="flex items-center gap-3 px-1">
                    {/* Which model ACTUALLY answered — the fallback chain can
                        land somewhere other than the picked/preferred model. */}
                    {msg.model && <span className="text-micro text-fg-faint">{msg.model.replace('gemini-', '')}</span>}
                    <button
                      type="button"
                      onClick={() => copyReply(msg.content, i)}
                      className="min-h-[28px] text-meta text-fg-muted hover:text-fg [@media(pointer:coarse)]:min-h-[44px]"
                      aria-label="Copy this reply"
                    >
                      {copiedIdx === i ? 'Copied' : 'Copy'}
                    </button>
                    {msg.steps && msg.steps.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDetailSteps(msg.steps!)}
                        className="min-h-[28px] text-meta font-semibold text-accent-600 hover:text-accent-700 [@media(pointer:coarse)]:min-h-[44px]"
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
            <div className="flex justify-start" role="status" aria-label="Thinking">
              <div className="rounded-card rounded-bl-md bg-surface-2 px-4 py-3">
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div data-tone="danger" className="tone-soft flex items-start gap-2 rounded-row py-1.5 pl-3 pr-1.5 text-body">
              <span className="tone-text min-w-0 flex-1 py-1.5">{error}</span>
              {/* A failed turn used to strand the question — resend the last user message instead. */}
              <button
                type="button"
                onClick={retryLast}
                disabled={loading}
                className="btn-secondary btn-sm shrink-0 disabled:opacity-40"
              >
                Retry
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Shown only when the user has scrolled up: auto-scroll is suppressed
            in that state so a new reply must not silently land off-screen. */}
        {!atBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            aria-label="Jump to newest message"
            className="absolute bottom-28 right-4 z-10 flex min-h-[44px] items-center gap-1 rounded-full border border-line-strong bg-surface px-3 text-meta font-semibold text-fg-2 shadow-float"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />Newest
          </button>
        )}

        {/* Input */}
        <div className="shrink-0 border-t border-line px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 md:pb-3">
          {pendingImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingImages.map((src, k) => (
                <div key={k} className="relative">
                  <img src={src} alt="" className="h-14 w-14 rounded-control border border-line object-cover" />
                  <button
                    type="button"
                    onClick={() => setPendingImages(p => p.filter((_, j) => j !== k))}
                    className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-line-strong bg-surface text-fg-2 shadow-float"
                    aria-label="Remove photo"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Live voice status — what is being heard, or that a reply is being
              spoken, each with a one-tap way out. */}
          {(voice.listening || voice.speaking) && (
            <div className="mb-2 flex items-center gap-2 rounded-row border border-accent-500/25 bg-accent-50 px-3 py-1">
              <span className={cx('h-2 w-2 shrink-0 rounded-full bg-accent-500', voice.listening && 'animate-pulse')} />
              <span className="min-w-0 flex-1 truncate text-meta text-fg-2">
                {voice.listening ? (interim || 'Listening…') : 'Speaking…'}
              </span>
              <button
                type="button"
                onClick={() => { voice.stopListening(); voice.cancelSpeak() }}
                className="min-h-[36px] shrink-0 px-1.5 text-meta font-semibold text-accent-700 [@media(pointer:coarse)]:min-h-[44px]"
              >
                Stop
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => { void addImages(e.target.files); e.target.value = '' }}
            />
            <IconButton
              bordered
              label="Attach a photo"
              onClick={() => fileRef.current?.click()}
              disabled={loading || pendingImages.length >= 3}
              className="disabled:opacity-40"
            >
              <Camera strokeWidth={1.9} aria-hidden />
            </IconButton>
            {/* Push-to-talk dictation — outside voice mode this just fills the
                box so the text can be edited before sending. */}
            {voice.sttSupported && (
              <IconButton
                bordered
                label={voice.listening ? 'Stop listening' : 'Dictate a message'}
                aria-pressed={voice.listening}
                onClick={voice.toggleListening}
                disabled={loading}
                className={cx('disabled:opacity-40', voice.listening && '!border-accent-500 !bg-accent-500 !text-on-accent animate-pulse')}
              >
                <Mic strokeWidth={1.9} aria-hidden />
              </IconButton>
            )}
            <textarea
              ref={inputRef}
              data-autofocus
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              placeholder="Ask anything…"
              aria-label="Message"
              rows={1}
              className="input max-h-32 flex-1 resize-none py-2.5"
              style={{ height: 'auto' }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = `${t.scrollHeight}px`
              }}
            />
            <button
              type="button"
              onClick={() => handleSend(input)}
              disabled={(!input.trim() && !pendingImages.length) || loading}
              aria-label="Send"
              className="btn-primary h-11 w-11 shrink-0 !px-0 disabled:opacity-40"
            >
              <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </button>
          </div>
          <p className="mt-1.5 hidden text-micro text-fg-faint md:block">Enter to send · Shift+Enter for a new line</p>
        </div>
      </SideDrawer>

      {/* Activity-trace detail — what the AI did behind the scenes */}
      <ModalShell open={detailSteps !== null} onClose={() => setDetailSteps(null)} title="AI activity" size="sm">
        <div className="flex flex-col gap-1.5">
          {(detailSteps ?? []).map((s, i) => (
            <div key={i} className="whitespace-pre-wrap break-words rounded-control border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-meta text-fg-2">
              {s}
            </div>
          ))}
        </div>
      </ModalShell>
    </>
  )
}

const CHIP = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-semibold transition-colors duration-100 [@media(pointer:coarse)]:h-11'
const CHIP_IDLE = 'border-line bg-surface-2 text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:text-fg'
const CHIP_ON = 'border-accent-500/30 bg-accent-50 text-accent-700'

/** Small "online" led on the model chip. */
function ToneLed() {
  return <span data-tone="success" aria-hidden className="tone-dot !h-1.5 !w-1.5" />
}
