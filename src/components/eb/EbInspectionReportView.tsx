'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ClipboardCheck, Download, Loader2, Printer, Send } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import EbReportDeliveryDialog from '@/components/eb/EbReportDeliveryDialog'
import { useEbToast } from '@/components/eb/EbToastProvider'
import {
  isEbDrainageTemplate,
  isEbReportSectionApplicable,
  isEbReportSectionIntegrated,
} from '@/lib/eb/reportSectionRules'
import {
  isEbTestingDocumentationConclusion,
  normalizeEbTestingDocumentationText,
  withEbPhotoAppendixListing,
} from '@/lib/eb/reportText'
import type {
  EbInspectionDocument,
  EbInspectionCheckpoint,
  EbInspectionReport,
  EbNote,
  EbNoteImage,
  EbPreviousInspectionItem,
  EbReportNoteHeading,
} from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'

type EbInspectionReportViewProps = {
  report: EbInspectionReport
  showInternalActions?: boolean
  publicActions?: ReactNode
}

function reportNavigationClassName(emerald: boolean, busy: boolean) {
  const base = 'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition'
  const variant = emerald
    ? 'border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'
    : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
  return busy ? `${base} ${variant} pointer-events-none cursor-wait opacity-70` : `${base} ${variant}`
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

function printableDrainageCheckpoints(report: EbInspectionReport) {
  return report.checkpoints.filter((checkpoint) => checkpoint.groupKey !== 'documents')
}

function numberedCheckpointGroups(checkpoints: EbInspectionCheckpoint[]) {
  let nextNumber = 1
  return groupedCheckpoints(checkpoints).map((group) => ({
    ...group,
    checkpoints: group.checkpoints.map((checkpoint) => ({
      checkpoint,
      number: nextNumber++,
    })),
  }))
}

function checkpointNumberByNoteId(report: EbInspectionReport) {
  const byNoteId = new Map<string, number>()
  for (const group of numberedCheckpointGroups(printableDrainageCheckpoints(report))) {
    for (const item of group.checkpoints) {
      if (item.checkpoint.noteId) byNoteId.set(item.checkpoint.noteId, item.number)
    }
  }
  return byNoteId
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

function reportPrintTitle(report: EbInspectionReport) {
  const reference = reportReference(report)
  if (reference) return `Utlåtande EB ${reference}`

  const inspectionDate = report.inspection.date?.trim()
  return inspectionDate ? `Utlåtande EB ${inspectionDate}` : 'Utlåtande EB'
}

function reportReference(report: EbInspectionReport) {
  const inspectionDate = report.inspection.date?.trim()
  const dateMatch = inspectionDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const sequenceNo = Number(report.inspection.sequenceNo)
  if (!dateMatch || !Number.isFinite(sequenceNo) || sequenceNo <= 0) return null
  return `${dateMatch[1]}-${dateMatch[2]}${dateMatch[3]}-${String(sequenceNo).padStart(2, '0')}`
}

const REPORT_DOCUMENT_TITLES: Record<EbInspectionReport['inspection']['variant'], string> = {
  SLB: 'UTLÅTANDE ÖVER SLUTBESIKTNING',
  FB: 'UTLÅTANDE ÖVER FÖRBESIKTNING',
  EB: 'UTLÅTANDE ÖVER EFTERBESIKTNING',
  GB: 'UTLÅTANDE ÖVER GARANTIBESIKTNING',
  KSB: 'UTLÅTANDE ÖVER KOMPLETTERANDE SLUTBESIKTNING',
  SAB: 'UTLÅTANDE ÖVER SÄRSKILD BESIKTNING',
}
const DRAINAGE_REPORT_DOCUMENT_TITLE = 'UTLÅTANDE ÖVER DRÄNERINGSBESIKTNING'
const REPORT_OPENING_METADATA_CLASS_NAME = 'text-[20pt] font-bold leading-[1.22] tracking-[-0.01em] text-black'
const REPORT_TITLE_HEADING_CLASS_NAME = 'text-[20pt] font-bold uppercase leading-[1.15] tracking-[-0.01em] text-emerald-700'
const REPORT_SECTION_HEADING_CLASS_NAME = 'mb-2 text-[12pt] font-bold leading-tight text-black'
const REPORT_APPENDIX_HEADING_CLASS_NAME = 'mb-3 text-[13pt] font-bold uppercase leading-tight text-black'
const EB_PAGE_WIDTH_MM = 210
const EB_PAGE_HEIGHT_MM = 297
const EB_PAGE_X_PADDING_MM = 12
const EB_PAGE_HEADER_TOP_MM = 7
const EB_PAGE_CONTENT_TOP_MM = 36
const EB_PAGE_CONTENT_BOTTOM_MM = 25
const EB_PAGE_CONTENT_WIDTH_MM = EB_PAGE_WIDTH_MM - EB_PAGE_X_PADDING_MM * 2
const EB_PAGE_CONTENT_HEIGHT_MM = EB_PAGE_HEIGHT_MM - EB_PAGE_CONTENT_TOP_MM - EB_PAGE_CONTENT_BOTTOM_MM
const EB_PAGE_PACKING_SAFETY_MM = 12
const DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION =
  'Fönster, dörrar, väggar etc numreras från vänster till höger. Vägg 1 = vägg till vänster om entrévägg. Vägg 2 = nästa vägg till höger om vägg 1 osv.'

const mm = (value: number) => `${value}mm`
const mmToPxNumber = (value: number) => (value * 96) / 25.4

function normalizeReportText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
}

function isDrainageReport(report: EbInspectionReport) {
  return isEbDrainageTemplate(report.project.projectTemplateKey)
}

function reportDocumentTitle(report: EbInspectionReport) {
  if (isDrainageReport(report)) {
    return report.inspection.variant === 'FB'
      ? 'UTLÅTANDE ÖVER FÖRBESIKTNING - DRÄNERINGSBESIKTNING'
      : DRAINAGE_REPORT_DOCUMENT_TITLE
  }

  return REPORT_DOCUMENT_TITLES[report.inspection.variant]
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
  const agreedWorks = report.project.objectDescription?.trim()
  const clientName = report.project.clientName?.trim()
  const clientAddress = report.project.clientAddress?.trim()
  const clientPostalCity = [report.project.clientPostalCode?.trim(), report.project.clientCity?.trim()]
    .filter(Boolean)
    .join(' ')
  const contractorName = report.project.contractorName?.trim()
  const contractorAddress = report.project.contractorAddress?.trim()
  const contractorPostalCity = [
    report.project.contractorPostalCode?.trim(),
    report.project.contractorCity?.trim(),
  ]
    .filter(Boolean)
    .join(' ')
  const contractorOrgNo = report.project.contractorOrgNo?.trim()

  return (
    <div className="text-[10.5pt] leading-[1.35] text-black">
      <div className="grid grid-cols-[62mm_1fr] gap-x-4">
        <div>Avtalsform:</div>
        <div>{vocabulary.agreementLine}</div>
      </div>
      <div className="mt-2 grid grid-cols-[62mm_1fr] gap-x-4">
        <div>Avtalade arbeten:</div>
        <div className="whitespace-pre-wrap">{agreedWorks || '-'}</div>
      </div>

      <div className="mt-2 underline">Parter:</div>

      <dl className="mt-2 grid gap-y-1">
        <div className="grid grid-cols-[62mm_1fr] gap-x-4">
          <dt>
            <PartyLabel type="client" fallback={vocabulary.clientLabel} />
          </dt>
          <dd>{clientName || 'Ej angiven'}</dd>
        </div>
        {clientAddress ? (
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt aria-hidden="true" />
            <dd>{clientAddress}</dd>
          </div>
        ) : null}
        {clientPostalCity ? (
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt aria-hidden="true" />
            <dd>{clientPostalCity}</dd>
          </div>
        ) : null}

        <div className="grid grid-cols-[62mm_1fr] gap-x-4 pt-1">
          <dt>
            <PartyLabel type="contractor" fallback={vocabulary.contractorLabel} />
          </dt>
          <dd>{contractorName || 'Ej angiven'}</dd>
        </div>
        {contractorAddress ? (
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt aria-hidden="true" />
            <dd>{contractorAddress}</dd>
          </div>
        ) : null}
        {contractorPostalCity ? (
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt aria-hidden="true" />
            <dd>{contractorPostalCity}</dd>
          </div>
        ) : null}
        {contractorOrgNo ? (
          <div className="grid grid-cols-[62mm_1fr] gap-x-4">
            <dt aria-hidden="true" />
            <dd>Org.nr: {contractorOrgNo}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

function InspectorReport({
  section,
}: {
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  const rows = printableReportLines(section.text)
    .map(parseLabelLine)
    .filter((row): row is NonNullable<ReturnType<typeof parseLabelLine>> => Boolean(row))
  const valueFor = (label: string) =>
    rows.find((row) => row.label.toLocaleLowerCase('sv-SE') === label.toLocaleLowerCase('sv-SE'))?.value
  const contactRows = [
    { label: 'Namn', value: valueFor('Besiktningsman') },
    { label: 'E-post', value: valueFor('E-post') },
    { label: 'Telefonnummer', value: valueFor('Telefonnummer') ?? valueFor('Telefon') },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value && row.value !== '-'))

  return (
    <ReportSection title={section.title} headingMarker>
      <dl className="grid grid-cols-[62mm_1fr] gap-x-4 gap-y-0.5 text-[10.5pt] leading-[1.35] text-black">
        {contactRows.map((row) => (
          <div key={row.label} className="contents">
            <dt>{row.label}:</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </ReportSection>
  )
}

function EditableReportText({ text }: { text: string }) {
  const normalized = normalizeReportText(text)
  if (!normalized) return null

  return (
    <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
      {normalized.split(/\n{2,}/).map((block, index) => (
        <p key={`${index}-${block}`} className="whitespace-pre-wrap">
          {block}
        </p>
      ))}
    </div>
  )
}

function InspectionTimeReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  const rows = printableReportLines(section.text)
    .map(parseLabelLine)
    .filter((row): row is NonNullable<ReturnType<typeof parseLabelLine>> => Boolean(row))
  const valueFor = (label: string) =>
    rows.find((row) => row.label.toLocaleLowerCase('sv-SE') === label.toLocaleLowerCase('sv-SE'))?.value
  const timeRows = [
    { label: 'Datum', value: report.inspection.date ?? valueFor('Datum') ?? '-' },
    { label: 'Tid', value: report.inspection.inspectionTime ?? valueFor('Tid') ?? '-' },
  ]

  return (
    <ReportSection title={section.title} headingMarker>
      <dl className="grid grid-cols-[62mm_1fr] gap-x-4 gap-y-0.5 text-[10.5pt] leading-[1.35] text-black">
        {timeRows.map((row) => (
          <div key={row.label} className="contents">
            <dt>{row.label}:</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
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

function ParticipantsReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
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
  const participantGroups = [
    { label: 'för beställaren:', participants: clientParticipants, other: false },
    { label: contractorRepresentativeLabel(report), participants: contractorParticipants, other: false },
    { label: 'Övriga närvarande:', participants: otherParticipants, other: true },
  ].filter((group) => group.participants.length > 0)

  return (
    <ReportSection title={section.title} headingMarker>
      <div className="text-[10.5pt] leading-[1.35] text-black">
        <div className="mb-2">
          {section.contentMode === 'mixed' ? (
            <EditableReportText text={section.text} />
          ) : (
            <p>Vid besiktningen var parterna representerade av:</p>
          )}
        </div>
        {participantGroups.length > 0 ? (
          <dl className="grid gap-y-1">
            {participantGroups.map((group) => (
              <div key={group.label} className="grid grid-cols-[62mm_1fr] gap-x-4">
                <dt>{group.label}</dt>
                <dd className="whitespace-pre-wrap">
                  {group.other
                    ? otherParticipantLines(group.participants)
                    : participantLines(group.participants)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>Inga närvarande har angetts.</p>
        )}
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
  if (normalizeReportText(block).startsWith('Inga dokument har markerats')) return true
  return lines.every(
    (line) =>
      line.trim().startsWith('•') &&
      (/\bDatum:\s*/i.test(line) || /överlämnas\.?$/i.test(line))
  )
}

function testingDocumentationBlocks(text: string, filterLegacyDocumentList: boolean) {
  const proseBlocks = normalizeReportText(normalizeEbTestingDocumentationText(text))
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(
      (block) =>
        block && (!filterLegacyDocumentList || !isTestingDocumentationDocumentBlock(block))
    )

  if (!filterLegacyDocumentList) {
    return {
      beforeList: proseBlocks.slice(0, 2),
      afterList: proseBlocks.slice(2),
    }
  }

  return {
    beforeList: proseBlocks.filter((block) => !isEbTestingDocumentationConclusion(block)),
    afterList: proseBlocks.filter(isEbTestingDocumentationConclusion),
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
  const { beforeList, afterList } = testingDocumentationBlocks(
    section.text,
    section.contentMode !== 'mixed'
  )
  const documents = report.inspectionDocuments
    .filter((document) => document.status === 'present')
    .sort((left, right) => left.sortOrder - right.sortOrder)

  return (
    <ReportSection title={section.title}>
      <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
        {beforeList.map((block, index) => (
          <p key={`${block}-${index}`} className="whitespace-pre-wrap">
            {block}
          </p>
        ))}

        <div className="pt-1">
          <p className="underline">Dokumentation:</p>
          {documents.length > 0 ? (
            <table className="mt-2 w-full table-fixed border-collapse text-[9.5pt] leading-[1.25] text-black">
              <thead>
                <tr className="bg-[#2f7d55] text-left text-white print:bg-[#2f7d55]">
                  <th className="w-[68%] border border-[#2f7d55] px-2 py-1 font-bold">Dokument</th>
                  <th className="border border-[#2f7d55] px-2 py-1 font-bold">Datum/status</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.documentTypeId} className="align-top">
                    <td className="border border-[#2f7d55] px-2 py-1">
                      <p>{document.title}</p>
                      {document.note?.trim() ? (
                        <p className="mt-0.5 text-[8.5pt] text-gray-700">{document.note.trim()}</p>
                      ) : null}
                    </td>
                    <td className="border border-[#2f7d55] px-2 py-1">
                      {documentationResultText(document)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

function DrainageChecklistIntroReport({
  guidanceVersion,
  hasPhotoRequiredCheckpoints,
  hasCheckpoints,
}: {
  guidanceVersion: string | null | undefined
  hasPhotoRequiredCheckpoints: boolean
  hasCheckpoints: boolean
}) {
  return (
    <ReportSection title="Kontrollunderlag dränering">
      {!hasCheckpoints ? (
        <p className="text-[10.5pt] leading-[1.35] text-black">
          Ingen dräneringskontrollista är registrerad för besiktningen.
        </p>
      ) : (
        <div className="space-y-2 text-[9.5pt] leading-[1.25] text-black">
          {guidanceVersion ? <p>Anvisning/version: {guidanceVersion}</p> : null}
          {hasPhotoRequiredCheckpoints ? (
            <p className="text-[9pt]">
              Kontrollpunkter märkta med foto ska verifieras med fotounderlag eller egenkontroll när momentet inte
              är direkt åtkomligt vid besiktningen.
            </p>
          ) : null}
        </div>
      )}
    </ReportSection>
  )
}

function DrainageChecklistGroupReport({
  groupLabel,
  checkpoints,
}: {
  groupLabel: string
  checkpoints: ReturnType<typeof numberedCheckpointGroups>[number]['checkpoints']
}) {
  return (
    <section className="eb-report-section break-inside-avoid text-[9.5pt] leading-[1.25] text-black">
      <h3 className="mb-1 text-[10pt] font-bold text-black">{groupLabel}</h3>
      <div className="grid border-t border-l border-black/50">
        <div className="grid grid-cols-[10mm_42mm_24mm_1fr] bg-[#eaf4ef] font-bold">
          <div className="border-r border-b border-black/50 px-1.5 py-1">Nr</div>
          <div className="border-r border-b border-black/50 px-1.5 py-1">Kontrollpunkt</div>
          <div className="border-r border-b border-black/50 px-1.5 py-1">Status</div>
          <div className="border-r border-b border-black/50 px-1.5 py-1">Kommentar</div>
        </div>
        {checkpoints.map(({ checkpoint, number }) => (
          <div key={checkpoint.id} className="grid grid-cols-[10mm_42mm_24mm_1fr]">
            <div className="border-r border-b border-black/50 px-1.5 py-1">{number}</div>
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
  const explanations: Record<string, string> = {
    E: 'Anger att besiktningsmannen bedömer entreprenören ansvarig för felet.',
    B: 'Anger att besiktningsmannen inte bedömer entreprenören ansvarig för förhållandet. Avhjälpande kräver särskild överenskommelse eller beställning.',
    S: 'Anger att förhållandet ska klarläggas genom särskild utredning innan slutlig bedömning görs.',
    U: 'Anger att noteringen har utgått och inte längre redovisas som ett kvarstående fel.',
    N: 'Anger att en uppskattad nedsättning av avtalat pris kan vara aktuell för felet.',
    A: 'Anger en anmärkning eller upplysning som inte har bedömts som ett entreprenadfel.',
  }
  return explanations[marker.key] ?? marker.label
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
  const decisionLabel = isApproved
    ? 'Arbetena godkänns'
    : isPartlyApproved
      ? 'Arbetena godkänns delvis'
      : 'Arbetena godkänns inte'
  const statusClassName = isApproved
    ? 'border-[#2f7d55] bg-[#eef7f2]'
    : isPartlyApproved
      ? 'border-[#a16207] bg-[#fffbeb]'
      : 'border-[#991b1b] bg-[#fef2f2]'

  return (
    <ReportSection title="Besked om godkännande">
      <div
        className={`break-inside-avoid border-l-[4px] px-4 py-3 text-black ${statusClassName}`}
      >
        <p className="text-[14pt] font-bold leading-tight">
          {decisionLabel}{isApproved && decisionDate ? ` ${decisionDate}` : ''}.
        </p>
        {isApproved ? (
          <p className="mt-2 text-[10.5pt] leading-[1.35]">
            Beslutet meddelades av besiktningsmannen till parterna vid besiktningen.
          </p>
        ) : (
          <div className="mt-2 space-y-2 text-[10.5pt] leading-[1.35]">
            <p>
              Noterade fel anses sammantaget inte vara av mindre betydelse.
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
          </div>
        )}
      </div>
    </ReportSection>
  )
}

function reportRecipients(report: EbInspectionReport) {
  return report.participants.filter((participant) => participant.receivesReport)
}

type EbInspectorSignature = NonNullable<EbInspectionReport['branding']['signature']>

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

function inspectorSignatureForReport(report: EbInspectionReport): EbInspectorSignature | null {
  const signature = report.branding.signature
  if (signature) {
    return {
      ...signature,
      signatureUrl: signature.signatureUrl ?? report.branding.inspectorSignatureUrl ?? null,
      avatarUrl: signature.avatarUrl ?? report.branding.inspectorAvatarUrl ?? null,
    }
  }

  const fallbackRows = signatureRows(report)
  const signatureUrl = report.branding.inspectorSignatureUrl ?? null
  const avatarUrl = report.branding.inspectorAvatarUrl ?? null
  const credentialLines = fallbackRows.details
    .filter((row) => row.label !== 'Telefon' && row.label !== 'E-post')
    .map((row) => `${row.label}: ${row.value}`)

  if (!signatureUrl && !avatarUrl && fallbackRows.name === '-' && credentialLines.length === 0) return null

  return {
    locationAndDate: '',
    inspectorName: fallbackRows.name !== '-' ? fallbackRows.name : 'Besiktningsman',
    avatarUrl,
    signatureUrl,
    credentialLines,
  }
}

function DistributionListReport({ report }: { report: EbInspectionReport }) {
  const recipients = reportRecipients(report)
  const sentAt = report.inspection.reportLastSentAt?.trim()
  const parsedSentAt = sentAt ? new Date(sentAt) : null
  const distributionDate =
    parsedSentAt && !Number.isNaN(parsedSentAt.getTime())
      ? parsedSentAt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
      : null

  return (
    <ReportSection title="Sändlista">
        <div className="space-y-4 text-[10.5pt] leading-[1.35] text-black">
          <p>
            {distributionDate
              ? `Undertecknat utlåtande har ${distributionDate} sänts per e-post till parterna och övriga enligt nedan.`
              : 'Utlåtandet har ännu inte skickats digitalt. Nedan visas avsedda mottagare.'}
          </p>

          {recipients.length > 0 ? (
            <table className="w-full border-collapse text-[9.5pt] leading-tight text-black">
              <thead>
                <tr className="bg-[#2f7d55] text-left text-white print:bg-[#2f7d55]">
                  <th className="w-[58mm] px-1.5 py-1 font-bold">Företag</th>
                  <th className="w-[58mm] px-1.5 py-1 font-bold">Namn</th>
                  <th className="px-1.5 py-1 font-bold">E-post</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((recipient, index) => (
                  <tr key={recipient.id ?? `${recipient.email}-${index}`}>
                    <td className="px-1.5 py-0.5">{recipient.companyName?.trim() || ''}</td>
                    <td className="px-1.5 py-0.5">{recipient.personName?.trim() || ''}</td>
                    <td className="px-1.5 py-0.5">{recipient.email?.trim() || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>Mottagare av utlåtandet har inte angetts.</p>
          )}

        </div>
    </ReportSection>
  )
}

function ContinuedFinalInspectionReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  const date = report.inspection.continuedFinalInspectionDate?.trim()
  const time = report.inspection.continuedFinalInspectionTime?.trim().slice(0, 5)

  if (section.contentMode !== 'mixed') {
    return (
      <ReportSection title={section.title}>
        <ReportText text={section.text} />
      </ReportSection>
    )
  }

  return (
    <ReportSection title={section.title}>
      <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
        <EditableReportText text={section.text} />
        {date || time ? (
          <p>
            Enligt överenskommelse verkställs ny slutbesiktning{' '}
            {date || 'Klicka här - ange datum'}, kl {time || '??:??'}.
          </p>
        ) : null}
      </div>
    </ReportSection>
  )
}

function ReclamationNoticeReport({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
}) {
  const warrantyEndDate = report.inspection.warrantyEndDate?.trim()
  const warrantyScope = report.inspection.warrantyScope?.trim()

  if (section.contentMode !== 'mixed') {
    return (
      <ReportSection title={section.title}>
        <ReportText text={section.text} />
      </ReportSection>
    )
  }

  return (
    <ReportSection title={section.title}>
      <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
        <EditableReportText text={section.text} />
        {warrantyEndDate && warrantyScope ? (
          <ul className="list-disc pl-7">
            <li>{warrantyEndDate} för {warrantyScope}</li>
          </ul>
        ) : (
          <p>Ingen särskild varugaranti har angetts.</p>
        )}
      </div>
    </ReportSection>
  )
}

function InspectorSignatureCard({
  signature,
  hasPhotoAppendix,
  onImageError,
}: {
  signature: EbInspectorSignature
  hasPhotoAppendix: boolean
  onImageError: (message: string) => void
}) {
  const hasCredentials = signature.credentialLines.length > 0

  return (
    <section
      className="tu-report-block tu-report-signature-block border-t border-violet-200 pt-5"
      style={{ marginTop: mm(4), marginBottom: mm(6) }}
    >
      <div className="w-[72mm]">
        {signature.avatarUrl ? (
          <div className="mb-2 h-[26mm] w-[26mm] overflow-hidden bg-white">
            <img
              src={signature.avatarUrl}
              alt={signature.inspectorName}
              data-eb-print-measure-image="true"
              onError={(event) => {
                event.currentTarget.dataset.ebImageFailed = 'true'
                onImageError('Besiktningsmannens profilbild kunde inte läsas in.')
              }}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}

        <div className="text-[13px] font-semibold leading-5 text-gray-950">
          {signature.locationAndDate}
        </div>

        {signature.signatureUrl ? (
          <div className="mt-3 flex h-[16mm] w-[42mm] items-center overflow-hidden bg-white">
            <img
              src={signature.signatureUrl}
              alt={`Underskrift ${signature.inspectorName}`}
              data-eb-print-measure-image="true"
              onError={(event) => {
                event.currentTarget.dataset.ebImageFailed = 'true'
                onImageError('Besiktningsmannens signatur kunde inte läsas in.')
              }}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}

        <div className="mt-2 text-[13px] font-semibold leading-5 text-gray-950">
          {signature.inspectorName}
        </div>
        {hasCredentials ? (
          <div className="mt-0.5 space-y-0.5 text-[12px] leading-5 text-gray-950">
            {signature.credentialLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
        {hasPhotoAppendix ? (
          <p className="mt-4 border-l-2 border-[#2f7d55] pl-3 text-[10.5pt] font-semibold leading-[1.35] text-black">
            Signeringen omfattar detta utlåtande inklusive Bilaga 1 – Fotobilaga.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function defectNoErrorPartsPolicyText(report: EbInspectionReport) {
  return report.inspection.defectNoErrorPartsPolicy === 'listed_with_dash' ? 'med ---' : 'inte'
}

function DefectsConditionsReport({
  report,
  section,
  displayNumberByNoteId,
}: {
  report: EbInspectionReport
  section: EbInspectionReport['reportDraft']['sections'][number]
  displayNumberByNoteId: Map<string, number>
}) {
  const markers = usedReportMarkers(report)
  const markerLegendSection = report.reportDraft.sections.find(
    (candidate) => candidate.key === 'marker_legend'
  )
  const deductionSection = report.reportDraft.sections.find(
    (candidate) => candidate.key === 'deduction'
  )
  const showMarkerLegend = markerLegendSection?.isRelevant !== false
  const showDeduction = deductionSection?.isRelevant !== false

  return (
    <ReportSection title={section.title}>
      <div className="space-y-2 text-[10.5pt] leading-[1.35] text-black">
        {section.contentMode !== 'mixed' ? (
          <p>
            Under denna rubrik redovisas de fel, bristfälligheter, anmärkningar och förhållanden som
            antecknats vid besiktningen.
          </p>
        ) : (
          <EditableReportText text={section.text} />
        )}
        {showMarkerLegend ? (
          markerLegendSection?.contentMode === 'mixed' ? (
            <>
              <EditableReportText text={markerLegendSection.text} />
              {markers.length > 0 ? (
                <div className="pt-1">
                  <p className="underline">Använda beteckningar:</p>
                  <dl className="mt-2 grid gap-y-1">
                    {markers.map((marker) => (
                      <div key={marker.key} className="grid grid-cols-[22mm_1fr] gap-x-4">
                        <dt className="font-bold">{marker.key}</dt>
                        <dd>{markerExplanation(marker)}</dd>
                        {marker.key === 'N' && showDeduction ? (
                          <DeductionNotesList
                            report={report}
                            displayNumberByNoteId={displayNumberByNoteId}
                          />
                        ) : null}
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="underline">Förklaringar för respektive kolumn:</p>
              <dl className="grid gap-y-1">
                <div className="grid grid-cols-[22mm_1fr] gap-x-4">
                  <dt>Bes.</dt>
                  <dd>Besiktningstyp och löpnummer för den besiktning där noteringen gjordes.</dd>
                </div>
                <div className="grid grid-cols-[22mm_1fr] gap-x-4">
                  <dt>Bet.</dt>
                  <dd>Beteckning med markering:</dd>
                </div>
                {markers.map((marker) => (
                  <div key={marker.key} className="grid grid-cols-[22mm_1fr] gap-x-4">
                    <dt className="pl-[16mm] font-bold">{marker.key}</dt>
                    <dd>{markerExplanation(marker)}</dd>
                    {marker.key === 'N' && showDeduction ? (
                      <DeductionNotesList
                        report={report}
                        displayNumberByNoteId={displayNumberByNoteId}
                      />
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
            </>
          )
        ) : null}

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

function ReportOpening({ report }: { report: EbInspectionReport }) {
  const objectIdentity = (
    report.project.propertyDesignation?.trim() ||
    report.project.brfApartmentNumber?.trim() ||
    report.project.title.trim()
  ).toLocaleUpperCase('sv-SE')
  const addressAndCity = [report.project.address?.trim(), report.project.city?.trim()]
    .filter(Boolean)
    .join(', ')
  const projectDescription =
    report.project.objectDescription?.trim() ||
    report.project.contractName?.trim() ||
    report.project.title.trim()
  const agreement = report.project.standardAgreement?.trim() || report.project.contractForm?.trim()
  const lines = [
    objectIdentity,
    addressAndCity,
    report.project.clientName?.trim(),
    projectDescription,
    agreement,
  ].filter((line): line is string => Boolean(line))

  return (
    <section className="eb-report-section break-inside-avoid text-left text-black">
      <h1 className={`${REPORT_TITLE_HEADING_CLASS_NAME} text-center ${lines.length > 0 ? 'mb-[11mm]' : ''}`}>
        {reportDocumentTitle(report)}
      </h1>
      {lines.length > 0 ? (
        <div className={REPORT_OPENING_METADATA_CLASS_NAME}>
          {lines.map((line, index) => (
            <p key={`${index}-${line}`} className="whitespace-pre-wrap">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function reportImageSrc(image: EbNoteImage) {
  const params = new URLSearchParams({
    url: image.publicUrl,
    max: '1400',
    q: '68',
  })
  return `/api/image-proxy?${params.toString()}`
}

function noteLocationLine(note: EbNote) {
  return detailLine([note.room, note.location, note.placeDetail])
}

function sortReportNoteHeadings(headings: EbReportNoteHeading[]) {
  return [...headings].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return left.id.localeCompare(right.id)
  })
}

function NoteTableHeader() {
  return (
    <thead>
      <tr className="bg-[#2f7d55] text-left text-white print:bg-[#2f7d55]">
        <th className="border border-[#8bb6a0] px-1.5 py-1 font-bold">Bes.</th>
        <th className="border border-[#8bb6a0] px-1.5 py-1 font-bold">Bet.</th>
        <th className="border border-[#8bb6a0] px-1.5 py-1 font-bold">Nr</th>
        <th className="border border-[#8bb6a0] px-1.5 py-1 font-bold">Del / Rum</th>
        <th className="border border-[#8bb6a0] px-1.5 py-1 font-bold">Fel</th>
        <th className="border border-[#8bb6a0] px-1.5 py-1 font-bold">Avhjälpt /sign</th>
      </tr>
    </thead>
  )
}

function NoteTable({
  note,
  headings,
  headingsAfter = [],
  inspectionReference,
  showHeader,
  displayNumber,
  noteText,
  continuation = false,
}: {
  note: EbNote
  headings: EbReportNoteHeading[]
  headingsAfter?: EbReportNoteHeading[]
  inspectionReference: string
  showHeader: boolean
  displayNumber: number
  noteText: string
  continuation?: boolean
}) {
  return (
    <table className="w-full table-fixed border-collapse text-[9.5pt] leading-tight text-black">
      <colgroup>
        <col style={{ width: mm(12) }} />
        <col style={{ width: mm(10) }} />
        <col style={{ width: mm(12) }} />
        <col style={{ width: mm(38) }} />
        <col />
        <col style={{ width: mm(22) }} />
      </colgroup>
      {showHeader ? <NoteTableHeader /> : null}
      <tbody>
        {headings.map((heading) => (
          <tr key={heading.id} className="break-inside-avoid">
            <th
              colSpan={6}
              scope="rowgroup"
              className="border border-[#8bb6a0] bg-[#eaf4ee] px-2 py-1.5 text-left text-[10.5pt] font-bold leading-tight text-black"
            >
              {heading.title}
            </th>
          </tr>
        ))}
        <tr className="break-inside-avoid">
          <td className="align-top border border-[#8bb6a0] px-1.5 py-1.5">
            {inspectionReference}
          </td>
          <td className="align-top border border-[#8bb6a0] px-1.5 py-1.5">
            {note.markerKey || ''}
          </td>
          <td className="align-top border border-[#8bb6a0] px-1.5 py-1.5">
            {displayNumber}
          </td>
          <td className="align-top border border-[#8bb6a0] px-1.5 py-1.5">
            {detailLine([note.room, note.location, note.placeDetail]) !== '-'
              ? detailLine([note.room, note.location, note.placeDetail])
              : ''}
          </td>
          <td className="whitespace-pre-wrap align-top border border-[#8bb6a0] px-1.5 py-1.5">
            {continuation ? <span className="font-bold">Fortsättning: </span> : null}
            {noteText}
          </td>
          <td className="align-top border border-[#8bb6a0] px-1.5 py-1.5" />
        </tr>
        {headingsAfter.map((heading) => (
          <tr key={heading.id} className="break-inside-avoid">
            <th
              colSpan={6}
              scope="rowgroup"
              className="border border-[#8bb6a0] bg-[#eaf4ee] px-2 py-1.5 text-left text-[10.5pt] font-bold leading-tight text-black"
            >
              {heading.title}
            </th>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function photoReferenceLabel(note: EbNote, checkpointNumber: number | undefined, displayNumber: number | undefined) {
  if (checkpointNumber) return `Kontrollpunkt ${checkpointNumber}`
  if (displayNumber) return `Notering ${displayNumber}`
  return note.noteNumber ? `Notering ${note.noteNumber}` : 'Notering'
}

const REPORT_TEXT_CHUNK_MAX_LENGTH = 800
const REPORT_TEXT_CHUNK_MAX_LINES = 16

function splitReportTextForPage(value: string) {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  const sourceLines = normalized.split('\n')
  const chunks: string[] = []
  let currentLines: string[] = []
  let currentLength = 0

  const flush = () => {
    if (currentLines.length === 0) return
    chunks.push(currentLines.join('\n').trimEnd())
    currentLines = []
    currentLength = 0
  }

  for (const sourceLine of sourceLines) {
    let remainingLine = sourceLine
    const lineParts: string[] = []
    while (remainingLine.length > REPORT_TEXT_CHUNK_MAX_LENGTH) {
      const minimumBreak = Math.floor(REPORT_TEXT_CHUNK_MAX_LENGTH * 0.6)
      const spaceBreak = remainingLine.lastIndexOf(' ', REPORT_TEXT_CHUNK_MAX_LENGTH)
      const breakIndex = spaceBreak >= minimumBreak ? spaceBreak : REPORT_TEXT_CHUNK_MAX_LENGTH
      lineParts.push(remainingLine.slice(0, breakIndex).trimEnd())
      remainingLine = remainingLine.slice(breakIndex).trimStart()
    }
    lineParts.push(remainingLine)

    for (const linePart of lineParts) {
      const separatorLength = currentLines.length > 0 ? 1 : 0
      if (
        currentLines.length >= REPORT_TEXT_CHUNK_MAX_LINES ||
        currentLength + separatorLength + linePart.length > REPORT_TEXT_CHUNK_MAX_LENGTH
      ) {
        flush()
      }
      currentLines.push(linePart)
      currentLength += (currentLines.length > 1 ? 1 : 0) + linePart.length
    }
  }
  flush()
  return chunks
}

type PhotoAppendixPhoto = {
  id: string
  referenceLabel: string
  location: string
  noteText: string
  image: EbNoteImage
  imageNumber: number
  totalImages: number
}

type PhotoAppendixSection = {
  id: string
  headings: EbReportNoteHeading[]
  photos: PhotoAppendixPhoto[]
}

function PhotoAppendixSectionBlock({
  section,
  photos,
  showTitle = false,
  showHeadings = false,
  onImageError,
}: {
  section: PhotoAppendixSection
  photos: PhotoAppendixPhoto[]
  showTitle?: boolean
  showHeadings?: boolean
  onImageError: (message: string) => void
}) {
  return (
    <section className="eb-report-section">
      {showTitle ? <h2 className={REPORT_APPENDIX_HEADING_CLASS_NAME}>BILAGA 1 – FOTOBILAGA</h2> : null}
      {showHeadings
        ? section.headings.map((heading) => (
            <h3
              key={heading.id}
              className="mb-2 border-y border-[#8bb6a0] bg-[#eaf4ee] px-2 py-1.5 text-[11pt] font-bold leading-tight text-black"
            >
              {heading.title}
            </h3>
          ))
        : null}
      <div className="eb-report-photo-grid grid grid-cols-2 gap-x-6 gap-y-5">
        {photos.map((photo) => {
          const imageLabel = photo.image.label?.trim()
          return (
            <figure
              key={photo.id}
              className="eb-report-photo-figure grid break-inside-avoid grid-rows-[auto_64mm] gap-1"
            >
              <figcaption className="break-words text-[9pt] leading-tight text-black">
                <p className="font-bold">
                  {photo.referenceLabel}
                  {photo.location !== '-' ? ` · ${photo.location}` : ''}
                </p>
                <p>Bild {photo.imageNumber} av {photo.totalImages}</p>
                {imageLabel ? (
                  <p className="whitespace-pre-wrap break-words">{imageLabel}</p>
                ) : null}
                {photo.imageNumber === 1 && photo.noteText ? (
                  <p className="whitespace-pre-wrap break-words">Notering: {photo.noteText}</p>
                ) : null}
              </figcaption>
              <img
                src={reportImageSrc(photo.image)}
                alt={`Bild ${photo.imageNumber} av ${photo.totalImages} till ${photo.referenceLabel.toLocaleLowerCase('sv-SE')}`}
                data-eb-print-measure-image="true"
                onError={(event) => {
                  event.currentTarget.dataset.ebImageFailed = 'true'
                  onImageError(
                    `${photo.referenceLabel}, bild ${photo.imageNumber}: bilden kunde inte läsas in.`
                  )
                }}
                className="eb-report-photo-image h-full w-full object-contain"
                style={{ objectPosition: 'center center' }}
              />
            </figure>
          )
        })}
      </div>
    </section>
  )
}

type EbPrintableBlock = {
  id: string
  node?: ReactNode
  render?: (context: { showRepeatHeader: boolean }) => ReactNode
  repeatHeaderKey?: string
  pageKind?: 'photo-appendix'
  startsNewPage?: boolean
  keepWithNext?: boolean
  spacingAfterMm?: number
}

type EbPlannedBlock = {
  block: EbPrintableBlock
  showRepeatHeader: boolean
}

type EbPagePlan = {
  pages: EbPlannedBlock[][]
  blocks: EbPrintableBlock[]
}

type EbPagePlanPages = Pick<EbPagePlan, 'pages'>

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

function readEbBlockHeight(element: HTMLElement) {
  const target = element.firstElementChild instanceof HTMLElement ? element.firstElementChild : element
  const rect = target.getBoundingClientRect()
  const style = window.getComputedStyle(target)
  const marginTop = Number.parseFloat(style.marginTop || '0') || 0
  const marginBottom = Number.parseFloat(style.marginBottom || '0') || 0
  return rect.height + marginTop + marginBottom
}

function blockMeasurementKey(block: EbPrintableBlock, showRepeatHeader: boolean) {
  return `${block.id}::${showRepeatHeader ? 'with-repeat-header' : 'without-repeat-header'}`
}

function createEbPagePlan(blocks: EbPrintableBlock[], heights: Map<string, number>): EbPagePlanPages {
  const maxHeight = mmToPxNumber(EB_PAGE_CONTENT_HEIGHT_MM - EB_PAGE_PACKING_SAFETY_MM)
  const pages: EbPlannedBlock[][] = []
  let current: EbPlannedBlock[] = []
  let currentHeight = 0
  let renderedRepeatHeaders = new Set<string>()

  const finishPage = () => {
    if (current.length > 0) pages.push(current)
    current = []
    currentHeight = 0
    renderedRepeatHeaders = new Set<string>()
  }

  for (const [blockIndex, block] of blocks.entries()) {
    if (block.startsNewPage && current.length > 0) {
      finishPage()
    }

    let showRepeatHeader = Boolean(
      block.repeatHeaderKey && !renderedRepeatHeaders.has(block.repeatHeaderKey)
    )
    let height = heights.get(blockMeasurementKey(block, showRepeatHeader)) ?? 0

    const nextBlock = block.keepWithNext ? blocks[blockIndex + 1] : undefined
    if (current.length > 0 && nextBlock) {
      const repeatHeadersAfterBlock = new Set(renderedRepeatHeaders)
      if (block.repeatHeaderKey) repeatHeadersAfterBlock.add(block.repeatHeaderKey)
      const nextShowsRepeatHeader = Boolean(
        nextBlock.repeatHeaderKey && !repeatHeadersAfterBlock.has(nextBlock.repeatHeaderKey)
      )
      const nextHeight =
        heights.get(blockMeasurementKey(nextBlock, nextShowsRepeatHeader)) ?? 0
      if (
        currentHeight + height + nextHeight > maxHeight &&
        height + nextHeight <= maxHeight
      ) {
        finishPage()
        showRepeatHeader = Boolean(block.repeatHeaderKey)
        height = heights.get(blockMeasurementKey(block, showRepeatHeader)) ?? 0
      }
    }

    if (current.length > 0 && currentHeight + height > maxHeight) {
      finishPage()
      showRepeatHeader = Boolean(block.repeatHeaderKey)
      height = heights.get(blockMeasurementKey(block, showRepeatHeader)) ?? 0
    }

    current.push({ block, showRepeatHeader })
    currentHeight += height
    if (block.repeatHeaderKey) renderedRepeatHeaders.add(block.repeatHeaderKey)
  }

  finishPage()
  return { pages }
}

function EbHeaderValue({
  label,
  value,
  nowrap = false,
}: {
  label: string
  value: string
  nowrap?: boolean
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col justify-start overflow-hidden px-1.5 py-0.5">
      <div className="shrink-0 text-[6pt] leading-[1.15] text-black">{label}</div>
      <div
        className={`mt-auto min-w-0 shrink-0 text-[9pt] font-normal leading-[1.1] text-black ${
          nowrap ? 'whitespace-nowrap' : 'break-words'
        }`}
      >
        {value || '-'}
      </div>
    </div>
  )
}

function EbPageHeader({
  report,
  pageNumber,
  totalPages,
  photoAppendix,
}: {
  report: EbInspectionReport
  pageNumber: number
  totalPages: number
  photoAppendix: boolean
}) {
  const propertyDesignation = report.project.propertyDesignation?.trim()
  const municipality = report.project.municipality?.trim()
  const brfApartmentNumber = report.project.brfApartmentNumber?.trim()
  const primaryObjectIdentifier = propertyDesignation || brfApartmentNumber
  const objectIdentifier = detailLine([primaryObjectIdentifier, municipality])
  const objectIdentifierLabel =
    primaryObjectIdentifier && municipality
      ? propertyDesignation
        ? 'Fastighetsbeteckning / kommun'
        : 'Objekt / kommun'
      : propertyDesignation
        ? 'Fastighetsbeteckning'
        : brfApartmentNumber
          ? 'Objekt'
          : municipality
            ? 'Kommun'
            : 'Objekt'
  const pageValue = `${pageNumber} (${totalPages})`
  const documentLabel = photoAppendix ? 'Bilaga 1 till utlåtande' : 'Dokument'
  const documentValue = photoAppendix
    ? reportReference(report) ?? reportPrintTitle(report)
    : reportDocumentTitle(report)

  return (
    <div
      className="eb-report-header-table grid overflow-hidden border border-emerald-700 text-[8pt] leading-tight text-black"
      style={{
        height: mm(21),
        gridTemplateColumns: '58mm 42mm 52mm 34mm',
        gridTemplateRows: '10.5mm 10.5mm',
      }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden border-b border-r border-emerald-700">
        <EbHeaderValue
          label={documentLabel}
          value={documentValue}
        />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-b border-r border-emerald-700">
        <EbHeaderValue label="Besiktningsdatum" value={report.inspection.date ?? '-'} nowrap />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-b border-r border-emerald-700">
        <EbHeaderValue label="Besiktningstyp" value={report.inspection.variantLabel} />
      </div>
      <div className="row-span-2 min-h-0 min-w-0 overflow-hidden">
        <div className="flex h-full items-center justify-center p-1.5">
          {report.branding.inspectorLogoUrl ? (
            <img
              src={report.branding.inspectorLogoUrl}
              alt="Besiktningsmannens logotyp"
              className="eb-report-header-logo h-auto max-h-[16mm] max-w-[30mm] object-contain"
            />
          ) : (
            <span className="text-center text-[8pt] font-semibold">{reportPrintTitle(report)}</span>
          )}
        </div>
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-emerald-700">
        <EbHeaderValue label={objectIdentifierLabel} value={objectIdentifier} />
      </div>
      <div className="col-span-1 min-h-0 min-w-0 overflow-hidden border-r border-emerald-700">
        <EbHeaderValue label="Adress" value={detailLine([report.project.address, report.project.city])} />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-emerald-700">
        <EbHeaderValue label="Sida" value={pageValue} nowrap />
      </div>
    </div>
  )
}

function EbPageFooter({ report }: { report: EbInspectionReport }) {
  const inspector = signatureRows(report)
  const fallbackContactLines = inspector.details
    .filter((row) => row.label === 'Telefon' || row.label === 'E-post')
    .map((row) => row.value)
  const companyLines =
    report.branding.footer.companyLines.length > 0
      ? report.branding.footer.companyLines
      : inspector.name !== '-'
        ? [inspector.name]
        : []
  const contactLines =
    report.branding.footer.contactLines.length > 0 ? report.branding.footer.contactLines : fallbackContactLines

  return (
    <footer
      className="eb-report-footer absolute grid grid-cols-3 items-end gap-4 border-t border-emerald-700 pt-1.5 text-[8px] leading-[1.25] text-gray-700"
      style={{
        left: mm(EB_PAGE_X_PADDING_MM),
        right: mm(EB_PAGE_X_PADDING_MM),
        bottom: mm(6),
        height: mm(15),
      }}
    >
      <div className="min-w-0 self-end">
        {companyLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div className="min-w-0 self-end text-center">
        {contactLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div className="flex min-w-0 justify-end self-end">
        <div className="flex flex-col items-center justify-end gap-1 text-center text-[8px] text-gray-500">
          <span>Skapat med</span>
          <img
            src={report.branding.besiktAppLogoUrl}
            alt="BesiktApp"
            className="eb-report-footer-logo h-auto max-h-[4mm] max-w-[22mm] object-contain"
          />
        </div>
      </div>
    </footer>
  )
}

function EbReportPageChrome({
  report,
  pageNumber,
  totalPages,
  photoAppendix,
  children,
}: {
  report: EbInspectionReport
  pageNumber: number
  totalPages: number
  photoAppendix: boolean
  children: ReactNode
}) {
  const pageStyle = {
    width: mm(EB_PAGE_WIDTH_MM),
    height: mm(EB_PAGE_HEIGHT_MM),
    minHeight: mm(EB_PAGE_HEIGHT_MM),
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  } satisfies CSSProperties

  return (
    <section className="eb-report-page bg-white shadow-sm ring-1 ring-gray-200" style={pageStyle}>
      <header
        className="absolute"
        style={{
          top: mm(EB_PAGE_HEADER_TOP_MM),
          left: mm(EB_PAGE_X_PADDING_MM),
          right: mm(EB_PAGE_X_PADDING_MM),
        }}
      >
        <EbPageHeader
          report={report}
          pageNumber={pageNumber}
          totalPages={totalPages}
          photoAppendix={photoAppendix}
        />
      </header>

      <div
        className="absolute overflow-hidden"
        style={{
          top: mm(EB_PAGE_CONTENT_TOP_MM),
          left: mm(EB_PAGE_X_PADDING_MM),
          right: mm(EB_PAGE_X_PADDING_MM),
          bottom: mm(EB_PAGE_CONTENT_BOTTOM_MM),
        }}
      >
        {children}
      </div>

      <EbPageFooter report={report} />
    </section>
  )
}

function EbPrintableBlockView({
  block,
  showRepeatHeader = false,
}: {
  block: EbPrintableBlock
  showRepeatHeader?: boolean
}) {
  return (
    <div
      className="eb-report-block"
      style={{ marginBottom: mm(block.spacingAfterMm ?? 4) }}
    >
      {block.render ? block.render({ showRepeatHeader }) : block.node}
    </div>
  )
}

function EbPrintPagedDocument({
  report,
  blocks,
}: {
  report: EbInspectionReport
  blocks: EbPrintableBlock[]
}) {
  const [pagePlan, setPagePlan] = useState<EbPagePlan | null>(null)
  const [measureVersion, setMeasureVersion] = useState(0)

  useLayoutEffect(() => {
    const measureRoot = document.querySelector<HTMLElement>('.eb-print-measure')
    const images = Array.from(
      measureRoot?.querySelectorAll<HTMLImageElement>('[data-eb-print-measure-image="true"]') ?? []
    )
    const imagesReady = images.every(
      (image) => image.complete && (image.naturalWidth > 0 || image.dataset.ebImageFailed === 'true')
    )

    if (!imagesReady) {
      const timeout = window.setTimeout(() => setMeasureVersion((version) => version + 1), 80)
      return () => window.clearTimeout(timeout)
    }

    let cancelled = false
    const frame = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (cancelled) return
        const heights = new Map<string, number>()
        const measuredBlocks = Array.from(
          measureRoot?.querySelectorAll<HTMLElement>('[data-eb-print-measure-key]') ?? []
        )
        for (const element of measuredBlocks) {
          const key = element.dataset.ebPrintMeasureKey
          if (!key) continue
          heights.set(key, readEbBlockHeight(element))
        }
        setPagePlan({ ...createEbPagePlan(blocks, heights), blocks })
      }, 40)
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [blocks, measureVersion])

  const pagePlanReady = pagePlan?.blocks === blocks
  const pages = pagePlanReady ? pagePlan.pages : []
  const totalPages = Math.max(1, pages.length)

  return (
    <div
      className="report-root eb-print-paged-document"
      data-eb-print-pagination-ready={pagePlanReady ? '1' : '0'}
      data-report-pagination-ready={pagePlanReady ? '1' : '0'}
    >
      <div
        className="eb-print-measure pointer-events-none absolute left-[-10000px] top-0 opacity-0"
        aria-hidden="true"
        style={{ width: mm(EB_PAGE_CONTENT_WIDTH_MM) }}
      >
        {blocks.flatMap((block) => {
          const variants = block.repeatHeaderKey ? [false, true] : [false]
          return variants.map((showRepeatHeader) => {
            const measurementKey = blockMeasurementKey(block, showRepeatHeader)
            return (
              <div key={measurementKey} data-eb-print-measure-key={measurementKey}>
                <EbPrintableBlockView block={block} showRepeatHeader={showRepeatHeader} />
              </div>
            )
          })
        })}
      </div>

      {!pagePlanReady ? (
        <div className="mx-auto my-8 max-w-5xl rounded-md border border-emerald-100 bg-white p-6 text-sm text-gray-600 shadow-sm print:hidden">
          Förbereder utskriftslayout...
        </div>
      ) : null}

      <div className="eb-print-pages flex flex-col items-center gap-4">
        {pages.map((pageBlocks, pageIndex) => {
          const photoAppendix = pageBlocks.some(({ block }) => block.pageKind === 'photo-appendix')
          return (
            <EbReportPageChrome
              key={`eb-print-page-${pageIndex}`}
              report={report}
              pageNumber={pageIndex + 1}
              totalPages={totalPages}
              photoAppendix={photoAppendix}
            >
              {pageBlocks.map(({ block, showRepeatHeader }) => (
                <EbPrintableBlockView
                  key={block.id}
                  block={block}
                  showRepeatHeader={showRepeatHeader}
                />
              ))}
            </EbReportPageChrome>
          )
        })}
      </div>
    </div>
  )
}

export default function EbInspectionReportView({
  report,
  showInternalActions = true,
  publicActions,
}: EbInspectionReportViewProps) {
  const router = useRouter()
  const { showError } = useEbToast()
  const [pendingNavigationKey, setPendingNavigationKey] = useState<string | null>(null)
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const printTitle = reportPrintTitle(report)
  const notes = useMemo(() => sortNotes(report.notes), [report.notes])
  const noteHeadings = useMemo(
    () => sortReportNoteHeadings(report.reportDraft.noteHeadings ?? []),
    [report.reportDraft.noteHeadings]
  )
  const noteHeadingsByNoteId = useMemo(() => {
    const grouped = new Map<string, EbReportNoteHeading[]>()
    for (const heading of noteHeadings) {
      if (!heading.beforeNoteId) continue
      grouped.set(heading.beforeNoteId, [...(grouped.get(heading.beforeNoteId) ?? []), heading])
    }
    return grouped
  }, [noteHeadings])
  const trailingNoteHeadings = useMemo(
    () => noteHeadings.filter((heading) => !heading.beforeNoteId),
    [noteHeadings]
  )
  const displayNumberByNoteId = useMemo(
    () => new Map(notes.map((note, index) => [note.id, index + 1])),
    [notes]
  )
  const drainageReport = isDrainageReport(report)
  const handleNavigation = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
    if (pendingNavigationKey) {
      event.preventDefault()
      return
    }
    setPendingNavigationKey(key)
  }
  const printableSections = useMemo(
    () =>
      report.reportDraft.sections.filter(
        (section) =>
          section.isRelevant &&
          !isEbReportSectionIntegrated(section.key) &&
          isEbReportSectionApplicable({
            sectionKey: section.key,
            inspectionVariant: report.inspection.variant,
            projectTemplateKey: report.project.projectTemplateKey,
          }) &&
          !(
            section.key === 'previous_inspections_tests' &&
            report.inspection.previousInspections.every((row) => !row.status && !row.date?.trim())
          )
      ),
    [
      report.inspection.previousInspections,
      report.inspection.variant,
      report.project.projectTemplateKey,
      report.reportDraft.sections,
    ]
  )
  const scopeSection = useMemo(
    () => printableSections.find((section) => section.key === 'scope') ?? null,
    [printableSections]
  )
  const inspectionTypeSection = useMemo(
    () =>
      report.reportDraft.sections.find(
        (section) =>
          section.key === 'inspection_type' &&
          section.isRelevant &&
          isEbReportSectionApplicable({
            sectionKey: section.key,
            inspectionVariant: report.inspection.variant,
            projectTemplateKey: report.project.projectTemplateKey,
          })
      ) ?? null,
    [
      report.inspection.variant,
      report.project.projectTemplateKey,
      report.reportDraft.sections,
    ]
  )
  const reportSections = useMemo(
    () => printableSections.filter((section) => section.key !== 'scope'),
    [printableSections]
  )
  const imagesByNoteId = useMemo(() => {
    const grouped = new Map<string, EbNoteImage[]>()
    const seenByNoteId = new Map<string, Set<string>>()
    for (const image of report.images) {
      if (!image.noteId) continue
      const imageKey = image.sourceAttachmentId
        ? `source:${image.sourceAttachmentId}`
        : image.filePath
          ? `path:${image.filePath}`
          : image.label
            ? `label:${image.label}`
            : `id:${image.id}`
      const seen = seenByNoteId.get(image.noteId) ?? new Set<string>()
      if (seen.has(imageKey)) continue
      seen.add(imageKey)
      seenByNoteId.set(image.noteId, seen)
      grouped.set(image.noteId, [...(grouped.get(image.noteId) ?? []), image])
    }
    for (const [noteId, images] of grouped) {
      grouped.set(noteId, sortImages(images))
    }
    return grouped
  }, [report.images])
  const checkpointNumberByNote = useMemo(() => checkpointNumberByNoteId(report), [report])
  const hasPhotoAppendixImages = useMemo(
    () =>
      notes.some(
        (note) =>
          (!drainageReport || checkpointNumberByNote.has(note.id)) &&
          (imagesByNoteId.get(note.id)?.length ?? 0) > 0
      ),
    [checkpointNumberByNote, drainageReport, imagesByNoteId, notes]
  )
  const inspectorSignature = useMemo(() => {
    const signatureSection = report.reportDraft.sections.find(
      (section) => section.key === 'signature_certificate'
    )
    return signatureSection?.isRelevant === false ? null : inspectorSignatureForReport(report)
  }, [report])
  const reportBlocks = useMemo<EbPrintableBlock[]>(() => {
    const blocks: EbPrintableBlock[] = [
      {
        id: 'report-opening',
        node: <ReportOpening report={report} />,
      },
    ]

    if (inspectionTypeSection) {
      blocks.push({
        id: `section-${inspectionTypeSection.key}`,
        node: (
          <ReportSection title={inspectionTypeSection.title}>
            <ReportText text={inspectionTypeSection.text} />
          </ReportSection>
        ),
      })
    }

    if (scopeSection) {
      blocks.push({
        id: `section-${scopeSection.key}`,
        node: (
          <ReportSection title={scopeSection.title}>
            <EditableReportText text={scopeSection.text} />
          </ReportSection>
        ),
      })
    }

    for (const section of reportSections) {
      if (section.key === 'inspection_time') {
        blocks.push({
          id: `section-${section.key}`,
          node: <InspectionTimeReport report={report} section={section} />,
        })
        continue
      }
      if (section.key === 'inspectors') {
        blocks.push({
          id: `section-${section.key}`,
          node: <InspectorReport section={section} />,
        })
        continue
      }
      if (section.key === 'participants') {
        blocks.push({
          id: `section-${section.key}`,
          node: <ParticipantsReport report={report} section={section} />,
        })
        continue
      }
      if (section.key === 'summons') {
        blocks.push({
          id: `section-${section.key}`,
          node: <SummonsReport report={report} section={section} />,
        })
        continue
      }
      if (section.key === 'previous_inspections_tests') {
        blocks.push({
          id: `section-${section.key}`,
          node: <PreviousInspectionsReport report={report} />,
        })
        continue
      }
      if (isTestingDocumentationSection(section)) {
        blocks.push({
          id: `section-${section.key}`,
          node: <TestingDocumentationReport report={report} section={section} />,
        })
        continue
      }
      if (section.key === 'drainage_checklist') {
        const printableCheckpoints = printableDrainageCheckpoints(report)
        const groups = numberedCheckpointGroups(printableCheckpoints)
        const hasPhotoRequiredCheckpoints = printableCheckpoints.some((checkpoint) => checkpoint.photoRequired)
        blocks.push({
          id: `section-${section.key}`,
          node: (
            <DrainageChecklistIntroReport
              guidanceVersion={report.project.drainageGuidanceVersion}
              hasCheckpoints={groups.length > 0}
              hasPhotoRequiredCheckpoints={hasPhotoRequiredCheckpoints}
            />
          ),
        })
        for (const group of groups) {
          chunkArray(group.checkpoints, 4).forEach((checkpointChunk, chunkIndex) => {
            blocks.push({
              id: `drainage-checklist-${group.key}-${chunkIndex}`,
              node: (
                <DrainageChecklistGroupReport
                  checkpoints={checkpointChunk}
                  groupLabel={chunkIndex === 0 ? group.label : `${group.label} (forts.)`}
                />
              ),
            })
          })
        }
        continue
      }
      if (section.key === 'defects_appendices') {
        const notesSection = report.reportDraft.sections.find((candidate) => candidate.key === 'notes')
        const deductionSection = report.reportDraft.sections.find(
          (candidate) => candidate.key === 'deduction'
        )
        blocks.push({
          id: 'defects-conditions',
          node: (
            <DefectsConditionsReport
              report={report}
              section={section}
              displayNumberByNoteId={displayNumberByNoteId}
            />
          ),
        })
        const printableNotes = notesSection?.isRelevant === false ? [] : notes
        printableNotes.forEach((note, noteIndex) => {
          const headings = noteHeadingsByNoteId.get(note.id) ?? []
          const textChunks = splitReportTextForPage(note.noteText)
          const printableTextChunks = textChunks.length > 0 ? textChunks : ['']
          printableTextChunks.forEach((noteText, textChunkIndex) => {
            const firstTextChunk = textChunkIndex === 0
            const lastTextChunk = textChunkIndex === printableTextChunks.length - 1
            const lastNote = noteIndex === printableNotes.length - 1
            blocks.push({
              id: `note-table-${note.id}-${textChunkIndex}`,
              repeatHeaderKey: 'defect-note-table',
              spacingAfterMm: lastNote && lastTextChunk ? 4 : 0,
              render: ({ showRepeatHeader }) => (
                <section
                  className={
                    noteIndex === 0 && firstTextChunk
                      ? 'eb-report-section mt-4'
                      : 'eb-report-section'
                  }
                >
                  <NoteTable
                    note={note}
                    headings={firstTextChunk ? headings : []}
                    headingsAfter={lastNote && lastTextChunk ? trailingNoteHeadings : []}
                    inspectionReference={`${report.inspection.variant}${report.inspection.sequenceNo}`}
                    showHeader={showRepeatHeader}
                    displayNumber={noteIndex + 1}
                    noteText={noteText}
                    continuation={!firstTextChunk}
                  />
                </section>
              ),
            })
          })
        })
        if (deductionSection?.isRelevant !== false) {
          blocks.push({
            id: 'deduction-agreement-summary',
            node: <DeductionAgreementSummary report={report} />,
          })
        }
        continue
      }
      if (section.key === 'contract_documents') {
        blocks.push({
          id: `section-${section.key}`,
          node: (
            <ReportSection title={section.title} headingMarker>
              <ReportText text={section.text} />
            </ReportSection>
          ),
        })
        continue
      }
      if (section.key === 'approval_decision') {
        blocks.push({
          id: `section-${section.key}`,
          node: <ApprovalDecisionReport report={report} />,
        })
        continue
      }
      if (section.key === 'appendices') {
        blocks.push({
          id: `section-${section.key}`,
          node: (
            <ReportSection title={section.title}>
              <ReportText
                text={withEbPhotoAppendixListing(section.text, hasPhotoAppendixImages)}
              />
            </ReportSection>
          ),
        })
        continue
      }
      if (section.key === 'continued_final_inspection') {
        blocks.push({
          id: `section-${section.key}`,
          node: <ContinuedFinalInspectionReport report={report} section={section} />,
        })
        continue
      }
      if (section.key === 'reclamation_notice') {
        blocks.push({
          id: `section-${section.key}`,
          node: <ReclamationNoticeReport report={report} section={section} />,
        })
        continue
      }
      if (section.key === 'distribution_list') {
        blocks.push({
          id: `section-${section.key}`,
          node: <DistributionListReport report={report} />,
        })
        continue
      }

      blocks.push({
        id: `section-${section.key}`,
        node: (
          <ReportSection title={section.title}>
            {section.key === 'contract_parties' ? (
              <ContractPartiesReport report={report} />
            ) : section.contentMode === 'editable' || section.contentMode === 'mixed' ? (
              <EditableReportText text={section.text} />
            ) : (
              <ReportText text={section.text} />
            )}
          </ReportSection>
        ),
      })
    }

    const photoSections: PhotoAppendixSection[] = []
    let pendingPhotoHeadings: EbReportNoteHeading[] = []
    let activePhotoSection: PhotoAppendixSection | null = null
    for (const note of notes) {
      const checkpointNumber = checkpointNumberByNote.get(note.id)
      if (drainageReport && !checkpointNumber) continue
      const headingsBefore = noteHeadingsByNoteId.get(note.id) ?? []
      if (headingsBefore.length > 0) {
        pendingPhotoHeadings = [...pendingPhotoHeadings, ...headingsBefore]
      }
      const referenceLabel = photoReferenceLabel(
        note,
        checkpointNumber,
        displayNumberByNoteId.get(note.id)
      )
      const images = imagesByNoteId.get(note.id) ?? []
      if (images.length === 0) continue

      if (!activePhotoSection || pendingPhotoHeadings.length > 0) {
        activePhotoSection = {
          id: `${note.id}-${photoSections.length + 1}`,
          headings: pendingPhotoHeadings,
          photos: [],
        }
        photoSections.push(activePhotoSection)
        pendingPhotoHeadings = []
      }

      const location = noteLocationLine(note)
      const noteText = note.noteText?.trim() ?? ''
      images.forEach((image, imageIndex) => {
        activePhotoSection?.photos.push({
          id: `${note.id}-${image.id}-${imageIndex + 1}`,
          referenceLabel,
          location,
          noteText,
          image,
          imageNumber: imageIndex + 1,
          totalImages: images.length,
        })
      })
    }

    const hasPhotoAppendix = photoSections.some((section) => section.photos.length > 0)

    if (inspectorSignature) {
      blocks.push({
        id: 'inspector-signature',
        node: (
          <InspectorSignatureCard
            signature={inspectorSignature}
            hasPhotoAppendix={hasPhotoAppendix}
            onImageError={showError}
          />
        ),
      })
    }

    let isFirstPhotoBlock = true
    for (const section of photoSections) {
      chunkArray(section.photos, 2).forEach((photos, sectionChunkIndex) => {
        const showTitle = isFirstPhotoBlock
        blocks.push({
          id: `photo-section-${section.id}-${sectionChunkIndex}`,
          pageKind: 'photo-appendix',
          startsNewPage: showTitle,
          repeatHeaderKey: section.headings.length > 0 ? `photo-section-${section.id}` : undefined,
          spacingAfterMm: 4,
          render: ({ showRepeatHeader }) => (
            <PhotoAppendixSectionBlock
              section={section}
              photos={photos}
              showTitle={showTitle}
              showHeadings={sectionChunkIndex === 0 || showRepeatHeader}
              onImageError={showError}
            />
          ),
        })
        isFirstPhotoBlock = false
      })
    }

    return blocks
  }, [
    checkpointNumberByNote,
    displayNumberByNoteId,
    drainageReport,
    hasPhotoAppendixImages,
    imagesByNoteId,
    inspectionTypeSection,
    inspectorSignature,
    noteHeadingsByNoteId,
    notes,
    report,
    reportSections,
    scopeSection,
    showError,
    trailingNoteHeadings,
  ])

  useEffect(() => {
    const previousTitle = document.title
    document.title = printTitle

    return () => {
      if (document.title === printTitle) {
        document.title = previousTitle
      }
    }
  }, [printTitle])
  const projectNavigationKey = `project:${report.project.id}`
  const reviewNavigationKey = `review:${report.inspection.inspectionId}`
  const isProjectNavigating = pendingNavigationKey === projectNavigationKey
  const isReviewNavigating = pendingNavigationKey === reviewNavigationKey
  const navigationInProgress = Boolean(pendingNavigationKey)
  const refreshReport = useCallback(() => {
    router.refresh()
  }, [router])
  const ignoreDeliveryProjectUpdate = useCallback(() => undefined, [])

  return (
    <main className="eb-report-print-root min-h-screen bg-neutral-200 text-black print:min-h-0 print:bg-white">
      {showInternalActions || publicActions ? (
        <div className="mx-auto max-w-5xl px-4 py-5 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 p-2 shadow-sm">
            {showInternalActions ? (
              <Link
                href={`/eb/projects/${report.project.id}`}
                onClick={(event) => handleNavigation(event, projectNavigationKey)}
                aria-disabled={navigationInProgress}
                aria-busy={isProjectNavigating}
                className={reportNavigationClassName(false, navigationInProgress)}
              >
                {isProjectNavigating ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeft size={16} />}
                Till entreprenaden
              </Link>
            ) : <span />}
            {showInternalActions ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Link
                  href={`/eb/projects/${report.project.id}/inspections/${report.inspection.inspectionId}/perform`}
                  onClick={(event) => handleNavigation(event, reviewNavigationKey)}
                  aria-disabled={navigationInProgress}
                  aria-busy={isReviewNavigating}
                  className={reportNavigationClassName(true, navigationInProgress)}
                >
                  {isReviewNavigating ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
                  Granska
                </Link>
                <div className="flex items-center overflow-hidden rounded-md border border-gray-300 bg-white">
                  <button
                    type="button"
                    onClick={() => {
                      document.title = printTitle
                      window.print()
                    }}
                    aria-label="Skriv ut utlåtandet"
                    title="Skriv ut"
                    className="inline-flex h-10 w-10 items-center justify-center text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
                  >
                    <Printer size={18} aria-hidden="true" />
                  </button>
                  {report.inspection.reportPdfDownloadUrl ? (
                    <a
                      href={report.inspection.reportPdfDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Ladda ner sökbar PDF"
                      title="Ladda ner sökbar PDF"
                      className="inline-flex h-10 w-10 items-center justify-center border-l border-gray-300 text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
                    >
                      <Download size={18} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setDeliveryOpen(true)}
                  disabled={navigationInProgress}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  <Send size={17} aria-hidden="true" />
                  {report.inspection.reportLockedAt
                    ? 'Leverera och visa status'
                    : 'Fastställ och leverera'}
                </button>
              </div>
            ) : publicActions}
          </div>
        </div>
      ) : null}

      <EbPrintPagedDocument blocks={reportBlocks} report={report} />

      {showInternalActions ? (
        <EbReportDeliveryDialog
          open={deliveryOpen}
          projectId={report.project.id}
          inspection={deliveryOpen ? report.inspection : null}
          onClose={() => setDeliveryOpen(false)}
          onProjectUpdated={ignoreDeliveryProjectUpdate}
          onChanged={refreshReport}
        />
      ) : null}
    </main>
  )
}
