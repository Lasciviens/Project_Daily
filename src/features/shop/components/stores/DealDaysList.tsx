import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { MoreHorizontal, Pencil, Plus, Power, RotateCcw } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, MetaLine, SegmentedControl, Skeleton, TonePill, Truncate, cx } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useDealDayRows, useEditDealDay, useResetDealDay } from '../../hooks/useShopStores'
import { dealDayProblem, type DealDayInput } from '../../api/shopStoresApi'
import { dealSlugOf } from '../../storeRows'
import { dealNextWords, dealRuleWords } from '../../storeWords'
import type { ShopDealDay, ShopDealDayEdit, ShopDealDayRow } from '../../types'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const NTH: { value: number; label: string }[] = [{ value: 1, label: '1st' }, { value: 2, label: '2nd' }, { value: 3, label: '3rd' }, { value: 4, label: '4th' }, { value: -1, label: 'last' }]

/** A deal day's fields as the form holds them, from what counts now (the owner's version, else the app's). */
function inputOf(row: ShopDealDayRow | null): DealDayInput {
  const d: ShopDealDay | ShopDealDayEdit | null = row?.own ?? row?.source ?? null
  return d
    ? { slug: row?.slug ?? d.slug, name: d.name, rule_kind: d.rule_kind, month: d.month, day: d.day, weekday: d.weekday, nth: d.nth, offset_days: d.offset_days, length_days: d.length_days, off: row?.own?.off ?? false, source_url: d.source_url }
    : { slug: '', name: '', rule_kind: 'fixed', month: 11, day: 1, weekday: null, nth: null, offset_days: 0, length_days: 1, off: false, source_url: null }
}

/** Edit a deal day (the app's becomes the owner's own version; the app's rule stays as it is) or add one of the owner's own. */
function DealDaySheet({ row, taken, onClose }: { row: ShopDealDayRow | null; taken: ReadonlySet<string>; onClose: () => void }) {
  const save = useEditDealDay()
  const [v, setV] = useState<DealDayInput>(() => inputOf(row))
  const set = (p: Partial<DealDayInput>) => setV(x => ({ ...x, ...p }))
  const slug = row ? row.slug : dealSlugOf(v.name) ?? ''
  const input: DealDayInput = { ...v, slug }
  const problem = !row && slug && taken.has(slug) ? 'There is a deal day with that name already' : !v.name.trim() ? 'A deal day needs a name' : dealDayProblem(input)
  const num = (s: string, lo: number, hi: number) => { const n = Number(s.replace(/[^\d-]/g, '')); return Number.isInteger(n) ? Math.max(lo, Math.min(hi, n)) : lo }

  return (
    <ModalShell onClose={onClose} title={row ? `Edit ${row.own?.name ?? row.source?.name ?? 'deal day'}` : 'New deal day'} size="sm" compact dismissible={!save.isPending}
      footer={
        <div className="flex items-center gap-2">
          {problem && <span data-tone="warn" className="tone-text min-w-0 flex-1 text-meta">{problem}</span>}
          <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto">Cancel</Button>
          <Button variant="primary" size="sm" disabled={!!problem} loading={save.isPending}
            onClick={() => { if (!problem) save.mutate(input, { onSuccess: onClose }) }}>{row ? 'Save' : 'Add'}</Button>
        </div>
      }>
      <div className="flex flex-col gap-2.5">
        <div>
          <label htmlFor="deal-name" className="field-label">Name</label>
          <input id="deal-name" value={v.name} onChange={e => set({ name: e.target.value })} maxLength={80} placeholder="Payday sale" className="input input-sm max-w-xs" />
        </div>
        <SegmentedControl<'fixed' | 'nth_weekday'> size="sm" value={v.rule_kind}
          onChange={k => set(k === 'fixed' ? { rule_kind: k, day: v.day ?? 1, weekday: null, nth: null } : { rule_kind: k, day: null, weekday: v.weekday ?? 4, nth: v.nth ?? 4 })}
          options={[{ value: 'fixed', label: 'A day of the year' }, { value: 'nth_weekday', label: 'A weekday of a month' }]} />
        <div className="flex flex-wrap items-center gap-1.5">
          {v.rule_kind === 'fixed'
            ? <input value={v.day ?? ''} onChange={e => set({ day: num(e.target.value, 1, 31) })} inputMode="numeric" aria-label="Day of the month" className="input input-sm w-[4rem] tabular-nums" />
            : <>
              <select value={v.nth ?? 4} onChange={e => set({ nth: Number(e.target.value) })} aria-label="Which one" className="select input-sm w-auto">
                {NTH.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
              <select value={v.weekday ?? 4} onChange={e => set({ weekday: Number(e.target.value) })} aria-label="Weekday" className="select input-sm w-auto">
                {WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
              </select>
              <span className="text-meta text-fg-muted">of</span>
            </>}
          <select value={v.month} onChange={e => set({ month: Number(e.target.value) })} aria-label="Month" className="select input-sm w-auto">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-2 text-meta font-medium text-fg-muted">
            Days after
            <input value={v.offset_days} onChange={e => set({ offset_days: num(e.target.value, -31, 31) })} inputMode="numeric" className="input input-sm w-[4rem] tabular-nums" />
          </label>
          <label className="flex items-center gap-2 text-meta font-medium text-fg-muted">
            Lasts
            <input value={v.length_days} onChange={e => set({ length_days: num(e.target.value, 1, 31) })} inputMode="numeric" className="input input-sm w-[4rem] tabular-nums" />
            days
          </label>
        </div>
        <p className="text-meta text-fg-muted">{dealRuleWords(input)}</p>
      </div>
    </ModalShell>
  )
}

/**
 * The deal days the Shop counts (Needs a look): 190's, each editable as the owner's own version (190's rule stays
 * as it is; Reset takes the owner's away), turned off, or one of the owner's own.
 */
export function DealDaysList() {
  const today = todayStr()
  const q = useDealDayRows()
  const edit = useEditDealDay()
  const reset = useResetDealDay()
  const [editing, setEditing] = useState<ShopDealDayRow | null | 'new'>(null)
  const rows = q.data ?? []
  const taken = new Set(rows.map(r => r.slug))

  if (q.isLoading) return <div aria-hidden className="flex flex-col gap-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-11 w-full" rounded="rounded-row" />)}</div>
  if (q.isError) {
    return <p className="text-body text-fg-muted">Couldn't load the deal days. <button type="button" onClick={() => void q.refetch()} className="font-semibold text-accent-600 hover:underline">Try again</button></p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-fg-muted">Needs a look counts these for the wishes with a target. Each is a rule, so it comes back every year.</p>
      <ul className="flex flex-col">
        {rows.map(r => {
          const shown = r.own ?? r.source
          if (!shown) return null
          const off = !!r.own?.off
          const name = r.own?.name ?? r.source?.name ?? r.slug
          const next = r.effective ? dealNextWords(r.effective, today) : null
          return (
            <li key={r.slug} className="flex items-center gap-1.5 border-b border-line py-1.5 last:border-b-0">
              <span className="min-w-0 flex-1 px-1">
                <Truncate as="span" className={cx('block text-body font-medium', off ? 'text-fg-muted' : 'text-fg')}>{name}</Truncate>
                <MetaLine as="span" className="block text-meta tabular-nums text-fg-muted" items={[dealRuleWords(shown), off ? 'turned off' : next]} />
              </span>
              {r.own && !off && <TonePill tone="info" className="shrink-0">{r.source ? 'You edited it' : 'Yours'}</TonePill>}
              {off && <TonePill tone="neutral" className="shrink-0">Off</TonePill>}
              <Menu as="div" className="shrink-0">
                <MenuButton className="icon-btn h-8 w-8 text-fg-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Deal day actions: ${name}`} title="Edit, turn off or reset">
                  <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
                </MenuButton>
                <MenuItems anchor="bottom end" transition className="menu z-toast w-56 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
                  <MenuItem><button type="button" onClick={() => setEditing(r)} className="menu-item"><Pencil aria-hidden className="h-4 w-4" /> Edit</button></MenuItem>
                  <MenuItem>
                    <button type="button" className="menu-item"
                      onClick={() => edit.mutate({ ...inputOf(r), off: !off, done: `${name} ${off ? 'turned on' : 'turned off'}` })}>
                      <Power aria-hidden className="h-4 w-4" /> {off ? 'Turn on' : 'Turn off'}
                    </button>
                  </MenuItem>
                  {r.own && r.source && (
                    <MenuItem><button type="button" onClick={() => reset.mutate({ slug: r.slug, name })} className="menu-item"><RotateCcw aria-hidden className="h-4 w-4" /> Back to the app's rule</button></MenuItem>
                  )}
                </MenuItems>
              </Menu>
            </li>
          )
        })}
      </ul>
      <Button size="sm" icon={<Plus />} className="w-fit" onClick={() => setEditing('new')}>Deal day</Button>
      {editing && <DealDaySheet row={editing === 'new' ? null : editing} taken={taken} onClose={() => setEditing(null)} />}
    </div>
  )
}
