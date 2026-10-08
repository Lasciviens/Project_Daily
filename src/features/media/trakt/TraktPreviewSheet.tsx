import { entityModal } from '../../../shared/modals'
import { ErrorNotice } from '../../../shared/components/ErrorNotice'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Skeleton, ToneDot, type Tone } from '../../../shared/ui'
import { Truncate } from '../../../shared/ui/Truncate'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { toast } from '../../../app/store'
import { previewReport, type PreviewChange, type PreviewTitle, type TraktPreview } from './traktPreview'
import { useRunTraktImport, useTraktPreview } from './useTrakt'

// The first import's dry run: every count the import would act on, with the
// titles behind it. Reads Trakt and the library; writes nothing.

const titleLine = (t: PreviewTitle) => `${t.title}${t.year ? ` (${t.year})` : ''}`

function Row({ tone, label, count, items }: { tone: Tone; label: string; count: number; items?: (PreviewTitle | PreviewChange)[] }) {
  const shown = (items ?? []).slice(0, 30)
  return (
    <details className="group rounded-control border border-line px-3 py-2 open:bg-surface-2" open={false}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-meta">
        <ToneDot tone={count ? tone : 'neutral'} />
        <span className="min-w-0 flex-1 text-fg">{label}</span>
        <span className="tabular-nums font-semibold text-fg">{count.toLocaleString('en-GB')}</span>
      </summary>
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5 pb-1 text-micro text-fg-2">
          {shown.map((t, i) => (
            <li key={`${t.kind}-${t.tmdbId ?? t.title}-${i}`} className="flex min-w-0 gap-2">
              <Truncate className="min-w-0 flex-1">{titleLine(t)}</Truncate>
              {'detail' in t && <span className="shrink-0 text-fg-muted">{t.detail}</span>}
            </li>
          ))}
          {(items?.length ?? 0) > shown.length && <li className="text-fg-muted">…and {(items!.length - shown.length).toLocaleString('en-GB')} more</li>}
        </ul>
      )}
    </details>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="section-label">{title}</h3>
      {children}
    </section>
  )
}

function Body({ p }: { p: TraktPreview }) {
  return (
    <div className="flex flex-col gap-4">
      {p.duplicateLocal > 0 && (
        <p className="w-fit rounded-control bg-surface-2 px-3 py-2 text-meta text-fg" data-tone="danger">
          {p.duplicateLocal} library title{p.duplicateLocal === 1 ? '' : 's'} appear twice — these are merged before any import.
        </p>
      )}
      <Section title="Movies">
        <Row tone="success" label="New from Trakt (added as Completed)" count={p.movies.add.length} items={p.movies.add} />
        <Row tone="info" label="Changed to match Trakt" count={p.movies.update.length} items={p.movies.update} />
        <Row tone="neutral" label="Already the same" count={p.movies.same} />
        <Row tone="warn" label="Watched here, not on Trakt (sent to Trakt)" count={p.movies.push.length} items={p.movies.push} />
      </Section>
      <Section title="Shows">
        <Row tone="success" label="New from Trakt" count={p.shows.add.length} items={p.shows.add} />
        <Row tone="info" label="Episodes to add to existing shows" count={p.shows.update.length} items={p.shows.update} />
        <Row tone="neutral" label="Already the same" count={p.shows.same} />
        <Row tone="warn" label="Watched here, not on Trakt (sent to Trakt)" count={p.shows.push.length} items={p.shows.push} />
      </Section>
      <Section title="Episodes">
        <Row tone="success" label="Watched episodes to add" count={p.episodes.add} />
        <Row tone="info" label="Play counts to update" count={p.episodes.playsChanged} />
        <Row tone="neutral" label="Already the same" count={p.episodes.same} />
        <Row tone="warn" label="Watched here, not on Trakt (sent to Trakt)" count={p.episodes.push} />
      </Section>
      <Section title="Watchlist · ratings · dropped">
        <Row tone="success" label="Watchlist titles to add (as Wishlist)" count={p.watchlist.add.length} items={p.watchlist.add} />
        <Row tone="warn" label="Wishlist here, not on the Trakt watchlist (sent)" count={p.watchlist.push.length} items={p.watchlist.push} />
        <Row tone="neutral" label="On the watchlist but already watched (leaves the watchlist)" count={p.watchlist.skippedWatched} />
        <Row tone="info" label="Ratings to take from Trakt" count={p.ratings.update.length} items={p.ratings.update} />
        <Row tone="neutral" label="Rated on Trakt only — title not in the library, rating not imported" count={p.ratings.skipped.length} items={p.ratings.skipped} />
        <Row tone="warn" label="Rated here, not on Trakt (sent)" count={p.ratings.push.length} items={p.ratings.push} />
        <Row tone="info" label="Shows to mark Dropped" count={p.dropped.add.length} items={p.dropped.add} />
        <Row tone="warn" label="Dropped here, not on Trakt (sent)" count={p.dropped.push.length} items={p.dropped.push} />
      </Section>
      <Section title="Also coming over">
        <Row tone="success" label="Favorites (marked on titles in your library; yours sent to Trakt)" count={p.favorites.matched} />
        <Row tone="success" label="Half-watched, not in your library (added as Watching)" count={p.playback.watching.length} items={p.playback.watching} />
        <Row tone="neutral" label="Half-watched, nothing to add (shown live in Continue watching)" count={p.playback.live} />
        <Row tone="danger" label="No TMDB match — picked by hand later" count={p.unmatched.length} items={p.unmatched} />
      </Section>
      <Section title="Notes">
        {p.notes ? (
          <>
            <Row tone="success" label="On Trakt, not here (written into your library)" count={p.notes.fromTrakt.length} items={p.notes.fromTrakt} />
            <Row tone="warn" label="Here, not on Trakt (sent to Trakt — over 500 characters, Trakt keeps the first 499 + …)" count={p.notes.push.length} items={p.notes.push} />
            <Row tone="info" label="A different note on each side — Trakt’s is kept" count={p.notes.differ.length} items={p.notes.differ} />
            <Row tone="neutral" label="Already the same" count={p.notes.same} />
            <Row tone="neutral" label="On Trakt for titles not in your library yet (they come in with the titles the import adds; a note alone adds no title)" count={p.notes.notInLibrary} />
          </>
        ) : <p className="text-meta text-fg-muted">Trakt’s notes were not read this time, so they are not counted here.</p>}
      </Section>
    </div>
  )
}

export function TraktPreviewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useTraktPreview(open)
  const imp = useRunTraktImport()
  const runImport = async () => {
    const ok = await entityModal.confirm({
      title: 'Import from Trakt now?',
      message: 'Your library takes everything Trakt holds (Trakt wins where both have a value), and what only the app holds is sent to Trakt. Watched or watching titles leave the watchlist on both sides. Changes waiting to go to Trakt are sent first. Automatic sync starts once this has finished. Safe to run again.',
      confirmLabel: 'Import',
    })
    if (!ok) return
    try { await imp.mutateAsync() } catch { /* toasted by the hook */ }
    q.refetch()
  }
  const copy = async () => {
    if (!q.data) return
    try {
      await navigator.clipboard.writeText(previewReport(q.data.preview, formatDateTime(q.data.snapshot.fetchedAt)))
      toast.success('Report copied — paste it into the chat')
    } catch {
      toast.error('Could not copy — your browser blocked the clipboard')
    }
  }
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="lg"
      title="Trakt import preview"
      subtitle={q.data ? `Read ${formatDateTime(q.data.snapshot.fetchedAt)} · nothing is saved until you press Import now` : q.error ? 'Nothing was read — see below' : 'Reading Trakt and your library…'}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={copy} disabled={!q.data || imp.isPending}>Copy report</Button>
          <Button onClick={() => q.refetch()} disabled={q.isFetching || imp.isPending}>Read again</Button>
          <Button variant="primary" onClick={runImport} disabled={!q.data || imp.isPending}>{imp.isPending ? 'Importing…' : 'Import now'}</Button>
        </div>
      }
    >
      {imp.isPending && <p className="mb-3 w-fit rounded-control bg-surface-2 px-3 py-2 text-meta text-fg" data-tone="info" role="status">Importing on the server — this can take a minute.</p>}
      {q.isLoading && <div className="flex flex-col gap-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-11" />)}</div>}
      {q.error && <ErrorNotice where="Settings → Trakt → Import preview" title="Could not read Trakt." error={q.error} onRetry={() => { void q.refetch() }} />}
      {(q.data?.snapshot.warnings ?? []).map(w => <p key={w} className="mb-2 w-fit rounded-control bg-surface-2 px-3 py-2 text-meta text-fg" data-tone="warn" role="status">{w} The rest of the preview is complete.</p>)}
      {q.data && <Body p={q.data.preview} />}
    </ModalShell>
  )
}
