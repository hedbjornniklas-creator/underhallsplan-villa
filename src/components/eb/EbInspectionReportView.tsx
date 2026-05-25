'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, FileText, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  EbInspectionDocument,
  EbInspectionReport,
  EbNote,
  EbNoteImage,
  EbPreviousInspectionItem,
} from '@/lib/eb/server'
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
const REPORT_TITLE_HEADING_CLASS_NAME = 'text-[16pt] font-bold uppercase leading-tight text-black'
const REPORT_SECTION_HEADING_CLASS_NAME = 'mb-2 text-[12pt] font-bold leading-tight text-black'
const REPORT_APPENDIX_HEADING_CLASS_NAME = 'mb-3 text-[13pt] font-bold uppercase leading-tight text-black'
const HIDDEN_REPORT_SECTION_KEYS = new Set([
  'inspection_type',
  'not_accessible',
  'documentation_only',
  'appendices',
  'marker_legend',
  'deduction',
  'notes',
])
const DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION =
  'Fönster, dörrar, väggar etc numreras från vänster till höger. Vägg 1 = vägg till vänster om entrévägg. Vägg 2 = nästa vägg till höger om vägg 1 osv.'

function normalizeReportText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
}

function parseLabelLine(line: string) {
  if (line.trim().startsWith('•')) return null
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

function isReportCursorArtifact(value: string) {
  return value.trim() === '|'
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
      if (!line || isMissingValue(line) || isReportCursorArtifact(line)) return false
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

function summonsMethod(report: EbInspectionReport, sectionText: string) {
  const method = report.inspection.invitationMethod?.trim()
  if (method) return method.toLocaleLowerCase('sv-SE')

  const lowerText = sectionText.toLocaleLowerCase('sv-SE')
  if (lowerText.includes('e-post') || lowerText.includes('epost') || lowerText.includes('e-mail')) return 'e-post'
  return 'e-post'
}

function summonsDate(report: EbInspectionReport, sectionText: string) {
  const date = report.inspection.invitationDate?.trim() || report.inspection.invitationSentAt?.trim()
  if (date) return date.slice(0, 10)

  const match = sectionText.match(/\b\d{4}-\d{2}-\d{2}\b/)
  return match?.[0] ?? 'Klicka här - ange datum'
}

function SummonsReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  return (
    <ReportSection title="Sättet för kallelse till besiktningen" headingMarker>
      <p className="text-[10.5pt] leading-[1.35] text-black">
        Besiktningsmannen har {summonsDate(report, section.text)} kallat parterna per {summonsMethod(report, section.text)}.
      </p>
    </ReportSection>
  )
}

function previousInspectionStatusLabel(value: EbPreviousInspectionItem['status']) {
  if (value === 'performed') return 'Utförd'
  if (value === 'not_performed') return 'Ej utförd'
  if (value === 'not_applicable') return 'Ej aktuell'
  return 'Ej angivet'
}

function PreviousInspectionsReport({ report }: { report: EbInspectionReport }) {
  return (
    <ReportSection title="Tidigare besiktningar">
      <dl className="grid gap-y-1 text-[10.5pt] leading-[1.35] text-black">
        {report.inspection.previousInspections.map((row) => (
          <div key={row.key} className="grid grid-cols-[62mm_20mm_1fr] gap-x-4">
            <dt>{row.label}</dt>
            <dd>{previousInspectionStatusLabel(row.status)}</dd>
            <dd>
              {row.status === 'performed'
                ? row.date ?? 'Klicka här - ange datum.'
                : row.date ?? ''}
            </dd>
          </div>
        ))}
      </dl>
    </ReportSection>
  )
}

function isTestingDocumentationDocumentBlock(block: string) {
  const lines = printableReportLines(block)
  if (lines.length === 0) return false
  return (
    lines.every((line) => line.trim().startsWith('•')) ||
    normalizeReportText(block).startsWith('Inga dokument har markerats')
  )
}

function isTestingDocumentationConclusion(block: string) {
  return normalizeReportText(block).startsWith('Där avtalad dokumentation')
}

function testingDocumentationBlocks(text: string) {
  const proseBlocks = normalizeReportText(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !isTestingDocumentationDocumentBlock(block))

  return {
    beforeList: proseBlocks.filter((block) => !isTestingDocumentationConclusion(block)),
    afterList: proseBlocks.filter(isTestingDocumentationConclusion),
  }
}

function isHandoverReportDocument(document: EbInspectionDocument) {
  return document.resultLabel?.trim().toLocaleLowerCase('sv-SE').includes('överlämnas') ?? false
}

function documentationResultText(document: EbInspectionDocument) {
  if (isHandoverReportDocument(document)) return 'Överlämnas.'
  return `Daterad: ${document.documentDate?.trim() || 'Klicka här - ange datum.'}`
}

function TestingDocumentationReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  const { beforeList, afterList } = testingDocumentationBlocks(section.text)
  const documents = report.inspectionDocuments
    .filter((document) => document.status === 'present')
    .sort((left, right) => left.sortOrder - right.sortOrder)

  return (
    <ReportSection title="Provning, dokumentation">
      <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
        {beforeList.map((block, index) => (
          <p key={`${block}-${index}`} className="whitespace-pre-wrap">
            {block}
          </p>
        ))}

        <div className="pt-1">
          <p className="underline">Dokumentation:</p>
          {documents.length > 0 ? (
            <ul className="mt-2 space-y-1 pl-7">
              {documents.map((document) => (
                <li key={document.documentTypeId} className="pl-1">
                  <div className="grid grid-cols-[88mm_1fr] items-end gap-x-5">
                    <span>{document.title}</span>
                    <span>{documentationResultText(document)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2">Inga dokument har markerats som redovisade för granskning.</p>
          )}
        </div>

        {afterList.map((block, index) => (
          <p key={`${block}-${index}`} className="whitespace-pre-wrap pt-1">
            {block}
          </p>
        ))}
      </div>
    </ReportSection>
  )
}

function usedReportMarkers(report: EbInspectionReport) {
  const usedKeys = new Set(
    report.notes
      .map((note) => note.markerKey?.trim())
      .filter((markerKey): markerKey is string => Boolean(markerKey))
  )

  return report.markers
    .filter((marker) => usedKeys.has(marker.key))
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

function markerExplanation(marker: EbInspectionReport['markers'][number]) {
  if (marker.key === 'N') {
    return 'Om nedsättning av avtalat pris är tillämplig anges uppskattad nedsättning för angivet fel som kvarstår.'
  }
  return marker.label
}

function deductionNotes(report: EbInspectionReport) {
  return sortNotes(report.notes.filter((note) => note.markerKey === 'N'))
}

function deductionAmountText(value: string | null) {
  const amount = value?.trim()
  if (!amount) return 'Ej angivet'
  return /(\bkr\b|kron)/i.test(amount) ? amount : `${amount} kronor`
}

function DeductionNotesList({ report }: { report: EbInspectionReport }) {
  const notes = deductionNotes(report)
  if (notes.length === 0) return null

  return (
    <div className="col-start-2 space-y-1 pt-1">
      <p>
        Om nedsättning av avtalat pris är tillämplig ska uppskattad nedsättning anges nedan.
        Beloppet ska motsvara skillnaden mellan värdet på det totala priset för arbetet i
        kontraktsenligt respektive felaktigt utförande.
      </p>
      <p>Uppskattad nedsättning av det totala priset för arbetet är för nedan angivna fel:</p>
      <dl className="grid gap-y-1">
        {notes.map((note) => (
          <div key={note.id} className="grid grid-cols-[34mm_1fr] gap-x-4">
            <dt>{`${report.project.notePrefix} ${note.noteNumber ?? '-'}`}</dt>
            <dd>{deductionAmountText(note.deductionAmount)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function defectNoErrorPartsPolicyText(report: EbInspectionReport) {
  return report.inspection.defectNoErrorPartsPolicy === 'listed_with_dash' ? 'med ---' : 'inte'
}

function DefectsConditionsReport({
  report,
}: {
  report: EbInspectionReport
}) {
  const markers = usedReportMarkers(report)

  return (
    <ReportSection title="Fel och förhållanden">
      <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
        <p>Under denna rubrik är angivna förhållanden som besiktningsmannen anser utgöra fel.</p>
        <p className="underline">Förklaringar för respektive kolumn:</p>

        <dl className="grid gap-y-1">
          <div className="grid grid-cols-[22mm_1fr] gap-x-4">
            <dt>Bet.</dt>
            <dd>Beteckning med markering:</dd>
          </div>

          {markers.map((marker) => (
            <div key={marker.key} className="grid grid-cols-[22mm_1fr] gap-x-4">
              <dt className="pl-[16mm] font-bold">{marker.key}</dt>
              <dd>{markerExplanation(marker)}</dd>
              {marker.key === 'N' ? <DeductionNotesList report={report} /> : null}
            </div>
          ))}

          <div className="grid grid-cols-[22mm_1fr] gap-x-4 pt-1">
            <dt>Nr</dt>
            <dd>Ordningsnummer på fel / bristfällighet / anmärkning.</dd>
          </div>
          <div className="grid grid-cols-[22mm_1fr] gap-x-4">
            <dt>Del/Rum</dt>
            <dd>Bygg- eller installationsdel / alternativt rumsnummer / rumsbenämning.</dd>
          </div>
          <div className="grid grid-cols-[22mm_1fr] gap-x-4">
            <dt>Fel</dt>
            <dd>Fel / bristfällighet / anmärkning.</dd>
          </div>
          <div className="grid grid-cols-[22mm_1fr] gap-x-4">
            <dt>Avhjälpt /sign</dt>
            <dd>Kolumn för intygande av hantverkaren att avhjälpande har skett med datum och signatur.</dd>
          </div>
        </dl>

        <div className="pt-3">
          <p className="underline">Övriga förklaringar:</p>
          <p className="mt-2 whitespace-pre-wrap">
            {report.inspection.defectNumberingExplanation?.trim() || DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION}
          </p>
          <p className="mt-2">
            Lokal, byggdel eller installationsdel utan fel redovisas {defectNoErrorPartsPolicyText(report)} och gäller eventuell förekomst av allmänna fel.
          </p>
          <p className="mt-2">
            Fel kompletterad med texten &quot;Avhjälps ej&quot; innebär att parterna enats om att avhjälpande ej skall ske, men att beställaren förbehåller sig rätt till kostnadsreglering.
          </p>
        </div>
      </div>
    </ReportSection>
  )
}

function isTestingDocumentationSection(section: EbInspectionReport['reportDraft']['sections'][number]) {
  return (
    section.key === 'testing_documentation' ||
    section.title.trim().toLocaleLowerCase('sv-SE') === 'provning, dokumentation'
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

function noteNumber(note: EbNote, index: number) {
  return String(note.noteNumber ?? index + 1)
}

function NoteTable({
  notes,
}: {
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
              {noteNumber(note, index)}
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
          ) : section.key === 'summons' ? (
            <SummonsReport key={section.key} report={report} section={section} />
          ) : section.key === 'previous_inspections_tests' ? (
            <PreviousInspectionsReport key={section.key} report={report} />
          ) : isTestingDocumentationSection(section) ? (
            <TestingDocumentationReport key={section.key} report={report} section={section} />
          ) : section.key === 'defects_appendices' ? (
            <div key={section.key}>
              <DefectsConditionsReport report={report} />
              <section className="eb-report-section mt-4">
                <NoteTable notes={notes} />
              </section>
            </div>
          ) : section.key === 'contract_documents' ? (
            <ReportSection key={section.key} title={section.title} headingMarker>
              <ReportText text={section.text} />
            </ReportSection>
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

        <PhotoAppendix report={report} notes={notes} imagesByNoteId={imagesByNoteId} />
      </article>
    </main>
  )
}
