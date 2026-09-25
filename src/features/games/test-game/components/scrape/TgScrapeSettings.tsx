import { useState, type ReactNode } from 'react'
import type { FieldPolicy, SsField, SsPrefs } from '../../../scraper/ssTypes'
import { ALL_FIELDS, FIELD_LABEL, defaultPrefs, mediaModeFor, modeCounts, normalizePrefs } from '../../../scraper/ssPlan'
import { MEDIA_GROUPS, MEDIA_TYPES, type MediaMode } from '../../../scraper/ssMediaCatalog'
import { useScrapePrefs } from '../../../scraper/useScrape'
import { TgScrapeDialog } from './TgScrapeDialog'
import { TgSegmented } from './TgScrapeParts'
import { TgScrapeStorage } from './TgScrapeStorage'

const SCALES: { value: string; label: string; hint: string }[] = [
  { value: '0.5', label: 'Small', hint: 'Covers 320 px wide' },
  { value: '1', label: 'Standard', hint: 'Covers 640 px, fan art 1280 px' },
  { value: '1.5', label: 'Large', hint: 'Covers 960 px' },
  { value: '0', label: 'Original', hint: 'Their full size — uses far more storage' },
]
const POLICY: { value: FieldPolicy; label: string }[] = [
  { value: 'fill', label: 'Fill empty' }, { value: 'replace', label: 'Replace' }, { value: 'skip', label: 'Never' },
]
const MODES = (image: boolean): { value: MediaMode; label: string; disabled?: boolean }[] => [
  { value: 'store', label: 'Save', disabled: !image }, { value: 'on_demand', label: 'Link' }, { value: 'skip', label: 'Skip' },
]
const REGION_NAMES: Record<string, string> = { wor: 'World', eu: 'Europe', us: 'USA', ss: 'ScreenScraper', jp: 'Japan', fr: 'France', de: 'Germany', uk: 'UK', sp: 'Spain', it: 'Italy', kr: 'Korea', br: 'Brazil' }
const LANG_NAMES: Record<string, string> = { en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese' }

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--tg-border)] py-4 first:pt-1 last:border-0">
      <h3 className="text-[14px] font-bold">{title}</h3>
      {note && <p className="mt-0.5 text-[12px] leading-snug tg-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Tap a chip to move it to the front — the order decides which version wins. */
function OrderChips({ list, names, onChange, label }: { list: string[]; names: Record<string, string>; onChange: (l: string[]) => void; label: string }) {
  return (
    <div role="list" aria-label={label} className="flex flex-wrap gap-1.5">
      {list.map((k, i) => (
        <button
          key={k} type="button" role="listitem" onClick={() => onChange([k, ...list.filter(x => x !== k)])}
          aria-label={`${names[k] ?? k}, position ${i + 1}${i ? ' — tap to put first' : ''}`}
          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold [@media(pointer:coarse)]:min-h-[44px] ${
            i === 0 ? 'border-[var(--tg-accent)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]' : 'border-[var(--tg-border)] text-[var(--tg-text-2)]'
          }`}
        >
          <span className="tabular-nums opacity-60">{i + 1}</span>{names[k] ?? k.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/**
 * "What to save" — the defaults every review starts from and every batch
 * save uses: per media type Save / Link / Skip, image size, per field Fill /
 * Replace / Never, region and language order, the full record, and the
 * storage budget the server will not cross. Edited as a draft; Save commits.
 */
export function TgScrapeSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, save } = useScrapePrefs()
  const [draft, setDraft] = useState<SsPrefs>(prefs)
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) { setWasOpen(open); if (open) setDraft(prefs) }
  const set = (patch: Partial<SsPrefs>) => setDraft(d => normalizePrefs({ ...d, ...patch }))
  const counts = modeCounts(draft)

  const footer = (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-2.5">
      <button type="button" onClick={() => setDraft(defaultPrefs())} className="tg-btn tg-btn-secondary !px-3 !text-[13px]">Defaults</button>
      <button type="button" onClick={onClose} className="tg-btn tg-btn-secondary">Cancel</button>
      <button type="button" onClick={() => save.mutate(draft, { onSuccess: onClose })} disabled={save.isPending} className="tg-btn tg-btn-primary">
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </div>
  )

  return (
    <TgScrapeDialog open={open} onClose={onClose} title="What to save" footer={footer} wide>
      <Section title="Storage" note="Your Supabase plan has 1 GB for everything. Over it, the whole app is eventually locked — so nothing is saved past the budget below; those images are linked instead.">
        <TgScrapeStorage budgetMb={draft.budgetMb} enabled={open} />
        <label className="mt-3 flex items-center justify-between gap-3 text-[13px]">
          <span className="font-medium">Stop saving images at</span>
          <select value={String(draft.budgetMb)} onChange={e => set({ budgetMb: Number(e.target.value) })} className="tg-input !w-auto px-3">
            {[400, 600, 700, 800, 900, 950].map(mb => <option key={mb} value={mb}>{mb} MB</option>)}
            {![400, 600, 700, 800, 900, 950].includes(draft.budgetMb) && <option value={draft.budgetMb}>{draft.budgetMb} MB</option>}
          </select>
        </label>
      </Section>

      <Section
        title="Artwork & files"
        note={<>Save keeps a resized copy (uses storage). Link keeps nothing and fetches from ScreenScraper when you look at it. Skip ignores the type. Now: {counts.store} saved · {counts.on_demand} linked · {counts.skip} skipped.</>}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium">Size of saved images</span>
          <TgSegmented label="Size of saved images" value={String(draft.imageScale)} options={SCALES.map(s => ({ value: s.value, label: s.label, hint: s.hint }))} onChange={v => set({ imageScale: Number(v) })} size="sm" />
        </div>
        <div className="flex flex-col gap-4">
          {MEDIA_GROUPS.map(g => {
            const types = MEDIA_TYPES.filter(t => t.group === g.key)
            if (!types.length) return null
            return (
              <div key={g.key}>
                <h4 className="mb-1 text-[12px] font-semibold tg-muted">{g.label}</h4>
                <ul className="flex flex-col">
                  {types.map(t => (
                    <li key={t.type} className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
                      <span className="text-[13px]">{t.label}</span>
                      <TgSegmented
                        size="sm" label={`${t.label}: save, link or skip`} value={mediaModeFor(draft, t.type)}
                        options={MODES(t.kind === 'image')}
                        onChange={m => set({ media: { ...draft.media, [t.type]: m } })}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Fields" note="What a save does with each field by default. Every review can still change it for that game.">
        <ul className="flex flex-col">
          {ALL_FIELDS.map((f: SsField) => (
            <li key={f} className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
              <span className="text-[13px]">{FIELD_LABEL[f]}</span>
              <TgSegmented size="sm" label={`${FIELD_LABEL[f]} by default`} value={draft.fields[f]} options={POLICY} onChange={p => set({ fields: { ...draft.fields, [f]: p } })} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Regions" note="Which version of a title, a date and a box wins when there are several.">
        <OrderChips list={draft.regions} names={REGION_NAMES} onChange={regions => set({ regions })} label="Region order" />
      </Section>

      <Section title="Languages" note="Descriptions, genres, modes and series. ScreenScraper mostly has English, French, German, Spanish, Italian and Portuguese.">
        <OrderChips list={draft.languages} names={LANG_NAMES} onChange={languages => set({ languages })} label="Language order" />
      </Section>

      <Section title="Full record" note="Every regional title and date, all rating boards, every known dump with hashes, hacks, controls — about 10–50 KB per game in the database (not in storage).">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[13px] font-medium">
          <input type="checkbox" checked={draft.snapshot} onChange={e => set({ snapshot: e.target.checked })} className="h-5 w-5 accent-[var(--tg-accent)]" />
          Save their full record with every scrape
        </label>
      </Section>
    </TgScrapeDialog>
  )
}
