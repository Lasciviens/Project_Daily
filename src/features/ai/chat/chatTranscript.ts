// A chat as plain text: for Copy chat, a message's own Copy, and Report (a Dev Request draft the owner reviews and saves).
// Pure (no React, no network): verify-ai-chat-ui.cjs runs it as it is.
//
// Everything here is input before it leaves: the owner's words, the model's answers and a tool's inputs may hold a hostile
// page's text. Hidden characters (controls, zero-width and direction marks, private-use and tag characters) are taken out;
// the Dev Request window's own marks (`[[…]]`) are broken up so a chat can never make a pick link or a review mark; the
// outline's own shape (a blank line between points, two spaces for a sub-point) is kept by code; every part is capped.

import { cardStateLabel, toolLabel, type ChatTurn } from './chatRules'

/** The most characters a report's outline may hold (the request window keeps 20 000; the rest is the owner's). */
export const REPORT_TEXT_MAX = 12_000
/** One message's share of a report. */
export const REPORT_TURN_MAX = 1500
/** The owner's own line on what went wrong. */
export const REPORT_LINE_MAX = 200
/** A copied chat (Copy chat): long, but never unbounded. */
export const COPY_TEXT_MAX = 60_000

// Control and invisible characters: the C0/C1 controls but the line break, soft hyphen, combining grapheme joiner, the
// Hangul fillers, zero-width and direction marks, variation selectors, the BOM, interlinear marks, and the format,
// surrogate, private-use and tag characters.
// eslint-disable-next-line no-control-regex, no-misleading-character-class -- control and combining characters, alone, are exactly what is taken out
const HIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|\p{Cf}|\p{Cs}|\p{Co}|[\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu

/** Text as the app's own: hidden characters out, line ends made plain, no run of more than one blank line, trimmed. */
export function plainChatText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').replace(HIDDEN, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** `text` cut at `max` characters (whole characters, never half a pair) with a mark that it was cut. */
export function capText(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}… [cut]`
}

/**
 * Text as one point of a Dev Request outline: no blank line inside (that would start a new point), no line that starts
 * with spaces (a sub-point), no `[[` or `]]` (the window reads those as marks). Single line breaks stay.
 */
export function outlinePoint(text: string): string {
  return text.split('\n').map(l => l.trim()).filter(Boolean).join('\n').replace(/\[\[/g, '[ [').replace(/\]\]/g, '] ]')
}

/** What a stored or streamed answer looked up, as plain words: "Looked up: Find text (Words: dentist)". */
function stepsLine(turn: ChatTurn): string {
  if (!turn.steps.length) return ''
  const steps = turn.steps.map(st => {
    const input = (st.input ?? []).filter(x => !x.long).map(x => `${x.label}: ${capText(plainChatText(x.value), 80)}`).join(', ')
    return `${toolLabel(st.name)}${input ? ` (${input})` : ''}`
  })
  return `Looked up: ${steps.join('; ')}`
}

/** A card in words: its state and its summary ("Card, waiting for Confirm: Log …"). */
function cardLines(turn: ChatTurn): string[] {
  return turn.cards.map(c => {
    const state = c.state === 'pending' ? 'waiting for Confirm' : c.state === 'undone' ? 'saved, then undone' : cardStateLabel(c.state).toLowerCase() || c.state
    return `Card, ${state}: ${capText(plainChatText(c.summary), 300)}`
  })
}

/** One message as plain text: who, the words, then what an answer looked up, its cards and its error. */
export function turnText(turn: ChatTurn): string {
  const lines: string[] = []
  const words = plainChatText(turn.text)
  if (turn.role === 'user') {
    lines.push(`You: ${words}${turn.photos ? ` [${turn.photos === 1 ? '1 photo' : `${turn.photos} photos`}]` : ''}`)
    return lines.join('\n')
  }
  lines.push(`Ask AI: ${words || (turn.error ? '(no answer)' : '(no text)')}`)
  const steps = stepsLine(turn)
  if (steps) lines.push(steps)
  lines.push(...cardLines(turn))
  if (turn.error) lines.push(`Error: ${capText(plainChatText(turn.error), 300)}`)
  return lines.join('\n')
}

/** The words of one message for its Copy button: what the person sees in the bubble, nothing else. */
export function messageCopyText(turn: ChatTurn): string {
  return capText(plainChatText(turn.text) || plainChatText(turn.error ?? ''), COPY_TEXT_MAX)
}

/** The whole chat for Copy chat: every message as plain text, a blank line between them. */
export function chatCopyText(turns: readonly ChatTurn[], chatId: string | null): string {
  const head = `Ask AI chat${chatId ? ` ${chatId}` : ''}`
  return capText([head, ...turns.map(turnText)].join('\n\n'), COPY_TEXT_MAX)
}

export interface ReportDraft { title: string; description: string }

/**
 * A Dev Request draft from a chat: the owner's line on what went wrong first, the chat's id (so the developer can find it in
 * Developer → AI → Calls and the database), then every message as one point (the reported answer marked). Capped: each
 * message at REPORT_TURN_MAX, the whole at REPORT_TEXT_MAX by leaving out the oldest messages (never the reported one),
 * and saying so. Nothing is saved here: the owner reads it in the request window and saves it.
 */
export function chatReportDraft(input: { turns: readonly ChatTurn[]; chatId: string | null; line: string; answerKey?: string | null; at: string }): ReportDraft {
  const line = capText(plainChatText(input.line).replace(/\s+/g, ' '), REPORT_LINE_MAX)
  const reportedAt = input.answerKey ? input.turns.findIndex(t => t.key === input.answerKey) : -1
  const points = input.turns.map((t, i) => outlinePoint(`${i === reportedAt ? '→ Reported answer. ' : ''}${capText(turnText(t), REPORT_TURN_MAX)}`))
  const head = [
    outlinePoint(`What went wrong: ${line || '(say it here)'}`),
    outlinePoint(`Ask AI chat ${input.chatId ?? '(not saved yet)'} · ${input.turns.length} messages · reported ${input.at}${reportedAt >= 0 ? ` · about message ${reportedAt + 1}` : ''}`),
  ]
  let kept = points
  let left = 0
  let reported = reportedAt
  const size = (list: readonly string[]) => [...head, ...list].join('\n\n').length + 60
  while (size(kept) > REPORT_TEXT_MAX && kept.length > 1) {
    // The oldest message goes first, but never the reported one.
    const drop = reported === 0 ? 1 : 0
    kept = kept.filter((_, i) => i !== drop)
    if (reported > drop) reported -= 1
    left += 1
  }
  const description = [...head, ...(left ? [`(${left} earlier message${left === 1 ? '' : 's'} left out to keep the report short)`] : []), ...kept].join('\n\n')
  return { title: capText(`Ask AI: ${line || 'chat report'}`, 120), description: capText(description, REPORT_TEXT_MAX) }
}
