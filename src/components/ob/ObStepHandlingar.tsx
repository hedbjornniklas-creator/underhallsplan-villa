'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/supabase'

export type TenureType = 'freehold' | 'bostadsratt' | null
export type DwellingType = 'house' | 'apartment' | null

type Property = Tables<'properties'>
type Inspection = Tables<'inspections'>
type DocumentType = Tables<'document_types'>
type InspectionDocument = Tables<'inspection_documents'>
type InspectionDisclosure = Tables<'inspection_disclosures'>

type InspectionDocumentStatus = 'present' | 'missing' | 'na'
type InspectionSide = 'buyer' | 'seller' | 'apartment'

// Om din DB-typ för inspection_documents.status redan är en enum union kan du ta bort denna
// och använda InspectionDocument['status'] direkt.
const STATUS_LABELS: Record<InspectionDocumentStatus, string> = {
  present: 'Tillhandahållen',
  missing: 'Inte tillhandahållen',
  na: 'Bedöms ej relevant',
}

const STANDARD_DEFECT_TEXT = 'Inga kända fel enligt fastighetsägaren.'

const normalizeSwedishToken = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll('å', 'a')
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')

const parseInspectionSideToken = (value: string): InspectionSide | null => {
  const token = normalizeSwedishToken(value)
  if (token.includes('seller') || token.includes('salj')) return 'seller'
  if (token.includes('apartment') || token.includes('lagenhet') || token.includes('apt')) {
    return 'apartment'
  }
  if (token.includes('buyer') || token.includes('kop')) return 'buyer'
  return null
}

const normalizeInspectionSide = (value: unknown): InspectionSide => {
  if (typeof value !== 'string') return 'buyer'
  return parseInspectionSideToken(value) ?? 'buyer'
}

const parseAppliesToSides = (raw: unknown): InspectionSide[] | null => {
  if (raw == null) return null

  let tokens: string[] = []
  if (Array.isArray(raw)) {
    tokens = raw.filter((value): value is string => typeof value === 'string')
  } else if (typeof raw === 'string') {
    tokens = raw.split(/[,;|]/g)
  } else {
    return null
  }

  const normalizedTokens = tokens.map(normalizeSwedishToken).filter(Boolean)
  if (normalizedTokens.includes('all')) return null

  const parsed = Array.from(
    new Set(
      normalizedTokens
        .map(token => parseInspectionSideToken(token))
        .filter((token): token is InspectionSide => token !== null)
    )
  )

  return parsed.length > 0 ? parsed : null
}

const documentTypeAppliesToInspectionSide = (
  documentType: DocumentType,
  inspectionSide: InspectionSide
) => {
  const appliesTo = parseAppliesToSides((documentType as { applies_to?: unknown }).applies_to)
  return !appliesTo || appliesTo.includes(inspectionSide)
}

export default function ObStepHandlingar({
  property,
  inspection,
}: {
  property: Property
  inspection: Inspection
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // saving-states
  const [savingDocs, setSavingDocs] = useState(false)
  const [savingDisclosure, setSavingDisclosure] = useState(false)
  const [savingDefect, setSavingDefect] = useState(false)
  const [savedDisclosure, setSavedDisclosure] = useState(false)
  const [savedDefect, setSavedDefect] = useState(false)

  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [documentsRaw, setDocumentsRaw] = useState<InspectionDocument[]>([])

  // Upplysningar (fri text) via egen tabell (en rad)
  const [disclosure, setDisclosure] = useState<InspectionDisclosure | null>(null)
  const [disclosureText, setDisclosureText] = useState('')

  // Upplysningar om fel/brister via inspections.defect_disclosures
  const [defectText, setDefectText] = useState(() => {
    const v = (inspection as any)?.defect_disclosures as string | null | undefined
    return v && v.trim() !== '' ? v : STANDARD_DEFECT_TEXT
  })
  const inspectionSide = normalizeInspectionSide((inspection as { inspection_side?: unknown })?.inspection_side)

  // -------------------------------
  // Helpers
  // -------------------------------
  const fetchDocumentTypes = async (): Promise<DocumentType[]> => {
    const { data, error: dtErr } = await supabase
      .from('document_types')
      .select('id,label,description,scope,is_active,applies_to')
      .in('scope', ['building', 'property'])
      .eq('is_active', true)

    if (dtErr) throw dtErr
    return (data || []) as DocumentType[]
  }

  const fetchInspectionDocuments = async (): Promise<InspectionDocument[]> => {
    const { data, error: docsErr } = await supabase
      .from('inspection_documents')
      .select('*')
      .eq('inspection_id', inspection.id)

    if (docsErr) throw docsErr
    return (data || []) as InspectionDocument[]
  }

  const ensureTemplateDocuments = async (
    types: DocumentType[],
    existing: InspectionDocument[]
  ) => {
    // map: document_type_id -> newest row (hanterar dubletter utan att radera data)
    const newestByType = new Map<string, InspectionDocument>()

    for (const d of existing) {
      const typeId = (d as any).document_type_id as string | null
      if (!typeId) continue

      const prev = newestByType.get(typeId)
      if (!prev) {
        newestByType.set(typeId, d)
        continue
      }

      const prevTs = (prev as any).created_at ? new Date((prev as any).created_at).getTime() : 0
      const dTs = (d as any).created_at ? new Date((d as any).created_at).getTime() : 0
      if (dTs >= prevTs) newestByType.set(typeId, d)
    }

    const missingTypes = types.filter(dt => !newestByType.has(dt.id))
    if (missingTypes.length === 0) return

    const payload = missingTypes.map(dt => ({
      inspection_id: inspection.id,
      document_type_id: dt.id,
      title: (dt as any).label ?? 'Handling',
      status: 'missing' as InspectionDocumentStatus,
      document_date: null,
      document_value: null,
      note: null,
    }))

    const { error: insErr } = await supabase.from('inspection_documents').insert(payload)
    if (insErr) throw insErr
  }

  const loadOrCreateDisclosureRow = async (): Promise<InspectionDisclosure> => {
    const { data, error: discErr } = await supabase
      .from('inspection_disclosures')
      .select('*')
      .eq('inspection_id', inspection.id)

    if (discErr) throw discErr

    let row = (data && data[0]) as InspectionDisclosure | undefined

    if (!row) {
      const { data: inserted, error: insErr } = await supabase
        .from('inspection_disclosures')
        .insert({
          inspection_id: inspection.id,
          title: 'upplysningar',
          note: '',
        })
        .select('*')
        .single()

      if (insErr) throw insErr
      row = inserted as InspectionDisclosure
    }

    return row
  }

  const ensureDefectTextSaved = async () => {
    const { data: inspRow, error: inspErr } = await supabase
      .from('inspections')
      .select('defect_disclosures')
      .eq('id', inspection.id)
      .single()

    if (inspErr) throw inspErr

    const current = ((inspRow as any)?.defect_disclosures ?? '').trim()
    if (current !== '') {
      setDefectText((inspRow as any)?.defect_disclosures ?? STANDARD_DEFECT_TEXT)
      return
    }

    await supabase
      .from('inspections')
      .update({ defect_disclosures: STANDARD_DEFECT_TEXT })
      .eq('id', inspection.id)

    setDefectText(STANDARD_DEFECT_TEXT)
  }

  // -------------------------------
  // LOAD ALL + ENSURE TEMPLATE DOCS
  // -------------------------------
  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      try {
        setLoading(true)
        setError(null)

        const allTypes = await fetchDocumentTypes()
        const types = allTypes.filter(type =>
          documentTypeAppliesToInspectionSide(type, inspectionSide)
        )
        if (cancelled) return
        setDocumentTypes(types)

        const existingDocs = await fetchInspectionDocuments()
        if (cancelled) return

        // Seeda handlingar: skapa rader för saknade document_types
        await ensureTemplateDocuments(types, existingDocs)

        // Läs om efter ev insert
        const docsAfter = await fetchInspectionDocuments()
        if (cancelled) return
        setDocumentsRaw(docsAfter)

        // disclosures (fri text) – säkerställ att en rad finns
        const disclosureRow = await loadOrCreateDisclosureRow()
        if (cancelled) return
        setDisclosure(disclosureRow)
        setDisclosureText((disclosureRow as any).note ?? '')

        // defect_disclosures – säkerställ att standard sparas även utan input
        await ensureDefectTextSaved()
      } catch (e: any) {
        console.error(e)
        setError(e?.message || 'Ett fel inträffade.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (inspection?.id) void loadAll()

    return () => {
      cancelled = true
    }
  }, [inspection?.id, inspectionSide])

  // -------------------------------
  // DEDUPE + SORT (hide duplicates)
  // -------------------------------
  const documents = useMemo(() => {
    const allowedTypeIds = new Set(documentTypes.map(type => type.id))
    const newestByType = new Map<string, InspectionDocument>()
    const customs: InspectionDocument[] = []

    for (const d of documentsRaw) {
      const typeId = (d as any).document_type_id as string | null
      if (!typeId) {
        customs.push(d)
        continue
      }
      if (!allowedTypeIds.has(typeId)) continue

      const prev = newestByType.get(typeId)
      if (!prev) {
        newestByType.set(typeId, d)
        continue
      }

      const prevTs = (prev as any).created_at ? new Date((prev as any).created_at).getTime() : 0
      const dTs = (d as any).created_at ? new Date((d as any).created_at).getTime() : 0
      if (dTs >= prevTs) newestByType.set(typeId, d)
    }

    const merged = [...newestByType.values(), ...customs]
    merged.sort((a, b) => ((a as any).title ?? '').localeCompare((b as any).title ?? '', 'sv'))
    return merged
  }, [documentsRaw, documentTypes])

  // -------------------------------
  // HANDLINGAR update
  // -------------------------------
  const updateDoc = async (id: string, patch: Partial<InspectionDocument>) => {
    setDocumentsRaw(prev => prev.map(d => (d.id === id ? ({ ...d, ...patch } as any) : d)))
    setSavingDocs(true)

    const { error } = await supabase.from('inspection_documents').update(patch).eq('id', id)

    setSavingDocs(false)

    if (error) {
      console.error(error)
      setError('Kunde inte spara handling.')
    }
  }

  // -------------------------------
  // LÄGG TILL EGEN HANDLING
  // -------------------------------
  const handleAddCustomDocument = async () => {
    if (!inspection?.id) return

    const title = window.prompt('Ange titel för den egna handlingen:')
    if (!title) return

    setSavingDocs(true)
    setError(null)

    const insertPayload: Partial<InspectionDocument> & {
      inspection_id: string
      title: string
      status: InspectionDocumentStatus
      document_type_id: null
    } = {
      inspection_id: inspection.id,
      document_type_id: null,
      title,
      status: 'present',
      document_date: null,
      document_value: null,
      note: null,
    }

    const { data, error } = await supabase
      .from('inspection_documents')
      .insert(insertPayload as any)
      .select('*')
      .single()

    setSavingDocs(false)

    if (error) {
      console.error(error)
      setError('Kunde inte lägga till handlingen.')
      return
    }

    if (data) {
      setDocumentsRaw(prev => [...prev, data as InspectionDocument])
    }
  }

  // -------------------------------
  // SAVE disclosureText (debounce)
  // -------------------------------
  useEffect(() => {
    if (!disclosure) return

    setSavedDisclosure(false)
    const timeout = setTimeout(async () => {
      setSavingDisclosure(true)

      const { error } = await supabase
        .from('inspection_disclosures')
        .update({ note: disclosureText || '' } as any)
        .eq('id', disclosure.id)

      setSavingDisclosure(false)

      if (error) {
        console.error(error)
        setError('Kunde inte spara upplysningar.')
        return
      }

      setSavedDisclosure(true)
      setTimeout(() => setSavedDisclosure(false), 1500)
    }, 500)

    return () => clearTimeout(timeout)
  }, [disclosureText, disclosure])

  // -------------------------------
  // SAVE defectText (debounce) – tomt => standard
  // -------------------------------
  useEffect(() => {
    if (!inspection?.id) return

    setSavedDefect(false)
    const timeout = setTimeout(async () => {
      let valueToSave = defectText

      if (!valueToSave || valueToSave.trim() === '') {
        valueToSave = STANDARD_DEFECT_TEXT
        setDefectText(valueToSave)
      }

      setSavingDefect(true)

      const { error } = await supabase
        .from('inspections')
        .update({ defect_disclosures: valueToSave } as any)
        .eq('id', inspection.id)

      setSavingDefect(false)

      if (error) {
        console.error(error)
        setError('Kunde inte spara upplysningar om fel.')
        return
      }

      setSavedDefect(true)
      setTimeout(() => setSavedDefect(false), 1500)
    }, 500)

    return () => clearTimeout(timeout)
  }, [defectText, inspection?.id])

  // -------------------------------
  // RENDER
  // -------------------------------
  if (loading) return <div className="p-4">Laddar…</div>
  if (error) return <div className="p-4 text-red-600">{error}</div>

  return (
    <div className="space-y-8">
      {/* =======================
          HANDLINGAR
      ======================== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Handlingar</h2>
            <div className="text-sm text-gray-600">
              {(property as any)?.name || 'Fastighet'}
              {(property as any)?.address ? ` – ${(property as any).address}` : ''}
            </div>
          </div>
          {savingDocs && <span className="text-sm text-gray-600">Sparar handling…</span>}
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-300 bg-white">
          <table className="min-w-[720px] w-full text-sm text-gray-900">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Handling</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Datum</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Notering</th>
              </tr>
            </thead>

            <tbody>
              {documents.map(doc => {
                const typeId = (doc as any).document_type_id as string | null
                const dt = typeId ? documentTypes.find(d => d.id === typeId) : null

                const docStatus = ((doc as any).status ?? 'missing') as InspectionDocumentStatus

                return (
                  <tr key={doc.id} className="border-t border-gray-200">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-gray-900">{(doc as any).title}</div>
                      {(dt as any)?.description && (
                        <div className="mt-0.5 text-sm text-gray-600">{(dt as any).description}</div>
                      )}
                    </td>

                    <td className="px-3 py-2 align-top">
                      <div className="flex gap-1 flex-wrap">
                        {(Object.keys(STATUS_LABELS) as InspectionDocumentStatus[]).map(key => (
                          <button
                            key={key}
                            onClick={() => void updateDoc(doc.id, { status: key } as any)}
                            className={
                              'px-2 py-1 rounded-full text-sm border ' +
                              (docStatus === key
                                ? 'bg-blue-50 border-blue-500 text-blue-700'
                                : 'bg-white border-gray-400 text-gray-800 hover:bg-gray-50')
                            }
                          >
                            {STATUS_LABELS[key]}
                          </button>
                        ))}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      <input
                        type="date"
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                        value={((doc as any).document_date ?? '') as string}
                        onChange={e =>
                          void updateDoc(doc.id, { document_date: e.target.value || null } as any)
                        }
                      />
                    </td>

                    <td className="px-3 py-2 align-top">
                      <textarea
                        className="min-h-[2.5rem] w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                        value={(((doc as any).note ?? '') as string) ?? ''}
                        onChange={e => void updateDoc(doc.id, { note: e.target.value } as any)}
                      />
                    </td>
                  </tr>
                )
              })}

              {documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-gray-600">
                    Inga handlingar ännu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => void handleAddCustomDocument()}
            className="text-sm px-3 py-1.5 border rounded-md bg-white hover:bg-gray-50"
          >
            + Lägg till egen handling
          </button>
        </div>
      </section>

      {/* =======================
          UPPlysningar – fri text
      ======================== */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Upplysningar</h2>
          {savingDisclosure && <span className="text-sm text-gray-600">Sparar…</span>}
          {!savingDisclosure && savedDisclosure && (
            <span className="text-xs text-emerald-600">Sparad ✓</span>
          )}
        </div>

        <textarea
          className="min-h-[200px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          placeholder="Skriv alla upplysningar här …"
          value={disclosureText}
          onChange={e => setDisclosureText(e.target.value)}
        />
      </section>

      {/* =======================
          Upplysningar om fel i fastigheten
      ======================== */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Upplysningar om fel i fastigheten</h2>
          {savingDefect && <span className="text-sm text-gray-600">Sparar…</span>}
          {!savingDefect && savedDefect && (
            <span className="text-xs text-emerald-600">Sparad ✓</span>
          )}
        </div>

        <textarea
          className="min-h-[160px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          value={defectText}
          onChange={e => setDefectText(e.target.value)}
        />
      </section>
    </div>
  )
}
