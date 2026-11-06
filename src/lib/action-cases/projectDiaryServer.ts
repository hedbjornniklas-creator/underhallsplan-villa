import 'server-only'
import { createHash } from 'node:crypto'
import QRCode from 'qrcode'
import { validateDiaryImage } from './projectDiaryImage'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { diaryDate, diaryPersonEntryRequest, diaryRevisionRequest, diaryPersonInput, diaryPhotoRequest, diaryText, diaryUuid, DIARY_EDIT_HOURS, DIARY_MAX_PHOTO_BYTES, DIARY_PHOTO_PART_BYTES, DIARY_MAX_PHOTO_PARTS, type DiaryEntry, type DiaryPerson, type DiaryPublicState, type DiaryWorkspace, type DiaryRevision } from './projectDiary'
import { diaryDeviceHash, diaryLinkToken, diarySecret, parseDiaryLink } from './projectDiaryLinks'

export const DIARY_BUCKET = 'project-diary-files'
export type DiaryContext = { orgId: string; userId: string }
export type DiaryIdentity = { ctx: DiaryContext; caseId: string } | { token: string; device: string | undefined }
type Actor = { orgId: string; caseId: string; userId: string | null; linkId: string | null; nonce: string | null; sessionHash: string | null; owner: string }
type Upload = { id: string; org_id: string; action_case_id: string; owner_key: string; name: string; content_type: string; size_bytes: number; state: string; sha256: string | null; expires_at: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code || '')) throw new Error('PROJECT_DIARY_SCHEMA')
  throw new Error(error.message?.match(/PROJECT_DIARY_[A-Z_]+/)?.[0] || 'PROJECT_DIARY_FAILED')
}
async function internal(ctx: DiaryContext, caseId: string) {
  if (!diaryUuid(caseId)) throw new Error('PROJECT_DIARY_NOT_FOUND')
  const db = createSupabaseAdminClient()
  const p = await db.from('action_cases').select('id,title,org_id,manager_profile_id').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle(); checked(p.error)
  const m = await db.from('org_members').select('profile_id').eq('org_id', ctx.orgId).eq('profile_id', ctx.userId).eq('is_active', true).maybeSingle(); checked(m.error)
  if (!p.data || !m.data) throw new Error('PROJECT_DIARY_NOT_FOUND')
  return p.data
}
async function link(token: string) {
  const { id, nonce } = parseDiaryLink(token)
  const r = await createSupabaseAdminClient().from('action_case_diary_links').select('id,nonce,org_id,action_case_id').eq('id', id).eq('nonce', nonce).eq('active', true).maybeSingle(); checked(r.error)
  if (!r.data) throw new Error('PROJECT_DIARY_NOT_FOUND')
  return r.data
}
export async function getDiaryPublic(token: string): Promise<DiaryPublicState> {
  const { id, nonce } = parseDiaryLink(token)
  const r = await createSupabaseAdminClient().rpc('project_diary_people_context', { p_link_id: id, p_nonce: nonce }); checked(r.error)
  return r.data as DiaryPublicState
}
async function actor(identity: DiaryIdentity): Promise<Actor> {
  if ('ctx' in identity) {
    await internal(identity.ctx, identity.caseId)
    return { ...identity.ctx, caseId: identity.caseId, linkId: null, nonce: null, sessionHash: null, owner: `profile:${identity.ctx.userId}` }
  }
  const l = await link(identity.token), deviceHash = diaryDeviceHash(identity.token, identity.device)
  return { orgId: l.org_id, caseId: l.action_case_id, userId: null, linkId: l.id, nonce: l.nonce, sessionHash: deviceHash, owner: `qr:${deviceHash}` }
}
async function command(a: Omit<Actor, 'owner'>, operation: string, data: Record<string, unknown>) {
  const r = await createSupabaseAdminClient().rpc('project_diary_people_command', { p_org_id: a.orgId, p_case_id: a.caseId, p_actor_id: a.userId,
    p_link_id: a.linkId, p_nonce: a.nonce, p_device_hash: a.sessionHash, p_operation: operation, p_data: data }); checked(r.error)
  return r.data
}
function baseUrl() {
  const configured = process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!configured) throw new Error('PROJECT_DIARY_CONFIG')
  const url = new URL(configured)
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('PROJECT_DIARY_CONFIG')
  return url.origin
}
export async function addDiaryPerson(identity: DiaryIdentity, data: Record<string, unknown>): Promise<DiaryPerson> {
  return command(await actor(identity), 'person', diaryPersonInput(data))
}
export async function setDiaryLink(ctx: DiaryContext, caseId: string, data: Record<string, unknown>) {
  if (typeof data.active !== 'boolean' || !Number.isSafeInteger(data.expectedRevision) || Number(data.expectedRevision) < 0) throw new Error('PROJECT_DIARY_INVALID')
  const a = await actor({ ctx, caseId })
  if (data.active) { baseUrl(); diarySecret() }
  return command(a, data.active ? 'link_enable' : 'link_disable', { expectedRevision: data.expectedRevision })
}
export async function submitDiaryEntry(identity: DiaryIdentity, data: Record<string, unknown>) {
  const a = await actor(identity), request = diaryPersonEntryRequest(data)
  const person = await createSupabaseAdminClient().from('action_case_diary_people').select('id,name,company').eq('id', request.personId).eq('org_id', a.orgId).eq('action_case_id', a.caseId).maybeSingle(); checked(person.error)
  if (!person.data) throw new Error('PROJECT_DIARY_PERSON')
  const canonical = { ...request, body: { ...request.body, name: person.data.name, company: person.data.company } }
  return command(a, 'entry', { ...canonical, requestHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') })
}
export async function correctDiaryEntry(ctx: DiaryContext, caseId: string, data: Record<string, unknown>) {
  if (!diaryUuid(data.entryId) || !diaryUuid(data.requestId)) throw new Error('PROJECT_DIARY_INVALID')
  return command(await actor({ ctx, caseId }), 'correction', { entryId: data.entryId, requestId: data.requestId, text: diaryText(data.text, 3000) })
}
export async function reviseDiaryEntry(ctx: DiaryContext, caseId: string, data: Record<string, unknown>) {
  const project = await internal(ctx, caseId)
  if (project.manager_profile_id !== ctx.userId) throw new Error('PROJECT_DIARY_MANAGER')
  const request = diaryRevisionRequest(data)
  const result = await createSupabaseAdminClient().rpc('revise_project_diary_entry', {
    p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_data: request,
  }); checked(result.error)
  return result.data
}
export async function getDiaryHistory(ctx: DiaryContext, caseId: string, entryId: string, before: string | null = null) {
  await internal(ctx, caseId)
  if (!diaryUuid(entryId) || before !== null && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before) > 2147483647)) throw new Error('PROJECT_DIARY_INVALID')
  const db = createSupabaseAdminClient()
  const original = await db.from('action_case_diary_entries').select('*').eq('id', entryId).eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle(); checked(original.error)
  if (!original.data) throw new Error('PROJECT_DIARY_NOT_FOUND')
  let query = db.from('action_case_diary_revisions').select('revision,body,photo_ids,item_title,minutes,actor_name,created_at').eq('entry_id', entryId)
  if (before !== null) query = query.lt('revision', Number(before))
  const result = await query.order('revision', { ascending: false }).limit(21); checked(result.error)
  let rows = (result.data || []).slice(0, 20)
  if (!rows.length && before === null) {
    const photos = await db.from('action_case_diary_photos').select('id').eq('entry_id', entryId).order('position'); checked(photos.error)
    rows = [{ revision: 0, body: original.data.body, photo_ids: (photos.data || []).map(photo => photo.id), item_title: original.data.item_title,
      minutes: original.data.minutes, actor_name: original.data.actor_name, created_at: original.data.received_at }]
  }
  const ids = [...new Set(rows.flatMap(row => row.photo_ids as string[]))]
  const photos = ids.length ? await db.from('action_case_diary_photos').select('*').eq('entry_id', entryId).in('id', ids) : { data: [], error: null }; checked(photos.error)
  const versions: DiaryRevision[] = rows.map(row => ({ revision: row.revision, body: row.body, itemTitle: row.item_title, minutes: row.minutes,
    actorName: row.actor_name, createdAt: row.created_at, photos: row.photo_ids.map((id: string) => {
      const photo = photos.data?.find(p => p.id === id)
      if (!photo) throw new Error('PROJECT_DIARY_PHOTO')
      return { id: photo.id, name: photo.name, size: photo.size_bytes, contentType: photo.content_type, sha256: photo.sha256 }
    }) }))
  return { versions, nextBeforeRevision: (result.data?.length || 0) > 20 ? rows.at(-1)!.revision : null }
}
const photoPath = (a: Pick<Actor, 'orgId' | 'caseId'>, id: string, incoming = false) => `${a.orgId}/${a.caseId}/${incoming ? 'incoming' : 'images'}/${id}`
const partPath = (a: Actor, id: string, index: number) => `${photoPath(a, id, true)}.part-${index}`
const stagingPaths = (a: Actor, id: string) => [photoPath(a, id, true), ...Array.from({ length: DIARY_MAX_PHOTO_PARTS }, (_, index) => partPath(a, id, index))]
async function removePhotoStaging(a: Actor, id: string) {
  await createSupabaseAdminClient().storage.from(DIARY_BUCKET).remove(stagingPaths(a, id)).catch(() => undefined)
}
async function ownedUpload(a: Actor, fileId: unknown) {
  if (!diaryUuid(fileId)) throw new Error('PROJECT_DIARY_PHOTO')
  const found = await createSupabaseAdminClient().from('action_case_diary_uploads').select('*').eq('id', fileId).eq('org_id', a.orgId).eq('action_case_id', a.caseId).eq('owner_key', a.owner).maybeSingle(); checked(found.error)
  const u = found.data as Upload | null
  if (!u || !['ready', 'pending'].includes(u.state) || Date.parse(u.expires_at) <= Date.now()) throw new Error('PROJECT_DIARY_PHOTO')
  return u
}
export async function prepareDiaryPhoto(identity: DiaryIdentity, data: Record<string, unknown>) {
  const a = await actor(identity), meta = diaryPhotoRequest(data), stored = await command(a, 'reserve_photo', meta) as Upload
  if (stored.state === 'ready') { await removePhotoStaging(a, meta.id); return { id: meta.id, ready: true } }
  if (stored.state !== 'pending') throw new Error('PROJECT_DIARY_PHOTO')
  const signed = await createSupabaseAdminClient().storage.from(DIARY_BUCKET).createSignedUploadUrl(photoPath(a, meta.id, true), { upsert: false })
  if (signed.error || !signed.data?.signedUrl) throw new Error('PROJECT_DIARY_UPLOAD')
  return { id: meta.id, uploadUrl: signed.data.signedUrl, ready: false }
}
export async function completeDiaryPhoto(identity: DiaryIdentity, fileId: unknown) {
  const a = await actor(identity), db = createSupabaseAdminClient(), u = await ownedUpload(a, fileId)
  if (u.state === 'ready') { await removePhotoStaging(a, u.id); return { id: u.id, name: u.name } }
  const raw = await db.storage.from(DIARY_BUCKET).download(photoPath(a, u.id, true))
  if (raw.error || !raw.data || raw.data.size !== u.size_bytes || raw.data.size > DIARY_MAX_PHOTO_BYTES) throw new Error('PROJECT_DIARY_PHOTO')
  const bytes = Buffer.from(await raw.data.arrayBuffer())
  return sealPhotoBytes(a, u, bytes)
}
async function sealPhotoBytes(a: Actor, u: Upload, bytes: Buffer) {
  const db = createSupabaseAdminClient()
  await validateDiaryImage(bytes, u.content_type, u.size_bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex'), finalPath = photoPath(a, u.id)
  const uploaded = await db.storage.from(DIARY_BUCKET).upload(finalPath, bytes, { contentType: u.content_type, upsert: false })
  if (uploaded.error) {
    // A previous attempt may have archived bytes before losing its RPC response.
    const old = await db.storage.from(DIARY_BUCKET).download(finalPath)
    if (old.error || !old.data || createHash('sha256').update(Buffer.from(await old.data.arrayBuffer())).digest('hex') !== sha256) throw new Error('PROJECT_DIARY_UPLOAD')
  }
  const result = await command(a, 'seal_photo', { id: u.id, sha256 })
  // Never remove archived bytes on an ambiguous commit result.
  await removePhotoStaging(a, u.id)
  return result
}
export async function storeDiaryPhotoPart(identity: DiaryIdentity, fileId: unknown, index: number, bytes: Buffer) {
  if (!Number.isInteger(index) || index < 0 || index >= DIARY_MAX_PHOTO_PARTS) throw new Error('PROJECT_DIARY_PHOTO')
  const a = await actor(identity), u = await ownedUpload(a, fileId)
  const expected = Math.min(DIARY_PHOTO_PART_BYTES, u.size_bytes - index * DIARY_PHOTO_PART_BYTES)
  if (expected <= 0 || bytes.length !== expected) throw new Error('PROJECT_DIARY_PHOTO')
  if (u.state === 'ready') return { id: u.id, part: index }
  const bucket = createSupabaseAdminClient().storage.from(DIARY_BUCKET), path = partPath(a, u.id, index)
  // Parts are private staging bytes with the reserved image's metadata. Only the
  // reconstructed, decoded original can be sealed and attached to an entry.
  const stored = await bucket.upload(path, bytes, { contentType: u.content_type, upsert: false })
  if (stored.error) {
    const prior = await bucket.download(path)
    if (prior.error || !prior.data || prior.data.size !== expected || !Buffer.from(await prior.data.arrayBuffer()).equals(bytes)) throw new Error('PROJECT_DIARY_UPLOAD')
  }
  return { id: u.id, part: index }
}
export async function completeRelayedDiaryPhoto(identity: DiaryIdentity, fileId: unknown) {
  const a = await actor(identity), u = await ownedUpload(a, fileId)
  if (u.state === 'ready') { await removePhotoStaging(a, u.id); return { id: u.id, name: u.name } }
  const bucket = createSupabaseAdminClient().storage.from(DIARY_BUCKET), chunks: Buffer[] = []
  const count = Math.ceil(u.size_bytes / DIARY_PHOTO_PART_BYTES)
  for (let index = 0; index < count; index++) {
    const part = await bucket.download(partPath(a, u.id, index))
    const expected = Math.min(DIARY_PHOTO_PART_BYTES, u.size_bytes - index * DIARY_PHOTO_PART_BYTES)
    if (part.error || !part.data || part.data.size !== expected) throw new Error('PROJECT_DIARY_UPLOAD')
    const bytes = Buffer.from(await part.data.arrayBuffer())
    if (bytes.length !== expected) throw new Error('PROJECT_DIARY_PHOTO')
    chunks.push(bytes)
  }
  return sealPhotoBytes(a, u, Buffer.concat(chunks, u.size_bytes))
}
export async function diaryPhotoUrl(ctx: DiaryContext, caseId: string, photoId: string) {
  await internal(ctx, caseId)
  if (!diaryUuid(photoId)) throw new Error('PROJECT_DIARY_NOT_FOUND')
  const db = createSupabaseAdminClient(), ref = await db.from('action_case_diary_photos').select('entry_id').eq('id', photoId).maybeSingle(); checked(ref.error)
  if (!ref.data) throw new Error('PROJECT_DIARY_NOT_FOUND')
  const entry = await db.from('action_case_diary_entries').select('id').eq('id', ref.data.entry_id).eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle(); checked(entry.error)
  if (!entry.data) throw new Error('PROJECT_DIARY_NOT_FOUND')
  const r = await db.storage.from(DIARY_BUCKET).createSignedUrl(photoPath({ orgId: ctx.orgId, caseId }, photoId), 60)
  if (r.error || !r.data?.signedUrl) throw new Error('PROJECT_DIARY_UPLOAD')
  return r.data.signedUrl
}
export async function cleanupDiaryUploads(ctx: DiaryContext, caseId: string) {
  const a = await actor({ ctx, caseId }), data = await command(a, 'cleanup', {}) as { ids: string[] }
  if (data.ids.length) {
    const result = await createSupabaseAdminClient().storage.from(DIARY_BUCKET).remove(data.ids.flatMap(id => [...stagingPaths(a, id), photoPath(a, id)]))
    if (result.error) console.error('PROJECT_DIARY_ORPHAN_CLEANUP_FAILED')
    else await command(a, 'cleanup_done', { ids: data.ids })
  }
}
export async function getProjectDiary(ctx: DiaryContext, caseId: string, filters = new URLSearchParams()): Promise<DiaryWorkspace & { nextCursor: string | null }> {
  const project = await internal(ctx, caseId), db = createSupabaseAdminClient()
  const canManage = project.manager_profile_id === ctx.userId
  const linkResult = await db.from('action_case_diary_links').select('id,nonce,active,revision').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle(); checked(linkResult.error)
  const l = linkResult.data
  let query = db.from('action_case_diary_current').select('*').eq('org_id', ctx.orgId).eq('action_case_id', caseId)
  if (filters.get('from')) query = query.gte('current_work_date', diaryDate(filters.get('from')))
  if (filters.get('to')) query = query.lte('current_work_date', diaryDate(filters.get('to')))
  if (filters.get('person')) query = query.ilike('current_body->>name', `%${diaryText(filters.get('person'), 160).replace(/[\\%_]/g, c => `\\${c}`)}%`)
  if (filters.get('item')) { if (!diaryUuid(filters.get('item'))) throw new Error('PROJECT_DIARY_INVALID'); query = query.eq('current_source_item_id', filters.get('item')) }
  if (filters.get('cursor')) {
    try {
      const c = JSON.parse(Buffer.from(filters.get('cursor')!, 'base64url').toString('utf8'))
      diaryDate(c.date)
      if (!diaryUuid(c.id) || typeof c.stamp !== 'string' || !/^[0-9T:.+Z-]{15,40}$/.test(c.stamp) || !Number.isFinite(Date.parse(c.stamp))) throw new Error()
      query = query.or(`current_work_date.lt.${c.date},and(current_work_date.eq.${c.date},received_at.lt.${c.stamp}),and(current_work_date.eq.${c.date},received_at.eq.${c.stamp},id.lt.${c.id})`)
    } catch { throw new Error('PROJECT_DIARY_INVALID') }
  }
  const result = await query.order('current_work_date', { ascending: false }).order('received_at', { ascending: false }).order('id', { ascending: false }).limit(51); checked(result.error)
  const rows = (result.data || []).slice(0, 50), ids = rows.map(r => r.id)
  const photoIds = [...new Set(rows.flatMap(row => row.current_photo_ids as string[]))]
  const photos = photoIds.length ? await db.from('action_case_diary_photos').select('*').in('entry_id', ids).in('id', photoIds).order('position') : { data: [], error: null }; checked(photos.error)
  const corrections = ids.length ? await db.from('action_case_diary_corrections').select('*').in('entry_id', ids).order('created_at').order('id') : { data: [], error: null }; checked(corrections.error)
  const items = await db.from('action_case_items').select('id,title').eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('sort_order'); checked(items.error)
  const profile = await db.from('profiles').select('full_name,email').eq('id', ctx.userId).maybeSingle(); checked(profile.error)
  const people = await db.from('action_case_diary_people').select('id,name,company').eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('name_key').order('company_key').order('id'); checked(people.error)
  const url = canManage && l?.active ? `${baseUrl()}/dagbok/${diaryLinkToken(l.id, l.nonce)}` : null
  const entries: DiaryEntry[] = rows.map(r => ({ id: r.id, personId: r.person_id || null, body: r.current_body, itemTitle: r.current_item_title, authorEmail: r.author_email, actorMethod: r.actor_method, emailVerifiedAt: r.email_verified_at, receivedAt: r.received_at, minutes: r.current_minutes,
    revision: r.revision, editUntil: new Date(Date.parse(r.received_at) + DIARY_EDIT_HOURS * 3600000).toISOString(),
    canEdit: canManage && Date.now() < Date.parse(r.received_at) + DIARY_EDIT_HOURS * 3600000, editedAt: r.edited_at, editedBy: r.edited_by,
    photos: r.current_photo_ids.map((id: string) => {
      const f = photos.data?.find(photo => photo.id === id && photo.entry_id === r.id)
      if (!f) throw new Error('PROJECT_DIARY_PHOTO')
      return { id: f.id, name: f.name, size: f.size_bytes, contentType: f.content_type, sha256: f.sha256 }
    }),
    corrections: (corrections.data || []).filter(c => c.entry_id === r.id).map(c => ({ id: c.id, text: c.text, actorName: c.actor_name, createdAt: c.created_at })) }))
  const last = rows.at(-1), hasMore = (result.data?.length || 0) > 50
  return { project: { id: project.id, title: project.title }, people: people.data || [], canManage, managerAssigned: Boolean(project.manager_profile_id), items: items.data || [], authorId: ctx.userId, authorName: profile.data?.full_name || '', authorEmail: profile.data?.email || '',
    link: { active: l?.active || false, revision: l?.revision || 0, url, qrDataUrl: url ? await QRCode.toDataURL(url, { width: 360, margin: 4, errorCorrectionLevel: 'M' }) : null }, entries, hasMore,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ date: last.current_work_date, stamp: last.received_at, id: last.id })).toString('base64url') : null }
}
