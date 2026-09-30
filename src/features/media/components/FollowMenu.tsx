import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Bell, BellRing, Check } from 'lucide-react'
import { useFollows, useToggleFollow } from '../hooks/useFollows'
import type { FollowKind } from '../api/followsApi'
import type { TMDBMovieFull, TMDBTVFull } from '../types'

interface Option { kind: FollowKind; tmdbId: number; name: string; label: string }

const KIND_LABEL: Record<FollowKind, string> = { collection: 'Franchise', company: 'Studio', director: 'Director', actor: 'Actor' }

/** What you can follow from this title: its franchise, director, studio and lead actors (movies). */
function optionsFor(detail: TMDBMovieFull | TMDBTVFull, isMovie: boolean): Option[] {
  if (!isMovie) return []
  const m = detail as TMDBMovieFull
  const out: Option[] = []
  if (m.belongs_to_collection) out.push({ kind: 'collection', tmdbId: m.belongs_to_collection.id, name: m.belongs_to_collection.name, label: m.belongs_to_collection.name })
  for (const d of (m.credits?.crew ?? []).filter(c => c.job === 'Director').slice(0, 2)) out.push({ kind: 'director', tmdbId: d.id, name: d.name, label: d.name })
  for (const c of (m.production_companies ?? []).slice(0, 2)) out.push({ kind: 'company', tmdbId: c.id, name: c.name, label: c.name })
  for (const a of (m.credits?.cast ?? []).slice(0, 3)) out.push({ kind: 'actor', tmdbId: a.id, name: a.name, label: a.name })
  return out
}

/**
 * Follow a franchise, director, studio or actor: new titles and new trailers
 * show up under Media → Lists → Following (checked daily).
 */
export function FollowMenu({ detail, isMovie }: { detail: TMDBMovieFull | TMDBTVFull; isMovie: boolean }) {
  const options = optionsFor(detail, isMovie)
  const { data: follows = [] } = useFollows()
  const toggle = useToggleFollow()
  if (options.length === 0) return null
  const followed = (o: Option) => follows.find(f => f.kind === o.kind && f.tmdb_id === o.tmdbId)
  const any = options.some(o => followed(o))

  return (
    <Menu>
      <MenuButton className="btn-ghost btn-sm">
        {any ? <BellRing aria-hidden className="h-4 w-4 text-accent-600" /> : <Bell aria-hidden className="h-4 w-4" />} Follow
      </MenuButton>
      <MenuItems anchor={{ to: 'bottom start', gap: 6, padding: 12 }} transition className="menu z-[70] w-[min(18rem,calc(100vw-24px))] transition duration-150 ease-out data-[closed]:opacity-0">
        <p className="px-2.5 pb-1 pt-1.5 text-micro text-fg-muted">New titles and trailers appear in Lists → Following.</p>
        {options.map(o => {
          const f = followed(o)
          return (
            <MenuItem key={`${o.kind}:${o.tmdbId}`}>
              <button type="button" className="menu-item w-full" onClick={() => toggle.mutate({ followId: f?.id, kind: o.kind, tmdbId: o.tmdbId, name: o.name })}>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{o.label}</span>
                  <span className="block text-micro text-fg-muted">{KIND_LABEL[o.kind]}</span>
                </span>
                {f && <Check aria-label="Following" className="h-4 w-4 text-accent-600" />}
              </button>
            </MenuItem>
          )
        })}
      </MenuItems>
    </Menu>
  )
}
