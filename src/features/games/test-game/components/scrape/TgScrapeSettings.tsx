import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { FieldPolicy, SsField, SsPrefs } from '../../../scraper/ssTypes'
import { ALL_FIELDS, FIELD_LABEL, defaultPrefs, mediaModeFor, modeCounts, normalizePrefs } from '../../../scraper/ssPlan'
import { MEDIA_GROUPS, MEDIA_TYPES, type MediaMode } from '../../../scraper/ssMediaCatalog'
import { useScrapePrefs } from '../../../scraper/useScrape'
import { TgDropdown } from '../TgDropdown'
import { TgScrapeDialog } from './TgScrapeDialog'
import { TgSegmented, TgSwitch } from './TgScrapeParts'
import { TgScrapeStorage } from './TgScrapeStorage'
import { MODE_HINT, MODE_LABEL } from './tgScrapeModel'

const SCALES: { value: string; label: string; hint: string }[] = [
  { value: '0.5', label: 'Small', hint: 'Covers 320 px wide' },
  { value: '1', label: 'Standard', hint: 'Covers 640 px, fan art 1280 px' },
  { value: '1.5', label: 'Large', hint: 'Covers 960 px' },
  { value: '0', label: 'Original', hint: 'Their full size — uses far more storage' },
]
const POLICY: { value: FieldPolicy; label: string }[] = [
  { value: 'fill', label: 'Fill empty' }, { value: 'replace', label: 'Replace' }, { value: 'skip', label: 'Never' },
]
const MODES = (image: boolean): { value: MediaMode; label: string; disabled?: boolean; hint?: string }[] =>
  (['store', 'on_demand', 'skip'] as MediaMode[]).map(m => ({ value: m, label: MODE_LABEL[m], disabled: m === 'store' && !image, hint: MODE_HINT[m] }))

// Every region and language code their API knows (44 / 21), with names.
const REGION_NAMES: Record<string, string> = {
  ss: 'ScreenScraper', wor: 'World', eu: 'Europe', us: 'USA', jp: 'Japan', uk: 'UK', fr: 'France', de: 'Germany',
  sp: 'Spain', it: 'Italy', nl: 'Netherlands', se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland', pt: 'Portugal',
  br: 'Brazil', kr: 'Korea', cn: 'China', tw: 'Taiwan', au: 'Australia', ca: 'Canada', ru: 'Russia', pl: 'Poland',
  tr: 'Turkey', asi: 'Asia', ame: 'America', afr: 'Africa', oce: 'Oceania', mex: 'Mexico', cl: 'Chile', pe: 'Peru',
  cz: 'Czechia', sk: 'Slovakia', hu: 'Hungary', gr: 'Greece', bg: 'Bulgaria', il: 'Israel', ae: 'UAE', kw: 'Kuwait',
  mor: 'Morocco', za: 'South Africa', nz: 'New Zealand', cus: 'Custom',
}
const LANG_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', sv: 'Swedish',
  no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', cz: 'Czech', sk: 'Slovak', hu: 'Hungarian',
  tr: 'Turkish', ja: 'Japanese', kr: 'Korean', zh: 'Chinese', tw: 'Chinese (Taiwan)',
}
const BUDGETS = [300, 400, 500, 600, 700, 800, 900, 950]

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--tg-border)] py-4 first:pt-1 last:border-0">
      <h3 className="text-[14px] font-bold">{title}</h3>
      {note && <p className="mt-0.5 text-[12px] leading-snug tg-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** An ordered list of codes: tap to put first, × to remove, + to add any code
 *  their API knows. The order decides which version wins. */
function OrderList({ list, names, onChange, label }: { list: string[]; names: Record<string, string>; onChange: (l: string[]) => void; label: string }) {
  const [adding, setAdding] = useState(false)
  const missing = Object.keys(names).filter(k => !list.includes(k))
  return (
    <div className="flex flex-col gap-2">
      <div role="list" aria-label={label} className="flex flex-wrap gap-1.5">
        {list.map((k, i) => (
          <span key={k} role="listitem" className={`inline-flex min-h-[44px] items-center overflow-hidden rounded-full border text-[12.5px] font-semibold ${
            i === 0 ? 'border-[var(--tg-accent)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]' : 'border-[var(--tg-border)] text-[var(--tg-text-2)]'
          }`}>
            <button type="button" onClick={() => onChange([k, ...list.filter(x => x !== k)])} aria-label={`${names[k] ?? k}, position ${i + 1}${i ? ' — put first' : ''}`} className="min-h-[44px] pl-3 pr-1.5">
              <span className="mr-1 tabular-nums opacity-60">{i + 1}</span>{names[k] ?? k.toUpperCase()}
            </button>
            {list.length > 1 && (
              <button type="button" onClick={() => onChange(list.filter(x => x !== k))} aria-label={`Remove ${names[k] ?? k}`} className="grid h-11 w-9 place-items-center opacity-70">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {list.length < 12 && missing.length > 0 && (
          <button type="button" onClick={() => setAdding(a => !a)} aria-expanded={adding} className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-dashed border-[var(--tg-border-strong)] px-3 text-[12.5px] font-semibold text-[var(--tg-text-2)]">
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add
          </button>
        )}
      </div>
      {adding && (
        <div className="flex flex-wrap gap-1">
          {missing.map(k => (
            <button key={k} type="button" onClick={() => { onChange([...list, k]); setAdding(false) }} className="min-h-[40px] rounded-lg bg-[var(--tg-panel-2)] px-2.5 text-[12px] font-medium [@media(pointer:coarse)]:min-h-[44px]">
              {names[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * "What to save" — the defaults every review starts from and every batch
 * save uses: per media type Copy / Online / Skip, image size, per field Fill /
 * Replace / Never, region and language order, the full record, and the
 * storage budget the server enforces. Edited as a draft; Save commits — and
 * only once the real settings have loaded, so defaults can never overwrite them.
 */
export function TgScrapeSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, loaded, error, save } = useScrapePrefs()
  const [draft, setDraft] = useState<SsPrefs>(prefs)
  const [touched, setTouched] = useState(false)
  const [wasOpen, setWasOpen] = useState(false)
  const [wasLoaded, setWasLoaded] = useState(loaded)
  if (open !== wasOpen) { setWasOpen(open); if (open) { setDraft(prefs); setTouched(false) } }
  // The real settings arrived while the sheet was open and untouched: show them.
  if (loaded !== wasLoaded) { setWasLoaded(loaded); if (loaded && open && !touched) setDraft(prefs) }
  const set = (patch: Partial<SsPrefs>) => { setTouched(true); setDraft(d => normalizePrefs({ ...d, ...patch })) }
  const counts = modeCounts(draft)

  const footer = (
    <div className="flex flex-col gap-2">
      {!loaded && <p className="text-[11.5px] tg-muted">{error ? 'Your saved settings could not be read — nothing can be saved until they load.' : 'Loading your saved settings…'}</p>}
      <div className="grid grid-cols-[auto_1fr_1fr] gap-2.5">
        <button type="button" onClick={() => { setTouched(true); setDraft(defaultPrefs()) }} className="tg-btn tg-btn-secondary !px-3 !text-[13px]">Defaults</button>
        <button type="button" onClick={onClose} className="tg-btn tg-btn-secondary">Cancel</button>
        <button type="button" onClick={() => save.mutate(draft, { onSuccess: onClose })} disabled={save.isPending || !loaded} className="tg-btn tg-btn-primary">
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <TgScrapeDialog open={open} onClose={onClose} title="What to save" footer={footer} wide>
      <Section title="Storage" note="Your Supabase plan has 1 GB for everything. Over it, the whole app is eventually locked — so nothing is copied past the budget below (never past 950 MB); those images are shown online instead.">
        <TgScrapeStorage budgetMb={draft.budgetMb} enabled={open} />
        <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
          <span className="font-medium">Stop copying images at</span>
          <TgDropdown
            value={String(draft.budgetMb)}
            options={[...new Set([...BUDGETS, draft.budgetMb])].sort((a, b) => a - b).map(mb => ({ value: String(mb), label: `${mb} MB` }))}
            onChange={v => set({ budgetMb: Number(v) })}
            buttonLabel={`${draft.budgetMb} MB`}
            ariaLabel="Storage budget"
            align="end"
          />
        </div>
      </Section>

      <Section
        title="Artwork & files"
        note={<>Copy keeps a small copy in your storage (and only when the game will use it). Online keeps nothing and shows it from ScreenScraper when you look. Skip ignores the type. Now: {counts.store} copied · {counts.on_demand} online · {counts.skip} skipped.</>}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium">Size of copies</span>
          <TgSegmented label="Size of copies" value={String(draft.imageScale)} options={SCALES.map(s => ({ value: s.value, label: s.label, hint: s.hint }))} onChange={v => set({ imageScale: Number(v) })} size="sm" />
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
                        size="sm" label={`${t.label}: copy, online or skip`} value={mediaModeFor(draft, t.type)}
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

      <Section title="Fields" note="What a save does with each field by default — and what Many games uses. Every review can still change it for that game.">
        <ul className="flex flex-col">
          {ALL_FIELDS.map((f: SsField) => (
            <li key={f} className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
              <span className="text-[13px]">{FIELD_LABEL[f]}</span>
              <TgSegmented size="sm" label={`${FIELD_LABEL[f]} by default`} value={draft.fields[f]} options={POLICY} onChange={p => set({ fields: { ...draft.fields, [f]: p } })} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Regions" note="Which version of a title, a date and a box wins when there are several. ScreenScraper = their own canonical name.">
        <OrderList list={draft.regions} names={REGION_NAMES} onChange={regions => set({ regions })} label="Region order" />
      </Section>

      <Section title="Languages" note="Descriptions, genres, modes and series. They mostly have English, French, German, Spanish, Italian and Portuguese.">
        <OrderList list={draft.languages} names={LANG_NAMES} onChange={languages => set({ languages })} label="Language order" />
      </Section>

      <Section title="Their raw answer" note="Every scrape always keeps their record — every regional title and date, all rating boards, every known dump with hashes, hacks, tips, controls — in the database (not in storage). This also keeps ScreenScraper's unprocessed answer beside it.">
        <TgSwitch on={draft.snapshot} onChange={v => set({ snapshot: v })} label="Also keep their raw answer" />
      </Section>
    </TgScrapeDialog>
  )
}
