import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Truncate } from '../../../shared/ui'
import { costNote } from '../../ai/claude/featureRules'
import { useClaudeDescribe } from '../../ai/claude/hooks/useClaude'
import { useShopCategories, useShopItems } from '../hooks/useShop'
import { useApplyTidy, useTidyRun, type TidyRunResult } from '../hooks/useShopTidy'
import { categoryPath } from '../shopModel'
import { tidyChanges, tidyInputFor, tidyCategories, tidyScope, tidyWorstCost, type TidyChange, type TidyKey, type TidySuggestion } from '../tidyModel'
import type { ShopItem } from '../types'

/**
 * Tidy up info (owner, 23.11.2026: "an additional function to tidy up the existing products info"; the store's words are
 * kept, no translation). One thing (from its record's ⋯) or all things (the Shop header's ⋯): the AI suggests a cleaner
 * name ("Brand Model variant, colour"), brand, model and one of your own categories; every field shows before → after
 * with a tick, an unticked field is never written, and nothing is saved without the Save tap. "All" asks one thing at a
 * time with a Stop, after showing the most it could cost. Saved with ONE Undo ("N things tidied · Undo").
 */
export function ShopTidyModal({ request, onClose }: EntityModalProps<'shop-tidy'>) {
  const single = !!request.ids && request.ids.length === 1
  const { data: items = [], isLoading } = useShopItems()
  const { data: categories = [] } = useShopCategories()
  const describe = useClaudeDescribe()
  const run = useTidyRun()
  const apply = useApplyTidy()
  const control = useRef<AbortController | null>(null)
  const started = useRef(false)
  const [step, setStep] = useState<{ done: number; total: number; name: string } | null>(null)
  const [found, setFound] = useState<Map<string, TidySuggestion>>(new Map())
  const [result, setResult] = useState<TidyRunResult | null>(null)
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())

  const rows = useMemo(() => {
    const ids = request.ids ? new Set(request.ids) : null
    return ids ? items.filter(i => ids.has(i.id)) : tidyScope(items)
  }, [items, request.ids])
  const pathOf = useMemo(() => (id: string | null) => {
    const p = categoryPath(id, categories)
    return p.subName ? `${p.topName} / ${p.subName}` : p.topName
  }, [categories])

  // The most one call could cost, from the job's own prices, shown before "all" starts.
  const estimate = useMemo(() => {
    const about = describe.data
    const job = about?.jobs.find(j => j.name === 'shop_tidy')
    const price = about?.prices.models.find(m => m.model === job?.defaults.model)
    if (!about || !job || !price || rows.length === 0) return null
    const input = JSON.stringify(tidyInputFor(rows[0], tidyCategories(categories), pathOf)).length
    const each = tidyWorstCost(
      { webSearchUsdEach: about.prices.webSearchUsdEach, longPromptOverTokens: about.prices.longPromptOverTokens, longPromptMultiplier: about.prices.longPromptMultiplier, model: price },
      { instructions: job.instructions.length, input }, job.defaults.maxOutputTokens,
    )
    return { each, total: each * rows.length }
  }, [describe.data, rows, categories, pathOf])

  function start() {
    if (run.isPending || rows.length === 0) return
    const controller = new AbortController()
    control.current = controller
    setFound(new Map())
    setResult(null)
    run.mutate({
      rows, categories, pathOf, signal: controller.signal,
      onStep: (done, total, name) => setStep({ done, total, name }),
      onSuggestion: (id, s) => setFound(m => new Map(m).set(id, s)),
    }, { onSuccess: r => { setResult(r); setStep(null) }, onError: () => setStep(null) })
  }

  // One thing, asked from its own record: it starts at once (the owner just tapped it).
  useEffect(() => {
    if (!single || started.current || isLoading || rows.length === 0) return
    started.current = true
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts once, when the thing has loaded
  }, [single, isLoading, rows.length])

  const reviewed = useMemo(() => {
    const out: { item: ShopItem; suggestion: TidySuggestion; changes: TidyChange[] }[] = []
    for (const item of rows) {
      const suggestion = (result?.suggestions ?? found).get(item.id)
      if (!suggestion) continue
      const changes = tidyChanges(item, suggestion, pathOf)
      if (changes.length) out.push({ item, suggestion, changes })
    }
    return out
  }, [rows, result, found, pathOf])
  const tickedCount = reviewed.reduce((n, r) => n + r.changes.filter(c => !off.has(`${r.item.id}:${c.key}`)).length, 0)
  const running = run.isPending

  function stop() { control.current?.abort() }
  function close() { control.current?.abort(); onClose() }

  function save() {
    // Read fresh at the tap: what was there at this moment is what Undo puts back.
    const fresh = new Map(items.map(i => [i.id, i]))
    const entries = reviewed.flatMap(r => {
      const item = fresh.get(r.item.id)
      const keys = new Set(r.changes.filter(c => !off.has(`${r.item.id}:${c.key}`)).map(c => c.key as TidyKey))
      return item && keys.size ? [{ item, suggestion: r.suggestion, keys }] : []
    })
    apply.mutate({ entries }, { onSuccess: () => onClose() })
  }

  const nothing = result && reviewed.length === 0
  const costLine = result && result.costUsd > 0 ? costNote(result.costUsd) : ''

  return (
    <ModalShell onClose={close} title={single ? 'Tidy up info' : 'Tidy up product info'} size="md" dismissible={!apply.isPending}
      footer={
        <div className="flex items-center gap-2">
          {running && <Button onClick={stop}>Stop</Button>}
          <Button onClick={close} className="ml-auto" disabled={apply.isPending}>{reviewed.length ? 'Cancel' : 'Close'}</Button>
          {reviewed.length > 0 && !running && (
            <Button variant="primary" onClick={save} loading={apply.isPending} disabled={tickedCount === 0}>Save {tickedCount} {tickedCount === 1 ? 'change' : 'changes'}</Button>
          )}
        </div>
      }>
      <div className="flex flex-col gap-3">
        {!single && !running && !result && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body text-fg-muted">
              AI looks at {rows.length} {rows.length === 1 ? 'thing' : 'things'} (wishes and things you own), one at a time, and suggests a cleaner name (“Brand Model variant, colour”, in the store’s own words), the brand, the model and one of your own categories. It may search the web to confirm a brand and model. It never touches a link, picture, price or date. You review every change, and nothing is saved without your tap.
            </p>
            {estimate
              ? <p className="text-meta text-fg-muted">Worst case up to ≈ ${estimate.total < 1 ? estimate.total.toFixed(3) : estimate.total.toFixed(2)} for {rows.length} {rows.length === 1 ? 'thing' : 'things'} (up to ≈ ${estimate.each.toFixed(3)} each). What it really costs is usually a small part of that, and it is shown after.</p>
              : <p className="text-meta text-fg-muted">{describe.isError ? "The cost couldn't be worked out — try again later." : 'Working out the cost…'}</p>}
            <Button variant="primary" onClick={start} disabled={!estimate || rows.length === 0}>Start</Button>
            {rows.length === 0 && !isLoading && <p className="text-meta text-fg-muted">Nothing to tidy yet.</p>}
          </div>
        )}
        {running && (
          <p role="status" className="flex items-center gap-2 text-body text-fg-muted">
            <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
            <span className="min-w-0"><Truncate>{step ? `${step.total > 1 ? `${step.done + 1} of ${step.total} · ` : ''}${step.name}` : 'Starting…'}</Truncate></span>
          </p>
        )}
        {running && found.size > 0 && <p className="text-meta text-fg-muted">{found.size} {found.size === 1 ? 'suggestion' : 'suggestions'} so far.</p>}
        {result && (
          <p className="text-meta text-fg-muted">
            {[
              reviewed.length ? `${reviewed.length} ${reviewed.length === 1 ? 'thing has' : 'things have'} suggestions` : null,
              rows.length - reviewed.length - result.failed > 0 ? `${rows.length - reviewed.length - result.failed} had nothing to change` : null,
              result.failed ? `${result.failed} could not be read` : null,
              result.stopped ? 'stopped' : null, costLine,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
        {result?.halted && <p className="text-meta text-warn">{result.halted}</p>}
        {run.isError && !running && <p className="text-meta text-warn">{run.error instanceof Error ? run.error.message : 'Nothing was read.'}</p>}
        {nothing && !running && <p className="text-body text-fg-muted">{single ? 'Nothing to tidy — it looks fine as it is.' : 'Nothing to change.'}</p>}
        {reviewed.length > 0 && !running && (
          <ul className="flex flex-col gap-2">
            {reviewed.map(({ item, changes }) => (
              <li key={item.id} className="flex flex-col gap-1 rounded-row border border-line bg-surface-2 p-3">
                {!single && <p className="text-body font-medium"><Truncate>{item.title}</Truncate></p>}
                {changes.map(c => {
                  const key = `${item.id}:${c.key}`
                  return (
                    <label key={c.key} className="flex items-start gap-2 text-body text-fg-2">
                      <input type="checkbox" checked={!off.has(key)} aria-label={`${c.label} of ${item.title}`}
                        onChange={e => setOff(s => { const n = new Set(s); if (e.target.checked) n.delete(key); else n.add(key); return n })}
                        className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent-500" />
                      <span className="w-14 shrink-0 text-meta text-fg-muted">{c.label}</span>
                      <span className="min-w-0 flex-1 break-words">
                        <span className="text-fg-muted">{c.before}</span>
                        <ArrowRight aria-hidden className="mx-1 inline h-3 w-3 text-fg-muted" />
                        <span className="font-medium text-fg">{c.after}</span>
                      </span>
                    </label>
                  )
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  )
}
