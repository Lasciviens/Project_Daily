// A text page's or a log entry's text, read as a few plain conventions —
// "# Heading", "- item", "1. step", ``` code ```, `code`, **bold**,
// [text](https://…) and bare https:// links — into parts the page renders as
// React elements (never as HTML). Pure, checked by verify-project-model.

export type ProsePart =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'code'; text: string }

export type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; url: string }

export function parseProse(text: string): ProsePart[] {
  const parts: ProsePart[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  const flush = () => {
    if (para.length) parts.push({ kind: 'paragraph', text: para.join('\n') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i])
      parts.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line)
    if (h) { flush(); parts.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2].trim() }); continue }
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line)
    const step = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (bullet || step) {
      flush()
      const kind = bullet ? 'bullets' : 'steps'
      const last = parts[parts.length - 1]
      const item = (bullet ?? step)![1].trim()
      if (last && last.kind === kind) last.items.push(item)
      else parts.push({ kind, items: [item] })
      continue
    }
    if (!line.trim()) { flush(); continue }
    para.push(line.trim())
  }
  flush()
  return parts
}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

export function parseInline(text: string): InlinePart[] {
  const out: InlinePart[] = []
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0
    if (i > at) out.push({ kind: 'text', text: text.slice(at, i) })
    if (m[1] != null) out.push({ kind: 'code', text: m[1] })
    else if (m[2] != null) out.push({ kind: 'bold', text: m[2] })
    else if (m[3] != null) out.push({ kind: 'link', text: m[3], url: m[4] })
    else out.push({ kind: 'link', text: m[5].replace(/^https?:\/\//i, ''), url: m[5] })
    at = i + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

/** The first line of a text, plain, for a one-line preview. */
export function firstLine(text: string | null | undefined): string {
  const line = (text ?? '').split('\n').find(l => l.trim() && !/^\s*```/.test(l)) ?? ''
  return line.replace(/^#{1,3}\s+|^\s*[-*•]\s+|^\s*\d+[.)]\s+/, '').replace(/\*\*|`/g, '').trim()
}
