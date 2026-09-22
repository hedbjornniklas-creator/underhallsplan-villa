// @ts-expect-error Node strip-types tests require the explicit extension.
import { getObTextDraftInspectionPrefix } from './localTextDrafts.ts'

export type ObDraftEntry = {
  key: string
  raw: string
  path: string[]
  buildingId?: string
  title: string
  values: Record<string, string> | null
  preview: string
}

const steps: Record<string, string> = {
  grunddata: 'Fastighet & uppdrag', handlingar: 'Handlingar & upplysningar',
  forutsattningar: 'Förutsättningar', runda: 'ÖB-runda', 'mobile-round': 'ÖB-runda',
  insida: 'Byggnad - insida', utsida: 'Byggnad - utsida',
  areamatning: 'Areamätning', fuktkontroll: 'Fuktkontroll',
}
export const obDraftFieldLabels: Record<string, string> = {
  note: 'Notering', risk_text: 'Risk', ftu_text: 'Fortsatt teknisk utredning',
  attendees_other: 'Övriga närvarande', defect_disclosures: 'Upplysningar om fel',
}

export function listObDraftEntries(inspectionId: string, storage: Storage): ObDraftEntry[] {
  const prefix = getObTextDraftInspectionPrefix(inspectionId)
  const entries: ObDraftEntry[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix)) continue
    const raw = storage.getItem(key)
    if (raw === null) continue
    let path = key.slice(prefix.length).split(':')
    let buildingId: string | undefined
    if (path[0] === 'building' && path[1]) { buildingId = path[1]; path = path.slice(2) }
    let values: Record<string, string> | null = null
    let preview = raw
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const row = parsed as Record<string, unknown>
        if (typeof row.value === 'string' && Object.keys(row).every(key => ['value', 'updatedAt'].includes(key))) {
          values = { [path.at(-1) || 'note']: row.value }
        } else if (path[0] === 'mobile-round' &&
          Object.keys(row).every(key => ['note', 'risk_text', 'ftu_text'].includes(key)) &&
          ['note', 'risk_text', 'ftu_text'].every(key => typeof row[key] === 'string')) {
          values = row as Record<string, string>
        }
        preview = JSON.stringify(row.value ?? row, null, 2)
      }
    } catch { /* Keep malformed drafts visible and unchanged. */ }
    const detail = path[1] === 'disclosure' ? 'Upplysningar' : path[1] === 'document' ? 'Handling' :
      obDraftFieldLabels[path.at(-1) || '']
    entries.push({ key, raw, path, buildingId, title: [steps[path[0]] || 'Lokalt utkast', detail].filter(Boolean).join(' · '), values, preview })
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

// Never infer that a missing record, failed read or unknown format is a saved draft.
export function clearVerifiedObDraft(entry: ObDraftEntry, saved: Record<string, string> | null, storage: Storage) {
  if (!entry.values || !saved || !Object.entries(entry.values).every(([field, value]) =>
    Object.hasOwn(saved, field) && saved[field] === value)) return false
  if (storage.getItem(entry.key) !== entry.raw) return false
  storage.removeItem(entry.key)
  return true
}
