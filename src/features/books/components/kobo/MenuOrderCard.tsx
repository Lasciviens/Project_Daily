import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ListTree, RotateCcw } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, SegmentedControl, Truncate, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { useKoboConfig, useKoboDeviceState, useSaveKoboConfig } from '../../hooks/useKoboControl'
import { MENU_SEPARATOR, menuTabs, moveMenuItem, type MenuSide } from '../../koboSettings'
import { effectiveOrder, listName, moveTargets, stepItem, visibleItems } from '../../kobo/menuView'

const SIDES = [{ value: 'filemanager', label: 'Library' }, { value: 'reader', label: 'While reading' }] as const

/** Reorder KOReader's menus — e.g. put Lasci's Board first, or move it to another tab. */
export function MenuOrderCard() {
  const [side, setSide] = useState<MenuSide>('filemanager')
  const [open, setOpen] = useState<string | null>('tools')
  const device = useKoboDeviceState()
  const config = useKoboConfig()
  const save = useSaveKoboConfig()
  const modal = useEntityModal()
  const report = device.data?.report?.menus?.[side]
  const overrides = config.data?.menu_order?.[side]
  const { order, labels, tabs, targets } = useMemo(() => {
    const o = effectiveOrder(report, overrides)
    const l = report?.labels ?? {}
    const t = report ? menuTabs({ order: o, labels: l }) : []
    return { order: o, labels: l, tabs: t, targets: moveTargets(o, l, t) }
  }, [report, overrides])

  const write = (changed: Record<string, string[]>) => {
    const menu_order = { ...(config.data?.menu_order ?? {}), [side]: { ...(overrides ?? {}), ...changed } }
    save.mutate({ menu_order })
  }
  async function reset() {
    if (!await modal.confirm({ title: 'Go back to KOReader’s own menu order?', confirmLabel: 'Reset' })) return
    const menu_order = { ...(config.data?.menu_order ?? {}) }
    delete menu_order[side]
    save.mutate({ menu_order })
  }

  return (
    <Card>
      <CardHeader title="Menu order" icon={<ListTree />} wrap
        subtitle="Move items up and down, or into another tab. The Kobo asks to restart KOReader after it applies a change."
        action={overrides && Object.keys(overrides).length > 0
          ? <Button size="sm" icon={<RotateCcw />} onClick={() => { void reset() }}>Reset</Button> : undefined} />
      <SegmentedControl size="sm" options={[...SIDES]} value={side} onChange={v => setSide(v as MenuSide)} />
      {!report ? (
        <p className="mt-3 text-meta text-fg-muted">
          {side === 'reader'
            ? 'The reader menu loads after the Kobo syncs once while a book is open (plugin 1.1).'
            : 'The menus load after the Kobo’s first sync with plugin 1.1.'}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {tabs.map(tab => {
            const list = order[tab] ?? []
            const shown = visibleItems(list, labels, order)
            const visible = new Set(shown)
            const expanded = open === tab
            return (
              <li key={tab}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(o => (o === tab ? null : tab))}
                  className="flex min-h-[44px] w-full items-center gap-2 text-left">
                  <span className="flex-1 text-body font-semibold text-fg">{listName(tab, labels)}</span>
                  {overrides?.[tab] && <span className="text-micro text-accent-600">changed</span>}
                  <ChevronDown aria-hidden className={cx('h-4 w-4 text-fg-muted transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && (
                  <ol className="flex flex-col gap-0.5 pb-2">
                    {list.map((id, i) => !visible.has(id) ? null : (
                      <li key={`${id}-${i}`} className="flex items-center gap-1">
                        {id === MENU_SEPARATOR ? (
                          <span className="flex-1 px-2 text-micro text-fg-faint">— separator —</span>
                        ) : (
                          <Truncate className="min-w-0 flex-1 px-2 text-body text-fg">
                            {listName(id, labels)}{order[id] ? ' ›' : ''}
                          </Truncate>
                        )}
                        <IconButton label={`Move ${listName(id, labels)} up`} disabled={save.isPending}
                          onClick={() => { const n = stepItem(list, i, -1, visible, id); if (n) write({ [tab]: n }) }}><ArrowUp /></IconButton>
                        <IconButton label={`Move ${listName(id, labels)} down`} disabled={save.isPending}
                          onClick={() => { const n = stepItem(list, i, 1, visible, id); if (n) write({ [tab]: n }) }}><ArrowDown /></IconButton>
                        {id !== MENU_SEPARATOR && (
                          <select aria-label={`Move ${listName(id, labels)} to another tab`} value="" disabled={save.isPending}
                            className="input min-h-[44px] w-24 text-meta"
                            onChange={e => { if (e.target.value) write(moveMenuItem(order, id, e.target.value, 0)) }}>
                            <option value="">Move…</option>
                            {targets.filter(t => t.id !== tab && t.id !== id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
