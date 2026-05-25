'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, FileText, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EbInspectionReport, EbNote, EbNoteImage } from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'

type EbInspectionReportViewProps = {
  report: EbInspectionReport
}

function sortNotes(notes: EbNote[]) {
  return [...notes].sort((left, right) => {
    if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) {
      return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    }
    if ((left.noteNumber ?? 0) !== (right.noteNumber ?? 0)) {
      return (left.noteNumber ?? 0) - (right.noteNumber ?? 0)
    }
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function sortImages(images: EbNoteImage[]) {
  return [...images].sort((left, right) => {
    if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) {
      return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    }
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function detailLine(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(', ') || '-'
}

function reportValue(value: string | null | undefined) {
  return value?.trim() || '-'
}

function addressCityLine(postalCode: string | null | undefined, city: string | null | undefined) {
  return [postalCode?.trim(), city?.trim()].filter(Boolean).join(' ') || '-'
}

const REPORT_DOCUMENT_TITLE = 'UTLÅTANDE ÖVER SLUTBESIKTNING'
const REPORT_NOTE_APPENDIX_TITLE = 'BILAGA 1 TILL UTLÅTANDE ÖVER SLUTBESIKTNING'
const REPORT_TITLE_HEADING_CLASS_NAME = 'text-[16pt] font-bold uppercase leading-tight text-black'
const REPORT_SECTION_HEADING_CLASS_NAME = 'mb-2 text-[12pt] font-bold leading-tight text-black'
const REPORT_APPENDIX_HEADING_CLASS_NAME = 'mb-3 text-[13pt] font-bold uppercase leading-tight text-black'
const HIDDEN_REPORT_SECTION_KEYS = new Set(['inspection_type', 'notes'])

function normalizeReportText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
}

function parseLabelLine(line: string) {
  const match = line.match(/^([^:]{1,48}):\s*(.*)$/)
  if (!match) return null
  return {
    label: match[1].trim(),
    value: match[2].trim() || '-',
  }
}

function isMissingValue(value: string) {
  return value.trim().toLocaleLowerCase('sv-SE') === 'ej angivet'
}

function isInstructionText(text: string) {
  const normalized = normalizeReportText(text)
  return (
    normalized.startsWith('Ange ') ||
    normalized.includes(' Komplettera ') ||
    normalized.includes('Komplettera om ')
  )
}

function printableReportLines(text: string) {
  if (isInstructionText(text)) return []

  return normalizeReportText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || isMissingValue(line)) return false
      const row = parseLabelLine(line)
      return !row || !isMissingValue(row.value)
    })
}

function hasPrintableReportText(text: string) {
  return printableReportLines(text).length > 0
}

function ReportText({ text }: { text: string }) {
  const blocks = normalizeReportText(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => hasPrintableReportText(block))

  if (blocks.length === 0) return null

  return (
    <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
      {blocks.map((block, blockIndex) => {
        const lines = printableReportLines(block)
        const labelRows = lines.map(parseLabelLine)
        const isDefinitionBlock = labelRows.length > 0 && labelRows.every(Boolean)

        if (isDefinitionBlock) {
          return (
            <dl key={`${blockIndex}-${block}`} className="grid gap-y-1">
              {labelRows.map((row, rowIndex) => row ? (
                <div key={`${row.label}-${rowIndex}`} className="grid grid-cols-[38mm_1fr] gap-x-4">
                  <dt className="font-normal text-black">{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ) : null)}
            </dl>
          )
        }

        return (
          <div key={`${blockIndex}-${block}`} className="space-y-1">
            {lines.map((line, lineIndex) => (
              <p key={`${line}-${lineIndex}`}>{line}</p>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ReportSection({
  title,
  children,
  headingMarker = false,
}: {
  title: string
  children: ReactNode
  headingMarker?: boolean
}) {
  return (
    <section className="eb-report-section break-inside-auto pt-4">
      <h2 className={`${REPORT_SECTION_HEADING_CLASS_NAME} flex items-baseline gap-2`}>
        {headingMarker ? (
          <span
            aria-hidden="true"
            className="inline-block h-0 w-0 border-b-[7px] border-l-[7px] border-b-black border-l-transparent"
          />
        ) : null}
        <span>{title}</span>
      </h2>
      {children}
    </section>
  )
}

function PartyLabel({
  type,
  fallback,
}: {
  type: 'client' | 'contractor'
  fallback: string
}) {
  if (fallback === 'Beställare /(Konsument)' || fallback === 'Hantverkare /(Näringsidkare)') {
    const prefix = type === 'client' ? 'Beställare /' : 'Hantverkare /'
    const role = type === 'client' ? 'Konsument' : 'Näringsidkare'

    return (
      <>
        {prefix}(<em>{role}</em>):
      </>
    )
  }

  return <>{fallback}:</>
}

function ContractPartiesReport({ report }: { report: EbInspectionReport }) {
  const vocabulary = resolveEbAgreementVocabulary(report.project.standardAgreement)

  return (
    <div className="text-[10.5pt] leading-[1.35] text-black">
      <div className="grid grid-cols-[62mm_1fr] gap-x-4">
        <div>Avtalsform:</div>
        <div>{vocabulary.agreementLine}</div>
      </div>

      <div className="mt-2 underline">Parter:</div>

      <dl className="mt-2 grid gap-y-1">
        <div className="grid grid-cols-[62mm_1fr] gap-x-4">
          <dt>
            <PartyLabel type="client" fallback={vocabulary.clientLabel} />
          </dt>
          <dd>{reportValue(report.project.clientName)}</dd>
        </div>
        <div className="grid grid-cols-[62mm_1fr] gap-x-4">
          <dt aria-hidden="true" />
          <dd>{reportValue(report.project.clientAddress)}</dd>
        </div>
        <div className="grid grid-cols-[62mm_1fr] gap-x-4">
          <dt aria-hidden="true" />
          <dd>{addressCityLine(report.project.clientPostalCode, report.project.clientCity)}</dd>
        </div>

        <div className="grid grid-cols-[62mm_1fr] gap-x-4 pt-1">
          <dt>
            <PartyLabel type="contractor" fallback={vocabulary.contractorLabel} />
          </dt>
          <dd>{reportValue(report.project.contractorName)}</dd>
        </div>
        <div className="grid grid-cols-[62mm_1fr] gap-x-4">
          <dt aria-hidden="true" />
          <dd>{reportValue(report.project.contractorAddress)}</dd>
        </div>
        <div className="grid grid-cols-[62mm_1fr] gap-x-4">
          <dt aria-hidden="true" />
          <dd>{addressCityLine(report.project.contractorPostalCode, report.project.contractorCity)}</dd>
        </div>
        <div className="grid grid-cols-[62mm_1fr] gap-x-4">
          <dt aria-hidden="true" />
          <dd>
            Org.nr: {reportValue(report.project.contractorOrgNo)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function reportFieldValue(text: string, label: string) {
  const normalizedLabel = label.toLocaleLowerCase('sv-SE')
  for (const line of printableReportLines(text)) {
    const row = parseLabelLine(line)
    if (row?.label.toLocaleLowerCase('sv-SE') === normalizedLabel) {
      return row.value
    }
  }
  return null
}

function appointedByPhrase(report: EbInspectionReport, sectionText: string) {
  if (report.inspection.inspectorAppointedBy === 'client') {
    return 'utsedd av beställaren'
  }
  if (report.inspection.inspectorAppointedBy === 'parties_jointly') {
    return 'utsedd av parterna gemensamt'
  }
  if (report.inspection.inspectorAppointedBy === 'contractor') {
    const vocabulary = resolveEbAgreementVocabulary(report.project.standardAgreement)
    const contractor = vocabulary.contractorShortLabel.toLocaleLowerCase('sv-SE')
    return contractor.startsWith('hantverk') ? 'utsedd av hantverkaren' : 'utsedd av entreprenören'
  }

  const storedValue = reportFieldValue(sectionText, 'Utsedd av')
  return storedValue ? `utsedd av ${storedValue.toLocaleLowerCase('sv-SE')}` : '-'
}

function InspectorReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  return (
    <ReportSection title={section.title} headingMarker>
      <div className="grid grid-cols-[62mm_34mm_1fr] gap-x-4 text-[10.5pt] leading-[1.35] text-black">
        <div>Besiktningsman:</div>
        <div>{reportFieldValue(section.text, 'Besiktningsman') ?? '-'}</div>
        <div>{appointedByPhrase(report, section.text)}</div>
      </div>
    </ReportSection>
  )
}

function participantName(participant: EbInspectionReport['participants'][number]) {
  return participant.personName?.trim() || participant.companyName?.trim() || '-'
}

function otherParticipantDescription(participant: EbInspectionReport['participants'][number]) {
  return participant.personName?.trim()
    ? detailLine([participant.personName, participant.companyName, participant.roleLabel])
    : detailLine([participant.companyName, participant.roleLabel])
}

function participantLines(participants: EbInspectionReport['participants']) {
  return participants.length > 0 ? participants.map(participantName).join('\n') : '-'
}

function otherParticipantLines(participants: EbInspectionReport['participants']) {
  return participants.length > 0 ? participants.map(otherParticipantDescription).join('\n') : '-'
}

function isParticipantForParty(
  participant: EbInspectionReport['participants'][number],
  party: 'client' | 'contractor'
) {
  if (participant.representsPartyKey === party) return true
  const role = participant.roleLabel?.toLocaleLowerCase('sv-SE') ?? ''
  if (party === 'client') return role.includes('beställ') || role.includes('konsument')
  return role.includes('hantverk') || role.includes('entrepren') || role.includes('näringsidk')
}

function contractorRepresentativeLabel(report: EbInspectionReport) {
  const vocabulary = resolveEbAgreementVocabulary(report.project.standardAgreement)
  const contractor = vocabulary.contractorShortLabel.toLocaleLowerCase('sv-SE')
  return contractor.startsWith('hantverk') ? 'för hantverkaren:' : 'för entreprenören:'
}

function ParticipantsReport({ report }: { report: EbInspectionReport }) {
  const presentParticipants = report.participants.filter((participant) => participant.attended)
  const clientParticipants = presentParticipants.filter((participant) => isParticipantForParty(participant, 'client'))
  const contractorParticipants = presentParticipants.filter((participant) =>
    isParticipantForParty(participant, 'contractor')
  )
  const otherParticipants = presentParticipants.filter(
    (participant) =>
      !isParticipantForParty(participant, 'client') &&
      !isParticipantForParty(participant, 'contractor')
  )

  return (
    <ReportSection title="Närvarande" headingMarker>
      <div className="text-[10.5pt] leading-[1.35] text-black">
        <p className="mb-2">Vid besiktningen var parterna representerade av:</p>
        <dl className="grid gap-y-1">
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt>för beställaren:</dt>
            <dd className="whitespace-pre-wrap">{participantLines(clientParticipants)}</dd>
          </div>
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt>{contractorRepresentativeLabel(report)}</dt>
            <dd className="whitespace-pre-wrap">{participantLines(contractorParticipants)}</dd>
          </div>
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt>Övriga närvarande:</dt>
            <dd className="whitespace-pre-wrap">{otherParticipantLines(otherParticipants)}</dd>
          </div>
        </dl>
      </div>
    </ReportSection>
  )
}

function ReportHeader({ report }: { report: EbInspectionReport }) {
  const propertyDesignation = report.project.propertyDesignation?.trim() || '-'
  const streetAndCity = detailLine([report.project.address, report.project.city])
  const entreprenadDescription = report.project.objectDescription?.trim() || '-'

  return (
    <header className="mb-8">
      <div className="grid min-h-[18mm] grid-cols-[60mm_1fr_60mm] items-start gap-4">
        <div className="flex min-h-[16mm] items-start justify-start">
          {report.branding.inspectorLogoUrl ? (
            <img
              src={report.branding.inspectorLogoUrl}
              alt="Besiktningsmannens logotyp"
              className="h-[16mm] w-auto max-w-[52mm] object-contain"
            />
          ) : null}
        </div>
        <div aria-hidden="true" />
        <div className="flex min-h-[16mm] items-start justify-end">
          <img
            src={report.branding.besiktAppLogoUrl}
            alt="BesiktApp"
            className="h-[16mm] w-auto max-w-[52mm] object-contain"
          />
        </div>
      </div>
      <div className="mt-3 h-[1.5px] w-full bg-[#2f7d55]" />

      <dl className="mt-3 grid gap-y-1 text-[10.5pt] leading-snug text-black">
        <div className="grid grid-cols-[38mm_1fr] gap-x-4">
          <dt className="font-bold">Fastighetsbeteckning</dt>
          <dd>{propertyDesignation}</dd>
        </div>
        <div className="grid grid-cols-[38mm_1fr] gap-x-4">
          <dt className="font-bold">Gatuadress, ort</dt>
          <dd>{streetAndCity}</dd>
        </div>
        <div className="grid grid-cols-[38mm_1fr] gap-x-4">
          <dt className="font-bold">Entreprenad</dt>
          <dd className="whitespace-pre-wrap">{entreprenadDescription}</dd>
        </div>
      </dl>

      <div className="mt-7 text-left">
        <h1 className={REPORT_TITLE_HEADING_CLASS_NAME}>{REPORT_DOCUMENT_TITLE}</h1>
      </div>
    </header>
  )
}

function noteReference(report: EbInspectionReport, note: EbNote, index: number) {
  return `${report.project.notePrefix} ${note.noteNumber ?? index + 1}`
}

function NoteTable({
  report,
  notes,
}: {
  report: EbInspectionReport
  notes: EbNote[]
}) {
  if (notes.length === 0) {
    return <p className="text-[10.5pt] text-black">Inga noteringar registrerade.</p>
  }

  return (
    <table className="w-full border-collapse text-[9.5pt] leading-tight text-black">
      <thead>
        <tr className="bg-[#4f86bf] text-left text-white print:bg-[#4f86bf]">
          <th className="w-[12mm] border border-[#8db1d7] px-1.5 py-1 font-bold">Bet.</th>
          <th className="w-[16mm] border border-[#8db1d7] px-1.5 py-1 font-bold">Nr</th>
          <th className="w-[42mm] border border-[#8db1d7] px-1.5 py-1 font-bold">Del / Rum</th>
          <th className="border border-[#8db1d7] px-1.5 py-1 font-bold">Fel</th>
          <th className="w-[24mm] border border-[#8db1d7] px-1.5 py-1 font-bold">Avhjälpt /sign</th>
        </tr>
      </thead>
      <tbody>
        {notes.map((note, index) => (
          <tr key={note.id} className="break-inside-avoid">
            <td className="align-top border border-[#8db1d7] px-1.5 py-1.5">
              {note.markerKey || ''}
            </td>
            <td className="align-top border border-[#8db1d7] px-1.5 py-1.5">
              {noteReference(report, note, index)}
            </td>
            <td className="align-top border border-[#8db1d7] px-1.5 py-1.5">
              {detailLine([note.room, note.location, note.placeDetail]) !== '-'
                ? detailLine([note.room, note.location, note.placeDetail])
                : ''}
            </td>
            <td className="whitespace-pre-wrap align-top border border-[#8db1d7] px-1.5 py-1.5">
              {note.noteText}
            </td>
            <td className="align-top border border-[#8db1d7] px-1.5 py-1.5" />
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PhotoAppendix({
  report,
  notes,
  imagesByNoteId,
}: {
  report: EbInspectionReport
  notes: EbNote[]
  imagesByNoteId: Map<string, EbNoteImage[]>
}) {
  const notesWithImages = notes
    .map((note, index) => ({
      note,
      index,
      images: imagesByNoteId.get(note.id) ?? [],
    }))
    .filter((item) => item.images.length > 0)

  if (notesWithImages.length === 0) return null

  return (
    <section className="eb-report-section mt-8 break-before-page">
      <h2 className={REPORT_APPENDIX_HEADING_CLASS_NAME}>FOTOBILAGA</h2>
      <div className="space-y-5">
        {notesWithImages.map(({ note, index, images }) => (
          <article key={note.id} className="break-inside-avoid">
            <p className="mb-2 text-[10pt] font-bold text-black">
              {noteReference(report, note, index)} {note.markerKey ? `(${note.markerKey})` : ''}
            </p>
            <div className="grid grid-cols-2 gap-4">
              {images.map((image) => (
                <figure key={image.id} className="break-inside-avoid">
                  <img
                    src={image.publicUrl}
                    alt={image.label ?? 'Noteringsbild'}
                    className="h-[62mm] w-full border border-gray-300 object-contain"
                  />
                  {image.label ? (
                    <figcaption className="mt-1 text-[8.5pt] text-gray-700">{image.label}</figcaption>
                  ) : null}
                </figure>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function EbInspectionReportView({ report }: EbInspectionReportViewProps) {
  const notes = sortNotes(report.notes)
  const printableSections = report.reportDraft.sections.filter(
    (section) =>
      section.isRelevant &&
      !HIDDEN_REPORT_SECTION_KEYS.has(section.key) &&
      section.status !== 'missing' &&
      hasPrintableReportText(section.text)
  )
  const scopeSection = printableSections.find((section) => section.key === 'scope') ?? null
  const reportSections = printableSections.filter((section) => section.key !== 'scope')
  const imagesByNoteId = new Map<string, EbNoteImage[]>()
  for (const image of report.images) {
    if (!image.noteId) continue
    imagesByNoteId.set(image.noteId, [...(imagesByNoteId.get(image.noteId) ?? []), image])
  }
  for (const [noteId, images] of imagesByNoteId) {
    imagesByNoteId.set(noteId, sortImages(images))
  }

  return (
    <main className="eb-report-print-root min-h-screen bg-neutral-200 text-black print:min-h-0 print:bg-white">
      <div className="mx-auto max-w-5xl px-4 py-5 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/eb/projects/${report.project.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Till entreprenaden
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/eb/projects/${report.project.id}/inspections/${report.inspection.inspectionId}/report/draft`}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              <FileText size={16} />
              Redigera utkast
            </Link>
            <Link
              href={`/eb/projects/${report.project.id}/inspections/${report.inspection.inspectionId}/perform`}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              <ClipboardCheck size={16} />
              Granska
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              <Printer size={16} />
              Skriv ut
            </button>
          </div>
        </div>
      </div>

      <article className="eb-report-print-document mx-auto bg-white px-12 py-10 shadow-sm print:shadow-none">
        <ReportHeader report={report} />

        {scopeSection ? (
          <ReportSection title={scopeSection.title}>
            <ReportText text={scopeSection.text} />
          </ReportSection>
        ) : null}

        {reportSections.map((section) => (
          section.key === 'inspectors' ? (
            <InspectorReport key={section.key} report={report} section={section} />
          ) : section.key === 'participants' ? (
            <ParticipantsReport key={section.key} report={report} />
          ) : (
            <ReportSection
              key={section.key}
              title={section.title}
            >
              {section.key === 'contract_parties' ? (
                <ContractPartiesReport report={report} />
              ) : (
                <ReportText text={section.text} />
              )}
            </ReportSection>
          )
        ))}

        <section className="eb-report-section mt-8 break-before-page">
          <h2 className={REPORT_APPENDIX_HEADING_CLASS_NAME}>{REPORT_NOTE_APPENDIX_TITLE}</h2>
          <NoteTable report={report} notes={notes} />
        </section>

        <PhotoAppendix report={report} notes={notes} imagesByNoteId={imagesByNoteId} />
      </article>
    </main>
  )
}
