'use client'

import Link from 'next/link'
import { ArrowLeft, Check, FileText, Save } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState, useTransition } from 'react'
import type {
  EbInspectionReport,
  EbPreviousInspectionItem,
  EbReportDraftSection,
  EbReportSectionStatus,
} from '@/lib/eb/server'

type Props = {
  initialReport: EbInspectionReport
}

const statusLabels: Record<EbReportSectionStatus, string> = {
  draft: 'Utkast',
  complete: 'Klar',
  missing: 'Saknas',
  not_applicable: 'Ej relevant',
}

const statusClasses: Record<EbReportSectionStatus, string> = {
  draft: 'border-amber-200 bg-amber-50 text-amber-800',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  missing: 'border-rose-200 bg-rose-50 text-rose-800',
  not_applicable: 'border-gray-200 bg-gray-50 text-gray-600',
}

const sourceLabels: Record<EbReportDraftSection['source'], string> = {
  project: 'Entreprenad',
  inspection: 'Besiktning',
  participants: 'Parter och närvarande',
  notes: 'Noteringar',
  checkpoints: 'Kontrollpunkter',
  standard_text: 'Standardtext',
  manual: 'Manuell',
}

const sourceHints: Record<EbReportDraftSection['source'], string> = {
  project: 'Grunduppgifter fylls i via Redigera entreprenad på entreprenadsidan.',
  inspection: 'Besiktningsuppgifter fylls i Uppgifter på besiktningen.',
  participants: 'Parter, mottagare och närvarande hanteras i Uppgifter på besiktningen.',
  notes: 'Noteringar, beteckningar och bilder hanteras i Granska eller mobil runda.',
  checkpoints: 'Kontrollpunkter hanteras i Granska.',
  standard_text: 'Texten är standardtext för utlåtandet och justeras här innan utskrift.',
  manual: 'Denna punkt fylls i här i utlåtandeutkastet.',
}

const INVITATION_METHOD_OPTIONS = [
  'E-post',
  'Brev',
  'Telefon',
  'SMS',
  'Muntligen',
  'Digitalt möte',
]

const PREVIOUS_INSPECTION_STATUS_OPTIONS: Array<{
  value: Exclude<EbPreviousInspectionItem['status'], null>
  label: string
}> = [
  { value: 'performed', label: 'Utförd' },
  { value: 'not_performed', label: 'Ej utförd' },
  { value: 'not_applicable', label: 'Ej aktuell' },
]

type StructuredReportFormState = {
  inspectorAppointedBy: string
  invitationMethod: string
  invitationDate: string
  approvalStatus: string
  approvalNote: string
  requiresContinuedFinalInspection: string
  continuedFinalInspectionDate: string
  continuedFinalInspectionTime: string
  warrantyPeriodYears: string
  warrantyEndDate: string
  warrantyScope: string
  defaultRemedyDeadline: string
  afterInspectionRequested: string
  afterInspectionRequestedBy: string
  afterInspectionDueDate: string
  afterInspectionNoticeInReport: boolean
  inspectionCostDistribution: string
  reportDistributionDate: string
  previousInspections: EbPreviousInspectionItem[]
}

type InspectionUpdateResponse = {
  error?: string
}

type ReportDraftResponse = {
  report?: EbInspectionReport
  error?: string
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function buildStructuredReportForm(
  inspection: EbInspectionReport['inspection']
): StructuredReportFormState {
  return {
    inspectorAppointedBy: inspection.inspectorAppointedBy ?? '',
    invitationMethod: inspection.invitationMethod ?? '',
    invitationDate: inspection.invitationDate ?? '',
    approvalStatus: inspection.approvalStatus ?? '',
    approvalNote: inspection.approvalNote ?? '',
    requiresContinuedFinalInspection:
      typeof inspection.requiresContinuedFinalInspection === 'boolean'
        ? String(inspection.requiresContinuedFinalInspection)
        : '',
    continuedFinalInspectionDate: inspection.continuedFinalInspectionDate ?? '',
    continuedFinalInspectionTime: inspection.continuedFinalInspectionTime?.slice(0, 5) ?? '',
    warrantyPeriodYears: inspection.warrantyPeriodYears ? String(inspection.warrantyPeriodYears) : '',
    warrantyEndDate: inspection.warrantyEndDate ?? '',
    warrantyScope: inspection.warrantyScope ?? '',
    defaultRemedyDeadline: inspection.defaultRemedyDeadline ?? '',
    afterInspectionRequested:
      typeof inspection.afterInspectionRequested === 'boolean'
        ? String(inspection.afterInspectionRequested)
        : '',
    afterInspectionRequestedBy: inspection.afterInspectionRequestedBy ?? '',
    afterInspectionDueDate: inspection.afterInspectionDueDate ?? '',
    afterInspectionNoticeInReport: inspection.afterInspectionNoticeInReport,
    inspectionCostDistribution: inspection.inspectionCostDistribution ?? '',
    reportDistributionDate: inspection.reportDistributionDate ?? todayInputValue(),
    previousInspections: inspection.previousInspections,
  }
}

function booleanFromSelect(value: string) {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function fieldClassName() {
  return 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
}

function fieldLabel(label: string, children: ReactNode) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function invitationMethodOption(value: string) {
  const normalized = value.trim().toLocaleLowerCase('sv-SE')
  return INVITATION_METHOD_OPTIONS.find((option) => option.toLocaleLowerCase('sv-SE') === normalized)
}

function InvitationMethodField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const selectedOption = value ? invitationMethodOption(value) : null
  const isCustom = customOpen || Boolean(value && !selectedOption)

  return (
    <div className="space-y-2">
      <select
        value={isCustom ? '__custom__' : selectedOption ?? ''}
        onChange={(event) => {
          if (event.target.value === '__custom__') {
            setCustomOpen(true)
            return
          }
          setCustomOpen(false)
          onChange(event.target.value)
        }}
        className={fieldClassName()}
      >
        <option value="">Ej satt</option>
        {INVITATION_METHOD_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="__custom__">Annat</option>
      </select>
      {isCustom ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ange kallelsemetod"
          className={fieldClassName()}
        />
      ) : null}
    </div>
  )
}

function PreviousInspectionsEditor({
  rows,
  onChange,
}: {
  rows: EbPreviousInspectionItem[]
  onChange: (rows: EbPreviousInspectionItem[]) => void
}) {
  const updateRow = <K extends keyof EbPreviousInspectionItem>(
    index: number,
    field: K,
    value: EbPreviousInspectionItem[K]
  ) => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
  }

  return (
    <div className="md:col-span-2 xl:col-span-4">
      <h3 className="text-sm font-semibold text-gray-950">Tidigare besiktningar</h3>
      <div className="mt-2 grid gap-2">
        {rows.map((row, index) => (
          <div key={row.key} className="grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 md:grid-cols-[1fr_9rem_10rem]">
            <input
              value={row.label}
              onChange={(event) => updateRow(index, 'label', event.target.value)}
              className={fieldClassName()}
            />
            <select
              value={row.status ?? ''}
              onChange={(event) =>
                updateRow(index, 'status', (event.target.value || null) as EbPreviousInspectionItem['status'])
              }
              className={fieldClassName()}
            >
              <option value="">Ej satt</option>
              {PREVIOUS_INSPECTION_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={row.date ?? ''}
              onChange={(event) => updateRow(index, 'date', event.target.value || null)}
              className={fieldClassName()}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function EbInspectionReportDraftClient({ initialReport }: Props) {
  const [sections, setSections] = useState(initialReport.reportDraft.sections)
  const [structuredForm, setStructuredForm] = useState<StructuredReportFormState>(() =>
    buildStructuredReportForm(initialReport.inspection)
  )
  const [activeKey, setActiveKey] = useState(sections[0]?.key ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isStructuredPending, startStructuredTransition] = useTransition()

  const activeSection = useMemo(
    () => sections.find((section) => section.key === activeKey) ?? sections[0] ?? null,
    [activeKey, sections]
  )

  const completeCount = sections.filter((section) => section.status === 'complete').length
  const missingCount = sections.filter((section) => section.status === 'missing').length

  function updateActiveSection(patch: Partial<EbReportDraftSection>) {
    if (!activeSection) return
    setDraftDirty(true)
    setSections((current) =>
      current.map((section) => (section.key === activeSection.key ? { ...section, ...patch } : section))
    )
  }

  function updateStructuredField<K extends keyof StructuredReportFormState>(
    field: K,
    value: StructuredReportFormState[K]
  ) {
    setStructuredForm((current) => ({ ...current, [field]: value }))
  }

  function saveDraft() {
    setMessage(null)
    startTransition(async () => {
      const response = await fetch(
        `/api/eb/projects/${initialReport.project.id}/inspections/${initialReport.inspection.inspectionId}/report-draft`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sections }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as {
        reportDraft?: { sections?: EbReportDraftSection[] }
        error?: string
      }
      if (!response.ok) {
        setMessage(payload.error ?? 'Kunde inte spara utlåtandeutkastet.')
        return
      }
      if (payload.reportDraft?.sections) {
        setSections(payload.reportDraft.sections)
      }
      setDraftDirty(false)
      setMessage('Utlåtandeutkastet är sparat.')
    })
  }

  function saveStructuredFields() {
    if (draftDirty) {
      setMessage('Spara utlåtandetexten innan du sparar utlåtandeuppgifter.')
      return
    }

    setMessage(null)
    startStructuredTransition(async () => {
      const updateResponse = await fetch(
        `/api/eb/projects/${initialReport.project.id}/inspections/${initialReport.inspection.inspectionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...structuredForm,
            requiresContinuedFinalInspection: booleanFromSelect(
              structuredForm.requiresContinuedFinalInspection
            ),
            warrantyPeriodYears: structuredForm.warrantyPeriodYears
              ? Number(structuredForm.warrantyPeriodYears)
              : null,
            afterInspectionRequested: booleanFromSelect(structuredForm.afterInspectionRequested),
          }),
        }
      )
      const updatePayload = (await updateResponse.json().catch(() => ({}))) as InspectionUpdateResponse
      if (!updateResponse.ok) {
        setMessage(updatePayload.error ?? 'Kunde inte spara utlåtandeuppgifter.')
        return
      }

      const reportResponse = await fetch(
        `/api/eb/projects/${initialReport.project.id}/inspections/${initialReport.inspection.inspectionId}/report-draft`
      )
      const reportPayload = (await reportResponse.json().catch(() => ({}))) as ReportDraftResponse
      if (!reportResponse.ok || !reportPayload.report) {
        setMessage(reportPayload.error ?? 'Uppgifterna sparades, men utlåtandeutkastet kunde inte laddas om.')
        return
      }

      setSections(reportPayload.report.reportDraft.sections)
      setStructuredForm(buildStructuredReportForm(reportPayload.report.inspection))
      setDraftDirty(false)
      setMessage('Utlåtandeuppgifterna är sparade och utkastet är uppdaterat.')
    })
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/eb/projects/${initialReport.project.id}/inspections/${initialReport.inspection.inspectionId}/report`}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Till utlåtande
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/eb/projects/${initialReport.project.id}/inspections/${initialReport.inspection.inspectionId}/perform`}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              <FileText size={16} />
              Granska
            </Link>
            <button
              type="button"
              onClick={saveDraft}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={16} />
              {isPending ? 'Sparar' : 'Spara'}
            </button>
          </div>
        </div>

        <header className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-800">Utlåtandeutkast</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{initialReport.project.title}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {initialReport.inspection.variantLabel} {initialReport.inspection.sequenceNo}
              </p>
            </div>
            <div className="flex gap-2 text-sm">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">
                {completeCount} klara
              </span>
              <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 font-semibold text-rose-800">
                {missingCount} saknas
              </span>
            </div>
          </div>
          {message ? <p className="mt-3 text-sm font-medium text-gray-700">{message}</p> : null}
        </header>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                Utlåtandeuppgifter
              </p>
              <h2 className="mt-1 text-lg font-bold text-gray-950">Beslut och formella datum</h2>
              <p className="mt-1 max-w-3xl text-sm text-gray-600">
                Dessa fält styr flera avsnitt i utlåtandet och sparas på besiktningen.
              </p>
            </div>
            <button
              type="button"
              onClick={saveStructuredFields}
              disabled={isStructuredPending}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={16} />
              {isStructuredPending ? 'Sparar' : 'Spara uppgifter'}
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {fieldLabel(
              'Besiktningsman utsedd av',
              <select
                value={structuredForm.inspectorAppointedBy}
                onChange={(event) => updateStructuredField('inspectorAppointedBy', event.target.value)}
                className={fieldClassName()}
              >
                <option value="">Ej satt</option>
                <option value="client">Beställare</option>
                <option value="parties_jointly">Parterna gemensamt</option>
                <option value="contractor">Entreprenör</option>
              </select>
            )}
            {fieldLabel(
              'Beslut',
              <select
                value={structuredForm.approvalStatus}
                onChange={(event) => updateStructuredField('approvalStatus', event.target.value)}
                className={fieldClassName()}
              >
                <option value="">Ej satt</option>
                <option value="approved">Godkänd</option>
                <option value="not_approved">Ej godkänd</option>
                <option value="partly_approved">Delvis godkänd</option>
              </select>
            )}
            {fieldLabel(
              'Kallelsemetod',
              <InvitationMethodField
                value={structuredForm.invitationMethod}
                onChange={(value) => updateStructuredField('invitationMethod', value)}
              />
            )}
            {fieldLabel(
              'Kallelsedatum',
              <input
                type="date"
                value={structuredForm.invitationDate}
                onChange={(event) => updateStructuredField('invitationDate', event.target.value)}
                className={fieldClassName()}
              />
            )}
            <PreviousInspectionsEditor
              rows={structuredForm.previousInspections}
              onChange={(rows) => updateStructuredField('previousInspections', rows)}
            />
            <div className="md:col-span-2 xl:col-span-4">
              {fieldLabel(
                'Beslutets motivering',
                <textarea
                  value={structuredForm.approvalNote}
                  onChange={(event) => updateStructuredField('approvalNote', event.target.value)}
                  rows={3}
                  className={`${fieldClassName()} leading-6`}
                />
              )}
            </div>
            {fieldLabel(
              'Fortsatt slutbesiktning',
              <select
                value={structuredForm.requiresContinuedFinalInspection}
                onChange={(event) =>
                  updateStructuredField('requiresContinuedFinalInspection', event.target.value)
                }
                className={fieldClassName()}
              >
                <option value="">Ej satt</option>
                <option value="true">Ja</option>
                <option value="false">Nej</option>
              </select>
            )}
            {structuredForm.requiresContinuedFinalInspection === 'true' ? (
              <>
                {fieldLabel(
                  'Ny slutbesiktning datum',
                  <input
                    type="date"
                    value={structuredForm.continuedFinalInspectionDate}
                    onChange={(event) =>
                      updateStructuredField('continuedFinalInspectionDate', event.target.value)
                    }
                    className={fieldClassName()}
                  />
                )}
                {fieldLabel(
                  'Ny slutbesiktning tid',
                  <input
                    type="time"
                    value={structuredForm.continuedFinalInspectionTime}
                    onChange={(event) =>
                      updateStructuredField('continuedFinalInspectionTime', event.target.value)
                    }
                    className={fieldClassName()}
                  />
                )}
              </>
            ) : null}
            {fieldLabel(
              'Garantitid',
              <select
                value={structuredForm.warrantyPeriodYears}
                onChange={(event) => updateStructuredField('warrantyPeriodYears', event.target.value)}
                className={fieldClassName()}
              >
                <option value="">Ej satt</option>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((year) => (
                  <option key={year} value={year}>
                    {year} år
                  </option>
                ))}
              </select>
            )}
            {fieldLabel(
              'Garantitidens slut',
              <input
                type="date"
                value={structuredForm.warrantyEndDate}
                onChange={(event) => updateStructuredField('warrantyEndDate', event.target.value)}
                className={fieldClassName()}
              />
            )}
            {fieldLabel(
              'Särskild varugaranti för',
              <input
                value={structuredForm.warrantyScope}
                onChange={(event) => updateStructuredField('warrantyScope', event.target.value)}
                placeholder="Exempel: vara, produkt eller material"
                className={fieldClassName()}
              />
            )}
            {fieldLabel(
              'Fel avhjälpta senast',
              <input
                type="date"
                value={structuredForm.defaultRemedyDeadline}
                onChange={(event) => updateStructuredField('defaultRemedyDeadline', event.target.value)}
                className={fieldClassName()}
              />
            )}
            {fieldLabel(
              'Efterbesiktning påkallad',
              <select
                value={structuredForm.afterInspectionRequested}
                onChange={(event) => updateStructuredField('afterInspectionRequested', event.target.value)}
                className={fieldClassName()}
              >
                <option value="">Ej satt</option>
                <option value="true">Ja</option>
                <option value="false">Nej</option>
              </select>
            )}
            {fieldLabel(
              'Efterbesiktning påkallad av',
              <select
                value={structuredForm.afterInspectionRequestedBy}
                onChange={(event) =>
                  updateStructuredField('afterInspectionRequestedBy', event.target.value)
                }
                className={fieldClassName()}
              >
                <option value="">Ej satt</option>
                <option value="client">Beställare</option>
                <option value="contractor">Hantverkare</option>
              </select>
            )}
            {fieldLabel(
              'Efterbesiktning senast',
              <input
                type="date"
                value={structuredForm.afterInspectionDueDate}
                onChange={(event) => updateStructuredField('afterInspectionDueDate', event.target.value)}
                className={fieldClassName()}
              />
            )}
            {fieldLabel(
              'Distributionsdatum',
              <input
                type="date"
                value={structuredForm.reportDistributionDate}
                onChange={(event) => updateStructuredField('reportDistributionDate', event.target.value)}
                className={fieldClassName()}
              />
            )}
            <div className="md:col-span-2 xl:col-span-4">
              {fieldLabel(
                'Besiktningskostnadens fördelning',
                <textarea
                  value={structuredForm.inspectionCostDistribution}
                  onChange={(event) =>
                    updateStructuredField('inspectionCostDistribution', event.target.value)
                  }
                  rows={3}
                  placeholder="Exempel: Kostnaden för besiktningen betalas av beställaren."
                  className={`${fieldClassName()} leading-6`}
                />
              )}
            </div>
            <label className="flex min-h-[4.1rem] items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm font-medium text-emerald-900">
              <input
                type="checkbox"
                checked={structuredForm.afterInspectionNoticeInReport}
                onChange={(event) =>
                  updateStructuredField('afterInspectionNoticeInReport', event.target.checked)
                }
                className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
              />
              Utlåtandet gäller som kallelse till efterbesiktning
            </label>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
            <div className="max-h-[calc(100vh-15rem)] overflow-auto">
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setActiveKey(section.key)}
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition ${
                    section.key === activeSection?.key ? 'bg-emerald-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full border text-xs font-bold ${
                      statusClasses[section.status]
                    }`}
                  >
                    {section.status === 'complete' ? <Check size={13} /> : section.sbrPoint ?? '-'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-gray-950">{section.title}</span>
                    <span className="mt-1 block text-xs text-gray-500">
                      {section.sbrPoint ? `SBR punkt ${section.sbrPoint} · ` : ''}
                      {sourceLabels[section.source]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {activeSection ? (
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                    {activeSection.sbrPoint ? `SBR punkt ${activeSection.sbrPoint}` : 'Utlåtande'}
                  </p>
                  <h2 className="mt-1 text-xl font-bold">{activeSection.title}</h2>
                  <p className="mt-1 text-sm text-gray-500">Källa: {sourceLabels[activeSection.source]}</p>
                  <p className="mt-2 max-w-2xl rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {sourceHints[activeSection.source]}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={activeSection.isRelevant}
                      onChange={(event) =>
                        updateActiveSection({
                          isRelevant: event.target.checked,
                          status: event.target.checked ? 'draft' : 'not_applicable',
                        })
                      }
                    />
                    Relevant
                  </label>
                  <select
                    value={activeSection.status}
                    onChange={(event) =>
                      updateActiveSection({ status: event.target.value as EbReportSectionStatus })
                    }
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold"
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <textarea
                value={activeSection.text}
                onChange={(event) => updateActiveSection({ text: event.target.value })}
                rows={18}
                className="mt-5 w-full rounded-lg border border-gray-300 bg-white p-4 text-sm leading-6 text-gray-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </section>
          ) : null}
        </div>
      </div>
    </main>
  )
}

