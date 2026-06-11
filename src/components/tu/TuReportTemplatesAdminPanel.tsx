'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { TU_STANDARD_REPORT_TEMPLATES } from '@/lib/tu/reportTemplates'

type TemplateRow = {
  id: string
  key: string
  title: string
  description: string | null
  document_title: string
  project_type: string
  version: number
  sort_order: number
  is_active: boolean
  is_system: boolean
}

type TemplateSectionRow = {
  id: string
  template_id: string
  template_section_key: string
  section_type_key: string
  title_override: string | null
  default_content: string | null
  ai_instruction: string | null
  sort_order: number
  is_required: boolean
  include_in_toc: boolean
  allow_delete: boolean
}

type SectionTypeRow = {
  key: string
  title: string
  is_active: boolean
  sort_order: number
}

type TemplateDraft = {
  id?: string
  key: string
  title: string
  description: string
  document_title: string
  project_type: string
  version: number
  sort_order: number
  is_active: boolean
  is_system?: boolean
}

type SectionDraft = {
  id?: string
  template_id: string
  template_section_key: string
  section_type_key: string
  title_override: string
  default_content: string
  ai_instruction: string
  sort_order: number
  is_required: boolean
  include_in_toc: boolean
  allow_delete: boolean
}

type SettingsError = {
  message: string
} | null

type SettingsResponse<T> = {
  data: T | null
  error: SettingsError
}

type SettingsQuery = {
  select: (columns: string) => SettingsQuery
  order: (column: string, options?: { ascending?: boolean }) => SettingsQuery
  insert: (values: unknown) => SettingsQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => SettingsQuery
  update: (values: unknown) => SettingsQuery
  delete: () => SettingsQuery
  eq: (column: string, value: unknown) => SettingsQuery
  single: () => Promise<SettingsResponse<unknown>>
  then: <TResult1 = SettingsResponse<unknown[]>, TResult2 = never>(
    onfulfilled?: ((value: SettingsResponse<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>
}

type SettingsClient = {
  from: (table: string) => SettingsQuery
}

const TEMPLATE_COLUMNS =
  'id,key,title,description,document_title,project_type,version,sort_order,is_active,is_system'

const SECTION_COLUMNS =
  'id,template_id,template_section_key,section_type_key,title_override,default_content,ai_instruction,sort_order,is_required,include_in_toc,allow_delete'

const EMPTY_TEMPLATE_DRAFT: TemplateDraft = {
  key: '',
  title: '',
  description: '',
  document_title: '',
  project_type: '',
  version: 1,
  sort_order: 100,
  is_active: true,
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function createKeyFromTitle(title: string) {
  return normalizeKey(title) || `tu_template_${Math.random().toString(36).slice(2, 8)}`
}

function createSectionInstanceKey(sectionTypeKey: string, existingKeys: Set<string>) {
  const base = normalizeKey(sectionTypeKey) || `section_${Math.random().toString(36).slice(2, 8)}`
  if (!existingKeys.has(base)) return base

  let index = 2
  while (existingKeys.has(`${base}_${index}`)) index += 1
  return `${base}_${index}`
}

function templatePayload(draft: TemplateDraft) {
  return {
    key: draft.key.trim(),
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    document_title: draft.document_title.trim(),
    project_type: draft.project_type.trim(),
    version: Number.isFinite(draft.version) && draft.version > 0 ? draft.version : 1,
    sort_order: Number.isFinite(draft.sort_order) ? draft.sort_order : 100,
    is_active: draft.is_active,
    is_system: Boolean(draft.is_system),
  }
}

function sectionPayload(draft: SectionDraft) {
  return {
    template_id: draft.template_id,
    template_section_key: draft.template_section_key.trim(),
    section_type_key: draft.section_type_key.trim(),
    title_override: draft.title_override.trim() || null,
    default_content: draft.default_content.trim() || null,
    ai_instruction: draft.ai_instruction.trim() || null,
    sort_order: Number.isFinite(draft.sort_order) ? draft.sort_order : 100,
    is_required: draft.is_required,
    include_in_toc: draft.include_in_toc,
    allow_delete: draft.allow_delete,
  }
}

function templateToDraft(template: TemplateRow): TemplateDraft {
  return {
    id: template.id,
    key: template.key,
    title: template.title,
    description: template.description ?? '',
    document_title: template.document_title,
    project_type: template.project_type,
    version: template.version,
    sort_order: template.sort_order,
    is_active: template.is_active,
    is_system: template.is_system,
  }
}

function sortTemplates(left: TemplateRow, right: TemplateRow) {
  return left.sort_order - right.sort_order || left.title.localeCompare(right.title, 'sv')
}

export default function TuReportTemplatesAdminPanel() {
  const settingsClient = useMemo(() => supabase as unknown as SettingsClient, [])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [sections, setSections] = useState<TemplateSectionRow[]>([])
  const [sectionTypes, setSectionTypes] = useState<SectionTypeRow[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null)
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reorderingSectionId, setReorderingSectionId] = useState<string | null>(null)

  const selectedTemplate = selectedTemplateId
    ? templates.find((template) => template.id === selectedTemplateId) ?? null
    : null
  const selectedTemplateSections = useMemo(
    () =>
      selectedTemplate
        ? sections
            .filter((section) => section.template_id === selectedTemplate.id)
            .sort((left, right) => left.sort_order - right.sort_order)
        : [],
    [sections, selectedTemplate]
  )
  const sectionTypeByKey = useMemo(
    () => new Map(sectionTypes.map((sectionType) => [sectionType.key, sectionType])),
    [sectionTypes]
  )
  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return templates
    return templates.filter((template) =>
      [
        template.key,
        template.title,
        template.description ?? '',
        template.document_title,
        template.project_type,
        template.is_active ? 'aktiv' : 'inaktiv',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [query, templates])

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    const [{ data: templateData, error: templateError }, { data: sectionData, error: sectionError }, { data: typeData, error: typeError }] =
      await Promise.all([
        settingsClient
          .from('settings_tu_report_templates')
          .select(TEMPLATE_COLUMNS)
          .order('sort_order', { ascending: true })
          .order('title', { ascending: true }),
        settingsClient
          .from('settings_tu_report_template_sections')
          .select(SECTION_COLUMNS)
          .order('sort_order', { ascending: true }),
        settingsClient
          .from('settings_tu_report_section_types')
          .select('key,title,is_active,sort_order')
          .order('title', { ascending: true }),
      ])

    if (templateError || sectionError || typeError) {
      setTemplates([])
      setSections([])
      setSectionTypes([])
      setError(
        templateError?.message ??
          sectionError?.message ??
          typeError?.message ??
          'Kunde inte hämta TU-mallar.'
      )
      setLoading(false)
      return
    }

    const nextTemplates = (templateData ?? []) as TemplateRow[]
    setTemplates(nextTemplates)
    setSections((sectionData ?? []) as TemplateSectionRow[])
    setSectionTypes((typeData ?? []) as SectionTypeRow[])
    setSelectedTemplateId((current) =>
      current && nextTemplates.some((template) => template.id === current) ? current : null
    )
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seedStandardTemplates = async () => {
    setError(null)
    const templateRows = TU_STANDARD_REPORT_TEMPLATES.map((template) => ({
      key: template.key,
      title: template.title,
      description: template.description ?? null,
      document_title: template.documentTitle,
      project_type: template.projectType,
      version: template.version,
      sort_order: template.sortOrder,
      is_active: template.isActive,
      is_system: true,
    }))

    const { error: templateError } = await settingsClient
      .from('settings_tu_report_templates')
      .upsert(templateRows, { onConflict: 'key' })
    if (templateError) {
      setError(templateError.message)
      return
    }

    const { data: savedTemplateData, error: reloadError } = await settingsClient
      .from('settings_tu_report_templates')
      .select(TEMPLATE_COLUMNS)
    if (reloadError) {
      setError(reloadError.message)
      return
    }

    const idByKey = new Map(((savedTemplateData ?? []) as TemplateRow[]).map((template) => [template.key, template.id]))
    const sectionRows = TU_STANDARD_REPORT_TEMPLATES.flatMap((template) => {
      const templateId = idByKey.get(template.key)
      if (!templateId) return []
      return (template.sections ?? []).map((section) => ({
        template_id: templateId,
        template_section_key: section.templateSectionKey,
        section_type_key: section.sectionTypeKey,
        title_override: section.titleOverride ?? null,
        default_content: section.defaultContent ?? null,
        ai_instruction: section.aiInstruction ?? null,
        sort_order: section.sortOrder,
        is_required: section.isRequired,
        include_in_toc: section.includeInToc,
        allow_delete: section.allowDelete,
      }))
    })

    const { error: sectionError } = await settingsClient
      .from('settings_tu_report_template_sections')
      .upsert(sectionRows, { onConflict: 'template_id,template_section_key' })
    if (sectionError) {
      setError(sectionError.message)
      return
    }

    setTemplateDraft(null)
    setSectionDraft(null)
    await loadAll()
  }

  const openNewTemplate = () => {
    setSelectedTemplateId(null)
    setPanelOpen(true)
    setTemplateDraft({
      ...EMPTY_TEMPLATE_DRAFT,
      sort_order: (templates.length + 1) * 100,
    })
    setSectionDraft(null)
  }

  const openEditTemplate = (template: TemplateRow) => {
    setSelectedTemplateId(template.id)
    setPanelOpen(true)
    setTemplateDraft(templateToDraft(template))
    setSectionDraft(null)
  }

  const closePanel = () => {
    setPanelOpen(false)
    setSelectedTemplateId(null)
    setTemplateDraft(null)
    setSectionDraft(null)
    setReorderingSectionId(null)
  }

  const saveTemplateDraft = async () => {
    if (!templateDraft) return
    const title = templateDraft.title.trim()
    const key = templateDraft.id ? templateDraft.key.trim() : createKeyFromTitle(templateDraft.key || title)
    const nextDraft = { ...templateDraft, key }
    const payload = templatePayload(nextDraft)

    if (!payload.title || !payload.document_title || !payload.project_type) {
      setError('Mallnamn, dokumentrubrik och projekttyp måste fyllas i.')
      return
    }
    if (!/^[a-z0-9_]+$/.test(payload.key)) {
      setError('Key får bara innehålla små bokstäver, siffror och underscore.')
      return
    }

    setError(null)
    if (templateDraft.id) {
      const { error: updateError } = await settingsClient
        .from('settings_tu_report_templates')
        .update(payload)
        .eq('id', templateDraft.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      setTemplates((current) =>
        current
          .map((template) => (template.id === templateDraft.id ? ({ ...template, ...payload } as TemplateRow) : template))
          .sort(sortTemplates)
      )
      setTemplateDraft((current) => (current ? { ...current, ...nextDraft } : current))
      return
    }

    const { data, error: insertError } = await settingsClient
      .from('settings_tu_report_templates')
      .insert(payload)
      .select(TEMPLATE_COLUMNS)
      .single()
    if (insertError) {
      setError(insertError.message)
      return
    }
    const created = data as TemplateRow
    setTemplates((current) => [...current, created].sort(sortTemplates))
    setSelectedTemplateId(created.id)
    setTemplateDraft(templateToDraft(created))
    setPanelOpen(true)
  }

  const deleteTemplate = async (template: TemplateRow) => {
    if (template.is_system) {
      setError('Systemmallar kan inte tas bort. Inaktivera mallen om den inte ska kunna väljas.')
      return
    }
    if (!confirm(`Ta bort mallen "${template.title}"? Skapade utlåtanden påverkas inte.`)) return
    const { error: deleteError } = await settingsClient
      .from('settings_tu_report_templates')
      .delete()
      .eq('id', template.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setTemplates((current) => current.filter((item) => item.id !== template.id))
    setSections((current) => current.filter((item) => item.template_id !== template.id))
    if (selectedTemplateId === template.id || templateDraft?.id === template.id) closePanel()
  }

  const openNewSection = () => {
    if (!selectedTemplate) return
    const activeSectionType = sectionTypes.find((sectionType) => sectionType.is_active) ?? sectionTypes[0] ?? null
    const existingKeys = new Set(selectedTemplateSections.map((section) => section.template_section_key))
    const sectionTypeKey = activeSectionType?.key ?? ''
    const nextSortOrder =
      selectedTemplateSections.reduce((highest, section) => Math.max(highest, section.sort_order), 0) + 100
    setSectionDraft({
      template_id: selectedTemplate.id,
      template_section_key: createSectionInstanceKey(sectionTypeKey, existingKeys),
      section_type_key: sectionTypeKey,
      title_override: '',
      default_content: '',
      ai_instruction: '',
      sort_order: nextSortOrder,
      is_required: false,
      include_in_toc: true,
      allow_delete: true,
    })
  }

  const openEditSection = (section: TemplateSectionRow) => {
    setSectionDraft({
      id: section.id,
      template_id: section.template_id,
      template_section_key: section.template_section_key,
      section_type_key: section.section_type_key,
      title_override: section.title_override ?? '',
      default_content: section.default_content ?? '',
      ai_instruction: section.ai_instruction ?? '',
      sort_order: section.sort_order,
      is_required: section.is_required,
      include_in_toc: section.include_in_toc,
      allow_delete: section.allow_delete,
    })
  }

  const updateSectionType = (sectionTypeKey: string) => {
    setSectionDraft((current) => {
      if (!current) return current
      if (current.id) return { ...current, section_type_key: sectionTypeKey }
      const existingKeys = new Set(selectedTemplateSections.map((section) => section.template_section_key))
      return {
        ...current,
        section_type_key: sectionTypeKey,
        template_section_key: createSectionInstanceKey(sectionTypeKey, existingKeys),
      }
    })
  }

  const saveSectionDraft = async () => {
    if (!sectionDraft) return
    const payload = sectionPayload(sectionDraft)
    if (!payload.section_type_key) {
      setError('Välj deltyp för mallsektionen.')
      return
    }
    if (!/^[a-z0-9_]+$/.test(payload.template_section_key)) {
      setError('Sektionens key får bara innehålla små bokstäver, siffror och underscore.')
      return
    }

    setError(null)
    if (sectionDraft.id) {
      const { error: updateError } = await settingsClient
        .from('settings_tu_report_template_sections')
        .update(payload)
        .eq('id', sectionDraft.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      setSections((current) =>
        current.map((section) => (section.id === sectionDraft.id ? ({ ...section, ...payload } as TemplateSectionRow) : section))
      )
      setSectionDraft(null)
      return
    }

    const { data, error: insertError } = await settingsClient
      .from('settings_tu_report_template_sections')
      .insert(payload)
      .select(SECTION_COLUMNS)
      .single()
    if (insertError) {
      setError(insertError.message)
      return
    }
    setSections((current) => [...current, data as TemplateSectionRow])
    setSectionDraft(null)
  }

  const moveSection = async (sectionId: string, direction: -1 | 1) => {
    const currentIndex = selectedTemplateSections.findIndex((section) => section.id === sectionId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= selectedTemplateSections.length) return

    const nextOrder = [...selectedTemplateSections]
    const [movedSection] = nextOrder.splice(currentIndex, 1)
    nextOrder.splice(targetIndex, 0, movedSection)
    const updates = nextOrder.map((section, index) => ({
      ...section,
      sort_order: (index + 1) * 100,
    }))

    setError(null)
    setReorderingSectionId(sectionId)
    const results = await Promise.all(
      updates.map((section) =>
        settingsClient
          .from('settings_tu_report_template_sections')
          .update({ sort_order: section.sort_order })
          .eq('id', section.id)
      )
    )
    const failed = results.find((result) => result.error)
    if (failed?.error) {
      setError(failed.error.message)
      setReorderingSectionId(null)
      return
    }

    const sortOrderById = new Map(updates.map((section) => [section.id, section.sort_order]))
    setSections((current) =>
      current.map((section) => {
        const sortOrder = sortOrderById.get(section.id)
        return typeof sortOrder === 'number' ? { ...section, sort_order: sortOrder } : section
      })
    )
    setSectionDraft((current) => {
      if (!current?.id) return current
      const sortOrder = sortOrderById.get(current.id)
      return typeof sortOrder === 'number' ? { ...current, sort_order: sortOrder } : current
    })
    setReorderingSectionId(null)
  }

  const deleteSection = async (section: TemplateSectionRow) => {
    if (!confirm('Ta bort sektionen från mallen? Skapade utlåtanden påverkas inte.')) return
    const { error: deleteError } = await settingsClient
      .from('settings_tu_report_template_sections')
      .delete()
      .eq('id', section.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setSections((current) => current.filter((item) => item.id !== section.id))
    if (sectionDraft?.id === section.id) setSectionDraft(null)
  }

  return (
    <div className="space-y-4 rounded-xl bg-white p-4 shadow">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-semibold">TU-mallar</h2>
          <div className="text-xs text-gray-500">settings_tu_report_templates</div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Styr vilka sektioner som kopieras in när en ny teknisk utredning skapas. Mallen kan inte bytas efter
            skapandet och befintliga utlåtanden påverkas inte av malländringar.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sök..."
            className="h-9 rounded border border-gray-300 px-2 text-sm"
          />
          <button
            type="button"
            onClick={openNewTemplate}
            className="h-9 rounded bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            + Ny mall
          </button>
          <button
            type="button"
            onClick={() => void seedStandardTemplates()}
            className="h-9 rounded border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 hover:bg-violet-50"
          >
            Lägg in standardmallar
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {templateDraft ? (
        <div className="hidden rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-950">
              {templateDraft.id ? 'Redigera mall' : 'Ny mall'}
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTemplateDraft(null)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void saveTemplateDraft()}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Spara
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Mallnamn</div>
              <input
                value={templateDraft.title}
                onChange={(event) => {
                  const title = event.target.value
                  setTemplateDraft((current) =>
                    current
                      ? {
                          ...current,
                          title,
                          key: current.id ? current.key : createKeyFromTitle(title),
                          document_title: current.document_title || title,
                          project_type: current.project_type || title,
                        }
                      : current
                  )
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Key</div>
              <input
                value={templateDraft.key}
                disabled={Boolean(templateDraft.id)}
                onChange={(event) =>
                  setTemplateDraft((current) =>
                    current ? { ...current, key: normalizeKey(event.target.value) } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Dokumentrubrik</div>
              <input
                value={templateDraft.document_title}
                onChange={(event) =>
                  setTemplateDraft((current) =>
                    current ? { ...current, document_title: event.target.value } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Projekttyp</div>
              <input
                value={templateDraft.project_type}
                onChange={(event) =>
                  setTemplateDraft((current) =>
                    current ? { ...current, project_type: event.target.value } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <div className="mb-1 text-gray-600">Beskrivning</div>
              <textarea
                value={templateDraft.description}
                rows={2}
                onChange={(event) =>
                  setTemplateDraft((current) =>
                    current ? { ...current, description: event.target.value } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Version</div>
              <input
                type="number"
                value={templateDraft.version}
                onChange={(event) =>
                  setTemplateDraft((current) =>
                    current ? { ...current, version: event.target.value === '' ? 1 : Number(event.target.value) } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Sortering</div>
              <input
                type="number"
                value={templateDraft.sort_order}
                onChange={(event) =>
                  setTemplateDraft((current) =>
                    current ? { ...current, sort_order: event.target.value === '' ? 100 : Number(event.target.value) } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={templateDraft.is_active}
                onChange={(event) =>
                  setTemplateDraft((current) =>
                    current ? { ...current, is_active: event.target.checked } : current
                  )
                }
              />
              Aktiv vid skapande av ny TU
            </label>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="overflow-auto rounded-lg border border-gray-200">
          <table className="w-full table-fixed border-separate border-spacing-y-2 p-2 text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400">
                <th className="px-3 py-1 w-[24%]">Mall</th>
                <th className="px-3 py-1 w-[18%]">Dokument</th>
                <th className="px-3 py-1 w-[18%]">Projekttyp</th>
                <th className="px-3 py-1 w-[10%]">Sektioner</th>
                <th className="px-3 py-1 w-[8%]">Sort</th>
                <th className="px-3 py-1 w-[8%]">Status</th>
                <th className="px-3 py-1 w-[14%] text-center">Åtgärder</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map((template) => {
                const sectionCount = sections.filter((section) => section.template_id === template.id).length
                const isSelected = panelOpen && selectedTemplateId === template.id

                return (
                  <tr
                    key={template.id}
                    onClick={() => openEditTemplate(template)}
                    className={`group cursor-pointer transition-colors ${
                      isSelected ? 'bg-emerald-50' : 'hover:bg-blue-50'
                    }`}
                  >
                    <td className="rounded-l-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                      <div className="truncate font-medium text-gray-950">{template.title}</div>
                      <div className="truncate font-mono text-[11px] text-gray-500">{template.key}</div>
                    </td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                      <div className="truncate">{template.document_title}</div>
                    </td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                      <div className="truncate">{template.project_type}</div>
                    </td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                      {sectionCount}
                    </td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                      {template.sort_order}
                    </td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                      {template.is_active ? 'Aktiv' : 'Inaktiv'}
                   </td>
                    <td className="rounded-r-xl border border-gray-200 bg-white px-3 py-2 text-right transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                      <div className="flex justify-end gap-2">
                      <button
                        type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditTemplate(template)
                          }}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                          Öppna
                      </button>
                        {!template.is_system ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              void deleteTemplate(template)
                            }}
                            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                          >
                            Ta bort
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && filteredTemplates.length === 0 ? (
                <tr>
                  <td className="px-3 py-5 text-gray-500" colSpan={7}>
                    Inga mallar.
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td className="px-3 py-5 text-gray-500" colSpan={7}>
                    Laddar...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div
          className={
            panelOpen
              ? 'fixed inset-y-0 right-0 z-50 w-full max-w-5xl overflow-y-auto border-l border-gray-200 bg-white p-4 shadow-2xl'
              : 'hidden'
          }
        >
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 border-b border-gray-200 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">TU-mall</div>
                <h3 className="mt-1 text-xl font-semibold text-gray-950">
                  {templateDraft?.title || selectedTemplate?.title || 'Ny mall'}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Redigera malluppgifter och delsektioner. Skapade utlåtanden påverkas inte.
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Stäng
              </button>
            </div>
          </div>

          {templateDraft ? (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-gray-950">
                  {templateDraft.id ? 'Malluppgifter' : 'Ny mall'}
                </h4>
                <button
                  type="button"
                  onClick={() => void saveTemplateDraft()}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Spara mall
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <div className="mb-1 text-gray-600">Mallnamn</div>
                  <input
                    value={templateDraft.title}
                    onChange={(event) => {
                      const title = event.target.value
                      setTemplateDraft((current) =>
                        current
                          ? {
                              ...current,
                              title,
                              key: current.id ? current.key : createKeyFromTitle(title),
                              document_title: current.document_title || title,
                              project_type: current.project_type || title,
                            }
                          : current
                      )
                    }}
                    className="w-full rounded border border-gray-300 px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <div className="mb-1 text-gray-600">Key</div>
                  <input
                    value={templateDraft.key}
                    disabled={Boolean(templateDraft.id)}
                    onChange={(event) =>
                      setTemplateDraft((current) =>
                        current ? { ...current, key: normalizeKey(event.target.value) } : current
                      )
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </label>
                <label className="text-sm">
                  <div className="mb-1 text-gray-600">Dokumentrubrik</div>
                  <input
                    value={templateDraft.document_title}
                    onChange={(event) =>
                      setTemplateDraft((current) =>
                        current ? { ...current, document_title: event.target.value } : current
                      )
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <div className="mb-1 text-gray-600">Projekttyp</div>
                  <input
                    value={templateDraft.project_type}
                    onChange={(event) =>
                      setTemplateDraft((current) =>
                        current ? { ...current, project_type: event.target.value } : current
                      )
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5"
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <div className="mb-1 text-gray-600">Beskrivning</div>
                  <textarea
                    value={templateDraft.description}
                    rows={2}
                    onChange={(event) =>
                      setTemplateDraft((current) =>
                        current ? { ...current, description: event.target.value } : current
                      )
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <div className="mb-1 text-gray-600">Version</div>
                  <input
                    type="number"
                    value={templateDraft.version}
                    onChange={(event) =>
                      setTemplateDraft((current) =>
                        current ? { ...current, version: event.target.value === '' ? 1 : Number(event.target.value) } : current
                      )
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <div className="mb-1 text-gray-600">Sortering</div>
                  <input
                    type="number"
                    value={templateDraft.sort_order}
                    onChange={(event) =>
                      setTemplateDraft((current) =>
                        current ? { ...current, sort_order: event.target.value === '' ? 100 : Number(event.target.value) } : current
                      )
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={templateDraft.is_active}
                    onChange={(event) =>
                      setTemplateDraft((current) =>
                        current ? { ...current, is_active: event.target.checked } : current
                      )
                    }
                  />
                  Aktiv vid skapande av ny TU
                </label>
              </div>
            </div>
          ) : null}

          {selectedTemplate ? (
            <>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold text-gray-950">{selectedTemplate.title}</h3>
                  <p className="text-xs text-gray-500">
                    Dokument: {selectedTemplate.document_title} · Projekttyp: {selectedTemplate.project_type} · Version {selectedTemplate.version}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewSection}
                  disabled={sectionTypes.length === 0}
                  className="h-9 rounded bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300"
                >
                  + Lägg till sektion
                </button>
              </div>

              {sectionDraft ? (
                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-gray-950">
                      {sectionDraft.id ? 'Redigera sektion' : 'Ny sektion'}
                    </h4>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSectionDraft(null)}
                        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        Avbryt
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveSectionDraft()}
                        className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        Spara
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm">
                      <div className="mb-1 text-gray-600">Deltyp</div>
                      <select
                        value={sectionDraft.section_type_key}
                        onChange={(event) => updateSectionType(event.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1.5"
                      >
                        {sectionTypes.map((sectionType) => (
                          <option key={sectionType.key} value={sectionType.key}>
                            {sectionType.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-gray-600">Sektion-key</div>
                      <input
                        value={sectionDraft.template_section_key}
                        disabled={Boolean(sectionDraft.id)}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, template_section_key: normalizeKey(event.target.value) } : current
                          )
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1.5 disabled:bg-gray-100 disabled:text-gray-500"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-gray-600">Rubrik i denna mall</div>
                      <input
                        value={sectionDraft.title_override}
                        placeholder={sectionTypeByKey.get(sectionDraft.section_type_key)?.title ?? ''}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, title_override: event.target.value } : current
                          )
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1.5"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-gray-600">Sortering</div>
                      <input
                        type="number"
                        value={sectionDraft.sort_order}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, sort_order: event.target.value === '' ? 100 : Number(event.target.value) } : current
                          )
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1.5"
                      />
                    </label>
                    <label className="text-sm md:col-span-2">
                      <div className="mb-1 text-gray-600">Standardtext</div>
                      <textarea
                        value={sectionDraft.default_content}
                        rows={3}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, default_content: event.target.value } : current
                          )
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1.5"
                      />
                    </label>
                    <label className="text-sm md:col-span-2">
                      <div className="mb-1 text-gray-600">AI-instruktion</div>
                      <textarea
                        value={sectionDraft.ai_instruction}
                        rows={2}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, ai_instruction: event.target.value } : current
                          )
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1.5"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={sectionDraft.include_in_toc}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, include_in_toc: event.target.checked } : current
                          )
                        }
                      />
                      Med i innehåll
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={sectionDraft.allow_delete}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, allow_delete: event.target.checked } : current
                          )
                        }
                      />
                      Får tas bort i utlåtandet
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={sectionDraft.is_required}
                        onChange={(event) =>
                          setSectionDraft((current) =>
                            current ? { ...current, is_required: event.target.checked } : current
                          )
                        }
                      />
                      Lås deltyp i utlåtandet
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-3">Ordning</th>
                      <th className="py-2 pr-3">Deltyp</th>
                      <th className="py-2 pr-3">Rubrik</th>
                      <th className="py-2 pr-3">Val</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedTemplateSections.map((section, index) => {
                      const sectionType = sectionTypeByKey.get(section.section_type_key)
                      const isMoving = reorderingSectionId === section.id
                      return (
                        <tr key={section.id}>
                          <td className="py-2 pr-3 align-top">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => void moveSection(section.id, -1)}
                                disabled={index === 0 || Boolean(reorderingSectionId)}
                                className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                Upp
                              </button>
                              <button
                                type="button"
                                onClick={() => void moveSection(section.id, 1)}
                                disabled={index === selectedTemplateSections.length - 1 || Boolean(reorderingSectionId)}
                                className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              >
                                Ned
                              </button>
                            </div>
                            <div className="mt-1 text-xs text-gray-400">
                              {isMoving ? 'Sparar...' : section.sort_order}
                            </div>
                          </td>
                          <td className="py-2 pr-3">
                            <span className="block font-medium text-gray-950">
                              {sectionType?.title ?? section.section_type_key}
                            </span>
                            <span className="block font-mono text-xs text-gray-500">
                              {section.template_section_key}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            {section.title_override || sectionType?.title || section.section_type_key}
                          </td>
                          <td className="py-2 pr-3 text-xs text-gray-600">
                            {section.include_in_toc ? 'Innehåll' : 'Ej innehåll'} ·{' '}
                            {section.allow_delete ? 'Kan tas bort' : 'Låst'} ·{' '}
                            {section.is_required ? 'Deltyp låst' : 'Deltyp fri'}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => openEditSection(section)}
                              className="mr-3 text-emerald-700 underline"
                            >
                              Editera
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteSection(section)}
                              className="text-rose-700 underline"
                            >
                              Ta bort
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {selectedTemplateSections.length === 0 ? (
                      <tr>
                        <td className="py-4 text-gray-500" colSpan={5}>
                          Inga sektioner i mallen.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
              Spara mallen innan du lägger till delsektioner.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
