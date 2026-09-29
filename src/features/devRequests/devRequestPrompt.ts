// Pure: turns picked backlog rows into one ready-to-paste prompt for Claude.
// Pure (imports only other pure modules) so a verify script can require it
// without a Supabase client.
import { LEGACY_POINT_RE } from './checkpoints'
import { REF_RE, markPromptText, parseDescription, pickLabel, type Mark, type PickMark } from './devRequestMarks'

export interface PromptRequest {
  title: string
  description: string | null
  page: string | null
  category: string
  priority: string
  effort?: string | null
}

const indent = (text: string) => text.split('\n').map(l => (l.trim() ? `   ${l}` : '')).join('\n')

// An older "3- text" point becomes its own numbered point under the request
// ("   1.3 text"), so each can be answered on its own.
function bodyLine(line: string, item: number): string {
  if (!line.trim()) return ''
  const m = LEGACY_POINT_RE.exec(line)
  if (m && m[3].trim()) return `   ${item}.${m[2]} ${m[3].trim()}`
  return `   ${line}`
}

interface ItemText { text: string; points: boolean; marks: boolean; links: boolean }

// A link in the text reads `“Water card” [1]`; its full detail (component,
// file, route, labels) follows as footnote [1] under the request.
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
  return { replace, used }
}

function itemText(r: PromptRequest, item: number): ItemText {
  const p = parseDescription(r.description)
  const sections: string[] = []
  const links = linker(p.marks)
  const body = links.replace(p.body.trim()).replace(/\n\s*\n+/g, '\n\n')
  let points = false
  let next = 1
  if (body) {
    sections.push(body.split('\n').map(l => bodyLine(l, item)).join('\n'))
    for (const l of body.split('\n')) {
      const m = LEGACY_POINT_RE.exec(l)
      if (m && m[3].trim()) { points = true; next = Math.max(next, Number(m[2]) + 1) }
    }
  }
  // Checkpoints continue the numbering; a ticked one says so.
  const cps = p.checkpoints.filter(c => c.text.trim())
  if (cps.length) {
    points = true
    sections.push(cps.map((c, i) => `   ${item}.${next + i} ${c.done ? '[done] ' : ''}${links.replace(c.text.trim())}`).join('\n'))
  }
  links.used.forEach((m, i) => sections.push(indent(`[${i + 1}] ${markPromptText(m)}`)))
  // Older picks (not linked from the text) and the page it was written on.
  const rest = p.marks.filter(m => !(m.type === 'pick' && m.id))
  for (const m of rest) sections.push(indent(markPromptText(m)))
  return { text: sections.join('\n\n'), points, marks: rest.length > 0 || links.used.length > 0, links: links.used.length > 0 }
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function buildClaudePrompt(requests: readonly PromptRequest[]): string {
  if (requests.length === 0) return ''
  const sorted = [...requests].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  let points = false
  let captured = false
  let linked = false
  const items = sorted.map((r, i) => {
    const meta = [r.category, `${r.priority} priority`, r.effort ? `effort ${r.effort}` : null, r.page && r.page !== 'other' ? `page ${r.page}` : null]
      .filter(Boolean).join(' · ')
    const t = itemText(r, i + 1)
    points ||= t.points
    captured ||= t.marks
    linked ||= t.links
    return `${i + 1}. **${r.title.trim()}** (${meta})${t.text ? `\n${t.text}` : ''}`
  })
  const n = requests.length
  return [
    `Please work on ${n === 1 ? 'this request' : `these ${n} requests`} from my Lasci's Board backlog (Dev Requests), in the order listed:`,
    '',
    items.join('\n\n'),
    '',
    ...(linked ? ['A quoted name followed by [n] (e.g. “Water card” [1]) is a spot I pointed at on the live app; footnote [n] under that request says exactly where it is.', ''] : []),
    ...(captured ? ['Blocks starting [Picked …] and [Page context] were captured from the live page: the header is the page name and its hash route with the query; a Component line names the React component and the file that rendered it (build-time data-src stamps); the other lines quote the exact visible labels, so search the code for those strings to find the spot.', ''] : []),
    ...(points ? ['Numbered sub-points (e.g. 1.2) are separate checkpoints; the ones marked [done] I have already ticked off.', ''] : []),
    `Read CLAUDE.md and docs/design/THEME.md first. For each item: find the root cause in the code, make the smallest correct change, verify it (build, typecheck, the relevant scripts/verify-*.cjs), then commit, push and open a draft PR. If an item is ambiguous or needs a decision from me, ask before building it. When you are done, tell me per item${points ? ' (and per numbered point, e.g. 1.2)' : ''} what changed and anything I need to do (migrations, edge-function deploys).`,
  ].join('\n')
}
