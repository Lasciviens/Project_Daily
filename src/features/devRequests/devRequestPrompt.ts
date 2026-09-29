// Pure: turns picked backlog rows into one ready-to-paste prompt for Claude.
// Pure (imports only other pure modules) so a verify script can require it
// without a Supabase client.
import { NUMBERED_ITEM_RE } from './numberedList'

export interface PromptRequest {
  title: string
  description: string | null
  page: string | null
  category: string
  priority: string
  effort?: string | null
}

// A "3- text" sub-item becomes its own numbered point under the request
// ("   1.3 text"), so each can be answered on its own.
function bodyLine(line: string, item: number): string {
  if (!line.trim()) return ''
  const m = NUMBERED_ITEM_RE.exec(line)
  if (m && m[3].trim()) return `   ${item}.${m[2]} ${m[3].trim()}`
  return `   ${line}`
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function buildClaudePrompt(requests: readonly PromptRequest[]): string {
  if (requests.length === 0) return ''
  const sorted = [...requests].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  const items = sorted.map((r, i) => {
    const meta = [r.category, `${r.priority} priority`, r.effort ? `effort ${r.effort}` : null, r.page && r.page !== 'other' ? `page ${r.page}` : null]
      .filter(Boolean).join(' · ')
    // Indented under its item; paragraphs keep one blank line between them.
    const text = r.description?.trim().replace(/\n\s*\n+/g, '\n\n') ?? ''
    const body = text ? `\n${text.split('\n').map(l => bodyLine(l, i + 1)).join('\n')}` : ''
    return `${i + 1}. **${r.title.trim()}** (${meta})${body}`
  })
  const n = requests.length
  // Descriptions can carry blocks the composer captured on the page.
  const points = requests.some(r => (r.description ?? '').split('\n').some(l => NUMBERED_ITEM_RE.test(l)))
  const captured = requests.some(r => /^\[(?:Picked|Page context)\b/m.test(r.description ?? ''))
  return [
    `Please work on ${n === 1 ? 'this request' : `these ${n} requests`} from my Lasci's Board backlog (Dev Requests), in the order listed:`,
    '',
    items.join('\n\n'),
    '',
    ...(captured ? ['Lines under [Picked …] and [Page context] were captured from the live page: a Component line names the React component and the file that rendered it; the other lines quote the exact visible labels, so search the code for those strings to find the spot.', ''] : []),
    `Read CLAUDE.md and docs/design/THEME.md first. For each item: find the root cause in the code, make the smallest correct change, verify it (build, typecheck, the relevant scripts/verify-*.cjs), then commit, push and open a draft PR. If an item is ambiguous or needs a decision from me, ask before building it. When you are done, tell me per item${points ? ' (and per numbered point, e.g. 1.2)' : ''} what changed and anything I need to do (migrations, edge-function deploys).`,
  ].join('\n')
}
