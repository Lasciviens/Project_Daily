import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ListTree, RotateCcw } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, SegmentedControl, Truncate, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { useKoboConfig, useKoboDeviceState, useSaveKoboConfig } from '../../hooks/useKoboControl'
import { MENU_SEPARATOR, menuTabs, moveMenuItem, type MenuSide } from '../../koboSettings'
import { MIN_LABEL_COVERAGE, effectiveOrder, inside, labelCoverage, listName, moveTargets, rowsToShow, stepItem, visibleItems } from '../../kobo/menuView'
import { HelpTip } from '../../../../shared/components/HelpTip'

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
  const { order, labels, tabs, targets, complete } = useMemo(() => {
    const o = effectiveOrder(report, overrides)
    const l = report?.labels ?? {}
    const t = report ? menuTabs({ order: o, labels: l }) : []
    return { order: o, labels: l, tabs: t, targets: moveTargets(o, l, t), complete: labelCoverage(t, l, o) >= MIN_LABEL_COVERAGE }
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
  function resetList(tab: string) {
    const rest = { ...(overrides ?? {}) }
    delete rest[tab]
    const menu_order = { ...(config.data?.menu_order ?? {}) }
    if (Object.keys(rest).length) menu_order[side] = rest
    else delete menu_order[side]
    save.mutate({ menu_order })
  }

  return (
    <Card>
      <CardHeader title="Menu order" icon={<ListTree />} wrap
        subtitle="KOReader’s top menu has a row of tabs (icons). Here you choose what each tab lists, and in which order."
        action={<div className="flex items-center gap-2">
          <HelpTip label="About menu order">
            <p>When you tap the top of the screen, KOReader opens a menu with a row of icon tabs. Each tab is a list.</p>
            <p className="mt-2">Move an item up or down within its list, or move it to another tab. For example, put <span className="font-semibold text-fg">Lasci's Board</span> at the top of the wrench (Tools) tab.</p>
            <p className="mt-2">“Library” is the menu in the book list; “While reading” is the menu inside a book. The Kobo applies changes at its next sync and asks to restart KOReader.</p>
          </HelpTip>
          {overrides && Object.keys(overrides).length > 0 && <Button size="sm" icon={<RotateCcw />} onClick={() => { void reset() }}>Reset all</Button>}
        </div>} />
      <SegmentedControl size="sm" options={[...SIDES]} value={side} onChange={v => setSide(v as MenuSide)} />
      {report && !complete && (
        <p className="mt-3 rounded-control border border-line bg-surface-2 px-3 py-2 text-meta text-fg-2">
          The Kobo sent only part of this menu (most items have no name yet), so it can’t be edited safely. Plugin 1.2 sends the whole menu; after its next sync everything shows here.
        </p>
      )}
      {!report ? (
        <p className="mt-3 text-meta text-fg-muted">
          {side === 'reader'
            ? 'The reader menu loads the first time the Kobo syncs while a book is open (plugin 1.1).'
            : 'The menus load after the Kobo’s first sync with plugin 1.1.'}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {tabs.map(tab => {
            const list = order[tab] ?? []
            const visible = new Set(visibleItems(list, labels, order))
            const rows = rowsToShow(list, labels, order)
            const expanded = open === tab
            return (
              <li key={tab}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(o => (o === tab ? null : tab))}
                  className="flex min-h-[44px] w-full items-center gap-2 text-left">
                  <span className="flex-1 text-body font-semibold text-fg">{listName(tab, labels)}</span>
                  <span className="text-micro tabular-nums text-fg-muted">{rows.filter(r => r.id !== MENU_SEPARATOR).length}</span>
                  {overrides?.[tab] && <span className="text-micro font-semibold text-accent-600">Changed by you</span>}
                  <ChevronDown aria-hidden className={cx('h-4 w-4 text-fg-muted transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && (
                  <ol className="flex flex-col gap-0.5 pb-2">
                    {overrides?.[tab] && (
                      <li className="pb-1"><Button size="sm" icon={<RotateCcw />} disabled={save.isPending} onClick={() => resetList(tab)}>Undo my changes to this list</Button></li>
                    )}
                    {rows.map(({ id, index: i }) => (
                      <li key={`${id}-${i}`} className="flex items-center gap-1">
                        {id === MENU_SEPARATOR ? (
                          <span aria-label="Divider line" className="mx-2 h-px flex-1 bg-line" />
                        ) : (
                          <Truncate className="min-w-0 flex-1 px-2 text-body text-fg">
                            {listName(id, labels)}{order[id] ? ' ›' : ''}
                          </Truncate>
                        )}
                        <IconButton label={`Move ${listName(id, labels)} up`} disabled={save.isPending || !complete}
                          onClick={() => { const n = stepItem(list, i, -1, visible, id); if (n) write({ [tab]: n }) }}><ArrowUp /></IconButton>
                        <IconButton label={`Move ${listName(id, labels)} down`} disabled={save.isPending || !complete}
                          onClick={() => { const n = stepItem(list, i, 1, visible, id); if (n) write({ [tab]: n }) }}><ArrowDown /></IconButton>
                        {id !== MENU_SEPARATOR && (
                          <select aria-label={`Move ${listName(id, labels)} to another tab`} value="" disabled={save.isPending || !complete}
                            className="input min-h-[44px] w-24 text-meta"
                            onChange={e => { if (e.target.value) write(moveMenuItem(order, id, e.target.value, 0)) }}>
                            <option value="">Move…</option>
                            {targets.filter(t => t.id !== tab && !inside(order, id, t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
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
