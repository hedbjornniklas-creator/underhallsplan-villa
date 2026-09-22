import { supabase } from '@/lib/supabaseClient'
import type { ObDraftEntry } from './draftReview'

// Read only. Every record lookup is bounded to the open inspection, not just a
// locally supplied row ID. Unknown/composite form formats are kept for review.
export async function readObDraftSavedText(inspectionId: string, entry: ObDraftEntry): Promise<Record<string, string> | null> {
  if (!entry.values) return null
  const p = entry.path
  let row: Record<string, unknown> | null = null
  if (p[0] === 'mobile-round' || ['runda', 'insida', 'utsida'].includes(p[0]) && p[1] === 'control-item') {
    const id = p[0] === 'mobile-round' ? p[1] : p[2]
    const result = await supabase.from('inspection_control_items').select('note,risk_text,ftu_text')
      .eq('inspection_id', inspectionId).eq('id', id).abortSignal(AbortSignal.timeout(15000)).maybeSingle()
    if (result.error) throw result.error
    row = result.data
  } else if (p[0] === 'handlingar' && ['document', 'disclosure'].includes(p[1])) {
    const table = p[1] === 'document' ? 'inspection_documents' : 'inspection_disclosures'
    const result = await supabase.from(table).select('note').eq('inspection_id', inspectionId).eq('id', p[2])
      .abortSignal(AbortSignal.timeout(15000)).maybeSingle()
    if (result.error) throw result.error
    row = result.data
  } else if (p.join(':') === 'grunddata:attendees_other' || p.join(':') === 'handlingar:defect_disclosures') {
    const result = await supabase.from('inspections').select('attendees_other,defect_disclosures').eq('id', inspectionId)
      .abortSignal(AbortSignal.timeout(15000)).maybeSingle()
    if (result.error) throw result.error
    row = result.data
  }
  if (!row) return null
  const saved: Record<string, string> = {}
  for (const field of Object.keys(entry.values)) {
    if (!Object.hasOwn(row, field) || row[field] !== null && typeof row[field] !== 'string') return null
    saved[field] = (row[field] as string | null) ?? ''
  }
  return saved
}
