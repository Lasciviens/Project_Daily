import { Copy, Flag } from 'lucide-react'
import { IconButton } from '../../../shared/ui'
import { copyText } from './chatClipboard'

// Report and Copy for Ask AI (owner, 24.11.2026: "send such chats to the developer"). Report opens the Dev Requests window
// with a draft straight away (reportDraft.ts); Copy puts plain text on the clipboard. Both use only what is on screen,
// cleaned (chatTranscript.ts). Each is an icon; its words are the label and the tooltip.

const SMALL = '!h-7 !w-7 shrink-0 text-fg-faint [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9 [&_svg]:!h-3.5 [&_svg]:!w-3.5'

/** A small copy button for one message. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  return <IconButton label={label} onClick={() => copyText(text)} className={SMALL}><Copy aria-hidden /></IconButton>
}

/** A small Report button: a Dev Request draft of the chat, with this answer marked. */
export function ReportButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return <IconButton label={label} onClick={onClick} disabled={disabled} className={SMALL}><Flag aria-hidden /></IconButton>
}
