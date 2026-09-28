export type EnvironmentalKind = 'radon' | 'mould'
export type ProtocolField = { key: string; label: string; type?: 'text' | 'number' | 'datetime-local' | 'date' | 'textarea'; options?: string[] }
export const protocolTitles: Record<EnvironmentalKind, string> = { radon: 'Radonindikering', mould: 'Mögelprov' }
export const objectFields: ProtocolField[] = [
  { key: 'building_type', label: 'Byggnadstyp' }, { key: 'building_year', label: 'Byggår' },
  { key: 'extension', label: 'Tillbyggd' }, { key: 'heating', label: 'Uppvärmning' },
  { key: 'ventilation', label: 'Ventilation' }, { key: 'object_other', label: 'Övriga objektuppgifter', type: 'textarea' },
]
export const protocolFields: Record<EnvironmentalKind, ProtocolField[]> = {
  radon: [...objectFields, { key: 'instrument', label: 'Instrument, märke och modell' },
    { key: 'instrument_id', label: 'Instrument-ID' }, { key: 'started_at', label: 'Mätning påbörjad', type: 'datetime-local' },
    { key: 'ended_at', label: 'Avläsning', type: 'datetime-local' },
    { key: 'conditions', label: 'Mätförhållanden', type: 'textarea' }],
  mould: [{ key: 'purpose', label: 'Syfte och omfattning', type: 'textarea' },
    { key: 'laboratory', label: 'Laboratorium' }, { key: 'report_reference', label: 'Analysrapportens nummer' },
    { key: 'report_date', label: 'Analysrapportens datum', type: 'date' },
    { key: 'conditions', label: 'Provtagningsförhållanden', type: 'textarea' }],
}
export const resultFields: Record<EnvironmentalKind, ProtocolField[]> = {
  radon: [{ key: 'building', label: 'Byggnad' }, { key: 'location', label: 'Våningsplan / rum' },
    { key: 'value', label: 'Radonhalt (Bq/m³)', type: 'number' },
    { key: 'uncertainty', label: 'Mätosäkerhet (%)', type: 'number' }, { key: 'note', label: 'Kommentar', type: 'textarea' }],
  mould: [{ key: 'building', label: 'Byggnad' }, { key: 'location', label: 'Våningsplan / rum' },
    { key: 'sample_id', label: 'Prov-ID' }, { key: 'sampled_at', label: 'Provtagning', type: 'datetime-local' },
    { key: 'material', label: 'Material / provpunkt' },
    { key: 'method', label: 'Provmetod', options: ['', 'Materialprov', 'Tejpprov', 'Luftprov', 'Svabbprov', 'Annan metod'] },
    { key: 'status', label: 'Analysstatus', options: ['Ej inskickat', 'Inväntar laboratoriesvar', 'Analyserat'] },
    { key: 'result', label: 'Laboratoriets resultat', type: 'textarea' }, { key: 'note', label: 'Kommentar', type: 'textarea' }],
}
export const conclusionFields: ProtocolField[] = [
  { key: 'comment', label: 'Bedömning / kommentar', type: 'textarea' },
  { key: 'other', label: 'Övrigt', type: 'textarea' }, { key: 'place', label: 'Ort' },
  { key: 'date', label: 'Datum', type: 'date' },
]
// Versioned source text is copied into each published snapshot, never looked up by the public viewer.
export const RADON_NOTICE_V1 = 'Mätningsresultat är en korttidsmätning och bör anses som en indikativ referens, kan variera med årstider och vädringsvanor.\nEn indikationsmätning ersätter inte en traditionell radonmätning.\nEn långtidsmätning under vinterhalvåret är alltid att rekommendera för att kunna fastställa ett säkrare värde.'
export const RADON_TERMS_V1 = 'Villkoren för överlåtelsebesiktningen med vederbörliga villkor, tillämpas även för tilläggsuppdraget och detta utlåtande, inklusive det som anges under rubrikerna ”besiktningsmannens ansvar” och ”äganderätt och nyttjanderätt till besiktningsutlåtandet”'
export const MOULD_NOTICE_V1 = 'Resultaten avser angivna prov och provtagningsplatser. Laboratoriets analysresultat och besiktningsmannens bedömning redovisas separat. Saknat eller inväntat laboratoriesvar är inte ett negativt provresultat.'
export type EnvironmentalProtocol = { schema: 1; include: boolean; fields: Record<string, string>; rows: { id: string; fields: Record<string, string> }[]; attachments: string[] }
export type EnvironmentalFile = { id: string; name: string; path: string; sha256: string; size: number }
export type EnvironmentalAppendix = { kind: EnvironmentalKind; title: string; source: string; notice: string; details: string; rows: { location: string; result: string }[]; conclusion: string; files: EnvironmentalFile[]; fileSummary: string }
export const isEnvironmentalKind = (value: unknown): value is EnvironmentalKind => value === 'radon' || value === 'mould'
export const emptyProtocol = (): EnvironmentalProtocol => ({ schema: 1, include: false, fields: {}, rows: [], attachments: [] })
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

// A locally recovered draft may contain a half-entered value; validate its shape without losing that text.
export function isEnvironmentalDraft(value: unknown): value is EnvironmentalProtocol {
  if (!value || typeof value !== 'object') return false
  const doc = value as EnvironmentalProtocol
  const fields = (f: unknown) => !!f && typeof f === 'object' && !Array.isArray(f) && Object.values(f).every(v => typeof v === 'string' && v.length <= 10000)
  return doc.schema === 1 && typeof doc.include === 'boolean' && fields(doc.fields) && Array.isArray(doc.rows) && doc.rows.length <= 100 &&
    doc.rows.every(row => !!row && isUuid(row.id) && fields(row.fields)) && new Set(doc.rows.map(row => row.id)).size === doc.rows.length &&
    Array.isArray(doc.attachments) && doc.attachments.length <= 20 && doc.attachments.every(isUuid) && new Set(doc.attachments).size === doc.attachments.length
}

export function parseEnvironmentalProtocol(value: unknown, kind: EnvironmentalKind): EnvironmentalProtocol {
  const fail = (message = 'Ogiltigt protokoll.'): never => { throw new Error(message) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const doc = value as EnvironmentalProtocol
  if (doc.schema !== 1 || typeof doc.include !== 'boolean' || !Array.isArray(doc.rows) || doc.rows.length > 100 || !Array.isArray(doc.attachments) || doc.attachments.length > 20) return fail()
  const fields = (input: unknown, definitions: ProtocolField[]): Record<string, string> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail()
    return Object.fromEntries(definitions.map(field => {
      const text = (input as Record<string, unknown>)[field.key] ?? ''
      if (typeof text !== 'string' || text.length > (field.type === 'textarea' ? 10000 : 300)) return fail(`${field.label}: texten är för lång eller ogiltig.`)
      if (field.options && text && !field.options.includes(text)) return fail(`${field.label}: ogiltigt val.`)
      if (text && field.type === 'number' && (!/^\d+(?:[.,]\d+)?$/.test(text) || !Number.isFinite(Number(text.replace(',', '.'))))) return fail(`${field.label}: ange ett tal som är noll eller större.`)
      if (text && (field.type === 'date' || field.type === 'datetime-local')) {
        const pattern = field.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
        const date = new Date(`${text.slice(0, 10)}T00:00:00Z`)
        if (!pattern.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text.slice(0, 10) ||
          (field.type === 'datetime-local' && (Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59))) return fail(`${field.label}: ogiltigt datum.`)
      }
      return [field.key, text]
    }))
  }
  const parsed: EnvironmentalProtocol = { schema: 1, include: doc.include,
    fields: fields(doc.fields, [...protocolFields[kind], ...conclusionFields]),
    rows: doc.rows.map(row => {
      if (!row || !isUuid(row.id)) return fail('Ogiltig provplats.')
      return { id: row.id, fields: fields(row.fields, resultFields[kind]) }
    }), attachments: doc.attachments.map(id => isUuid(id) ? id : fail('Ogiltig bilaga.')) }
  if (new Set(parsed.rows.map(row => row.id)).size !== parsed.rows.length || new Set(parsed.attachments).size !== parsed.attachments.length) return fail('Dubbla rader eller bilagor.')
  if (kind === 'radon' && parsed.fields.started_at && parsed.fields.ended_at && parsed.fields.ended_at < parsed.fields.started_at) return fail('Avläsningen får inte vara före mätningens start.')
  return parsed
}

export function protocolPublicationErrors(doc: EnvironmentalProtocol, kind: EnvironmentalKind): string[] {
  const errors: string[] = []
  if (!doc.rows.length) errors.push('Lägg till minst en mät- eller provplats.')
  if (kind === 'radon' && (!doc.fields.instrument || !doc.fields.started_at || !doc.fields.ended_at)) errors.push('Ange instrument samt start och avläsning för radonindikeringen.')
  if (kind === 'mould' && doc.rows.some(row => row.fields.status === 'Analyserat') && (!doc.fields.laboratory?.trim() || !doc.fields.report_reference?.trim())) errors.push('Ange laboratorium och analysrapportens nummer för analyserade prov.')
  doc.rows.forEach((row, index) => {
    const f = row.fields
    if (!f.building?.trim() || !f.location?.trim()) errors.push(`Plats ${index + 1}: ange byggnad och våningsplan / rum.`)
    if (kind === 'radon' && !f.value) errors.push(`Plats ${index + 1}: radonhalt saknas.`)
    if (kind === 'mould' && (!f.sample_id || !f.sampled_at || !f.method || !f.status)) errors.push(`Prov ${index + 1}: ange prov-ID, provtagning, metod och analysstatus.`)
    if (kind === 'mould' && f.status === 'Analyserat' && !f.result?.trim()) errors.push(`Prov ${index + 1}: analysresultat saknas.`)
  })
  return errors
}

export function buildEnvironmentalAppendix(doc: EnvironmentalProtocol, kind: EnvironmentalKind, files: EnvironmentalFile[]): EnvironmentalAppendix {
  const lines = (definitions: ProtocolField[], fields: Record<string, string>) => definitions.filter(f => fields[f.key]?.trim()).map(f => `${f.label}: ${f.type === 'datetime-local' ? fields[f.key].replace('T', ' ') : fields[f.key]}`).join('\n')
  const rows = doc.rows.map(row => ({ location: [row.fields.building, row.fields.location].filter(Boolean).join(' · '), result: lines(resultFields[kind].filter(f => !['building', 'location'].includes(f.key)), row.fields) }))
  const attachments = files.filter(file => doc.attachments.includes(file.id)).map(file => ({ ...file }))
  return { kind, title: protocolTitles[kind], source: kind === 'radon' ? 'Underlag: SBR Bilaga Radonindikering 2026.1' : 'Provtagningsprotokoll för mögelprov',
    notice: kind === 'radon' ? `${RADON_NOTICE_V1}\n\n${RADON_TERMS_V1}` : MOULD_NOTICE_V1,
    details: lines(protocolFields[kind], doc.fields),
    rows,
    conclusion: lines(conclusionFields, doc.fields), files: attachments,
    fileSummary: attachments.length ? `Separata originalbilagor (tillgängliga i det digitala utlåtandet):\n${attachments.map(file => file.name).join('\n')}` : '' }
}

export function hasEnvironmentalSelection(keys: string[], scope: string[], kind: EnvironmentalKind) {
  const aliases = kind === 'radon' ? ['radon', 'radonindikering'] : ['mould', 'mold', 'mogelprov', 'mogel']
  return [...keys, ...scope].some(key => aliases.includes(key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()))
}
