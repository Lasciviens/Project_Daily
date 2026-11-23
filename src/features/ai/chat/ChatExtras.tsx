import { useState } from 'react'
import { Camera, ChevronRight, Mic, Square, X } from 'lucide-react'
import { IconButton } from '../../../shared/ui'
import { PhotoButton } from '../claude/components/PhotoButton'
import type { PhotoInput } from '../claude/featureRules'
import type { ChatSetup } from './chatApi'
import { toolLabel } from './chatRules'

// The small parts around Ask AI's message box: photos waiting to be sent, the microphone, and the line that says which
// tools and instructions a chat was started with (a chat keeps them for its whole life).

/** The photos waiting under the box (each can be taken out), the button that adds one, and the cost note. */
export function PhotoStrip({ photos, onRemove, firstInChat }: { photos: readonly PhotoInput[]; onRemove: (index: number) => void; firstInChat: boolean }) {
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
        A photo stays in this chat.{firstInChat ? ' The first one makes that answer a little dearer: the chat’s saved copy can’t be reused.' : ''}
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

/** The microphone: it fills the box with what the browser heard; the owner reads it and sends. */
export function MicButton({ listening, onToggle, disabled }: { listening: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <IconButton label={listening ? 'Stop listening' : 'Speak your message'} aria-pressed={listening} onClick={onToggle} disabled={disabled}
      className={listening ? 'bg-accent-50 !text-accent-700' : undefined}>
      {listening ? <Square aria-hidden /> : <Mic aria-hidden />}
    </IconButton>
  )
}

/** What this chat was started with: its kind, how many tools (which, on a tap) and whether your instructions were in it. */
export function ChatSetupNote({ setup }: { setup: ChatSetup }) {
  const [open, setOpen] = useState(false)
  const names = setup.toolNames.map(toolLabel)
  return (
    <div className="px-1 text-meta text-fg-faint">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-left [@media(hover:hover)]:hover:text-fg-muted">
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden />
        {setup.mode === 'coach' ? 'Coach chat' : 'Chat'} · {setup.toolNames.length} {setup.toolNames.length === 1 ? 'tool' : 'tools'}{setup.ownInstructions ? ' · your instructions' : ''}
      </button>
      {open && (
        <p className="mt-0.5 pl-4 text-fg-muted">
          {names.length ? `Tools: ${names.join(', ')}.` : 'No tools: this chat answers from what you say.'} {setup.ownInstructions ? 'Your instructions were copied in when it started. ' : ''}
          A chat keeps what it started with: changes in Settings reach new chats.
        </p>
      )}
    </div>
  )
}
