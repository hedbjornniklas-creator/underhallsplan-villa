'use client'

import Link from 'next/link'
import { ArrowLeft, Check, FileText, Save } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import type { EbInspectionReport, EbReportDraftSection, EbReportSectionStatus } from '@/lib/eb/server'

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
  standard_text: 'Standardtext',
  manual: 'Manuell',
}

const sourceHints: Record<EbReportDraftSection['source'], string> = {
  project: 'Grunduppgifter fylls i via Redigera entreprenad på entreprenadsidan.',
  inspection: 'Besiktningsuppgifter fylls i när besiktningen skapas, i kallelsen eller i runda/granska.',
  participants: 'Parter, mottagare och närvarande hanteras i kallelsedialogen.',
  notes: 'Noteringar, beteckningar och bilder hanteras i Granska eller mobil runda.',
  standard_text: 'Texten är standardtext för utlåtandet och justeras här innan utskrift.',
  manual: 'Denna punkt fylls i här i utlåtandeutkastet.',
}

export default function EbInspectionReportDraftClient({ initialReport }: Props) {
  const [sections, setSections] = useState(initialReport.reportDraft.sections)
  const [activeKey, setActiveKey] = useState(sections[0]?.key ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const activeSection = useMemo(
    () => sections.find((section) => section.key === activeKey) ?? sections[0] ?? null,
    [activeKey, sections]
  )

  const completeCount = sections.filter((section) => section.status === 'complete').length
  const missingCount = sections.filter((section) => section.status === 'missing').length

  function updateActiveSection(patch: Partial<EbReportDraftSection>) {
    if (!activeSection) return
    setSections((current) =>
      current.map((section) => (section.key === activeSection.key ? { ...section, ...patch } : section))
    )
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
      setMessage('Utlåtandeutkastet är sparat.')
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

