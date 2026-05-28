'use client'

import Link from 'next/link'
import { ExternalLink, Pencil, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import ObStepAreamatning from './ObStepAreamatning'
import ObStepForutsattningar from './ObStepForutsattningar'
import ObStepFuktkontroll from './ObStepFuktkontroll'
import ObStepGrunddata from './ObStepGrunddata'
import ObStepHandlingar from './ObStepHandlingar'
import ObStepInsida from './ObStepInsida'
import ObStepUtsida from './ObStepUtsida'
import type {
  ObSectionKey,
  ObWizardInspection,
  ObWizardProperty,
} from './ObWizard'

type EditableReviewTarget =
  | 'grunddata'
  | 'handlingar'
  | 'forutsattningar'
  | 'utsida'
  | 'insida'
  | 'areamatning'
  | 'fuktkontroll'

type ReviewSection = {
  id: string
  title: string
  subtitle: string
  target: EditableReviewTarget | null
}

type ObStepGranskaProps = {
  property: ObWizardProperty
  inspection: ObWizardInspection
  availableSections: ObSectionKey[]
  onPropertyUpdated?: (property: ObWizardProperty) => void
  onInspectionUpdated?: (inspection: ObWizardInspection) => void
  onInspectionAddonSelectionChanged?: (selectedAddonKeys: string[]) => void
  onSectionChange?: (section: ObSectionKey) => void
}

const EDITABLE_TARGET_LABELS: Record<EditableReviewTarget, string> = {
  grunddata: 'Grunddata',
  handlingar: 'Handlingar',
  forutsattningar: 'Förutsättningar',
  utsida: 'Byggnad - utsida',
  insida: 'Byggnad - insida',
  areamatning: 'Areamätning',
  fuktkontroll: 'Fuktkontroll',
}

function isApartmentInspection(inspection: ObWizardInspection) {
  return String(inspection.inspection_side ?? '').trim().toLowerCase() === 'apartment'
}

export default function ObStepGranska({
  property,
  inspection,
  availableSections,
  onPropertyUpdated,
  onInspectionUpdated,
  onInspectionAddonSelectionChanged,
  onSectionChange,
}: ObStepGranskaProps) {
  const [activeReviewSectionId, setActiveReviewSectionId] = useState('assignment')
  const [previewVersion, setPreviewVersion] = useState(0)
  const availableSectionSet = useMemo(
    () => new Set<ObSectionKey>(availableSections),
    [availableSections]
  )
  const apartmentInspection = isApartmentInspection(inspection)

  const reportSections = useMemo<ReviewSection[]>(() => {
    const sections: ReviewSection[] = [
      {
        id: 'cover',
        title: 'Omslag',
        subtitle: 'Objekt, uppdragsnummer, datum och besiktningsman.',
        target: 'grunddata',
      },
      {
        id: 'assignment',
        title: apartmentInspection ? 'Uppdraget' : 'Överlåtelsebesiktning',
        subtitle: 'Beställare, objekt, omfattning och grunduppgifter.',
        target: 'grunddata',
      },
      {
        id: 'documents',
        title: 'Handlingar och upplysningar',
        subtitle: 'Tillhandahållna handlingar, säljarupplysningar och kända fel.',
        target: 'handlingar',
      },
      {
        id: 'conditions',
        title: 'Förutsättningar',
        subtitle: 'Väder, möblering, åtkomst och övriga besiktningsförutsättningar.',
        target: 'forutsattningar',
      },
    ]

    if (availableSectionSet.has('utsida')) {
      sections.push({
        id: 'notes-exterior',
        title: 'Noteringar - Byggnad utsida',
        subtitle: 'Utvändiga noteringar, riskanalys, FTU och bilder.',
        target: 'utsida',
      })
    }

    sections.push({
      id: 'notes-interior',
      title: apartmentInspection
        ? 'Noteringar - Lägenhet insida'
        : 'Noteringar - Byggnad insida',
      subtitle: 'Invändiga noteringar, riskanalys, FTU och bilder.',
      target: 'insida',
    })

    if (availableSectionSet.has('areamatning')) {
      sections.push({
        id: 'area-measurement',
        title: 'Bilaga - Areamätning',
        subtitle: 'Mätuppgifter, resultat och sammanfattning.',
        target: 'areamatning',
      })
    }

    if (availableSectionSet.has('fuktkontroll')) {
      sections.push({
        id: 'moisture-control',
        title: 'Bilaga - Fuktkontroll',
        subtitle: 'Mätpunkter, bedömning och bilder.',
        target: 'fuktkontroll',
      })
    }

    sections.push({
      id: 'appendices',
      title: 'Villkor och bilagor',
      subtitle: 'Standardbilagor och automatiskt innehåll i utlåtandet.',
      target: null,
    })

    return sections
  }, [apartmentInspection, availableSectionSet])

  const activeReviewSection =
    reportSections.find((section) => section.id === activeReviewSectionId) ??
    reportSections[0]
  const reportHref =
    property.id && inspection.id ? `/utlatande/${property.id}/${inspection.id}` : null
  const iframeSrc = reportHref
    ? `${reportHref}?embed=1&review=${previewVersion}`
    : null

  function renderEditor(target: EditableReviewTarget | null) {
    if (!target) {
      return (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-600">
          Den här delen skapas automatiskt från utlåtandemallen och har ingen egen
          redigeringsyta.
        </div>
      )
    }

    switch (target) {
      case 'grunddata':
        return (
          <ObStepGrunddata
            property={property}
            inspection={inspection}
            onPropertyUpdated={onPropertyUpdated}
            onInspectionUpdated={onInspectionUpdated}
            onInspectionAddonSelectionChanged={onInspectionAddonSelectionChanged}
          />
        )
      case 'handlingar':
        return <ObStepHandlingar property={property} inspection={inspection} />
      case 'forutsattningar':
        return <ObStepForutsattningar property={property} inspection={inspection} />
      case 'utsida':
        return <ObStepUtsida inspection={inspection} />
      case 'insida':
        return <ObStepInsida inspection={inspection} />
      case 'areamatning':
        return <ObStepAreamatning property={property} inspection={inspection} />
      case 'fuktkontroll':
        return <ObStepFuktkontroll property={property} inspection={inspection} />
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-8rem)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
      <section className="min-w-0 rounded-2xl border border-white/55 bg-white/95 p-3 shadow-xl ring-1 ring-black/5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
              Förhandsgranskning
            </p>
            <h2 className="text-lg font-semibold text-gray-950">Utlåtande</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewVersion((version) => version + 1)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
            >
              <RefreshCw size={15} />
              Uppdatera
            </button>
            {reportHref ? (
              <Link
                href={reportHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                <ExternalLink size={15} />
                Ny flik
              </Link>
            ) : null}
          </div>
        </div>

        {iframeSrc ? (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
            <iframe
              key={iframeSrc}
              title="Utlåtande för granskning"
              src={iframeSrc}
              className="block w-full bg-white"
              style={{ minHeight: 'calc(100vh - 14rem)', border: 0 }}
            />
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Utlåtandet kan inte förhandsgranskas innan fastighet och besiktning är valda.
          </div>
        )}
      </section>

      <aside className="min-w-0 rounded-2xl border border-white/55 bg-white/95 shadow-xl ring-1 ring-black/5 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-hidden">
        <div className="border-b border-gray-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Granska
          </p>
          <h2 className="text-lg font-semibold text-gray-950">Redigera i rapportordning</h2>
        </div>

        <div className="grid gap-0 xl:max-h-[calc(100vh-7rem)] xl:grid-rows-[auto_minmax(0,1fr)]">
          <nav className="border-b border-gray-200 p-3">
            <div className="grid max-h-64 gap-2 overflow-auto pr-1">
              {reportSections.map((section, index) => {
                const isActive = section.id === activeReviewSection?.id
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveReviewSectionId(section.id)}
                    className={`grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 rounded-lg px-3 py-2 text-left transition ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/10'
                        : 'bg-gray-50 text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        isActive ? 'bg-white/20 text-white' : 'bg-white text-gray-500'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{section.title}</span>
                      <span
                        className={`mt-0.5 block truncate text-xs ${
                          isActive ? 'text-white/80' : 'text-gray-500'
                        }`}
                      >
                        {section.target ? EDITABLE_TARGET_LABELS[section.target] : 'Automatiskt'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </nav>

          <div className="min-h-0 overflow-auto p-4">
            {activeReviewSection ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-gray-950">
                        {activeReviewSection.title}
                      </h3>
                      <p className="mt-1 text-sm text-gray-600">
                        {activeReviewSection.subtitle}
                      </p>
                    </div>
                    {activeReviewSection.target && onSectionChange ? (
                      <button
                        type="button"
                        onClick={() => {
                          const target = activeReviewSection.target
                          if (target) onSectionChange(target)
                        }}
                        className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
                      >
                        <Pencil size={15} />
                        Hel flik
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0">{renderEditor(activeReviewSection.target)}</div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  )
}
