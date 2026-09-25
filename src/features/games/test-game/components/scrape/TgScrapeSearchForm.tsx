import { useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { useSsSystems } from '../../../scraper/useScrape'
import type { SsSystem } from '../../../scraper/ssApi'
import { searchableLength } from '../../../scraper/ssPlan'
import { formProblem, romFilled, type SearchForm } from './tgScrapeModel'

/** ES-DE folder → the ScreenScraper system it means (lowest id wins, the rule
 *  the server uses — hack collections were numbered after the real console). */
function resolveFolder(systems: SsSystem[], folder: string): SsSystem | null {
  const f = folder.trim().toLowerCase()
  if (!f) return null
  if (/^\d+$/.test(f)) return systems.find(s => String(s.id) === f) ?? null
  return systems.filter(s => (s.retropie_names ?? []).includes(f)).sort((a, b) => a.id - b.id)[0] ?? null
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-medium text-[var(--tg-text-2)]">{label}{hint && <span className="ml-1 font-normal tg-faint">{hint}</span>}</span>
      {children}
    </label>
  )
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3 text-[12.5px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
        on ? 'border-[var(--tg-accent)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]' : 'border-[var(--tg-border)] text-[var(--tg-muted)]'
      }`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${on ? 'bg-[var(--tg-accent)]' : 'bg-[var(--tg-border-strong)]'}`} />
      {children}
    </button>
  )
}

/**
 * Search by name, by ROM (filename, size, CRC/MD5/SHA1, serial), by
 * ScreenScraper id — any mix, all sent at once and merged. Each part can be
 * switched off, so "with or without ROM info" is one tap.
 */
export function TgScrapeSearchForm({ form, onChange, onSearch, searching, hasTarget }: {
  form: SearchForm
  onChange: (f: SearchForm) => void
  onSearch: () => void
  searching: boolean
  hasTarget: boolean
}) {
  const systems = useSsSystems()
  const list = useMemo(() => systems.data ?? [], [systems.data])
  const resolved = resolveFolder(list, form.system)
  const filled = romFilled(form)
  const [romOpen, setRomOpen] = useState(false)
  const romId = useId()
  const set = (patch: Partial<SearchForm>) => onChange({ ...form, ...patch })
  const problem = formProblem(form)
  const shortName = form.useName && form.name.trim() && searchableLength(form.name) < 4

  // The select's value: the ES-DE folder as-is when that is what the form
  // holds, so a game's own folder stays selected; otherwise a numeric id.
  const folderOption = form.system && !/^\d+$/.test(form.system)
    ? { value: form.system, label: resolved ? `${resolved.name ?? form.system} (${form.system})` : `${form.system} (not in their list)` }
    : null

  return (
    <form
      className="tg-panel flex flex-col gap-3 p-4"
      onSubmit={e => { e.preventDefault(); onSearch() }}
      aria-label="Search ScreenScraper"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="tg-section-label">Search</h2>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Toggle on={form.useName} onChange={v => set({ useName: v })}>Name</Toggle>
          <Toggle on={form.useRom} onChange={v => set({ useRom: v })}>ROM info</Toggle>
        </div>
      </div>

      <Field label="Name">
        <span className="relative block">
          <input
            value={form.name} onChange={e => set({ name: e.target.value })} disabled={!form.useName}
            placeholder="e.g. Sonic the Hedgehog" className="tg-input pl-3 pr-10 disabled:opacity-50" autoComplete="off" enterKeyHint="search"
          />
          {form.name && (
            <button type="button" onClick={() => set({ name: '' })} aria-label="Clear name" className="absolute right-0.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg tg-muted">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </span>
        {shortName && <span className="text-[11.5px] text-[var(--tg-red)]">At least 4 letters are needed to search by name ("the" does not count).</span>}
      </Field>

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
          className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">ROM info &amp; ScreenScraper id</span>
            <span className="block truncate text-[11.5px] tg-muted">
              {filled || form.jeuId ? [filled ? `${filled} of 6 ROM fields` : null, form.jeuId ? `id ${form.jeuId}` : null].filter(Boolean).join(' · ') : 'Exact matches — a hash needs no system'}
              {!form.useRom && filled ? ' · switched off' : ''}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 tg-muted transition-transform ${romOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {romOpen && (
          <div id={romId} className="grid grid-cols-1 gap-3 border-t border-[var(--tg-border)] p-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="File name" hint="as on the handheld, with extension">
                <input value={form.filename} onChange={e => set({ filename: e.target.value })} disabled={!form.useRom} className="tg-input px-3 disabled:opacity-50" autoComplete="off" spellCheck={false} />
              </Field>
            </div>
            <Field label="Size" hint="bytes">
              <input value={form.size} onChange={e => set({ size: e.target.value.replace(/[^\d]/g, '') })} disabled={!form.useRom} inputMode="numeric" className="tg-input px-3 disabled:opacity-50" />
            </Field>
            <Field label="CRC32" hint="8 hex">
              <input value={form.crc} onChange={e => set({ crc: e.target.value.trim() })} disabled={!form.useRom} className="tg-input px-3 font-mono disabled:opacity-50" autoComplete="off" spellCheck={false} maxLength={8} />
            </Field>
            <Field label="MD5" hint="32 hex">
              <input value={form.md5} onChange={e => set({ md5: e.target.value.trim() })} disabled={!form.useRom} className="tg-input px-3 font-mono disabled:opacity-50" autoComplete="off" spellCheck={false} maxLength={32} />
            </Field>
            <Field label="SHA1" hint="40 hex">
              <input value={form.sha1} onChange={e => set({ sha1: e.target.value.trim() })} disabled={!form.useRom} className="tg-input px-3 font-mono disabled:opacity-50" autoComplete="off" spellCheck={false} maxLength={40} />
            </Field>
            <Field label="Serial" hint="disc/cart id">
              <input value={form.serial} onChange={e => set({ serial: e.target.value })} disabled={!form.useRom} className="tg-input px-3 disabled:opacity-50" autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="ScreenScraper id" hint="digits">
              <input value={form.jeuId} onChange={e => set({ jeuId: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" className="tg-input px-3" />
            </Field>
          </div>
        )}
      </div>

      <button type="submit" disabled={!!problem || searching} className="tg-btn tg-btn-primary w-full" title={problem ?? undefined}>
        <Search aria-hidden className={`h-4 w-4 ${searching ? 'animate-pulse' : ''}`} strokeWidth={2.2} />
        {searching ? 'Searching…' : 'Search'}
      </button>
      {problem && <p className="-mt-1 text-center text-[11.5px] tg-muted">{problem}</p>}
      {!hasTarget && <p className="-mt-1 text-center text-[11.5px] tg-muted">No game picked — results can be browsed, not saved.</p>}
    </form>
  )
}
