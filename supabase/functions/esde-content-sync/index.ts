// Original images + complete parsed game XML. Requires migration 100.
// JWT off: authenticate the device secret before every read/write. Owner is
// always server-configured; service credentials never leave this function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'
const base = Deno.env.get('SUPABASE_URL')!
const db = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-esde-secret,x-esde-asset', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const hashPattern = /^[a-f0-9]{64}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
class Invalid extends Error {}
const requireValue = (ok: unknown, message: string) => { if (!ok) throw new Invalid(message) }
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('')
async function authenticate(given: string, expected: string) {
  const encoder = new TextEncoder(), a = await digest(encoder.encode(given)), b = await digest(encoder.encode(expected))
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
async function readBytes(req: Request, limit: number) {
  const reader = req.body?.getReader()
  if (!reader) throw new Invalid('Missing body')
  const chunks: Uint8Array[] = []; let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) { await reader.cancel(); throw new Invalid('File exceeds size limit') }
    chunks.push(value)
  }
  const result = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
function parse(text: string) { try { return JSON.parse(text) } catch { throw new Invalid('Invalid JSON') } }
function imageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  const text = (from: number, to: number) => new TextDecoder().decode(bytes.slice(from, to))
  if (bytes.length < 12) return null
  if ([137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return { mime: 'image/png', extension: 'png' }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', extension: 'jpg' }
  if (text(0,4) === 'RIFF' && text(8,12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' }
  if (['GIF87a','GIF89a'].includes(text(0,6))) return { mime: 'image/gif', extension: 'gif' }
  if (text(0,2) === 'BM') return { mime: 'image/bmp', extension: 'bmp' }
  return null // PDFs/videos/unknown bytes are never uploaded, even with an image filename.
}

// ── Storage wall ────────────────────────────────────────────────────────────
// The Free plan's 1 GB bucket quota is a hard wall: past it the project is
// eventually locked with 402 on EVERY request. The ScreenScraper scraper
// already refuses to store past its budget; this upload shares the bucket, so
// it refuses past the same hard cap. 413 is not retried by the device script,
// so a full bucket stops the run cleanly instead of hammering it.
const STORAGE_HARD_CAP = 950 * 1024 * 1024
async function storageRefusal(incoming: number): Promise<{ used: number } | null> {
  const { data, error } = await db.rpc('game_media_usage') as { data: unknown; error: unknown }
  // Before migration 104 the function does not exist: behave as before it.
  if (error) {
    const code = (error as { code?: string }).code
    if (code === 'PGRST202' || code === '42883') return null
    throw error
  }
  if (!Array.isArray(data)) return null
  const used = (data as { bytes?: number }[]).reduce((sum, row) => sum + Number(row.bytes ?? 0), 0)
  return used + incoming > STORAGE_HARD_CAP ? { used } : null
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405)
  const secret = Deno.env.get('ESDE_SYNC_SECRET'), owner = Deno.env.get('HEVY_USER_ID')
  if (!secret || !owner) return reply({ error: 'Server not configured' }, 503)
  if (!await authenticate(req.headers.get('x-esde-secret') ?? '', secret)) return reply({ error: 'Unauthorized' }, 401)
  try {
    const binary = new URL(req.url).searchParams.get('action') === 'asset'
    let body
    if (binary) {
      const header = req.headers.get('x-esde-asset') ?? ''
      requireValue(header.length > 0 && header.length < 16000, 'Invalid asset header')
      try { body = parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(header), c => c.charCodeAt(0)))) }
      catch { throw new Invalid('Invalid asset header') }
      requireValue(body && typeof body === 'object' && !Array.isArray(body), 'Invalid asset metadata')
      body.action = 'asset'
    } else body = parse(new TextDecoder().decode(await readBytes(req, 1500000)))
    requireValue(body && typeof body === 'object' && !Array.isArray(body), 'Expected object')
    if (body.action === 'inventory') {
      const page = body.page ?? 0
      requireValue(Number.isSafeInteger(page) && page >= 0 && page < 10000, 'Invalid page')
      const { data, error } = await db.from('game_platforms')
        .select('id,esde_system,esde_path,esde_source_hash,esde_assets')
        .eq('user_id', owner).eq('external_source', 'esde').order('id').range(page * 100, page * 100 + 99)
      if (error) throw error
      return reply({ status: 'ok', variants: data, more: data.length === 100 })
    }
    requireValue(typeof body.variant_id === 'string' && uuid.test(body.variant_id), 'Invalid variant')
    const { data: variant, error } = await db.from('game_platforms').select('id,esde_system,esde_path')
      .eq('user_id', owner).eq('external_source', 'esde').eq('id', body.variant_id).maybeSingle()
    if (error) throw error
    if (!variant) return reply({ error: 'Import game first or refresh inventory' }, 409)
    let kind: string, value: unknown
    if (body.action === 'source') {
      requireValue(typeof body.source_json === 'string' && hashPattern.test(body.sha256), 'Invalid source')
      requireValue(await digest(new TextEncoder().encode(body.source_json)) === body.sha256, 'Source hash mismatch')
      const document = parse(body.source_json)
      requireValue(document && typeof document.game === 'string' && document.context && typeof document.context === 'object', 'Invalid source document')
      kind = 'source'; value = { sha256: body.sha256, document }
    } else if (binary) {
      requireValue(typeof body.key === 'string' && typeof body.category === 'string' && /^[a-z0-9_-]{1,80}$/i.test(body.category) && body.category.toLowerCase() !== 'videos', 'Invalid category')
      requireValue(hashPattern.test(body.sha256) && Number.isSafeInteger(body.size) && body.size > 0 && body.size <= 20000000, 'Invalid image size/hash')
      const stem = variant.esde_path.replace(/^\.\//, '').replace(/\.[^/.]+$/, '')
      const allowed = ['png','jpg','jpeg','webp','gif','bmp']
      const prefix = `${variant.esde_system}/${body.category}/${stem}.`
      requireValue(body.key.startsWith(prefix) && allowed.includes(body.key.slice(prefix.length).toLowerCase()), 'Image path does not match game')
      const bytes = await readBytes(req, 20000000), type = imageType(bytes)
      requireValue(type && bytes.length === body.size, 'Expected supported image; PDF/video excluded')
      requireValue(await digest(bytes) === body.sha256, 'Image hash mismatch')
      const full = await storageRefusal(bytes.length)
      if (full) return reply({ error: 'storage_full', used: full.used, cap: STORAGE_HARD_CAP }, 413)
      const object = `${owner}/esde/${variant.id}/${body.sha256}.${type!.extension}`
      const { error: uploadError } = await db.storage.from('game-media').upload(object, bytes,
        { contentType: type!.mime, cacheControl: '31536000', upsert: true })
      if (uploadError) throw uploadError
      kind = 'asset'; value = { key: body.key, asset: { category: body.category, sha256: body.sha256,
        size: bytes.length, mime: type!.mime, url: `${base}/storage/v1/object/public/game-media/${object}` } }
    } else if (body.action === 'prune') {
      requireValue(Array.isArray(body.entries) && body.entries.length <= 150, 'Invalid removal batch')
      kind = 'prune'; value = { entries: body.entries }
    } else throw new Invalid('Unknown action')
    const { data, error: saveError } = await db.rpc('esde_save_content', {
      p_user_id: owner, p_variant_id: variant.id, p_kind: kind, p_value: value,
    })
    if (saveError?.message.includes('changed since inventory')) return reply({ error: 'Asset changed; rescan required' }, 409)
    if (saveError) throw saveError
    return reply({ status: 'ok', ...data })
  } catch (error) {
    if (error instanceof Invalid) return reply({ error: error.message }, 400)
    console.error('esde-content-sync operation failed')
    return reply({ error: 'Operation failed; retry safely' }, 500)
  }
})
