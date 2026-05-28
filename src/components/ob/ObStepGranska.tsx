'use client'

import { Pencil, X } from 'lucide-react'
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
  eyebrow: string
  body: string
  target: EditableReviewTarget | null
  summary: string[]
}

type ObStepGranskaProps = {
  property: ObWizardProperty
  inspection: ObWizardInspection
  availableSections: ObSectionKey[]
  onPropertyUpdated?: (property: ObWizardProperty) => void
  onInspectionUpdated?: (inspection: ObWizardInspection) => void
  onInspectionAddonSelectionChanged?: (selectedAddonKeys: string[]) => void
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

function textOrDash(value: unknown) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : '--'
}

function joinAddress(parts: Array<string | null | undefined>) {
  const line = parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return line || '--'
}

function formatInspectionSide(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'seller') return 'Säljare'
  if (normalized === 'apartment') return 'Lägenhet'
  return 'Köpare'
}

export default function ObStepGranska({
  property,
  inspection,
  availableSections,
  onPropertyUpdated,
  onInspectionUpdated,
  onInspectionAddonSelectionChanged,
}: ObStepGranskaProps) {
  const [activeTarget, setActiveTarget] = useState<EditableReviewTarget | null>(null)
  const availableSectionSet = useMemo(
    () => new Set<ObSectionKey>(availableSections),
    [availableSections]
  )
  const apartmentInspection = isApartmentInspection(inspection)

  const reportSections = useMemo<ReviewSection[]>(() => {
    const sections: ReviewSection[] = [
      {
        id: 'cover',
        eyebrow: 'Omslag',
        title: 'Utlåtandets grunduppgifter',
        body:
          'Det här motsvarar de uppgifter som läsaren möter först: objekt, uppdrag, datum och besiktningsman.',
        target: 'grunddata',
        summary: [
          `Uppdrag: ${textOrDash(inspection.assignment_number)}`,
          `Besiktningsdatum: ${textOrDash(inspection.date)}`,
          `Roll: ${formatInspectionSide(inspection.inspection_side)}`,
          `Besiktningsman: ${textOrDash(inspection.inspector_name)}`,
        ],
      },
      {
        id: 'assignment',
        eyebrow: apartmentInspection ? 'Uppdraget' : 'Överlåtelsebesiktning',
        title: textOrDash(property.name),
        body:
          'Objekt, beställare och omfattning samlas här eftersom de styr flera delar av utlåtandet.',
        target: 'grunddata',
        summary: [
          `Adress: ${joinAddress([property.address, property.postal_code, property.city])}`,
          `Fastighetsbeteckning: ${textOrDash(property.cadastral_id)}`,
          `Beställare: ${textOrDash(property.customer_name ?? inspection.client_name)}`,
          `Omfattning: ${textOrDash(inspection.scope)}`,
        ],
      },
      {
        id: 'documents',
        eyebrow: 'Handlingar och upplysningar',
        title: 'Handlingar, uppgifter och kända fel',
        body:
          'Här redigeras underlag och upplysningar som senare redovisas före noteringarna i utlåtandet.',
        target: 'handlingar',
        summary: [
          `Upplysningar: ${textOrDash(inspection.defect_disclosures)}`,
          'Handlingar redigeras i panelen.',
        ],
      },
      {
        id: 'conditions',
        eyebrow: 'Förutsättningar',
        title: 'Besiktningens förutsättningar',
        body:
          'Förutsättningarna beskriver väder, möblering, åtkomst och andra val som påverkar bedömningen.',
        target: 'forutsattningar',
        summary: [
          `Byggnadstyp: ${textOrDash(property.dwelling_type)}`,
          `Byggnadsår: ${textOrDash(property.year_built)}`,
          `Uppvärmning: ${textOrDash(property.heating)}`,
          `Ventilation: ${textOrDash(property.ventilation)}`,
        ],
      },
    ]

    if (availableSectionSet.has('utsida')) {
      sections.push({
        id: 'notes-exterior',
        eyebrow: 'Noteringar',
        title: 'Byggnad - utsida',
        body:
          'Utvändiga komponenter, kontrollpunkter, fria noteringar, riskanalys, FTU och bilder.',
        target: 'utsida',
        summary: ['Mark', 'Grundmur / Sockel', 'Fasad', 'Yttertak', 'Övrigt'],
      })
    }

    sections.push({
      id: 'notes-interior',
      eyebrow: 'Noteringar',
      title: apartmentInspection ? 'Lägenhet - insida' : 'Byggnad - insida',
      body:
        'Invändiga rum och byggdelar med noteringar, riskanalys, FTU och bilder i samma del som utlåtandet.',
      target: 'insida',
      summary: apartmentInspection
        ? ['Entré', 'Kök', 'Våtrum', 'Rum', 'Övrigt']
        : ['Plan och rum', 'Kontrollpunkter', 'Bilder', 'Risk/FTU'],
    })

    if (availableSectionSet.has('areamatning')) {
      sections.push({
        id: 'area-measurement',
        eyebrow: 'Bilaga',
        title: 'Areamätning',
        body:
          'Mätuppgifter, resultat och sammanfattning visas i bilagan men redigeras från samma granskningsflöde.',
        target: 'areamatning',
        summary: [
          `Objekt: ${joinAddress([property.address, property.city])}`,
          `Uppdrag: ${textOrDash(inspection.assignment_number)}`,
        ],
      })
    }

    if (availableSectionSet.has('fuktkontroll')) {
      sections.push({
        id: 'moisture-control',
        eyebrow: 'Bilaga',
        title: 'Fuktkontroll',
        body:
          'Fuktindikering, mätpunkter, bedömning och bilder visas som egen bilaga i utlåtandet.',
        target: 'fuktkontroll',
        summary: [
          `Objekt: ${joinAddress([property.address, property.city])}`,
          `Uppdrag: ${textOrDash(inspection.assignment_number)}`,
        ],
      })
    }

    sections.push({
      id: 'appendices',
      eyebrow: 'Bilagor',
      title: 'Villkor och standardbilagor',
      body:
        'Denna del skapas från utlåtandemallen och standardtexter. Den är med här för att ordningen ska kännas komplett.',
      target: null,
      summary: ['Bilaga 1', 'Byggordbok', 'Livslängdstabell'],
    })

    return sections
  }, [apartmentInspection, availableSectionSet, inspection, property])

  const activeSection =
    activeTarget === null
      ? null
      : reportSections.find((section) => section.target === activeTarget) ?? null

  function closePanel() {
    setActiveTarget(null)
  }

  function renderEditor(target: EditableReviewTarget) {
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

  const panelContent = activeTarget ? (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 md:px-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
            Redigera
          </p>
          <h2 className="text-lg font-semibold text-gray-950">
            {activeSection?.title ?? EDITABLE_TARGET_LABELS[activeTarget]}
          </h2>
        </div>
        <button
          type="button"
          onClick={closePanel}
          aria-label="Stäng"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-700 transition hover:bg-gray-100"
        >
          <X size={20} strokeWidth={2.25} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3 md:p-5">
        {renderEditor(activeTarget)}
      </div>
    </div>
  ) : null

  return (
    <div className="min-h-[calc(100vh-8rem)] w-full min-w-0 max-w-full">
      <div className="mx-auto w-full max-w-[1480px] space-y-4">
        <section className="rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-xl ring-1 ring-black/5 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Granska
          </p>
          <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-950">Utlåtandet i arbetsordning</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
                Alla redigerbara delar ligger i samma ordning som de hör hemma i utlåtandet.
                Klicka på en del för att öppna redigering i sidopanelen.
              </p>
            </div>
            <div className="text-sm font-medium text-gray-500">
              {reportSections.length} delar
            </div>
          </div>
        </section>

        <section className="space-y-3">
          {reportSections.map((section, index) => (
            <article
              key={section.id}
              className="grid gap-4 rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-sm ring-1 ring-black/5 md:grid-cols-[7.5rem_minmax(0,1fr)_auto] md:items-start md:p-5"
            >
              <div>
                <div className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-indigo-50 px-3 text-sm font-bold text-indigo-700">
                  {index + 1}
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                  {section.eyebrow}
                </p>
              </div>

              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-950">{section.title}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{section.body}</p>
                {section.summary.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {section.summary.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex md:justify-end">
                {section.target ? (
                  <button
                    type="button"
                    onClick={() => setActiveTarget(section.target)}
                    className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    <Pencil size={15} />
                    Redigera
                  </button>
                ) : (
                  <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-500">
                    Automatiskt
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
      </div>

      {activeTarget && panelContent ? (
        <>
          <div className="fixed inset-0 z-50 hidden bg-black/20 lg:block" onClick={closePanel} />
          <aside className="fixed inset-y-0 right-0 z-50 hidden w-full max-w-[1440px] border-l border-gray-200 bg-white shadow-2xl lg:flex lg:flex-col">
            {panelContent}
          </aside>
          <section className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
            {panelContent}
          </section>
        </>
      ) : null}
    </div>
  )
}
