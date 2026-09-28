import { buildEnvironmentalAppendix, isEnvironmentalKind, parseEnvironmentalProtocol, protocolPublicationErrors, protocolTitles,
  type EnvironmentalFile, type EnvironmentalAppendix } from '../ob/environmentalProtocol'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function readEnvironmentalAppendices(supabase: SupabaseClient, inspectionId: string): Promise<EnvironmentalAppendix[]> {
  const protocols = await supabase.from('inspection_environmental_protocols').select('kind,document').eq('inspection_id', inspectionId)
  // Before migration there can be no new protocols. Other failures must not silently omit an appendix.
  if (protocols.error && !['42P01', 'PGRST205'].includes(protocols.error.code)) throw Error('Tilläggsprotokollen kunde inte läsas. Försök igen innan utlåtandet publiceras.')
  if (!protocols.data?.length) return []
  const files = await supabase.from('inspection_environmental_files').select('id,kind,name,path,sha256,size').eq('inspection_id', inspectionId)
  if (files.error) throw Error('Tilläggens originalbilagor kunde inte läsas.')
  return environmentalAppendicesFromRows(protocols.data, files.data ?? [])
}

export function environmentalAppendicesFromRows(protocols: { kind: unknown; document: unknown }[], files: (EnvironmentalFile & { kind: string })[]): EnvironmentalAppendix[] {
  return protocols.slice().sort((a, b) => (a.kind === 'radon' ? 0 : 1) - (b.kind === 'radon' ? 0 : 1)).flatMap(row => {
    if (!isEnvironmentalKind(row.kind)) throw Error('Okänt tilläggsprotokoll. Inget utlåtande skapas.')
    const doc = parseEnvironmentalProtocol(row.document, row.kind)
    if (!doc.include) return []
    const errors = protocolPublicationErrors(doc, row.kind)
    if (errors.length) throw Error(`${protocolTitles[row.kind]}: ${errors.join(' ')}`)
    const attachments = files.filter(file => file.kind === row.kind && doc.attachments.includes(file.id))
    if (attachments.length !== doc.attachments.length) throw Error(`${protocolTitles[row.kind]}: en bilaga saknas. Inget ofullständigt utlåtande skapas.`)
    return [buildEnvironmentalAppendix(doc, row.kind, attachments)]
  })
}
