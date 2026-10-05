import { useRef, useState } from 'react'
import { Check, ChevronDown, ImagePlus, Moon, Trash2 } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { useDeleteSleepImage, useKoboConfig, useSaveKoboConfig, useSleepImages, useSleepImageUrls, useUploadSleepImages } from '../../hooks/useKoboControl'
import { SETTING_GROUPS } from '../../koboSettingsCatalogue'
import { SettingControl } from './SettingControl'
import { useKoboSettings } from './useKoboSetting'

const MODE = 'screensaver_type'
/** Sleep-screen settings shown under the mode picker (the rest sit in the settings card). */
const sleepGroup = SETTING_GROUPS.find(g => g.id === 'sleep_screen')?.settings ?? []
const bookshelfGroup = SETTING_GROUPS.find(g => g.id === 'bookshelf')?.settings ?? []

/** What the Kobo shows while it sleeps: the mode, your own images, and the details. */
export function SleepScreenCard() {
  const s = useKoboSettings()
  const mode = s.view(MODE)
  const modeDef = s.def(MODE)
  const current = mode?.value
  const extra = sleepGroup.filter(d => d.key !== MODE && !d.managed)
  const [more, setMore] = useState(false)
  return (
    <Card>
      <CardHeader title="Sleep screen" icon={<Moon />} subtitle="KOReader's sleep screen. Kobo's own sleep screen (outside KOReader) is not touched." wrap />
      {modeDef && mode && (
        <div role="radiogroup" aria-label="What the sleep screen shows" className="grid gap-1 @container sm:grid-cols-2">
          {modeDef.options?.map(o => (
            <button key={String(o.value)} type="button" role="radio" aria-checked={current === o.value} disabled={s.loading}
              onClick={() => s.set(MODE, o.value)}
              className={cx('flex min-h-[44px] items-center gap-2 rounded-control border px-3 py-2 text-left text-body',
                current === o.value ? 'border-accent-500 bg-accent-50 text-fg' : 'border-line text-fg-2 hover:bg-surface-hover')}>
              <span aria-hidden className={cx('grid h-4 w-4 shrink-0 place-items-center rounded-full border', current === o.value ? 'border-accent-600 bg-accent-500 text-on-accent' : 'border-line')}>
                {current === o.value && <Check className="h-3 w-3" />}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {mode?.pending && <p className="mt-2 text-micro text-warn">Waiting for the Kobo's next sync.</p>}
      {current === 'cover' && (
        <p className="mt-2 text-meta text-fg-muted">
          Shows the book open in KOReader, or the last one you read there. Until a book has been opened in KOReader, KOReader shows an image instead.
        </p>
      )}
      {(current === 'random_image' || current === 'document_cover' || current === 'cover') && (
        <SleepImages purpose={current === 'document_cover' ? 'pick' : current === 'cover' ? 'fallback' : 'random'} />
      )}
      {current === 'bookshelf' && (
        <div className="mt-3 divide-y divide-line border-t border-line">
          {bookshelfGroup.map(d => {
            const v = s.view(d.key)
            return v && <SettingControl key={d.key} def={d} view={v} disabled={s.loading} onChange={x => s.set(d.key, x)} />
          })}
        </div>
      )}
      <button type="button" aria-expanded={more} onClick={() => setMore(m => !m)}
        className="mt-3 flex min-h-[44px] w-full items-center gap-2 border-t border-line text-left">
        <span className="flex-1 text-body font-semibold text-fg">More sleep screen options</span>
        <span className="text-micro tabular-nums text-fg-muted">{extra.length}</span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 text-fg-muted transition-transform', more && 'rotate-180')} />
      </button>
      {more && (
        <div className="divide-y divide-line">
          {extra.map(d => {
            const v = s.view(d.key)
            return v && <SettingControl key={d.key} def={d} view={v} disabled={s.loading} onChange={x => s.set(d.key, x)} />
          })}
        </div>
      )}
    </Card>
  )
}

/** Your own sleep images: added here, copied to the Kobo at its next sync. */
function SleepImages({ purpose }: { purpose: 'pick' | 'random' | 'fallback' }) {
  const pickOne = purpose === 'pick'
  const images = useSleepImages()
  const urls = useSleepImageUrls(images.data ?? [])
  const upload = useUploadSleepImages()
  const remove = useDeleteSleepImage()
  const config = useKoboConfig()
  const save = useSaveKoboConfig()
  const modal = useEntityModal()
  const input = useRef<HTMLInputElement>(null)
  const rows = images.data ?? []
  const used = rows.reduce((t, r) => t + r.size_bytes, 0)
  const selected = config.data?.sleep_image_id ?? null
  return (
    <section className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-meta text-fg-muted">
          {purpose === 'pick' ? 'Tap an image to show it every time.'
            : purpose === 'fallback' ? 'Shown when there is no cover to show.'
              : 'One of these at random each time (or in order — see below).'}
          {' '}{rows.length} {rows.length === 1 ? 'image' : 'images'} · {(used / 1048576).toFixed(1)} of 10 MB
        </p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
          onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) upload.mutate(f) }} />
        <Button size="sm" icon={<ImagePlus />} loading={upload.isPending} onClick={() => input.current?.click()}>Add images</Button>
      </div>
      {rows.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
          {rows.map(img => (
            <li key={img.id} className="relative">
              <button type="button" disabled={!pickOne} aria-pressed={pickOne ? selected === img.id : undefined}
                aria-label={pickOne ? `Show ${img.filename} on the sleep screen` : img.filename}
                onClick={() => pickOne && save.mutate({ sleep_image_id: selected === img.id ? null : img.id })}
                className={cx('block w-full overflow-hidden rounded-control border-2', pickOne && selected === img.id ? 'border-accent-500' : 'border-line')}>
                {urls.data?.[img.storage_path]
                  ? <img src={urls.data[img.storage_path]} alt="" className="aspect-[3/4] w-full bg-surface-2 object-cover" loading="lazy" />
                  : <span className="block aspect-[3/4] w-full bg-surface-2" />}
              </button>
              <IconButton label={`Delete ${img.filename}`} className="absolute right-0 top-0 bg-surface/80"
                onClick={async () => {
                  if (await modal.confirm({ title: 'Delete this image?', message: 'It is removed from the Kobo at its next sync.', confirmLabel: 'Delete', destructive: true })) remove.mutate(img)
                }}><Trash2 /></IconButton>
            </li>
          ))}
        </ul>
      )}
      <p className="text-micro text-fg-muted">Images are resized to the Kobo's screen (1072 × 1448) before upload.</p>
    </section>
  )
}
