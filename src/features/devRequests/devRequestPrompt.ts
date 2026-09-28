// Pure: turns picked backlog rows into one ready-to-paste prompt for Claude.
// Import-free so a verify script can require it without a Supabase client.

export interface PromptRequest {
  title: string
  description: string | null
  page: string | null
  category: string
  priority: string
  effort?: string | null
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function buildClaudePrompt(requests: readonly PromptRequest[]): string {
  if (requests.length === 0) return ''
  const sorted = [...requests].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  const items = sorted.map((r, i) => {
    const meta = [r.category, `${r.priority} priority`, r.effort ? `effort ${r.effort}` : null, r.page && r.page !== 'other' ? `page ${r.page}` : null]
      .filter(Boolean).join(' · ')
    const body = r.description?.trim() ? `\n   ${r.description.trim().replace(/\n+/g, '\n   ')}` : ''
    return `${i + 1}. **${r.title.trim()}** (${meta})${body}`
  })
  const n = requests.length
  return [
    `Please work on ${n === 1 ? 'this request' : `these ${n} requests`} from my Lasci's Board backlog (Dev Requests), in the order listed:`,
    '',
    ...items,
    '',
    'Read CLAUDE.md and docs/design/THEME.md first. For each item: find the root cause in the code, make the smallest correct change, verify it (build, typecheck, the relevant scripts/verify-*.cjs), then commit, push and open a draft PR. If an item is ambiguous or needs a decision from me, ask before building it. When you are done, tell me per item what changed and anything I need to do (migrations, edge-function deploys).',
  ].join('\n')
}
