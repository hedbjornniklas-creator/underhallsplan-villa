'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, Printer } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type {
  EbInspectionDocument,
  EbInspectionCheckpoint,
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

function sortCheckpoints(checkpoints: EbInspectionCheckpoint[]) {
  return [...checkpoints].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return left.title.localeCompare(right.title, 'sv-SE')
  })
}

function groupedCheckpoints(checkpoints: EbInspectionCheckpoint[]) {
  const groups: Array<{ key: string; label: string; checkpoints: EbInspectionCheckpoint[] }> = []
  const byKey = new Map<string, { key: string; label: string; checkpoints: EbInspectionCheckpoint[] }>()

  for (const checkpoint of sortCheckpoints(checkpoints)) {
    const groupKey = checkpoint.groupKey || 'other'
    const existing = byKey.get(groupKey)
    if (existing) {
      existing.checkpoints.push(checkpoint)
      continue
    }
    const group = {
      key: groupKey,
      label: checkpoint.groupLabel || 'Övrigt',
      checkpoints: [checkpoint],
    }
    byKey.set(groupKey, group)
    groups.push(group)
  }

  return groups
}

function checkpointStatusLabel(status: EbInspectionCheckpoint['status']) {
  if (status === 'ok') return 'OK'
  if (status === 'deviation') return 'Avvikelse'
  if (status === 'not_applicable') return 'Ej aktuellt'
  if (status === 'not_accessible') return 'Ej åtkomligt'
  if (status === 'not_verifiable') return 'Ej verifierbart'
  return 'Ej kontrollerat'
}

function detailLine(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(', ') || '-'
}

function reportValue(value: string | null | undefined) {
  return value?.trim() || '-'
}

function reportPrintTitle(report: EbInspectionReport) {
  const inspectionDate = report.inspection.date?.trim()
  return inspectionDate ? `Utlåtande ${inspectionDate}` : 'Utlåtande'
}

function addressCityLine(postalCode: string | null | undefined, city: string | null | undefined) {
  return [postalCode?.trim(), city?.trim()].filter(Boolean).join(' ') || '-'
}

const REPORT_DOCUMENT_TITLE = 'UTLÅTANDE ÖVER SLUTBESIKTNING'
const DRAINAGE_REPORT_DOCUMENT_TITLE = 'UTLÅTANDE ÖVER DRÄNERINGSBESIKTNING'
const SBR_LOGO_SRC = '/report-assets/sbr-logo.png'
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
  'warranty_end',
  'special_investigation',
  'remedy_cost',
  'after_inspection',
  'signature_certificate',
])
const DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION =
  'Fönster, dörrar, väggar etc numreras från vänster till höger. Vägg 1 = vägg till vänster om entrévägg. Vägg 2 = nästa vägg till höger om vägg 1 osv.'

function normalizeReportText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
}

function isDrainageReport(report: EbInspectionReport) {
  return report.project.projectTemplateKey === 'drainage_foundation'
}

function reportDocumentTitle(report: EbInspectionReport) {
  return isDrainageReport(report) ? DRAINAGE_REPORT_DOCUMENT_TITLE : REPORT_DOCUMENT_TITLE
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
  return match?.[0] ?? null
}

function SummonsReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  const date = summonsDate(report, section.text)
  const method = summonsMethod(report, section.text)

  return (
    <ReportSection title="Sättet för kallelse till besiktningen" headingMarker>
      <p className="text-[10.5pt] leading-[1.35] text-black">
        {date
          ? `Besiktningsmannen har ${date} kallat parterna per ${method}.`
          : `Besiktningsmannen har kallat parterna per ${method}.`}
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
  const rows = report.inspection.previousInspections.filter((row) => row.status || row.date?.trim())
  if (rows.length === 0) return null

  return (
    <ReportSection title="Tidigare besiktningar">
      <dl className="grid gap-y-1 text-[10.5pt] leading-[1.35] text-black">
        {rows.map((row) => (
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

function DrainageChecklistReport({ report }: { report: EbInspectionReport }) {
  const groups = groupedCheckpoints(report.checkpoints)
  const hasPhotoRequiredCheckpoints = report.checkpoints.some((checkpoint) => checkpoint.photoRequired)

  return (
    <ReportSection title="Kontrollunderlag dränering">
      {groups.length === 0 ? (
        <p className="text-[10.5pt] leading-[1.35] text-black">
          Ingen dräneringskontrollista är registrerad för besiktningen.
        </p>
      ) : (
        <div className="space-y-3 text-[9.5pt] leading-[1.25] text-black">
          {report.project.drainageGuidanceVersion ? (
            <p>Anvisning/version: {report.project.drainageGuidanceVersion}</p>
          ) : null}
          {hasPhotoRequiredCheckpoints ? (
            <p className="text-[9pt]">
              Kontrollpunkter märkta med foto ska verifieras med fotounderlag eller egenkontroll när momentet inte
              är direkt åtkomligt vid besiktningen.
            </p>
          ) : null}
          {groups.map((group) => (
            <section key={group.key} className="break-inside-avoid">
              <h3 className="mb-1 text-[10pt] font-bold text-black">{group.label}</h3>
              <div className="grid border-t border-l border-black/50">
                <div className="grid grid-cols-[46mm_24mm_1fr] bg-neutral-100 font-bold">
                  <div className="border-r border-b border-black/50 px-1.5 py-1">Kontrollpunkt</div>
                  <div className="border-r border-b border-black/50 px-1.5 py-1">Status</div>
                  <div className="border-r border-b border-black/50 px-1.5 py-1">Kommentar</div>
                </div>
                {group.checkpoints.map((checkpoint) => (
                  <div key={checkpoint.id} className="grid grid-cols-[46mm_24mm_1fr]">
                    <div className="border-r border-b border-black/50 px-1.5 py-1">
                      <p>{checkpoint.title}</p>
                      {checkpoint.photoRequired ? (
                        <p className="mt-0.5 text-[8pt] italic">Foto</p>
                      ) : null}
                    </div>
                    <div className="border-r border-b border-black/50 px-1.5 py-1">
                      {checkpointStatusLabel(checkpoint.status)}
                    </div>
                    <div className="whitespace-pre-wrap border-r border-b border-black/50 px-1.5 py-1">
                      {checkpoint.comment?.trim() || '-'}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
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

function parseDeductionNumber(value: string | null) {
  const normalized = value
    ?.replace(/\s/g, '')
    .replace(/kr(?:onor)?/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function deductionSummaryAmountText(report: EbInspectionReport) {
  const amountValues = deductionNotes(report)
    .map((note) => note.deductionAmount)
    .filter((amount): amount is string => Boolean(amount?.trim()))

  if (amountValues.length === 0) return 'Ej angivet'

  const parsedValues = amountValues.map(parseDeductionNumber)
  if (parsedValues.every((value): value is number => value !== null)) {
    const sum = parsedValues.reduce((total, value) => total + value, 0)
    return `${sum.toLocaleString('sv-SE')} kronor`
  }

  return amountValues.map(deductionAmountText).join(', ')
}

function DeductionNotesList({
  report,
  displayNumberByNoteId,
}: {
  report: EbInspectionReport
  displayNumberByNoteId: Map<string, number>
}) {
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
            <dt>{`${report.project.notePrefix} ${displayNumberByNoteId.get(note.id) ?? '-'}`}</dt>
            <dd>{deductionAmountText(note.deductionAmount)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function DeductionAgreementSummary({ report }: { report: EbInspectionReport }) {
  if (deductionNotes(report).length === 0) return null

  return (
    <section className="eb-report-section mt-6 break-inside-avoid text-[10.5pt] leading-[1.35] text-black">
      <p className="font-medium italic">
        Nedan anges om parterna har träffat överenskommelse om det.
      </p>
      <p className="mt-2">
        Kostnad för avhjälpande av fel i arbeten som är påtalade av besiktningsmannen bedöms till{' '}
        {deductionSummaryAmountText(report)}.
      </p>
    </section>
  )
}

function approvalDecisionDate(report: EbInspectionReport) {
  return report.inspection.date?.trim() ?? null
}

function approvalReasonLines(value: string | null) {
  return normalizeReportText(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function ApprovalDecisionReport({ report }: { report: EbInspectionReport }) {
  if (!report.inspection.approvalStatus) return null

  const isApproved = report.inspection.approvalStatus === 'approved'
  const isPartlyApproved = report.inspection.approvalStatus === 'partly_approved'
  const decisionDate = approvalDecisionDate(report)
  const reasonLines = approvalReasonLines(report.inspection.approvalNote)

  return (
    <ReportSection title="Besked om godkännande">
      <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
        {isApproved ? (
          <>
            <p>Arbetena godkänns{decisionDate ? ` ${decisionDate}` : ''}.</p>
            <p>Beslutet meddelades av besiktningsmannen till parterna vid besiktningen.</p>
          </>
        ) : (
          <>
            <p>
              Arbetena godkänns {isPartlyApproved ? 'delvis' : 'inte'} på grund av att noterade fel sammantaget inte anses vara av mindre betydelse.
            </p>
            {reasonLines.length > 0 ? (
              <>
                <p>Följande skäl utgör hinder för godkännande:</p>
                <ul className="list-disc space-y-1 pl-8">
                  {reasonLines.map((line, index) => (
                    <li key={`${line}-${index}`}>{line}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </ReportSection>
  )
}

function reportRecipients(report: EbInspectionReport) {
  return report.participants.filter((participant) => participant.receivesReport)
}

function signatureRows(report: EbInspectionReport) {
  const signatureSection = report.reportDraft.sections.find(
    (section) => section.key === 'signature_certificate'
  )
  const rows = printableReportLines(signatureSection?.text ?? '')
    .map(parseLabelLine)
    .filter((row): row is NonNullable<ReturnType<typeof parseLabelLine>> => Boolean(row))
  const name = rows.find((row) => row.label === 'Besiktningsman')?.value ?? '-'
  const details = rows.filter((row) => row.label !== 'Besiktningsman' && row.label !== 'Datum')

  return { name, details }
}

function DistributionListReport({ report }: { report: EbInspectionReport }) {
  const recipients = reportRecipients(report)
  const distributionDate = report.inspection.reportDistributionDate?.trim() || 'Klicka här - ange datum'
  const inspector = signatureRows(report)

  return (
    <ReportSection title="Sändlista">
      <div className="space-y-4 text-[10.5pt] leading-[1.35] text-black">
        <p>
          Undertecknat utlåtande har {distributionDate} sänts per e-post till parterna och övriga enligt nedan.
        </p>

        {recipients.length > 0 ? (
          <table className="w-full border-collapse text-[9.5pt] leading-tight text-black">
            <thead>
              <tr className="bg-[#4f86bf] text-left text-white print:bg-[#4f86bf]">
                <th className="w-[58mm] px-1.5 py-1 font-bold">Företag</th>
                <th className="w-[58mm] px-1.5 py-1 font-bold">Namn</th>
                <th className="px-1.5 py-1 font-bold">E-post</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((recipient, index) => (
                <tr key={recipient.id ?? `${recipient.email}-${index}`}>
                  <td className="px-1.5 py-0.5">{recipient.companyName?.trim() || '-'}</td>
                  <td className="px-1.5 py-0.5">{recipient.personName?.trim() || '-'}</td>
                  <td className="px-1.5 py-0.5">{recipient.email?.trim() || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Mottagare av utlåtandet har inte angetts.</p>
        )}

        <div className="pt-3">
          {report.branding.inspectorAvatarUrl ? (
            <img
              src={report.branding.inspectorAvatarUrl}
              alt="Besiktningsmannen"
              className="eb-report-inspector-avatar h-[34mm] w-[34mm] object-cover"
            />
          ) : null}

          <div className="mt-4 space-y-1">
            <p className="font-semibold">{inspector.name}</p>
            {inspector.details.length > 0 ? (
              <dl className="grid gap-y-0.5">
                {inspector.details.map((row) => (
                  <div key={row.label} className="grid grid-cols-[34mm_1fr] gap-x-2">
                    <dt>{row.label}:</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <img
              src={SBR_LOGO_SRC}
              alt="SBR Byggingenjörerna"
              className="eb-report-sbr-logo mt-2 h-[14mm] w-auto object-contain"
            />
          </div>
        </div>
      </div>
    </ReportSection>
  )
}

function defectNoErrorPartsPolicyText(report: EbInspectionReport) {
  return report.inspection.defectNoErrorPartsPolicy === 'listed_with_dash' ? 'med ---' : 'inte'
}

function DefectsConditionsReport({
  report,
  displayNumberByNoteId,
}: {
  report: EbInspectionReport
  displayNumberByNoteId: Map<string, number>
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
              {marker.key === 'N' ? (
                <DeductionNotesList report={report} displayNumberByNoteId={displayNumberByNoteId} />
              ) : null}
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
  const propertyDesignation = report.project.propertyDesignation?.trim()
  const brfApartmentNumber = report.project.brfApartmentNumber?.trim()
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
              className="eb-report-header-logo h-[16mm] max-h-[16mm] w-auto max-w-[52mm] object-contain"
            />
          ) : null}
        </div>
        <div aria-hidden="true" />
        <div className="flex min-h-[16mm] items-start justify-end">
          <img
            src={report.branding.besiktAppLogoUrl}
            alt="BesiktApp"
            className="eb-report-header-logo h-[16mm] max-h-[16mm] w-auto max-w-[52mm] object-contain"
          />
        </div>
      </div>
      <div className="mt-3 h-[1.5px] w-full bg-[#2f7d55]" />

      <dl className="mt-3 grid gap-y-1 text-[10.5pt] leading-snug text-black">
        {propertyDesignation ? (
          <div className="grid grid-cols-[38mm_1fr] gap-x-4">
            <dt className="font-bold">Fastighetsbeteckning</dt>
            <dd>{propertyDesignation}</dd>
          </div>
        ) : null}
        {brfApartmentNumber ? (
          <div className="grid grid-cols-[38mm_1fr] gap-x-4">
            <dt className="font-bold">BRF och lgh nr</dt>
            <dd>{brfApartmentNumber}</dd>
          </div>
        ) : null}
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
        <h1 className={REPORT_TITLE_HEADING_CLASS_NAME}>{reportDocumentTitle(report)}</h1>
      </div>
    </header>
  )
}

function noteReference(report: EbInspectionReport, index: number) {
  return `${report.project.notePrefix} ${index + 1}`
}

function noteNumber(index: number) {
  return String(index + 1)
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
              {noteNumber(index)}
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
              {noteReference(report, index)} {note.markerKey ? `(${note.markerKey})` : ''}
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
  const printTitle = reportPrintTitle(report)
  const notes = sortNotes(report.notes)
  const displayNumberByNoteId = new Map(notes.map((note, index) => [note.id, index + 1]))
  const drainageReport = isDrainageReport(report)
  const printableSections = report.reportDraft.sections.filter(
    (section) =>
      section.isRelevant &&
      !HIDDEN_REPORT_SECTION_KEYS.has(section.key) &&
      !(drainageReport && (section.key === 'testing_documentation' || section.key === 'contract_documents')) &&
      !(section.key === 'previous_inspections_tests' && report.inspection.previousInspections.every((row) => !row.status && !row.date?.trim())) &&
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

  useEffect(() => {
    const previousTitle = document.title
    document.title = printTitle

    return () => {
      if (document.title === printTitle) {
        document.title = previousTitle
      }
    }
  }, [printTitle])

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
              href={`/eb/projects/${report.project.id}/inspections/${report.inspection.inspectionId}/perform`}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              <ClipboardCheck size={16} />
              Granska
            </Link>
            <button
              type="button"
              onClick={() => {
                document.title = printTitle
                window.print()
              }}
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
          ) : section.key === 'drainage_checklist' ? (
            <DrainageChecklistReport key={section.key} report={report} />
          ) : section.key === 'defects_appendices' ? (
            <div key={section.key}>
              <DefectsConditionsReport report={report} displayNumberByNoteId={displayNumberByNoteId} />
              <section className="eb-report-section mt-4">
                <NoteTable notes={notes} />
              </section>
              <DeductionAgreementSummary report={report} />
            </div>
          ) : section.key === 'contract_documents' ? (
            <ReportSection key={section.key} title={section.title} headingMarker>
              <ReportText text={section.text} />
            </ReportSection>
          ) : section.key === 'approval_decision' ? (
            <ApprovalDecisionReport key={section.key} report={report} />
          ) : section.key === 'distribution_list' ? (
            <DistributionListReport key={section.key} report={report} />
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
