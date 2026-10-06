// Pure: turns picked backlog rows into one ready-to-paste prompt for Claude.
// Pure (imports only other pure modules) so a verify script can require it
// without a Supabase client.
import { REF_RE, markPromptText, parseDescription, pickLabel, type Mark, type PickMark } from './devRequestMarks'
import { STILL_RE, requestPoints } from './points'

export interface PromptRequest {
  title: string
  description: string | null
  page: string | null
  category: string
  priority: string
  effort?: string | null
}

const indent = (text: string) => text.split('\n').map(l => (l.trim() ? `   ${l}` : '')).join('\n')

// `   1.2 first line` with the lines after it lined up under the text.
function numbered(label: string, text: string): string {
  const pad = ' '.repeat(3 + label.length + 1)
  return text.split('\n').map((l, i) => (i === 0 ? `   ${label} ${l}` : l.trim() ? `${pad}${l}` : '')).join('\n')
}

interface ItemText { text: string; points: boolean; marks: boolean; links: boolean; fixed: boolean; recheck: boolean }

// A link in the text reads `“Water card” [1]`; its full detail (component,
// file, route, labels) follows as footnote [1] under the request. `name`
// only names it (for a point that is left out: no footnote needed).
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

const short = (text: string, max = 90) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t }

// A point collected into a re-check request: the original words, then the
// "Still not fixed" line(s) — quoted apart so Claude sees what failed.
function recheckPoint(text: string): string {
  const lines = text.split('\n')
  const cut = lines.findIndex(l => STILL_RE.test(l.trim()))
  if (cut <= 0) return text
  return [`Originally asked: ${lines[0]}`, ...lines.slice(1, cut).map(l => `  ${l}`), ...lines.slice(cut)].join('\n')
}

/**
 * Points (paragraphs) are numbered 1.1, 1.2 … in the order the user sees them.
 * One that is already Fixed is left in as a one-line "[already fixed]" — the
 * numbers stay the ones on screen, and Claude knows not to touch working
 * code — and one moved to a re-check request is skipped the same way. A Not
 * fixed one carries the note of what is still wrong.
 */
function itemText(r: PromptRequest, item: number): ItemText {
  const p = parseDescription(r.description)
  const sections: string[] = []
  const links = linker(p.marks)
  const points = requestPoints(p)
  const reviewed = points.some(pt => pt.state)
  const recheck = !!p.recheck
  let fixed = false
  if (recheck) sections.push(indent(`RE-REQUEST — these points were sent to you before${p.recheck!.title.trim() ? ` (in “${p.recheck!.title.trim()}”)` : ''} and the fix did not work. Each quotes what I originally asked and what is still wrong. Don't repeat the first approach: find out why it didn't take, and look deeper.`))
  if (points.length === 1 && !reviewed && !recheck) {
    sections.push(indent(links.replace(points[0].text)))
  } else if (points.length) {
    sections.push(points.map(pt => {
      const label = `${item}.${pt.n}`
      if (pt.state === 'fixed') { fixed = true; return numbered(label, `[already fixed — leave as is] ${short(links.name(pt.text))}`) }
      if (pt.state === 'moved') return numbered(label, `[moved to a separate re-check request — skip] ${short(links.name(pt.text))}`)
      const words = links.replace(recheck ? recheckPoint(pt.text) : pt.text)
      const note = pt.state === 'not_fixed' ? `\nNOT FIXED after the last attempt${pt.review?.note ? `: ${pt.review.note}` : '.'}` : ''
      return numbered(label, words + note)
    }).join('\n'))
  }
  links.used.forEach((m, i) => sections.push(indent(`[${i + 1}] ${markPromptText(m)}`)))
  // Older picks (not linked from the text) and the page it was written on.
  const rest = p.marks.filter(m => !(m.type === 'pick' && m.id))
  for (const m of rest) sections.push(indent(markPromptText(m)))
  return {
    text: sections.join('\n\n'),
    points: points.length > 1 || reviewed || recheck,
    marks: rest.length > 0 || links.used.length > 0,
    links: links.used.length > 0,
    fixed,
    recheck,
  }
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function buildClaudePrompt(requests: readonly PromptRequest[]): string {
  if (requests.length === 0) return ''
  const sorted = [...requests].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  let points = false
  let captured = false
  let linked = false
  let fixed = false
  let recheck = false
  const items = sorted.map((r, i) => {
    const meta = [r.category, `${r.priority} priority`, r.effort ? `effort ${r.effort}` : null, r.page && r.page !== 'other' ? `page ${r.page}` : null]
      .filter(Boolean).join(' · ')
    const t = itemText(r, i + 1)
    points ||= t.points
    captured ||= t.marks
    linked ||= t.links
    fixed ||= t.fixed
    recheck ||= t.recheck
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
    ...(points ? [`Numbered sub-points (e.g. 1.2) are separate points — answer each one on its own.${fixed ? ' The ones marked [already fixed] work now: leave that code alone.' : ''}`, ''] : []),
    ...(recheck ? ['An item marked RE-REQUEST repeats points whose earlier fix did not work: check what the first attempt changed, find why it fell short, and verify the result on the spot I pointed at.', ''] : []),
    `Read CLAUDE.md and docs/design/THEME.md first. For each item: find the root cause in the code, make the smallest correct change, verify it (build, typecheck, the relevant scripts/verify-*.cjs), then commit, push and open a draft PR. If an item is ambiguous or needs a decision from me, ask before building it. When you are done, tell me per item${points ? ' (and per numbered point, e.g. 1.2)' : ''} what changed and anything I need to do (migrations, edge-function deploys).`,
  ].join('\n')
}
