// Pure: turns picked backlog rows into one ready-to-paste prompt for Claude
// Code. Shape (kept short on purpose — every line is something the agent
// needs):
//   ## Request 1 — <title>          (just "## <title>" for one request)
//   bug · high priority · page /home
//   RE-CHECK: … (a re-check request only)
//   1. point                        numbered as in the editor
//      1.1 sub-point
//   2. [already fixed — leave as is] …
//   [1] footnote: where a linked spot is (component, file, route, labels)
//   ---
//   How to work: … (only the rules that apply)
// Pure (imports only other pure modules) so a verify script can require it.
import { REF_RE, markPromptText, parseDescription, pickLabel, type Mark, type PickMark } from './devRequestMarks'
import { requestPoints, type Point } from './points'
import { tailNote } from './outline'

export interface PromptRequest {
  title: string
  description: string | null
  page: string | null
  category: string
  priority: string
  effort?: string | null
}

// A link in the text reads `“Water card” [1]`; its full detail (component,
// file, route, labels) follows as footnote [1] under the request. `name`
// only names it (for a point that is skipped: no footnote needed).
function linker(marks: readonly Mark[]) {
  const byId = new Map(marks.flatMap(m => (m.type === 'pick' && m.id ? [[m.id, m] as const] : [])))
  const used: PickMark[] = []
  const replace = (text: string) => text.replace(REF_RE, (_, id: string) => {
    const m = byId.get(id)
    if (!m) return ''
    let n = used.indexOf(m) + 1
    if (!n) { used.push(m); n = used.length }
    return `“${pickLabel(m)}” [${n}]`
  })
  const name = (text: string) => text.replace(REF_RE, (_, id: string) => { const m = byId.get(id); return m ? `“${pickLabel(m)}”` : '' })
  return { replace, name, used }
}

const short = (text: string, max = 80) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t }

// `1. first line` / `   1.1 first line`, the lines after it lined up under the text.
function numbered(pt: Point, text: string): string {
  const head = pt.level === 1 ? `   ${pt.label} ` : `${pt.label}. `
  const pad = ' '.repeat(head.length)
  return text.split('\n').map((l, i) => (i === 0 ? head + l : l.trim() ? pad + l.trim() : '')).filter((l, i) => i === 0 || l).join('\n')
}

const blockIndent = (text: string, by = '    ') => text.split('\n').map((l, i) => (i === 0 || !l.trim() ? l : by + l)).join('\n')

interface ItemText { text: string; numbered: boolean; marks: boolean; fixed: boolean; moved: boolean; recheck: boolean }

function itemText(r: PromptRequest): ItemText {
  const p = parseDescription(r.description)
  const links = linker(p.marks)
  const points = requestPoints(p)
  const reviewed = points.some(pt => pt.state)
  const recheck = p.recheck
  const out: string[] = []
  let fixed = false
  let moved = false
  if (recheck) {
    const from = recheck.title.trim() ? ` in “${recheck.title.trim()}”` : ''
    out.push(`RE-CHECK: each point below was sent before${from} and the fix did not work. The line under it says what is still wrong.`)
  }
  const asProse = points.length === 1 && !reviewed && !recheck && points[0].level === 0
  if (asProse) out.push(links.replace(points[0].text))
  else if (points.length) {
    out.push(points.map(pt => {
      if (pt.state === 'fixed') { fixed = true; return numbered(pt, `[already fixed — leave as is] ${short(links.name(pt.words))}`) }
      if (pt.state === 'moved') moved = true
      if (pt.state === 'moved') return numbered(pt, `[moved to a separate re-check request — skip] ${short(links.name(pt.words))}`)
      const lines = [links.replace(pt.words)]
      if (pt.tail) lines.push(`Still not fixed after the first attempt${tailNote(pt.tail) ? `: ${tailNote(pt.tail)}` : '.'}`)
      if (pt.state === 'not_fixed') lines.push(`NOT FIXED after the last attempt${pt.review?.note ? `: ${pt.review.note.replace(/\s*\n\s*/g, ' ')}` : '.'}`)
      return numbered(pt, lines.join('\n'))
    }).join('\n'))
  }
  const notes: string[] = links.used.map((m, i) => blockIndent(`[${i + 1}] ${markPromptText(m)}`))
  // Older picks (not linked from the text) and the page it was written on.
  const rest = p.marks.filter(m => !(m.type === 'pick' && m.id))
  for (const m of rest) notes.push(markPromptText(m))
  if (notes.length) out.push(notes.join('\n'))
  return { text: out.join('\n\n'), numbered: !asProse && points.length > 0, marks: notes.length > 0, fixed, moved, recheck: !!recheck }
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function buildClaudePrompt(requests: readonly PromptRequest[]): string {
  if (requests.length === 0) return ''
  const sorted = [...requests].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  const one = sorted.length === 1
  let anyNumbered = false, anyMarks = false, anyFixed = false, anyMoved = false, anyRecheck = false
  const items = sorted.map((r, i) => {
    const meta = [r.category, `${r.priority} priority`, r.effort ? `effort ${r.effort}` : null, r.page && r.page !== 'other' ? `page ${r.page}` : null]
      .filter(Boolean).join(' · ')
    const t = itemText(r)
    anyNumbered ||= t.numbered
    anyMarks ||= t.marks
    anyFixed ||= t.fixed
    anyMoved ||= t.moved
    anyRecheck ||= t.recheck
    const heading = one ? `## ${r.title.trim()}` : `## Request ${i + 1} — ${r.title.trim()}`
    return [heading, meta, ...(t.text ? ['', t.text] : [])].join('\n')
  })
  const example = one ? '1.2' : 'Request 2 · 1.2'
  const rules = [
    'Read CLAUDE.md and docs/design/THEME.md first.',
    ...(anyMarks ? ['A quoted name with [n] (e.g. “Water card” [1]) is a spot I pointed at in the live app. Footnote [n], [Picked …] and [Page context] blocks give the route with its query, the component and file that rendered it, and the exact visible labels — search the code for those labels.'] : []),
    ...(anyFixed ? ['Points marked [already fixed] work now: leave that code alone.'] : []),
    ...(anyMoved ? ['Skip points marked [moved …]: another request covers them.'] : []),
    ...(anyRecheck ? ['For a RE-CHECK, first find what the earlier attempt changed and why it didn\'t take; don\'t repeat it — look deeper.'] : []),
    `For each ${one ? (anyNumbered ? 'point' : 'part') : `request${anyNumbered ? ' and point' : ''}`}: find the root cause, make the smallest correct change, and verify it (npx tsc -b, npm run build, the relevant scripts/verify-*.cjs${anyMarks ? ', and the spot I pointed at' : ''}).`,
    'Then commit, push and open a draft PR.',
    'If something is ambiguous or needs a decision from me, ask before building it.',
    `When done, report per ${one ? (anyNumbered ? `point (e.g. ${example})` : 'part') : `request${anyNumbered ? ` and point (e.g. ${example})` : ''}`}: what changed, and anything I must do (migrations, edge-function deploys).`,
  ]
  return [
    one ? 'Please work on this request from my Lasci\'s Board backlog (Dev Requests).'
      : `Please work on these ${sorted.length} requests from my Lasci's Board backlog (Dev Requests), in this order.`,
    '',
    items.join('\n\n'),
    '',
    '---',
    'How to work:',
    ...rules.map(r => `- ${r}`),
  ].join('\n')
}
