import { useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Pencil, Search, X } from 'lucide-react'
import { useSsSystems } from '../../../scraper/useScrape'
import type { SsSystem } from '../../../scraper/ssApi'
import { searchableLength } from '../../../scraper/ssPlan'
import { fieldErrors, formProblem, romFilled, searchBy, withSearchBy, type SearchBy, type SearchForm } from './tgScrapeModel'
import { TgChip, TgSegmented } from './TgScrapeParts'

/** ES-DE folder → the ScreenScraper system it means (lowest id wins, the rule
 *  the server uses — hack collections were numbered after the real console). */
function resolveFolder(systems: SsSystem[], folder: string): SsSystem | null {
  const f = folder.trim().toLowerCase()
  if (!f) return null
  if (/^\d+$/.test(f)) return systems.find(s => String(s.id) === f) ?? null
  return systems.filter(s => (s.retropie_names ?? []).includes(f)).sort((a, b) => a.id - b.id)[0] ?? null
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-medium text-[var(--tg-text-2)]">{label}{hint && <span className="ml-1 font-normal tg-faint">{hint}</span>}</span>
      {children}
      {error && <span className="text-[11.5px] text-[var(--tg-red)]">{error}</span>}
    </label>
  )
}

/**
 * Search by name, by ROM (file name, size, CRC/MD5/SHA1, serial, ScreenScraper
 * id), or both — sent at once and merged. Folded, it is one line of chips
 * saying exactly what was searched, with Edit.
 */
export function TgScrapeSearchForm({ form, onChange, onSearch, searching, hasTarget, open = true, onOpen }: {
  form: SearchForm
  onChange: (f: SearchForm) => void
  onSearch: () => void
  searching: boolean
  hasTarget: boolean
  open?: boolean
  onOpen?: () => void
}) {
  const systems = useSsSystems()
  const list = useMemo(() => systems.data ?? [], [systems.data])
  const resolved = resolveFolder(list, form.system)
  const filled = romFilled(form)
  const errors = fieldErrors(form)
  const [romOpen, setRomOpen] = useState(() => Object.keys(errors).length > 0)
  const romId = useId()
  const set = (patch: Partial<SearchForm>) => onChange({ ...form, ...patch })
  const problem = formProblem(form)
  const shortName = form.useName && form.name.trim() && searchableLength(form.name) < 4
  const by = searchBy(form)
  const sysName = form.system ? (resolved?.name ?? form.system) : 'Any system'

  if (!open) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px]"><span className="tg-muted">Searched </span>{form.useName && form.name.trim() ? `“${form.name.trim()}”` : 'by ROM'}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <TgChip>{sysName}</TgChip>
            {form.useRom && form.filename.trim() && <TgChip>ROM file</TgChip>}
            {form.useRom && (form.crc || form.md5 || form.sha1) && <TgChip>Hash</TgChip>}
            {form.useRom && form.jeuId.trim() && <TgChip>{form.previousId ? 'Previous match' : `id ${form.jeuId}`}</TgChip>}
          </div>
        </div>
        <button type="button" onClick={onOpen} className="tg-btn tg-btn-secondary shrink-0 !px-3 !text-[13px]" aria-label="Edit search">
          <Pencil aria-hidden className="h-4 w-4" strokeWidth={2} /> Edit
        </button>
      </div>
    )
  }

  // The select's value: the ES-DE folder as-is when that is what the form
  // holds, so a game's own folder stays selected; otherwise a numeric id.
  const folderOption = form.system && !/^\d+$/.test(form.system)
    ? { value: form.system, label: resolved ? `${resolved.name ?? form.system} (${form.system})` : `${form.system} (not in their list)` }
    : null
  const byOptions: { value: SearchBy; label: string; disabled?: boolean; hint?: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'rom', label: 'ROM', disabled: filled === 0, hint: filled === 0 ? 'Add a file name, a hash or an id below first' : 'Exact matches by the ROM itself' },
    { value: 'both', label: 'Both', disabled: filled === 0, hint: filled === 0 ? 'Add ROM info below first' : undefined },
  ]

  return (
    <form
      className="tg-panel flex flex-col gap-3 p-4"
      onSubmit={e => { e.preventDefault(); onSearch() }}
      aria-label="Search ScreenScraper"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="tg-section-label">Search by</h2>
        <TgSegmented label="Search by" value={filled === 0 ? 'name' : by} options={byOptions} onChange={v => onChange(withSearchBy(form, v))} />
      </div>

      {by !== 'rom' && (
        <Field label="Name">
          <span className="relative block">
            <input
              value={form.name} onChange={e => set({ name: e.target.value })}
              placeholder="e.g. Sonic the Hedgehog" className="tg-input pl-3 pr-12" autoComplete="off" enterKeyHint="search"
            />
            {form.name && (
              <button type="button" onClick={() => set({ name: '' })} aria-label="Clear name" className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-lg tg-muted">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </span>
          {shortName && <span className="text-[11.5px] text-[var(--tg-red)]">At least 4 letters are needed to search by name ("the" does not count).</span>}
        </Field>
      )}

      <Field label="System" hint={form.system && !resolved ? '— searches every system' : undefined}>
        <select value={form.system} onChange={e => set({ system: e.target.value })} className="tg-input px-3">
          <option value="">Any system</option>
          {folderOption && <option value={folderOption.value}>{folderOption.label}</option>}
          {list.map(s => <option key={s.id} value={String(s.id)}>{s.name ?? `System ${s.id}`}</option>)}
        </select>
      </Field>

      <div className="rounded-xl border border-[var(--tg-border)]">
        <button
          type="button" onClick={() => setRomOpen(o => !o)} aria-expanded={romOpen} aria-controls={romId}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 px-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">ROM info &amp; ScreenScraper id</span>
            <span className="block truncate text-[11.5px] tg-muted">
              {filled
                ? [form.filename.trim() ? form.filename.trim() : null, form.crc || form.md5 || form.sha1 ? 'hash' : null, form.jeuId ? (form.previousId ? 'previous match' : `id ${form.jeuId}`) : null].filter(Boolean).join(' · ')
                : 'A hash finds the exact dump, even under another name'}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 tg-muted transition-transform ${romOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {romOpen && (
          <div id={romId} className="grid grid-cols-1 gap-3 border-t border-[var(--tg-border)] p-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="File name" hint="as on the handheld, with extension">
                <input value={form.filename} onChange={e => set({ filename: e.target.value })} className="tg-input px-3" autoComplete="off" spellCheck={false} />
              </Field>
            </div>
            <Field label="Size" hint="bytes">
              <input value={form.size} onChange={e => set({ size: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" className="tg-input px-3" />
            </Field>
            <Field label="CRC32" error={errors.crc}>
              <input value={form.crc} onChange={e => set({ crc: e.target.value.trim() })} aria-invalid={!!errors.crc} className="tg-input px-3 font-mono" autoComplete="off" spellCheck={false} maxLength={8} />
            </Field>
            <Field label="MD5" error={errors.md5}>
              <input value={form.md5} onChange={e => set({ md5: e.target.value.trim() })} aria-invalid={!!errors.md5} className="tg-input px-3 font-mono" autoComplete="off" spellCheck={false} maxLength={32} />
            </Field>
            <Field label="SHA1" error={errors.sha1}>
              <input value={form.sha1} onChange={e => set({ sha1: e.target.value.trim() })} aria-invalid={!!errors.sha1} className="tg-input px-3 font-mono" autoComplete="off" spellCheck={false} maxLength={40} />
            </Field>
            <Field label="Serial" hint="disc/cart id">
              <input value={form.serial} onChange={e => set({ serial: e.target.value })} className="tg-input px-3" autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="ScreenScraper id" hint={form.previousId ? 'the previous match' : 'digits'} error={errors.jeuId}>
              <input value={form.jeuId} onChange={e => set({ jeuId: e.target.value.replace(/[^\d]/g, ''), previousId: false })} inputMode="numeric" className="tg-input px-3" />
            </Field>
          </div>
        )}
      </div>

      <button type="submit" disabled={!!problem || searching} className="tg-btn tg-btn-primary w-full">
        <Search aria-hidden className={`h-4 w-4 ${searching ? 'animate-pulse' : ''}`} strokeWidth={2.2} />
        {searching ? 'Searching…' : 'Search'}
      </button>
      {problem && <p className="-mt-1 text-center text-[11.5px] tg-muted">{problem}</p>}
      {!hasTarget && <p className="-mt-1 text-center text-[11.5px] tg-muted">No game picked — you can look at results, just not save them.</p>}
    </form>
  )
}
