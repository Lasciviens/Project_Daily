// Handheld cover uploads and explicit deletion reconciliation. JWT is disabled:
// this function authenticates ESDE_SYNC_SECRET, never accepts a client user ID,
// and scopes all data to the configured owner. Requires migration 094.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'

const base = Deno.env.get('SUPABASE_URL')!
const db = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const bucket = 'game-media'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-esde-secret', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
class Invalid extends Error {}
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Invalid(message) }
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('')
async function authenticated(given: string, expected: string) {
  // Hash both to fixed length before comparing; never log credential material.
  const encoder = new TextEncoder()
  const a = await digest(encoder.encode(given)), b = await digest(encoder.encode(expected))
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}
async function readBody(req: Request) {
  const reader = req.body?.getReader()
  requireValue(reader, 'Missing body')
  const chunks: Uint8Array[] = []; let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > 1500000) { await reader.cancel(); throw new Invalid('Request too large') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Invalid('Invalid JSON') }
}

// Delete storage through its API, after the DB transaction. On a failed cleanup
// the client retains the exact request and retries it (the RPC is idempotent).
async function removeDeletedCovers(userId: string, ids: string[]) {
  for (const id of ids) {
    const { data: variant, error } = await db.from('game_platforms').select('id').eq('user_id', userId).eq('id', id).maybeSingle()
    if (error) throw error
    if (variant) continue
    const prefix = `${userId}/esde/${id}`
    const objects: string[] = []
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw error
      for (const file of data ?? []) {
        if (/^[a-f0-9]{64}\.webp$/.test(file.name)) objects.push(`${prefix}/${file.name}`)
      }
      if (!data || data.length < 100) break
    }
    for (const object of objects) {
      const url = `${base}/storage/v1/object/public/${bucket}/${object}`
      const [games, variants] = await Promise.all([
        db.from('games').select('id').eq('user_id', userId).eq('primary_cover_url', url).limit(1),
        db.from('game_platforms').select('id').eq('user_id', userId).eq('cover_url', url).limit(1),
      ])
      if (games.error) throw games.error
      if (variants.error) throw variants.error
      if (games.data?.length || variants.data?.length) continue
      const { error } = await db.storage.from(bucket).remove([object])
      if (error) throw error
    }
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405)
  const secret = Deno.env.get('ESDE_SYNC_SECRET'), userId = Deno.env.get('HEVY_USER_ID')
  if (!secret || !userId) return reply({ error: 'Server not configured' }, 503)
  if (!await authenticated(req.headers.get('x-esde-secret') ?? '', secret)) return reply({ error: 'Unauthorized' }, 401)
  try {
    const body = await readBody(req)
    requireValue(body && typeof body === 'object' && !Array.isArray(body), 'Expected object')
    const managedPrefix = `${base}/storage/v1/object/public/${bucket}/${userId}/esde/`
    if (body.action === 'inventory') {
      const page = body.page ?? 0
      requireValue(Number.isSafeInteger(page) && page >= 0 && page < 10000, 'Invalid page')
      const { data, error } = await db.from('game_platforms')
        .select('id,game_id,esde_system,esde_path,cover_url,updated_at')
        .eq('user_id', userId).eq('external_source', 'esde').order('id').range(page * 500, page * 500 + 499)
      if (error) throw error
      return reply({ status: 'ok', variants: data, more: data.length === 500, managed_prefix: managedPrefix })
    }
    if (body.action === 'upload_cover') {
      requireValue(typeof body.system === 'string' && /^[a-z0-9_-]{1,80}$/i.test(body.system), 'Invalid system')
      requireValue(typeof body.path === 'string' && body.path.length > 0 && body.path.length <= 4096, 'Invalid path')
      requireValue(typeof body.sha256 === 'string' && /^[a-f0-9]{64}$/.test(body.sha256), 'Invalid image hash')
      requireValue(typeof body.image_base64 === 'string' && body.image_base64.length <= 1400000, 'Invalid image')
      let bytes: Uint8Array
      try { bytes = Uint8Array.from(atob(body.image_base64), c => c.charCodeAt(0)) } catch { throw new Invalid('Invalid base64') }
      const decoder = new TextDecoder()
      requireValue(bytes.length >= 20 && bytes.length <= 1000000 && decoder.decode(bytes.slice(0, 4)) === 'RIFF' && decoder.decode(bytes.slice(8, 12)) === 'WEBP', 'Expected WebP under 1 MB')
      requireValue(await digest(bytes) === body.sha256, 'Image hash mismatch')
      const { data: variant, error } = await db.from('game_platforms').select('id,cover_url')
        .eq('user_id', userId).eq('external_source', 'esde').eq('esde_system', body.system).eq('esde_path', body.path).maybeSingle()
      if (error) throw error
      if (!variant) return reply({ error: 'Import this game first' }, 409)
      if (variant.cover_url && !variant.cover_url.startsWith(managedPrefix)) return reply({ status: 'ok', manual_cover: true })
      const object = `${userId}/esde/${variant.id}/${body.sha256}.webp`
      const url = `${base}/storage/v1/object/public/${bucket}/${object}`
      const { error: uploadError } = await db.storage.from(bucket).upload(object, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: true })
      if (uploadError) throw uploadError
      const { data: linked, error: linkError } = await db.rpc('esde_link_cover', { p_user_id: userId, p_variant_id: variant.id, p_url: url, p_managed_prefix: managedPrefix })
      if (linkError) throw linkError
      return reply({ status: 'ok', ...linked, url })
    }
    if (body.action === 'delete_variants') {
      requireValue(Array.isArray(body.entries) && body.entries.length >= 1 && body.entries.length <= 150, 'Expected 1-150 explicit entries')
      for (const entry of body.entries) requireValue(entry && uuid.test(entry.id) && typeof entry.system === 'string' && typeof entry.path === 'string' && typeof entry.updated_at === 'string', 'Invalid deletion entry')
      const { data, error } = await db.rpc('esde_delete_variants', { p_user_id: userId, p_entries: body.entries })
      if (error?.message.includes('changed since inventory')) return reply({ error: 'Inventory changed; rescan required' }, 409)
      if (error) throw error
      await removeDeletedCovers(userId, body.entries.map((entry: { id: string }) => entry.id))
      return reply({ status: 'ok', ...data })
    }
    throw new Invalid('Unknown action')
  } catch (error) {
    if (error instanceof Invalid) return reply({ error: error.message }, 400)
    // Do not log payload, URLs, headers or database errors containing user data.
    console.error('esde-media-sync operation failed')
    return reply({ error: 'Operation failed; safe to retry' }, 500)
  }
})
