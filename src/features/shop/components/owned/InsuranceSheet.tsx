import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Download, Printer } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, EmptyState, MetaLine, Truncate } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { toast } from '../../../../app/store'
import { useShopCategories, useShopItems } from '../../hooks/useShop'
import { useShopMoney } from '../../hooks/useShopMoney'
import { useWatchMap } from '../../hooks/useShopPrices'
import { insuranceCsv, insuranceFileName, insuranceRows, insuranceTotals, type InsuranceRow } from '../../insuranceList'
import { complete } from '../../ownModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'

/** What a row is worth, in words: the new price now when a watch read one, else what was paid. */
function valueWords(r: InsuranceRow): string | null {
  if (r.newNow?.nok != null) return `new now ${money(r.newNow.nok)}`
  return null
}

function facts(r: InsuranceRow): (string | false | null)[] {
  return [
    r.accessoryOf ? `accessory of ${r.accessoryOf}` : r.category || null,
    r.store,
    r.bought && `bought ${r.approx ? '≈ ' : ''}${formatDate(r.bought)}`,
    r.serial && `serial ${r.serial}`,
  ]
}

/** Saves the list as a file on this device (a phone opens its share sheet). */
function saveCsv(rows: readonly InsuranceRow[], today: string) {
  const name = insuranceFileName(today)
  const url = URL.createObjectURL(new Blob([insuranceCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  toast.success(`Saved ${name}`)
}

// The print view: only the list on the page, in the light scheme's system colours (no app tokens: paper is light).
const PRINT_CSS = `
@media screen { [data-print-root] { display: none !important; } }
@media print {
  body > *:not([data-print-root]) { display: none !important; }
  [data-print-root] { display: block !important; color-scheme: light; color: CanvasText; background: Canvas; font: 11pt/1.4 Inter, Arial, sans-serif; }
  [data-print-root] table { width: 100%; border-collapse: collapse; }
  [data-print-root] th, [data-print-root] td { text-align: left; padding: 4pt 6pt; border-bottom: 0.5pt solid GrayText; vertical-align: top; }
  [data-print-root] td.num, [data-print-root] th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
}`

function PrintView({ rows, today }: { rows: readonly InsuranceRow[]; today: string }) {
  const t = insuranceTotals(rows)
  return createPortal(
    <div data-print-root>
      <style>{PRINT_CSS}</style>
      <h1>Insurance list · {formatDate(today)}</h1>
      <p>{t.things} things · paid {complete(t.paid) ? money(t.paid.nok) : 'not all known'}{t.checked ? ` · new now ${money(t.newNow)} (${t.checked} checked)` : ''}</p>
      <table>
        <thead><tr><th>Name</th><th>Category · store</th><th>Bought</th><th>Serial</th><th className="num">Paid</th><th className="num">New now</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.title}{r.accessoryOf ? ` (accessory of ${r.accessoryOf})` : ''}</td>
              <td>{[r.category, r.store].filter(Boolean).join(' · ')}</td>
              <td>{r.bought ? `${r.approx ? '≈ ' : ''}${formatDate(r.bought)}` : ''}</td>
              <td>{r.serial ?? ''}</td>
              <td className="num">{complete(r.paid) ? money(r.paid.nok) : r.price != null ? money(r.price, r.currency) : ''}</td>
              <td className="num">{r.newNow?.nok != null ? money(r.newNow.nok) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  )
}

/**
 * The insurance list (Shop step C): everything you own — accessories too — and its value, what you paid and the
 * new price now when a price watch read one (a new offer or the shop's own page), the most valuable first. Saved
 * as a CSV file or printed.
 */
export function InsuranceSheet({ onClose }: { onClose: () => void }) {
  const today = todayStr()
  const { data: items = [], isLoading } = useShopItems()
  const { data: categories = [] } = useShopCategories()
  const { ctx } = useShopMoney()
  const watches = useWatchMap()
  const rows = useMemo(() => insuranceRows(items, categories, ctx, watches), [items, categories, ctx, watches])
  const t = insuranceTotals(rows)
  const subtitle = rows.length
    ? `${t.things} thing${t.things === 1 ? '' : 's'} · paid ${complete(t.paid) ? money(t.paid.nok) : 'not all known'}${t.checked ? ` · new now ${money(t.newNow)} (${t.checked} checked)` : ''}`
    : undefined
  return (
    <ModalShell open onClose={onClose} title="Insurance list" subtitle={subtitle} size="lg" bodyClassName="px-2 pb-4 pt-1 sm:px-3 sm:pb-5"
      footer={rows.length > 0 && (
        <div className="flex items-center gap-2">
          <Button icon={<Printer />} onClick={() => window.print()}>Print</Button>
          <Button variant="primary" icon={<Download />} className="ml-auto" onClick={() => saveCsv(rows, today)}>Save as CSV</Button>
        </div>
      )}>
      {isLoading ? <p className="px-2 py-6 text-center text-body text-fg-muted">Loading…</p>
        : rows.length === 0 ? <EmptyState title="Nothing is yours yet" description="What you own lands here with what it cost — mark a wish bought, or add something you own." />
        : (
          <ul className="flex flex-col">
            {rows.map(r => (
              <li key={r.id} className="row py-1.5">
                <span className="min-w-0 flex-1">
                  <Truncate className="text-body font-medium text-fg">{r.title}</Truncate>
                  <span className="block text-meta text-fg-muted"><MetaLine as="span" items={facts(r)} /></span>
                </span>
                <span className="shrink-0 text-right text-meta tabular-nums">
                  <AmountText amount={r.paid} unknown={r.gift ? 'Gift' : 'Price missing'} className="block font-semibold text-fg" />
                  {valueWords(r) && <span className="block text-fg-muted">{valueWords(r)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      {rows.length > 0 && <PrintView rows={rows} today={today} />}
    </ModalShell>
  )
}
