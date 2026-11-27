// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's category (owner, 27.11.2026: "bring category to top on
//  the task screen") and the category's add-on fields under it ("Category
//  decides how the task's add-on fields would show up … when you choose cinema
//  it should also show some additional fields like which movie, which cinema,
//  with who and how much it costed"; migration 215). One section for Add and
//  Edit wherever the screen opens, drawn from the registry
//  (items/categoryDetails): Media — Type (Movie / TV / Cinema), the movie or
//  show, with who, and a cinema trip's cost, seats and booking (its cinema is
//  the Location row, named Cinema); Games — the game, On, with who.
//  The movie, show or game is the task's link (210: picked from the library,
//  or from TMDB's search — added through the library's own add by the save,
//  never on pick); × takes it off, an edit too (215). A cinema trip's Cinema
//  is the item's place (its slot's; by name in the details without a slot).
//  "On" offers only what the owner typed before ("do not add those manually,
//  it will be added after I put them in"). Values change the form only
//  through planForm.withDetails.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Combobox, ComboboxInput, ComboboxOption } from '@headlessui/react'
import { Plus, User, X } from 'lucide-react'
import { SegmentedControl, Truncate } from '../../ui'
import { ChoiceRow, LINE, Panel, Row, TapRow } from './ItemRows'
import { ChipSelect } from './fields'
import { typingHints } from './fieldStyles'
import { FieldOptions } from '../FieldOptions'
import { CATEGORY_LABELS } from './planModal.config'
import { withCategory, withDetails, withMediaType, type DetailsForm, type PendingTitle, type PlanForm } from './planForm'
import { PlaceRow } from './PlaceRow'
import type { PanelKey } from './TimeSection'
import {
  cleanNames, cleanText, DETAIL_CURRENCIES, DETAIL_LIMITS, detailFields, detailsOf, earlierValues, readAmount, suggestionsFor,
  type DetailCurrency, type MediaType,
} from '../../../features/items/categoryDetails'
import { episodeCode, LINK_KINDS, screenLinkOf } from '../../../features/items/linkKinds'
import type { ItemLink, ItemLinkKind } from '../../../features/items/itemTypes'
import { useLinkedThing } from '../../../features/items/usePlanThis'
import { useEarlierCinemas, useEarlierDetails } from '../../../features/items/useItemDetails'
import { useMovies } from '../../../features/media/hooks/useMovies'
import { useTVSeries } from '../../../features/media/hooks/useTVSeries'
import { useSearchTitles } from '../../../features/media/hooks/useTMDB'
import { useAllGames, useLibraryGames } from '../../../features/games/hooks/useGames'
import type { TimeBlockCategory } from '../../../features/daily/types'
import type { TMDBSearchMovie, TMDBSearchTV } from '../../../features/media/types'

const CATEGORIES = Object.keys(CATEGORY_LABELS) as TimeBlockCategory[]
const INPUT = 'input-bare min-w-0 pb-0 text-right text-lead'

/** The Category row (the title card's second line) and its choices, opened under it. */
export function CategoryRow({ form, patch, open, toggle, mark }: {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
  mark?: ReactNode
}) {
  function pick(category: TimeBlockCategory) {
    patch(withCategory(form, category))
    toggle(null)
  }
  return (
    <>
      <TapRow label="Category" mark={mark} value={CATEGORY_LABELS[form.category]} open={open === 'category'} onClick={() => toggle('category')} />
      {open === 'category' && (
        <Panel label="Category">
          {CATEGORIES.map(c => <ChoiceRow key={c} label={CATEGORY_LABELS[c]} chosen={c === form.category} onClick={() => pick(c)} />)}
        </Panel>
      )}
    </>
  )
}

/** The category's own section (nothing for a category without add-on fields). */
export function DetailsSection({ form, patch, mark, placeMark }: {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  mark?: ReactNode
  /** Where a cinema trip's Cinema goes: its slot's place (Apple Calendar's location), or only the app without a slot. */
  placeMark?: ReactNode
}) {
  const def = detailsOf(form.category)
  const type = form.details.type ?? undefined
  const fields = detailFields(form.category, type)
  const earlier = useEarlierDetails(fields.includes('with') || fields.includes('on'))
  const cinemas = useEarlierCinemas(fields.includes('cinema'))
  if (!def) return null
  const set = (details: Partial<DetailsForm>) => patch(withDetails(form, { details }))
  const linkKind = def.linkKind?.(type) ?? null
  // The link shown: the one the form holds when it is of this field's kind.
  const link = form.link && 'id' in form.link && linkKind && form.link.kind === linkKind ? form.link : null
  const pending = form.pendingTitle && form.pendingTitle.kind === linkKind ? form.pendingTitle : null
  const setLink = (next: ItemLink | null, pendingTitle: PendingTitle | null = null) =>
    patch({ link: next, pendingTitle, linkTouched: true, detailsTouched: true })
  const rows = earlier.data ?? []

  return (
    <>
      {def.types && (
        <Row label="Type" mark={mark}>
          <SegmentedControl<MediaType> size="xs" value={type ?? def.types[0].value}
            options={def.types.map(t => ({ value: t.value, label: t.label, tip: t.tip }))}
            onChange={t => patch(withMediaType(form, t))} />
        </Row>
      )}
      {fields.includes('thing') && linkKind && (
        <ThingRow kind={linkKind} link={link} pending={pending} mark={mark}
          onPick={picked => ('link' in picked ? setLink(picked.link) : setLink(null, picked.pending))} onClear={() => setLink(null)} />
      )}
      {fields.includes('thing') && linkKind === 'tv' && link && (
        <EpisodeRow link={link} mark={mark} onChange={setLink} />
      )}
      {fields.includes('cinema') && (
        // The item's one place (its slot's — Location shows only Travel Time then — or by name without a slot).
        <div className={LINE}>
          <PlaceRow value={form.place} onChange={place => patch({ place, placeTouched: true, detailsTouched: true })}
            label="Cinema" earlier={cinemas} mark={placeMark} />
        </div>
      )}
      {fields.includes('on') && (
        <TextRow label="On" tip="On: what it is played on — your own words; earlier ones are offered" value={form.details.on}
          max={DETAIL_LIMITS.on} mark={mark} placeholder="Device"
          offered={earlierValues(rows, d => d.on)} onChange={on => set({ on })} />
      )}
      {fields.includes('with') && (
        <NamesRow value={form.details.with} mark={mark} known={earlierValues(rows, d => d.with, 20)} onChange={w => set({ with: w })} />
      )}
      {fields.includes('cost') && (
        <CostRow cost={form.details.cost} currency={form.details.currency} mark={mark}
          onCost={cost => set({ cost })} onCurrency={currency => set({ currency })} />
      )}
      {fields.includes('seats') && (
        <TextRow label="Seats" tip="Seats: where you sit (row and seat)" value={form.details.seats} max={DETAIL_LIMITS.text} mark={mark}
          placeholder="e.g. H12–H13" kind="code" onChange={seats => set({ seats })} />
      )}
      {fields.includes('booking') && (
        <TextRow label="Booking" tip="Booking: the booking reference" value={form.details.booking} max={DETAIL_LIMITS.text} mark={mark}
          placeholder="Reference" kind="code" onChange={booking => set({ booking })} />
      )}
    </>
  )
}

/** A pick: a thing in the library (its link), or a TMDB title the save adds to the library first. */
type Picked = { link: ItemLink } | { pending: PendingTitle }
type Option = { key: string; label: string; sub?: string; pick: Picked }
/** A thing picked in this screen's own fields (not a Plan button: those build their requests in items/planThis). */
const thingOf = (kind: 'movie' | 'tv' | 'game', id: string): Picked => ({ link: { kind, id } })

/** The movie, show or game: its title (a tap searches again; × takes it off), or the search. */
function ThingRow({ kind, link, pending, mark, onPick, onClear }: {
  kind: ItemLinkKind
  link: ItemLink | null
  pending: PendingTitle | null
  mark?: ReactNode
  onPick: (picked: Picked) => void
  onClear: () => void
}) {
  const label = LINK_KINDS[kind].label
  const [editing, setEditing] = useState(false)
  const thing = useLinkedThing(link ? screenLinkOf(null, link) : null)
  if ((!link && !pending) || editing) {
    return (
      <Row label={label} mark={mark}>
        <ThingSearch kind={kind} label={label} autoFocus={editing} onClose={() => setEditing(false)}
          onPick={l => { onPick(l); setEditing(false) }} />
      </Row>
    )
  }
  const title = pending ? pending.title : thing.data?.title ?? (thing.isLoading ? '…' : `A ${label.toLowerCase()} not in your library`)
  return (
    <Row label={label} mark={mark}>
      <button type="button" onClick={() => setEditing(true)} className="min-w-0 max-w-[65%] py-2 text-right text-fg"
        aria-label={`${label}: ${title} — change it`} title={pending ? `${label}: ${title} — added to your library when saved` : `${label}: ${title} — tap to pick another`}>
        <bdi className="block min-w-0"><Truncate>{title}</Truncate></bdi>
      </button>
      <button type="button" onClick={onClear} aria-label={`Remove the ${label.toLowerCase()}`} title={`Remove the ${label.toLowerCase()}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-faint hover:bg-surface-hover hover:text-fg">
        <X aria-hidden className="h-4 w-4" />
      </button>
    </Row>
  )
}

const yearOf = (d: string | null | undefined): string | undefined => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : undefined)

type SearchProps = { kind: ItemLinkKind; label: string; autoFocus: boolean; onPick: (picked: Picked) => void; onClose: () => void }

/** The search: the library first, then (a movie or show) TMDB's titles — added to the library by the save. */
function ThingSearch(props: SearchProps) {
  return props.kind === 'game' ? <GameSearch {...props} /> : <MediaSearch {...props} />
}

/** A game: the Games library (retro, Steam and PlayStation), read only when this search shows. */
function GameSearch(props: SearchProps) {
  const [focused, setFocused] = useState(props.autoFocus)
  const [query, setQuery] = useState('')
  // Read only once the search is used (the Games page's rule: no eager read on mount).
  const retro = useAllGames(focused)
  const steam = useLibraryGames('steam', focused)
  const ps = useLibraryGames('playstation', focused)
  const q = query.trim().toLowerCase()
  const options: Option[] = !focused ? [] : [...(retro.data ?? []), ...steam.games, ...ps.games]
    .filter(g => !q || g.title.toLowerCase().includes(q)).slice(0, 8)
    .map(g => ({ key: `own-${g.id}`, label: g.title, sub: g.release_year ? String(g.release_year) : undefined, pick: thingOf('game', g.id) }))
  const note = focused && q && !options.length ? 'No game by that name in your library' : null
  return <SearchCombo {...props} query={query} setQuery={setQuery} setFocused={setFocused} options={options} note={note} />
}

function MediaSearch(props: SearchProps) {
  const { kind } = props
  const [focused, setFocused] = useState(props.autoFocus)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const id = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(id) }, [query])
  const movies = useMovies()
  const shows = useTVSeries()
  const tmdb = useSearchTitles(kind === 'tv' ? 'tv' : 'movie', focused && debounced.length >= 2 ? debounced : '')
  const q = query.trim().toLowerCase()
  const has = (title: string) => !q || title.toLowerCase().includes(q)

  const options: Option[] = []
  if (focused && kind === 'movie') {
    for (const e of (movies.data ?? []).filter(e => has(e.movie.title)).slice(0, 6)) {
      options.push({ key: `own-${e.id}`, label: e.movie.title, sub: yearOf(e.movie.release_date), pick: thingOf('movie', e.id) })
    }
  }
  if (focused && kind === 'tv') {
    for (const e of (shows.data ?? []).filter(e => has(e.tv_series.title)).slice(0, 6)) {
      options.push({ key: `own-${e.id}`, label: e.tv_series.title, sub: yearOf(e.tv_series.first_air_date), pick: thingOf('tv', e.id) })
    }
  }
  if (debounced.length >= 2) {
    const inLibrary = new Set(kind === 'movie' ? (movies.data ?? []).map(e => e.movie.tmdb_id) : (shows.data ?? []).map(e => e.tv_series.tmdb_id))
    for (const r of (tmdb.data?.pages[0]?.results ?? []).filter(r => !inLibrary.has(r.id)).slice(0, 6)) {
      const title = kind === 'movie' ? (r as TMDBSearchMovie).title : (r as TMDBSearchTV).name
      const year = yearOf(kind === 'movie' ? (r as TMDBSearchMovie).release_date : (r as TMDBSearchTV).first_air_date)
      options.push({
        key: `tmdb-${r.id}`, label: title, sub: [year, 'added to your library when saved'].filter(Boolean).join(' · '),
        pick: { pending: { kind: kind as 'movie' | 'tv', tmdbId: r.id, title } },
      })
    }
  }
  const note = debounced.length >= 2 && tmdb.isError ? 'TMDB is not answering — pick from your library'
    : focused && q && !options.length && !tmdb.isFetching ? `No ${props.label.toLowerCase()} by that name` : null
  return <SearchCombo {...props} query={query} setQuery={setQuery} setFocused={setFocused} options={options} note={note} />
}

function SearchCombo({ label, autoFocus, onPick, onClose, query, setQuery, setFocused, options, note }: SearchProps & {
  query: string
  setQuery: (q: string) => void
  setFocused: (on: boolean) => void
  options: Option[]
  note: string | null
}) {
  const field = useRef<HTMLInputElement>(null)
  return (
    <Combobox<Option | null> value={null} immediate
      onChange={o => { if (o) onPick(o.pick) }}
      onClose={() => { if (!query) { setFocused(false); onClose() } }}>
      <div className="relative min-w-0 flex-1">
        <ComboboxInput ref={field} autoFocus={autoFocus} aria-label={`${label}: search`} placeholder="Search" maxLength={80} value={query}
          onFocus={() => setFocused(true)} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } }}
          {...typingHints(`q-${label.toLowerCase()}`, 'search')} className={`${INPUT} w-full`} />
        {(options.length > 0 || note) && (
          <FieldOptions field={field} gap={8} className="min-w-[15rem]">
            {note && <p className="px-3 py-2 text-meta text-fg-muted">{note}</p>}
            {options.map(o => (
              <ComboboxOption key={o.key} value={o} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                {o.key.startsWith('tmdb-') && <Plus aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <bdi className="min-w-0"><Truncate>{o.label}</Truncate></bdi>
                  {o.sub && <span className="text-meta text-fg-muted">{o.sub}</span>}
                </span>
              </ComboboxOption>
            ))}
          </FieldOptions>
        )}
      </div>
    </Combobox>
  )
}

/** A show's one episode (optional): S and E, both or neither (210). */
function EpisodeRow({ link, mark, onChange }: { link: { kind: ItemLinkKind; id: string; season?: number; episode?: number }; mark?: ReactNode; onChange: (l: ItemLink) => void }) {
  const [s, setS] = useState(link.season != null ? String(link.season) : '')
  const [e, setE] = useState(link.episode != null ? String(link.episode) : '')
  const send = (season: string, episode: string) => {
    const sn = /^\d{1,3}$/.test(season) ? Number(season) : null
    const en = /^\d{1,4}$/.test(episode) ? Number(episode) : null
    onChange(sn != null && en != null ? { kind: 'tv', id: link.id, season: sn, episode: en } : { kind: 'tv', id: link.id })
  }
  const box = 'input-bare w-10 pb-0 text-center text-lead tabular-nums'
  return (
    <Row label="Episode" mark={mark}>
      <span className="flex items-center gap-1 text-meta text-fg-muted" title={link.season != null && link.episode != null ? episodeCode(link.season, link.episode) : 'Episode: the whole show, or one episode'}>
        S<input aria-label="Season" {...typingHints('season', 'none')} inputMode="numeric" maxLength={3} value={s} placeholder="–" className={box}
          onChange={ev => { setS(ev.target.value); send(ev.target.value, e) }} />
        E<input aria-label="Episode" {...typingHints('episode', 'none')} inputMode="numeric" maxLength={4} value={e} placeholder="–" className={box}
          onChange={ev => { setE(ev.target.value); send(s, ev.target.value) }} />
      </span>
    </Row>
  )
}

/** A short text with no box (On, Seats, Booking); `offered`: earlier values to pick from as it is typed. */
function TextRow({ label, tip, value, max, mark, placeholder, offered, kind = 'sentence', onChange }: {
  label: string
  tip: string
  value: string
  max: number
  mark?: ReactNode
  placeholder: string
  offered?: readonly string[]
  /** How the keyboard capitalises it (typingHints). */
  kind?: 'sentence' | 'code'
  onChange: (v: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const list = focused && offered ? suggestionsFor(offered, value).slice(0, 8) : []
  const input = (
    <ComboboxInputOrPlain combo={!!offered} field={field} hints={typingHints(label.toLowerCase(), kind)} aria-label={tip} title={tip} placeholder={placeholder} maxLength={max} value={value}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); const t = cleanText(value, max); if ((t ?? '') !== value) onChange(t ?? '') }}
      onChange={v => onChange(v)} />
  )
  return (
    <Row label={label} mark={mark}>
      {offered ? (
        <Combobox<string | null> value={null} immediate onChange={v => { if (v) onChange(v) }}>
          <div className="relative min-w-0 flex-1">
            {input}
            {list.length > 0 && (
              <FieldOptions field={field} className="min-w-[10rem]">
                {list.map(v => (
                  <ComboboxOption key={v} value={v} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                    <bdi className="min-w-0 flex-1"><Truncate>{v}</Truncate></bdi>
                  </ComboboxOption>
                ))}
              </FieldOptions>
            )}
          </div>
        </Combobox>
      ) : <div className="min-w-0 flex-1">{input}</div>}
    </Row>
  )
}

function ComboboxInputOrPlain({ combo, field, hints, onChange, ...rest }: {
  combo: boolean
  field: RefObject<HTMLInputElement | null>
  hints: ReturnType<typeof typingHints>
  'aria-label': string
  title: string
  placeholder: string
  maxLength: number
  value: string
  onFocus: () => void
  onBlur: () => void
  onChange: (v: string) => void
}) {
  const props = { ...rest, ...hints, className: `${INPUT} w-full` }
  return combo
    ? <ComboboxInput ref={field} {...props} onChange={e => onChange(e.target.value)} />
    : <input ref={field} {...props} onChange={e => onChange(e.target.value)} />
}

/** With who: names as small chips (× takes one off) and a field after them; earlier names are offered as they type. */
function NamesRow({ value, mark, known, onChange }: { value: string[]; mark?: ReactNode; known: readonly string[]; onChange: (v: string[]) => void }) {
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const typed = cleanText(query, DETAIL_LIMITS.name)
  const offered = focused ? suggestionsFor(known, query, value).slice(0, 8) : []
  const has = (n: string) => value.some(x => x.toLowerCase() === n.toLowerCase())
  // A name typed that isn't picked yet nor offered as it is: "Add …" first, so Enter adds what was typed.
  const isNew = !!typed && !has(typed) && !offered.some(o => o.toLowerCase() === typed.toLowerCase())
  const add = (n: string) => { onChange(cleanNames([...value, n]) ?? []); setQuery('') }
  const field = useRef<HTMLInputElement>(null)
  return (
    <Row label="With" mark={mark} wide>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 py-1.5">
        {value.map(n => (
          <span key={n} className="inline-flex h-7 min-w-0 max-w-full items-center gap-0.5 rounded-full bg-surface-2 pl-2 pr-0.5 text-body text-fg-2">
            <User aria-hidden className="h-3 w-3 shrink-0 text-fg-muted" />
            <bdi className="min-w-0"><Truncate className="max-w-[9rem]">{n}</Truncate></bdi>
            <button type="button" onClick={() => onChange(value.filter(x => x !== n))} aria-label={`Remove ${n}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg">
              <X aria-hidden className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length < DETAIL_LIMITS.names && (
          <Combobox<string | null> value={null} onChange={n => { if (n) add(n) }} onClose={() => { if (!query) setFocused(false) }} immediate>
            <div className="relative min-w-0">
              {/* The owner saw "AutoFill Contact" over this field and its old three-word placeholder cut ("Add a nam",
                  27.11.2026). iOS guesses contact fields from a field's words too, so none says "name" (untested on a
                  device). One short word, in a field sized in em to hold it at any Display scale. */}
              <ComboboxInput ref={field} aria-label="With: who goes with you" title="With: who you go or play with — earlier ones are offered"
                placeholder="Add" maxLength={DETAIL_LIMITS.name + 10} value={query}
                onFocus={() => setFocused(true)} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && isNew && offered.length === 0) { e.preventDefault(); add(typed) }
                  if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') }
                }}
                // A name typed and never Entered is kept when the field is left, never dropped without a word.
                onBlur={() => { if (typed && !has(typed)) add(typed); setFocused(false); setQuery('') }}
                {...typingHints('with', 'words')}
                // Narrow beside the names (no line of its own on a phone), wider while typing.
                className="input-bare w-[3em] pb-0 text-right text-lead transition-[width] focus:w-[8em] motion-reduce:transition-none" />
              {(isNew || offered.length > 0) && (
                <FieldOptions field={field} className="min-w-[12rem]">
                  {isNew && offered.length > 0 && (
                    <ComboboxOption value={typed} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                      <Plus aria-hidden className="h-4 w-4 shrink-0" /><Truncate className="min-w-0 flex-1" fullText={`Add “${typed}”`}>Add “<bdi>{typed}</bdi>”</Truncate>
                    </ComboboxOption>
                  )}
                  {offered.map(n => (
                    <ComboboxOption key={n} value={n} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                      <User aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" /><bdi className="min-w-0 flex-1"><Truncate>{n}</Truncate></bdi>
                    </ComboboxOption>
                  ))}
                </FieldOptions>
              )}
            </div>
          </Combobox>
        )}
      </div>
    </Row>
  )
}

/** The cost: an amount and its currency (never spending — owner: "Cost not toward my spending no."). */
function CostRow({ cost, currency, mark, onCost, onCurrency }: {
  cost: string
  currency: DetailCurrency
  mark?: ReactNode
  onCost: (v: string) => void
  onCurrency: (c: DetailCurrency) => void
}) {
  const read = readAmount(cost)
  const problem = 'problem' in read ? read.problem : null
  return (
    <Row label="Cost" mark={mark}>
      <input {...typingHints('cost', 'none')} aria-label="Cost: what it cost — kept with the plan, never counted as spending" title={problem ?? 'Cost: kept with the plan, never counted as spending'}
        inputMode="decimal" maxLength={12} value={cost} placeholder="0" onChange={e => onCost(e.target.value)}
        data-tone={problem ? 'danger' : undefined} className={`${INPUT} w-20 tabular-nums ${problem ? 'tone-text' : ''}`} />
      <ChipSelect<DetailCurrency> label="Currency" value={currency} options={DETAIL_CURRENCIES.map(c => ({ value: c, label: c }))} onChange={onCurrency} />
    </Row>
  )
}
