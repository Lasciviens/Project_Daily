import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import {
  deleteAiNote, deleteSleepImage, fetchAiNotes, fetchKoboConfig, fetchKoboDeviceState, fetchSleepImages, saveKoboConfig,
  sleepImageUrls, uploadBookCover, uploadSleepImage,
} from '../api/koboControlApi'
import { resizeImage } from '../api/imageResize'
import type { KoboDeviceConfig, SleepImage } from '../types'

/** The Clara BW's screen, portrait. */
const SCREEN = { w: 1072, h: 1448 }

export function useKoboConfig() {
  return useQuery({ queryKey: qk.books.koboConfig(), queryFn: fetchKoboConfig, staleTime: STALE.short })
}

export function useKoboDeviceState() {
  return useQuery({ queryKey: qk.books.koboDevice(), queryFn: fetchKoboDeviceState, staleTime: STALE.short })
}

type ConfigPatch = Partial<Pick<KoboDeviceConfig, 'settings' | 'menu_order' | 'sleep_image_id'>>

/**
 * Saves a change for the Kobo. Optimistic: the page shows it at once; the
 * Kobo applies it at its next sync.
 */
export function useSaveKoboConfig() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'kobo_config_save',
    mutationKey: ['books', 'kobo-config-save'],
    // One at a time: each save carries the whole settings object, so two quick
    // changes landing out of order would lose the first.
    scope: { id: 'kobo-config' },
    mutationFn: (patch: ConfigPatch) => saveKoboConfig(patch),
    onMutate: async (patch: ConfigPatch) => {
      await qc.cancelQueries({ queryKey: qk.books.koboConfig() })
      const prev = qc.getQueryData<KoboDeviceConfig | null>(qk.books.koboConfig())
      qc.setQueryData<KoboDeviceConfig | null>(qk.books.koboConfig(), old => ({
        settings: {}, menu_order: {}, sleep_image_id: null, rev: 0, updated_at: new Date().toISOString(), ...(old ?? {}), ...patch,
      }))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      const c = ctx as { prev?: KoboDeviceConfig | null } | undefined
      qc.setQueryData(qk.books.koboConfig(), c?.prev ?? null)
    },
    invalidates: [qk.books.koboConfig()],
  })
}

/**
 * One setting: a value, or null for "back to KOReader's default". A reset is
 * stored as null (never dropped), so the Kobo is told to delete its own value.
 */
export function settingPatch(config: KoboDeviceConfig | null | undefined, key: string, value: KoboDeviceConfig['settings'][string]): ConfigPatch {
  return { settings: { ...(config?.settings ?? {}), [key]: value } }
}

export function useSleepImages() {
  return useQuery({ queryKey: qk.books.sleepImages(), queryFn: fetchSleepImages, staleTime: STALE.default })
}

export function useSleepImageUrls(images: SleepImage[]) {
  const paths = images.map(i => i.storage_path)
  return useQuery({
    queryKey: [...qk.books.sleepImages(), 'urls', paths.join('|')],
    queryFn: () => sleepImageUrls(paths),
    staleTime: 30 * 60_000,
    enabled: paths.length > 0,
  })
}

export function useUploadSleepImages() {
  return useMutationWithFeedback({
    action: 'kobo_sleep_upload',
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const r = await resizeImage(f, SCREEN.w, SCREEN.h)
        await uploadSleepImage({ ...r, filename: f.name })
      }
      return files.length
    },
    loadingMessage: 'Uploading…',
    successMessage: n => `${n === 1 ? 'Image' : `${n} images`} added — on the Kobo after its next sync`,
    invalidates: [qk.books.sleepImages(), qk.books.koboConfig()],
  })
}

export function useDeleteSleepImage() {
  return useMutationWithFeedback({
    action: 'kobo_sleep_delete',
    mutationFn: (img: SleepImage) => deleteSleepImage(img),
    successMessage: 'Image removed',
    invalidates: [qk.books.sleepImages(), qk.books.koboConfig()],
  })
}

export function useUploadBookCover() {
  return useMutationWithFeedback({
    action: 'book_cover_upload',
    mutationFn: async ({ bookId, file, previous }: { bookId: string; file: File; previous: string | null }) => {
      const r = await resizeImage(file, 600, 900)
      return uploadBookCover(bookId, r.blob, previous)
    },
    loadingMessage: 'Uploading cover…',
    successMessage: 'Cover saved',
    invalidates: [qk.books.library()],
  })
}

export function useAiNotes(bookId?: string) {
  return useQuery({ queryKey: qk.books.aiNotes(bookId), queryFn: () => fetchAiNotes(bookId), staleTime: STALE.default })
}

export function useDeleteAiNote() {
  return useMutationWithFeedback({
    action: 'book_ai_note_delete',
    mutationFn: (id: string) => deleteAiNote(id),
    invalidates: [['books', 'ai-notes']],
  })
}
