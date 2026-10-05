import { useRef } from 'react'
import { Check, ImagePlus, Moon, Trash2 } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, TonePill, cx } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import { useEntityModal } from '../../../../shared/modals'
import { useDeleteSleepImage, useKoboConfig, useSaveKoboConfig, useSleepImages, useSleepImageUrls, useUploadSleepImages } from '../../hooks/useKoboControl'
import { SETTING_GROUPS } from '../../koboSettingsCatalogue'
import { SettingHelp } from './SettingControl'
import { GroupCard } from './SettingsGroupCard'
import { useKoboSettings } from './useKoboSetting'

const MODE = 'screensaver_type'
const sleepGroup = SETTING_GROUPS.find(g => g.id === 'sleep_screen')
const bookshelfGroup = SETTING_GROUPS.find(g => g.id === 'bookshelf')

/** One plain line under each choice. */
const MODE_HINT: Record<string, string> = {
  cover: 'The cover of the book you are reading in KOReader.',
  bookshelf: 'Your recent books drawn as spines on a shelf, with progress.',
  random_image: 'One of your own pictures, a different one each time.',
  document_cover: 'Always the same picture, the one you pick below.',
  readingprogress: 'A page of reading statistics for the current book.',
  bookstatus: 'The current book’s summary: title, progress and your rating.',
  disable: 'Nothing new: the page you were reading stays on the screen.',
}

/** What the Kobo shows while it sleeps: the choice, your own images, and the details. */
export function SleepScreenCard() {
  const s = useKoboSettings()
  const mode = s.view(MODE)
  const modeDef = s.def(MODE)
  const current = mode?.value
  const extraKeys = (sleepGroup?.settings ?? []).filter(d => d.key !== MODE && !d.managed).map(d => d.key)
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="What the sleep screen shows" icon={<Moon />} wrap
          subtitle="Shown when you close the cover or press the power button. Only KOReader’s sleep screen; Kobo’s own is not touched."
          action={modeDef ? <HelpTip label="About the sleep screen"><SettingHelp def={modeDef} /></HelpTip> : undefined} />
        {modeDef && mode && (
          <div className="@container">
            <div role="radiogroup" aria-label="What the sleep screen shows" className="grid gap-2 @[34rem]:grid-cols-2">
              {modeDef.options?.map(o => {
                const on = current === o.value
                return (
                  <button key={String(o.value)} type="button" role="radio" aria-checked={on} disabled={s.loading}
                    onClick={() => s.set(MODE, o.value)}
                    className={cx('flex min-h-[56px] items-start gap-3 rounded-row border px-3 py-2.5 text-left',
                      on ? 'border-accent-500 bg-accent-50' : 'border-line hover:bg-surface-hover')}>
                    <span aria-hidden className={cx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border',
                      on ? 'border-accent-600 bg-accent-500 text-on-accent' : 'border-line-strong')}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body font-semibold text-fg">{o.label}</span>
                      {MODE_HINT[String(o.value)] && <span className="block text-meta text-fg-muted">{MODE_HINT[String(o.value)]}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {mode?.pending && <p className="mt-2"><TonePill tone="warn">Waiting for the Kobo’s next sync</TonePill></p>}
        {current === 'cover' && (
          <p className="mt-3 text-meta text-fg-muted">
            Until a book has been opened in KOReader once, KOReader shows one of your images below instead.
          </p>
        )}
      </Card>
      {(current === 'random_image' || current === 'document_cover' || current === 'cover') && (
        <Card>
          <CardHeader title={current === 'document_cover' ? 'Pick your image' : 'Your images'} icon={<ImagePlus />} />
          <SleepImages purpose={current === 'document_cover' ? 'pick' : current === 'cover' ? 'fallback' : 'random'} />
        </Card>
      )}
      {current === 'bookshelf' && bookshelfGroup && <GroupCard group={bookshelfGroup} s={s} color={2} />}
      {sleepGroup && extraKeys.length > 0 && (
        <GroupCard group={{ ...sleepGroup, label: 'Message and more' }} keys={extraKeys} s={s} color={2} />
      )}
    </div>
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
    <section className="flex flex-col gap-2">
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
