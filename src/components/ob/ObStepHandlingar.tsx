'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/supabase'
import DebouncedTextarea from './DebouncedTextarea'

export type TenureType = 'freehold' | 'bostadsratt' | null
export type DwellingType = 'house' | 'apartment' | null

type Property = Tables<'properties'>
type Inspection = Tables<'inspections'>
type DocumentType = Tables<'document_types'>
type InspectionDocument = Tables<'inspection_documents'>
type InspectionDisclosure = Tables<'inspection_disclosures'>

type InspectionDocumentStatus = 'present' | 'missing' | 'na'
type InspectionSide = 'buyer' | 'seller' | 'apartment'

type DocumentViewModel = {
  id: string
  title: string
  description: string | null
  status: InspectionDocumentStatus
  documentDate: string
  note: string
}

// Om din DB-typ för inspection_documents.status redan är en enum union kan du ta bort denna
// och använda InspectionDocument['status'] direkt.
const STATUS_LABELS: Record<InspectionDocumentStatus, string> = {
  present: 'Tillhandahållen',
  missing: 'Inte tillhandahållen',
  na: 'Bedöms ej relevant',
}

type InspectionExtraFields = Inspection & {
  defect_disclosures?: string | null
  inspection_side?: unknown
  locked_at?: string | null
}

type DocumentTypeExtraFields = DocumentType & {
  applies_to?: unknown
  label?: string | null
  description?: string | null
}

type InspectionDocumentExtraFields = InspectionDocument & {
  document_type_id?: string | null
  title?: string | null
  status?: string | null
  document_date?: string | null
  note?: string | null
  created_at?: string | null
}

type InspectionDisclosureExtraFields = InspectionDisclosure & {
  note?: string | null
  source_image_url?: string | null
}

type InspectionDefectRow = {
  defect_disclosures?: string | null
}

const DISCLOSURE_IMAGE_BUCKET = 'inspection-images' as const

const STANDARD_DISCLOSURE_TEXT =
  'Säljaren förvärvade fastigheten\nFöljande renoveringar och underhåll är utförda:'
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
  const appliesTo = parseAppliesToSides((documentType as DocumentTypeExtraFields).applies_to)
  return !appliesTo || appliesTo.includes(inspectionSide)
}

const toDocumentViewModel = (
  doc: InspectionDocument,
  documentTypes: DocumentType[]
): DocumentViewModel => {
  const typedDoc = doc as InspectionDocumentExtraFields
  const typeId = typedDoc.document_type_id ?? null
  const documentType = typeId ? documentTypes.find(type => type.id === typeId) : null
  const typedDocumentType = documentType as DocumentTypeExtraFields | null
  const status = typedDoc.status
  const normalizedStatus: InspectionDocumentStatus =
    status === 'present' || status === 'na' || status === 'missing' ? status : 'missing'

  return {
    id: doc.id,
    title: typedDoc.title ?? 'Handling',
    description: typedDocumentType?.description ?? null,
    status: normalizedStatus,
    documentDate: typedDoc.document_date ?? '',
    note: typedDoc.note ?? '',
  }
}

const resolveInspectionImageUrl = (path: string | null | undefined) => {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null

  if (path.startsWith('/storage/')) return `${base}${path}`
  if (path.startsWith('storage/')) return `${base}/${path}`
  if (path.startsWith('/')) return path

  return `${base}/storage/v1/object/public/${DISCLOSURE_IMAGE_BUCKET}/${path}`
}

export default function ObStepHandlingar({
  inspection,
}: {
  property: Property
  inspection: Inspection
}) {
  const collapsedStorageKey = `ob:handlingar:collapsed:${inspection.id}`
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inspectionWithExtras = inspection as InspectionExtraFields
  const isInspectionLocked = Boolean(inspectionWithExtras.locked_at)

  // saving-states
  const [savingDocs, setSavingDocs] = useState(false)
  const [savingDisclosure, setSavingDisclosure] = useState(false)
  const [savingDefect, setSavingDefect] = useState(false)
  const [uploadingDisclosureImage, setUploadingDisclosureImage] = useState(false)
  const [savedDisclosure, setSavedDisclosure] = useState(false)
  const [savedDefect, setSavedDefect] = useState(false)

  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [documentsRaw, setDocumentsRaw] = useState<InspectionDocument[]>([])
  const [collapsedDocumentIds, setCollapsedDocumentIds] = useState<Set<string>>(() => new Set())

  // Upplysningar (fri text) via egen tabell (en rad)
  const [disclosure, setDisclosure] = useState<InspectionDisclosure | null>(null)
  const [disclosureText, setDisclosureText] = useState('')
  const [disclosureImagePath, setDisclosureImagePath] = useState<string | null>(null)

  // Upplysningar om fel/brister via inspections.defect_disclosures
  const [defectText, setDefectText] = useState(() => {
    const v = inspectionWithExtras.defect_disclosures
    return v && v.trim() !== '' ? v : STANDARD_DEFECT_TEXT
  })
  const inspectionSide = normalizeInspectionSide(inspectionWithExtras.inspection_side)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(collapsedStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const ids = parsed.filter((value): value is string => typeof value === 'string')
      setCollapsedDocumentIds(new Set(ids))
    } catch (e) {
      console.warn('Kunde inte läsa sparat minimeringsläge för handlingar:', e)
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const ids = Array.from(collapsedDocumentIds.values())
      window.localStorage.setItem(collapsedStorageKey, JSON.stringify(ids))
    } catch (e) {
      console.warn('Kunde inte spara minimeringsläge för handlingar:', e)
    }
  }, [collapsedDocumentIds, collapsedStorageKey])

  // -------------------------------
  // Helpers
  // -------------------------------
  const fetchDocumentTypes = useCallback(async (): Promise<DocumentType[]> => {
    const { data, error: dtErr } = await supabase
      .from('document_types')
      .select('id,label,description,scope,is_active,applies_to')
      .in('scope', ['building', 'property'])
      .eq('is_active', true)

    if (dtErr) throw dtErr
    return (data || []) as DocumentType[]
  }, [])

  const fetchInspectionDocuments = useCallback(async (): Promise<InspectionDocument[]> => {
    const { data, error: docsErr } = await supabase
      .from('inspection_documents')
      .select('*')
      .eq('inspection_id', inspection.id)

    if (docsErr) throw docsErr
    return (data || []) as InspectionDocument[]
  }, [inspection.id])

  const ensureTemplateDocuments = useCallback(async (
    types: DocumentType[],
    existing: InspectionDocument[]
  ) => {
    // map: document_type_id -> newest row (hanterar dubletter utan att radera data)
    const newestByType = new Map<string, InspectionDocument>()

    for (const d of existing) {
      const typedDocument = d as InspectionDocumentExtraFields
      const typeId = typedDocument.document_type_id ?? null
      if (!typeId) continue

      const prev = newestByType.get(typeId)
      if (!prev) {
        newestByType.set(typeId, d)
        continue
      }

      const typedPrevious = prev as InspectionDocumentExtraFields
      const prevTs = typedPrevious.created_at ? new Date(typedPrevious.created_at).getTime() : 0
      const dTs = typedDocument.created_at ? new Date(typedDocument.created_at).getTime() : 0
      if (dTs >= prevTs) newestByType.set(typeId, d)
    }

    const missingTypes = types.filter(dt => !newestByType.has(dt.id))
    if (missingTypes.length === 0) return
    if (isInspectionLocked) return

    const payload = missingTypes.map(dt => ({
      inspection_id: inspection.id,
      document_type_id: dt.id,
      title: (dt as DocumentTypeExtraFields).label ?? 'Handling',
      status: 'missing' as InspectionDocumentStatus,
      document_date: null,
      document_value: null,
      note: null,
    }))

    const { error: insErr } = await supabase.from('inspection_documents').insert(payload)
    if (insErr) throw insErr
  }, [inspection.id, isInspectionLocked])

  const loadOrCreateDisclosureRow = useCallback(async (): Promise<InspectionDisclosure | null> => {
    const { data, error: discErr } = await supabase
      .from('inspection_disclosures')
      .select('*')
      .eq('inspection_id', inspection.id)

    if (discErr) throw discErr

    let row = (data && data[0]) as InspectionDisclosure | undefined

    if (!row) {
      if (isInspectionLocked) return null
      const { data: inserted, error: insErr } = await supabase
        .from('inspection_disclosures')
        .insert({
          inspection_id: inspection.id,
          title: 'upplysningar',
          note: STANDARD_DISCLOSURE_TEXT,
        })
        .select('*')
        .single()

      if (insErr) throw insErr
      row = inserted as InspectionDisclosure
    }

    return row ?? null
  }, [inspection.id, isInspectionLocked])

  const ensureDefectTextSaved = useCallback(async () => {
    const { data: inspRow, error: inspErr } = await supabase
      .from('inspections')
      .select('defect_disclosures')
      .eq('id', inspection.id)
      .single()

    if (inspErr) throw inspErr

    const typedInspectionRow = (inspRow ?? null) as InspectionDefectRow | null
    const current = (typedInspectionRow?.defect_disclosures ?? '').trim()
    if (current !== '') {
      setDefectText(typedInspectionRow?.defect_disclosures ?? STANDARD_DEFECT_TEXT)
      return
    }
    if (isInspectionLocked) {
      setDefectText(STANDARD_DEFECT_TEXT)
      return
    }

    await supabase
      .from('inspections')
      .update({ defect_disclosures: STANDARD_DEFECT_TEXT })
      .eq('id', inspection.id)

    setDefectText(STANDARD_DEFECT_TEXT)
  }, [inspection.id, isInspectionLocked])

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
        if (!isInspectionLocked) {
          await ensureTemplateDocuments(types, existingDocs)
        }

        // Läs om efter ev insert
        const docsAfter = await fetchInspectionDocuments()
        if (cancelled) return
        setDocumentsRaw(docsAfter)

        // disclosures (fri text) - säkerställ att en rad finns
        const disclosureRow = await loadOrCreateDisclosureRow()
        if (cancelled) return
        setDisclosure(disclosureRow)
        const typedDisclosureRow = disclosureRow as InspectionDisclosureExtraFields | null
        setDisclosureText(typedDisclosureRow?.note ?? '')
        setDisclosureImagePath(typedDisclosureRow?.source_image_url ?? null)

        // defect_disclosures - säkerställ att standard sparas även utan input
        await ensureDefectTextSaved()
      } catch (e: unknown) {
        console.error(e)
        setError(e instanceof Error ? e.message : 'Ett fel inträffade.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (inspection?.id) void loadAll()

    return () => {
      cancelled = true
    }
  }, [
    inspection?.id,
    inspectionSide,
    isInspectionLocked,
    ensureDefectTextSaved,
    ensureTemplateDocuments,
    fetchDocumentTypes,
    fetchInspectionDocuments,
    loadOrCreateDisclosureRow,
  ])

  // -------------------------------
  // DEDUPE + SORT (hide duplicates)
  // -------------------------------
  const documents = useMemo(() => {
    const allowedTypeIds = new Set(documentTypes.map(type => type.id))
    const newestByType = new Map<string, InspectionDocument>()
    const customs: InspectionDocument[] = []

    for (const d of documentsRaw) {
      const typedDocument = d as InspectionDocumentExtraFields
      const typeId = typedDocument.document_type_id ?? null
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

      const typedPrevious = prev as InspectionDocumentExtraFields
      const prevTs = typedPrevious.created_at ? new Date(typedPrevious.created_at).getTime() : 0
      const dTs = typedDocument.created_at ? new Date(typedDocument.created_at).getTime() : 0
      if (dTs >= prevTs) newestByType.set(typeId, d)
    }

    const merged = [...newestByType.values(), ...customs]
    merged.sort((a, b) => {
      const left = (a as InspectionDocumentExtraFields).title ?? ''
      const right = (b as InspectionDocumentExtraFields).title ?? ''
      return left.localeCompare(right, 'sv')
    })
    return merged
  }, [documentsRaw, documentTypes])

  // -------------------------------
  // HANDLINGAR update
  // -------------------------------
  const updateDoc = async (id: string, patch: Partial<InspectionDocument>) => {
    if (isInspectionLocked) return
    setDocumentsRaw(prev => prev.map(d => (d.id === id ? ({ ...d, ...patch } as InspectionDocument) : d)))
    setSavingDocs(true)

    const { error } = await supabase.from('inspection_documents').update(patch).eq('id', id)

    setSavingDocs(false)

    if (error) {
      console.error(error)
      setError('Kunde inte spara handling.')
    }
  }

  const toggleDocumentCollapsed = (id: string) => {
    setCollapsedDocumentIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // -------------------------------
  // LÄGG TILL EGEN HANDLING
  // -------------------------------
  const handleAddCustomDocument = async () => {
    if (!inspection?.id) return
    if (isInspectionLocked) return

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
      .insert(insertPayload)
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

  const handleDeleteCustomDocument = async (doc: InspectionDocument) => {
    if (isInspectionLocked) return
    const typedDocument = doc as InspectionDocumentExtraFields
    if (typedDocument.document_type_id) return

    const confirmed = window.confirm('Vill du radera den här egna handlingen?')
    if (!confirmed) return

    setSavingDocs(true)
    setError(null)

    const { error } = await supabase.from('inspection_documents').delete().eq('id', doc.id)

    setSavingDocs(false)

    if (error) {
      console.error(error)
      setError('Kunde inte radera handlingen.')
      return
    }

    setDocumentsRaw(prev => prev.filter(item => item.id !== doc.id))
    setCollapsedDocumentIds(prev => {
      if (!prev.has(doc.id)) return prev
      const next = new Set(prev)
      next.delete(doc.id)
      return next
    })
  }

  const saveDisclosureText = async (value: string) => {
    if (isInspectionLocked) return
    if (!disclosure) return

    setSavedDisclosure(false)
    setSavingDisclosure(true)

    const { error } = await supabase
      .from('inspection_disclosures')
      .update({ note: value || '' })
      .eq('id', disclosure.id)

    setSavingDisclosure(false)

    if (error) {
      console.error(error)
      setError('Kunde inte spara upplysningar.')
      return
    }

    setSavedDisclosure(true)
    setTimeout(() => setSavedDisclosure(false), 1500)
  }

  const saveDefectText = async (value: string) => {
    if (isInspectionLocked) return
    if (!inspection?.id) return

    setSavedDefect(false)
    let valueToSave = value

    if (!valueToSave || valueToSave.trim() === '') {
      valueToSave = STANDARD_DEFECT_TEXT
      setDefectText(valueToSave)
    }

    setSavingDefect(true)

    const { error } = await supabase
      .from('inspections')
      .update({ defect_disclosures: valueToSave })
      .eq('id', inspection.id)

    setSavingDefect(false)

    if (error) {
      console.error(error)
      setError('Kunde inte spara upplysningar om fel.')
      return
    }

    setSavedDefect(true)
    setTimeout(() => setSavedDefect(false), 1500)
  }

  const handleDisclosureImageUpload = async (file: File | null) => {
    if (!file) return
    if (isInspectionLocked) return
    if (!disclosure) return

    try {
      setError(null)
      setUploadingDisclosureImage(true)

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const fileName = `disclosure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const nextPath = `${inspection.id}/disclosures/${disclosure.id}/${fileName}`
      const previousPath = disclosureImagePath

      const { error: uploadError } = await supabase.storage
        .from(DISCLOSURE_IMAGE_BUCKET)
        .upload(nextPath, file, { upsert: false, cacheControl: '3600' })

      if (uploadError) throw uploadError

      const { error: updateError } = await supabase
        .from('inspection_disclosures')
        .update({ source_image_url: nextPath })
        .eq('id', disclosure.id)
      if (updateError) throw updateError

      setDisclosureImagePath(nextPath)

      if (
        previousPath &&
        previousPath !== nextPath &&
        !previousPath.startsWith('http://') &&
        !previousPath.startsWith('https://') &&
        !previousPath.startsWith('/')
      ) {
        const { error: removeError } = await supabase.storage
          .from(DISCLOSURE_IMAGE_BUCKET)
          .remove([previousPath])
        if (removeError) {
          console.warn('Kunde inte ta bort tidigare upplysningsbild:', removeError.message)
        }
      }
    } catch (e: unknown) {
      console.error('handleDisclosureImageUpload failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ladda upp bild till upplysningar.')
    } finally {
      setUploadingDisclosureImage(false)
    }
  }

  const handleDisclosureImageRemove = async () => {
    if (isInspectionLocked) return
    if (!disclosure) return
    if (!disclosureImagePath) return

    try {
      setError(null)
      setUploadingDisclosureImage(true)

      const oldPath = disclosureImagePath
      const { error: updateError } = await supabase
        .from('inspection_disclosures')
        .update({ source_image_url: null })
        .eq('id', disclosure.id)
      if (updateError) throw updateError

      setDisclosureImagePath(null)

      if (
        !oldPath.startsWith('http://') &&
        !oldPath.startsWith('https://') &&
        !oldPath.startsWith('/')
      ) {
        const { error: removeError } = await supabase.storage
          .from(DISCLOSURE_IMAGE_BUCKET)
          .remove([oldPath])
        if (removeError) {
          console.warn('Kunde inte ta bort upplysningsbild:', removeError.message)
        }
      }
    } catch (e: unknown) {
      console.error('handleDisclosureImageRemove failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort upplysningsbild.')
    } finally {
      setUploadingDisclosureImage(false)
    }
  }

  // -------------------------------
  // RENDER
  // -------------------------------
  if (loading) return <div className="p-4">Laddar...</div>
  if (error) return <div className="p-4 text-red-600">{error}</div>

  return (
    <div className="space-y-8">
      {isInspectionLocked ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Besiktningen är låst. Handlingar och upplysningar är skrivskyddade.
        </section>
      ) : null}

      {/* =======================
          HANDLINGAR
      ======================== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Handlingar</h2>
          </div>
          {savingDocs && <span className="text-sm text-gray-600">Sparar handling...</span>}
        </div>

        <div className="space-y-3 md:hidden">
          {documents.map(doc => {
            const viewDoc = toDocumentViewModel(doc, documentTypes)
            const isCollapsed = collapsedDocumentIds.has(doc.id)
            const typedDocument = doc as InspectionDocumentExtraFields
            const isCustomDocument = !typedDocument.document_type_id

            return (
              <article
                key={doc.id}
                className="min-w-0 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-gray-900">
                      {viewDoc.title}
                    </h3>
                    <div className="mt-1 text-xs font-medium text-blue-700">
                      {STATUS_LABELS[viewDoc.status]}
                    </div>
                    {viewDoc.description && !isCollapsed ? (
                      <p className="mt-1 break-words text-xs leading-5 text-gray-600">
                        {viewDoc.description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleDocumentCollapsed(doc.id)}
                    className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm"
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? 'Visa' : 'Minimera'}
                  </button>
                </div>

                {!isCollapsed ? (
                  <>
                    <label className="mt-3 block min-w-0 space-y-1">
                      <span className="text-xs font-medium text-gray-600">Status</span>
                      <select
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                        value={viewDoc.status}
                        disabled={isInspectionLocked}
                        onChange={event =>
                          void updateDoc(doc.id, {
                            status: event.target.value as InspectionDocumentStatus,
                          })
                        }
                      >
                        {(Object.keys(STATUS_LABELS) as InspectionDocumentStatus[]).map(key => (
                          <option key={key} value={key}>
                            {STATUS_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="mt-3 grid gap-3">
                      <label className="min-w-0 space-y-1">
                        <span className="text-xs font-medium text-gray-600">Datum</span>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                          value={viewDoc.documentDate}
                          disabled={isInspectionLocked}
                          onChange={e =>
                            void updateDoc(doc.id, { document_date: e.target.value || null })
                          }
                        />
                      </label>

                      <label className="min-w-0 space-y-1">
                        <span className="text-xs font-medium text-gray-600">Notering</span>
                        <DebouncedTextarea
                          className="min-h-20 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                          value={viewDoc.note}
                          disabled={isInspectionLocked}
                          onSave={value => void updateDoc(doc.id, { note: value })}
                        />
                      </label>
                    </div>

                    {isCustomDocument ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleDeleteCustomDocument(doc)}
                          disabled={isInspectionLocked || savingDocs}
                          className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Radera handling
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </article>
            )
          })}

          {documents.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white px-3 py-4 text-center text-sm text-gray-600">
              Inga handlingar ännu.
            </div>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border border-gray-300 bg-white md:block">
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
                const typedDocument = doc as InspectionDocumentExtraFields
                const typeId = typedDocument.document_type_id ?? null
                const dt = typeId ? documentTypes.find(d => d.id === typeId) : null
                const isCustomDocument = !typeId

                const docStatus = (
                  typedDocument.status === 'present' ||
                  typedDocument.status === 'missing' ||
                  typedDocument.status === 'na'
                    ? typedDocument.status
                    : 'missing'
                ) as InspectionDocumentStatus
                const typedDocumentType = dt as DocumentTypeExtraFields | null

                return (
                  <tr key={doc.id} className="border-t border-gray-200">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-gray-900">{typedDocument.title}</div>
                      {typedDocumentType?.description && (
                        <div className="mt-0.5 text-sm text-gray-600">{typedDocumentType.description}</div>
                      )}
                      {isCustomDocument ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteCustomDocument(doc)}
                          disabled={isInspectionLocked || savingDocs}
                          className="mt-2 rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Radera
                        </button>
                      ) : null}
                    </td>

                    <td className="px-3 py-2 align-top">
                      <select
                        className="w-full min-w-[11rem] rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                        value={docStatus}
                        disabled={isInspectionLocked}
                        onChange={event =>
                          void updateDoc(doc.id, {
                            status: event.target.value as InspectionDocumentStatus,
                          })
                        }
                      >
                        {(Object.keys(STATUS_LABELS) as InspectionDocumentStatus[]).map(key => (
                          <option key={key} value={key}>
                            {STATUS_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-3 py-2 align-top">
                      <input
                        type="date"
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                        value={typedDocument.document_date ?? ''}
                        disabled={isInspectionLocked}
                        onChange={e =>
                          void updateDoc(doc.id, { document_date: e.target.value || null })
                        }
                      />
                    </td>

                    <td className="px-3 py-2 align-top">
                      <DebouncedTextarea
                        className="min-h-[2.5rem] w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                        value={typedDocument.note ?? ''}
                        disabled={isInspectionLocked}
                        onSave={value => void updateDoc(doc.id, { note: value })}
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
            disabled={isInspectionLocked}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            + Lägg till egen handling
          </button>
        </div>
      </section>

      {/* =======================
          UPPlysningar - fri text
      ======================== */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Upplysningar</h2>
          {savingDisclosure && <span className="text-sm text-gray-600">Sparar...</span>}
          {!savingDisclosure && savedDisclosure && (
            <span className="text-xs text-emerald-600">Sparad</span>
          )}
        </div>

        <DebouncedTextarea
          className="min-h-[200px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          placeholder="Skriv alla upplysningar här ..."
          value={disclosureText}
          disabled={isInspectionLocked}
          onValueChange={setDisclosureText}
          onSave={saveDisclosureText}
        />

        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={isInspectionLocked || uploadingDisclosureImage}
                onChange={event => {
                  const file = event.target.files?.[0] ?? null
                  void handleDisclosureImageUpload(file)
                  event.currentTarget.value = ''
                }}
              />
              {uploadingDisclosureImage ? 'Laddar upp bild...' : '+ Lägg till bild'}
            </label>

            {disclosureImagePath ? (
              <button
                type="button"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isInspectionLocked || uploadingDisclosureImage}
                onClick={() => void handleDisclosureImageRemove()}
              >
                Ta bort bild
              </button>
            ) : null}
          </div>

          {disclosureImagePath ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <img
                src={resolveInspectionImageUrl(disclosureImagePath) ?? ''}
                alt="Upplysningsbild"
                className="max-h-64 w-full object-contain"
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* =======================
          Upplysningar om fel i fastigheten
      ======================== */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Upplysningar om fel i fastigheten</h2>
          {savingDefect && <span className="text-sm text-gray-600">Sparar...</span>}
          {!savingDefect && savedDefect && (
            <span className="text-xs text-emerald-600">Sparad</span>
          )}
        </div>

        <DebouncedTextarea
          className="min-h-[160px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          value={defectText}
          disabled={isInspectionLocked}
          onValueChange={setDefectText}
          onSave={saveDefectText}
        />
      </section>
    </div>
  )
}



