import { useState } from 'react'
import { Button, Card, CardHeader, Skeleton, ToneDot, Truncate, cx } from '../../../shared/ui'
import { HoverPeek } from '../../../shared/components/HoverPeek'
import { useEntityModal } from '../../../shared/modals'
import { tableSlice, type FbStandingRow, type FbTable } from '../footballModel'
import { noteTones, tablesToShow } from '../footballView'
import { useStandings } from '../hooks/useFootball'
import { TeamLogo } from './TeamLogo'

/**
 * One tournament's table(s): the top and the rows around the teams you follow
 * (footballModel.tableSlice), "Show all" for the whole table. Zones are a dot;
 * what a dot means waits behind "Key". A group stage shows the groups with a
 * followed team; the rest open with "N more groups".
 */
export function StandingsCard({ league, followed }: { league: string; followed: ReadonlySet<string> }) {
  const q = useStandings(league)
  const [whole, setWhole] = useState(false)
  if (q.isLoading) return <Skeleton rounded="rounded-card" className="h-48" />
  if (q.isError || !q.data || !q.data.tables.length) {
    return (
      <Card>
        <CardHeader title={q.data?.name || league} variant="label" />
        <p className="text-body text-fg-muted">
          {q.isError ? 'This table couldn\'t be read from ESPN.' : 'No table for this tournament right now.'}
        </p>
        {q.isError && <Button size="sm" variant="ghost" className="mt-2" onClick={() => { void q.refetch() }}>Try again</Button>}
      </Card>
    )
  }
  const { shown, hidden } = tablesToShow(q.data.tables, followed)
  const tables = whole ? q.data.tables : shown
  return (
    <Card>
      <CardHeader title={q.data.name || league} variant="label" />
      <div className="flex flex-col gap-4">
        {tables.map(t => <StandingsTable key={t.name} league={league} table={t} followed={followed} whole={whole} named={q.data.tables.length > 1} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {(hidden > 0 || tables.some(t => t.rows.length > tableSlice(t.rows, followed).filter(Boolean).length)) && (
          <Button size="sm" variant="ghost" onClick={() => setWhole(v => !v)}>
            {whole ? 'Show less' : hidden > 0 ? `Show all · ${hidden} more ${hidden === 1 ? 'group' : 'groups'}` : 'Show all'}
          </Button>
        )}
      </div>
    </Card>
  )
}

function StandingsTable({ league, table, followed, whole, named }: {
  league: string; table: FbTable; followed: ReadonlySet<string>; whole: boolean; named: boolean
}) {
  const modal = useEntityModal()
  const tones = noteTones(table.rows)
  const rows = whole ? table.rows : tableSlice(table.rows, followed)
  const cell = 'px-1.5 py-1.5 text-right tabular-nums'
  const row = (r: FbStandingRow) => {
    const tone = r.note ? tones.get(r.note.text) : undefined
    const mine = followed.has(r.team.id)
    return (
      <tr key={r.team.id} className={cx('border-t border-line hover:bg-surface-hover', mine && 'bg-accent-50 font-semibold')}>
        <td className="w-7 py-1.5 pl-1 text-meta tabular-nums text-fg-muted">
          <span className="flex items-center gap-1">{tone ? <ToneDot tone={tone} /> : <span className="w-1.5" />}{r.rank}</span>
        </td>
        <td className="max-w-0 py-1.5 pr-1">
          <button type="button" className="flex w-full min-w-0 items-center gap-2 text-left"
            onClick={() => modal.open({ kind: 'football-team', teamId: r.team.id, league })}>
            <TeamLogo src={r.team.logo} size={16} />
            <Truncate className="text-body text-fg">{r.team.short}</Truncate>
          </button>
        </td>
        <td className={cx(cell, 'text-meta text-fg-muted')}>{r.played}</td>
        <td className={cx(cell, 'text-meta text-fg-muted')}>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
        <td className={cx(cell, 'text-body font-semibold text-fg')}>{r.points}</td>
      </tr>
    )
  }
  return (
    <div>
      {named && <h3 className="mb-1 text-meta font-semibold text-fg-muted"><Truncate>{table.name}</Truncate></h3>}
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-micro text-fg-faint">
            <th className="w-7 py-1 pl-1 text-left font-semibold">#</th>
            <th className="py-1 text-left font-semibold">Team</th>
            <th className="w-8 py-1 pr-1.5 text-right font-semibold" title="Played">P</th>
            <th className="w-9 py-1 pr-1.5 text-right font-semibold" title="Goal difference">GD</th>
            <th className="w-10 py-1 pr-1.5 text-right font-semibold" title="Points">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (r ? row(r) : (
            <tr key={`gap-${i}`} aria-hidden><td colSpan={5} className="py-0.5 text-center text-meta text-fg-faint">⋯</td></tr>
          )))}
        </tbody>
      </table>
      {tones.size > 0 && (
        <HoverPeek label="What the dots mean" trigger={<span className="mt-1 inline-block text-meta text-fg-muted underline decoration-dotted underline-offset-2">Key</span>}>
          <ul className="flex flex-col gap-1.5 text-meta text-fg">
            {[...tones].map(([text, tone]) => <li key={text} className="flex items-center gap-2"><ToneDot tone={tone} />{text}</li>)}
          </ul>
        </HoverPeek>
      )}
    </div>
  )
}
