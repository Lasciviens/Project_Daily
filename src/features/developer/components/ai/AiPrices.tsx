import type { ReactNode } from 'react'
import { ExternalLink, Lock } from 'lucide-react'
import { Card, CardHeader, PageBoard, Skeleton } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useClaudeDescribe } from '../../../ai/claude/hooks/useClaude'
import { callCost, formatCount, formatPrice, formatUsd, modelNameOf, priceSourceUrl } from '../../../ai/claude/ledgerRules'
import type { Describe, DescribeModelPrice } from '../../../ai/claude/types'
import { AI_PRICES_BOARD, type AiPricesSection } from '../../developerBoards'
import { ReadFailed, Term } from './aiBits'

// Developer → AI → Prices: the function's own price table (`describe`), the day it was checked against
// Anthropic's page, and one call worked out by hand. Read-only: the budget wall is worked out from these numbers.

const EXAMPLE = { input: 1200, output: 300 }

const PRICE_ROWS: readonly (readonly [string, keyof Omit<DescribeModelPrice, 'model'>])[] = [
  ['Input', 'inputPerMTok'], ['Output', 'outputPerMTok'], ['Cache read', 'cacheReadPerMTok'],
  ['Cache write, 5 min', 'cacheWrite5mPerMTok'], ['Cache write, 1 h', 'cacheWrite1hPerMTok'],
]

function PriceTable({ about }: { about: Describe }) {
  const { prices } = about
  const source = priceSourceUrl(prices.source)
  return (
    <Card>
      <CardHeader variant="label" title={<Term term="MTok">Dollars per million tokens</Term>} />
      {prices.models.length === 0
        ? <p className="text-body text-fg-muted">The function lists no prices.</p>
        : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-x-6 gap-y-4">
            {prices.models.map(m => (
              <section key={m.model} aria-label={modelNameOf(about.models, m.model)}>
                <h4 className="text-body font-semibold text-fg">{modelNameOf(about.models, m.model)}</h4>
                <p className="font-mono text-meta text-fg-muted">{m.model}</p>
                <dl className="mt-1.5 divide-y divide-line text-body">
                  {PRICE_ROWS.map(([label, key]) => (
                    <div key={key} className="flex items-baseline justify-between gap-3 py-1">
                      <dt className="text-fg-2">{label}</dt>
                      <dd className="font-medium tabular-nums text-fg">{m[key] > 0 ? formatPrice(m[key]) : '—'}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-meta text-fg-2">
        {prices.longPromptOverTokens > 0 && (
          <li>A prompt over {formatCount(prices.longPromptOverTokens)} tokens costs {prices.longPromptMultiplier}× on every line above.</li>
        )}
        {prices.webSearchUsdEach > 0 && (
          <li>A web search costs {formatUsd(prices.webSearchUsdEach, { fine: true })} each, on top of the tokens. Only “Ideas for this place” uses it, at most {prices.webSearchMaxUses} a call, and each call says how many it ran.</li>
        )}
        {prices.batchMultiplier > 0 && (
          <li>A batch job (one that can wait a few hours) costs {prices.batchMultiplier}× the price.</li>
        )}
        <li className="text-fg-muted">
          Checked {prices.checkedOn ? `on ${formatDate(prices.checkedOn)}` : 'on an unknown day'} against{' '}
          {source
            ? <a href={source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-600">Anthropic’s pricing page <ExternalLink aria-hidden className="h-3 w-3" /></a>
            : 'Anthropic’s pricing page'}.
        </li>
      </ul>
    </Card>
  )
}

function WorkedExample({ about }: { about: Describe }) {
  // The model ✨ uses by default: the first job's, else the first price line.
  const price = about.prices.models.find(m => m.model === about.jobs[0]?.defaults.model) ?? about.prices.models[0]
  if (!price) return null
  const input = callCost(price, { input: EXAMPLE.input }), output = callCost(price, { output: EXAMPLE.output })
  return (
    <Card>
      <CardHeader variant="label" title="One call, worked out" />
      <p className="text-body text-fg-2">
        A call with {formatCount(EXAMPLE.input)} input and {formatCount(EXAMPLE.output)} output tokens on {modelNameOf(about.models, price.model)} costs{' '}
        <span className="font-semibold tabular-nums text-fg">{formatUsd(callCost(price, EXAMPLE), { fine: true })}</span>:
      </p>
      <dl className="mt-2 flex flex-col gap-1 text-meta tabular-nums text-fg-2">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt>{formatCount(EXAMPLE.input)} × {formatPrice(price.inputPerMTok)} ÷ 1{' '}000{' '}000</dt>
          <dd className="font-medium text-fg">{formatUsd(input, { fine: true })}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt>{formatCount(EXAMPLE.output)} × {formatPrice(price.outputPerMTok)} ÷ 1{' '}000{' '}000</dt>
          <dd className="font-medium text-fg">{formatUsd(output, { fine: true })}</dd>
        </div>
      </dl>
      <p className="mt-2 text-meta text-fg-muted">
        About {formatCount(Math.floor(1 / Math.max(callCost(price, EXAMPLE), 0.000001)))} such calls for one dollar. Each call’s real cost is
        worked out the same way when it is logged, from its own token counts, and kept on its row.
      </p>
    </Card>
  )
}

export function AiPrices() {
  const about = useClaudeDescribe()
  if (about.isError) {
    return <ReadFailed what="the price table" error={about.error} onRetry={() => { void about.refetch() }} retrying={about.isFetching} />
  }
  const d = about.data
  const sections: Record<AiPricesSection, ReactNode> = {
    table: d ? <PriceTable about={d} /> : <Skeleton rounded="rounded-card" className="h-[22rem] w-full" />,
    example: d ? <WorkedExample about={d} /> : <Skeleton rounded="rounded-card" className="h-44 w-full" />,
    about: (
      <Card className="flex items-start gap-3">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-surface-2 text-fg-2"><Lock className="h-4 w-4" /></span>
        <p className="text-body text-fg-2">
          <span className="font-semibold text-fg">These prices are read-only.</span>{' '}
          The budget wall is worked out from them, so they change with a reviewed code change that checks Anthropic’s page again — not from the browser.
        </p>
      </Card>
    ),
  }
  return <PageBoard sections={sections} layout={AI_PRICES_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
}
