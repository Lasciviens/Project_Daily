import { useState } from 'react'
import { Camera, ChevronRight, Mic, Square, X } from 'lucide-react'
import { IconButton } from '../../../shared/ui'
import { PhotoButton } from '../claude/components/PhotoButton'
import type { PhotoInput } from '../claude/featureRules'
import { toolLabel, VOICE_LANGUAGES, voiceLanguageOf, type ChatMode, type VoiceLanguageId } from './chatRules'

// The small parts around Ask AI's message box: photos waiting to be sent, the microphone with its language, and the line that
// says which tools and instructions a chat has (a chat keeps them for its whole life).

/** The photos waiting under the box (each can be taken out) and what happens to them. `days`: how long chats are kept at most (your setting). */
export function PhotoStrip({ photos, onRemove, firstInChat, days }: { photos: readonly PhotoInput[]; onRemove: (index: number) => void; firstInChat: boolean; days: number }) {
  if (!photos.length) return null
  return (
    <div className="mb-2">
      <ul className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <li key={i} className="relative">
            <img src={`data:${p.media_type};base64,${p.data}`} alt="A photo to send" className="h-14 w-14 rounded-row border border-line object-cover" />
            <IconButton label="Remove this photo" onClick={() => onRemove(i)} className="absolute -right-2 -top-2 !h-6 !w-6 rounded-full border border-line bg-surface"><X className="!h-3 !w-3" aria-hidden /></IconButton>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-meta text-fg-muted">
        Kept with this chat until you delete it — at most {days} {days === 1 ? 'day' : 'days'}.{firstInChat ? ' The first photo in a chat makes that answer a little dearer.' : ''}
      </p>
    </div>
  )
}

export function AttachPhoto({ onFile, loading, disabled, why }: { onFile: (file: File) => void; loading: boolean; disabled: boolean; why: string | null }) {
  return (
    <span title={why ?? undefined} className="inline-flex">
      <PhotoButton iconOnly icon={<Camera aria-hidden />} onFile={onFile} loading={loading} disabled={disabled}>{why ?? 'Add a photo'}</PhotoButton>
    </span>
  )
}

/** The microphone and its language: it fills the box with what the browser heard; you read it and send. */
export function MicButton({ listening, onToggle, disabled, language, onLanguage }: { listening: boolean; onToggle: () => void; disabled: boolean; language: VoiceLanguageId; onLanguage: (id: VoiceLanguageId) => void }) {
  return (
    <span className="inline-flex items-center">
      <IconButton label={listening ? 'Stop listening' : 'Speak your message'} aria-pressed={listening} onClick={onToggle} disabled={disabled}
        className={listening ? 'bg-accent-50 !text-accent-700' : undefined}>
        {listening ? <Square aria-hidden /> : <Mic aria-hidden />}
      </IconButton>
      <select value={language} onChange={e => onLanguage(voiceLanguageOf(e.target.value))} disabled={listening} aria-label="Voice language" title="Voice language"
        className="select !h-8 !w-[3.9rem] !px-1.5 !py-0 text-meta">
        {VOICE_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.short}</option>)}
      </select>
    </span>
  )
}

/**
 * What a chat has: its kind, how many tools (their names on a tap) and your own instructions (the words on a tap).
 * `planned`: the chat is not started yet, so this is what it WILL start with, from your settings now.
 */
export function ChatSetupNote({ mode, toolNames, ownerInstructions, planned }: { mode: ChatMode; toolNames: readonly string[]; ownerInstructions: string; planned: boolean }) {
  const [open, setOpen] = useState(false)
  const names = toolNames.map(toolLabel)
  return (
    <div className="px-1 text-meta text-fg-faint">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-left [@media(hover:hover)]:hover:text-fg-muted">
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden />
        {mode === 'coach' ? 'Coach chat' : 'Chat'} · {toolNames.length} {toolNames.length === 1 ? 'tool' : 'tools'}{ownerInstructions ? ' · your instructions' : ''}
      </button>
      {open && (
        <div className="mt-0.5 flex flex-col gap-1 pl-4 text-fg-muted">
          <p>{names.length ? `Tools: ${names.join(', ')}.` : 'No tools: it answers from what you say.'}</p>
          <p>{ownerInstructions ? <>Your instructions: <span className="whitespace-pre-wrap break-words text-fg-2">“{ownerInstructions}”</span></> : 'No instructions of your own.'}</p>
          <p>{planned ? 'A new chat starts with what Settings says now. ' : ''}A chat keeps the tools and instructions it started with for its whole life; changes in Settings reach new chats.</p>
        </div>
      )}
    </div>
  )
}
