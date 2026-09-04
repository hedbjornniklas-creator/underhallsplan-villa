'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  List,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ReportShareButton from '@/components/report/ReportShareButton'
import {
  isEbDrainageTemplate,
  isEbReportSectionApplicable,
} from '@/lib/eb/reportSectionRules'
import type {
  EbInspectionCheckpoint,
  EbInspectionReport,
  EbNote,
  EbNoteImage,
  EbReportDraftSection,
  EbReportNoteHeading,
} from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'

export type EbPublicDeliveryDocumentLink = {
  id: string
  title: string | null
  fileName: string | null
  contentType: string | null
  fileSizeBytes: number | null
  createdAt: string | null
  downloadUrl: string
}

type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed'

type EbPublicReportSnapshotViewProps = {
  report: EbInspectionReport
  publishedAt?: string | null
  shareEndpoint: string | null
  shareUrl: string | null
  pdfDownloadUrl: string | null
  pdfStatus?: PdfStatus
  pdfError?: string | null
  deliveryDocuments?: EbPublicDeliveryDocumentLink[]
}

type PublicImage = {
  id: string
  src: string
  fullSrc: string
  alt: string
  reference: string
  location: string | null
  label: string | null
  noteText: string | null
}

type PublicImageGroup = {
  id: string
  headings: EbReportNoteHeading[]
  reference: string
  location: string | null
  images: PublicImage[]
}

const REPORT_DOCUMENT_TITLES: Record<EbInspectionReport['inspection']['variant'], string> = {
  SLB: 'Utlåtande över slutbesiktning',
  FB: 'Utlåtande över förbesiktning',
  EB: 'Utlåtande över efterbesiktning',
  GB: 'Utlåtande över garantibesiktning',
  KSB: 'Utlåtande över kompletterande slutbesiktning',
  SAB: 'Utlåtande över särskild besiktning',
}

const INTEGRATED_SECTION_KEYS = new Set([
  'marker_legend',
  'deduction',
  'notes',
  'warranty_end',
  'after_inspection',
  'signature_certificate',
])

function normalizeText(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\n/g, '\n')
    .trim()
}

function formatDateTime(value: string | null | undefined) {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return normalized
  return parsed.toLocaleString('sv-SE', {
    dateStyle: 'medium',
    timeStyle: normalized.includes('T') ? 'short' : undefined,
    timeZone: 'Europe/Stockholm',
  })
}

function formatFileSize(value: number | null | undefined) {
  if (!value || value < 1) return null
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function reportDocumentTitle(report: EbInspectionReport) {
  if (isEbDrainageTemplate(report.project.projectTemplateKey)) {
    return report.inspection.variant === 'FB'
      ? 'Utlåtande över förbesiktning – dräneringsbesiktning'
      : 'Utlåtande över dräneringsbesiktning'
  }
  return REPORT_DOCUMENT_TITLES[report.inspection.variant]
}

function reportReference(report: EbInspectionReport) {
  const match = report.inspection.date?.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const sequenceNo = Number(report.inspection.sequenceNo)
  if (!match || !Number.isFinite(sequenceNo) || sequenceNo <= 0) return null
  return `${match[1]}-${match[2]}${match[3]}-${String(sequenceNo).padStart(2, '0')}`
}

function compact(parts: Array<string | null | undefined>, separator = ', ') {
  return parts.map((part) => part?.trim()).filter(Boolean).join(separator)
}

function isMissingLine(value: string) {
  const normalized = value.trim().toLocaleLowerCase('sv-SE')
  return normalized === 'ej angivet' || normalized === 'ej angivet.' || normalized === '|'
}

function printableLines(value: string) {
  const normalized = normalizeText(value)
  if (
    normalized.startsWith('Ange ') ||
    normalized.includes(' Komplettera ') ||
    normalized.includes('Komplettera om ')
  ) {
    return []
  }
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isMissingLine(line))
}

function parseDefinition(line: string) {
  if (/^[•*-]\s+/.test(line)) return null
  const match = line.match(/^([^:]{1,54}):\s*(.*)$/)
  if (!match || isMissingLine(match[2])) return null
  return { label: match[1].trim(), value: match[2].trim() || '–' }
}

function ReadableText({ text }: { text: string }) {
  const blocks = normalizeText(text)
    .split(/\n{2,}/)
    .map((block) => printableLines(block))
    .filter((lines) => lines.length > 0)

  if (blocks.length === 0) return null

  return (
    <div className="space-y-4 text-[15px] leading-7 text-slate-800 sm:text-base">
      {blocks.map((lines, blockIndex) => {
        const bullets = lines.every((line) => /^[•*-]\s+/.test(line))
        if (bullets) {
          return (
            <ul key={`list-${blockIndex}`} className="list-disc space-y-2 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={`${line}-${lineIndex}`}>{line.replace(/^[•*-]\s+/, '')}</li>
              ))}
            </ul>
          )
        }

        const rows = lines.map(parseDefinition)
        if (rows.every(Boolean)) {
          return (
            <dl key={`rows-${blockIndex}`} className="grid gap-3 sm:grid-cols-2">
              {rows.map((row, rowIndex) =>
                row ? (
                  <div key={`${row.label}-${rowIndex}`} className="min-w-0">
                    <dt className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
                      {row.label}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{row.value}</dd>
                  </div>
                ) : null
              )}
            </dl>
          )
        }

        return (
          <p key={`text-${blockIndex}`} className="whitespace-pre-line break-words">
            {lines.join('\n')}
          </p>
        )
      })}
    </div>
  )
}

function sortNotes(notes: EbNote[]) {
  return [...notes].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    if ((left.noteNumber ?? 0) !== (right.noteNumber ?? 0)) {
      return (left.noteNumber ?? 0) - (right.noteNumber ?? 0)
    }
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function sortImages(images: EbNoteImage[]) {
  return [...images].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function sortHeadings(headings: EbReportNoteHeading[]) {
  return [...headings].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return left.id.localeCompare(right.id)
  })
}

function sortCheckpoints(checkpoints: EbInspectionCheckpoint[]) {
  return [...checkpoints].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return left.title.localeCompare(right.title, 'sv-SE')
  })
}

function checkpointStatusLabel(status: EbInspectionCheckpoint['status']) {
  if (status === 'ok') return 'OK'
  if (status === 'deviation') return 'Avvikelse'
  if (status === 'not_applicable') return 'Ej aktuellt'
  if (status === 'not_accessible') return 'Ej åtkomligt'
  if (status === 'not_verifiable') return 'Ej verifierbart'
  return 'Ej kontrollerat'
}

function imageProxyUrl(image: EbNoteImage, max: number, quality: number) {
  const params = new URLSearchParams({
    url: image.publicUrl,
    max: String(max),
    q: String(quality),
  })
  return `/api/image-proxy?${params.toString()}`
}

function noteLocation(note: EbNote) {
  return compact([note.room, note.location, note.placeDetail]) || null
}

function participantName(
  participant: EbInspectionReport['participants'][number]
) {
  return participant.personName?.trim() || participant.companyName?.trim() || '–'
}

function isParticipantFor(
  participant: EbInspectionReport['participants'][number],
  party: 'client' | 'contractor'
) {
  if (participant.representsPartyKey === party) return true
  const role = participant.roleLabel?.toLocaleLowerCase('sv-SE') ?? ''
  if (party === 'client') return role.includes('beställ') || role.includes('konsument')
  return role.includes('entrepren') || role.includes('hantverk') || role.includes('näringsidk')
}

function SectionShell({
  section,
  children,
}: {
  section: EbReportDraftSection
  children: ReactNode
}) {
  return (
    <section
      id={`section-${section.key}`}
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="border-b border-slate-100 px-5 py-4 sm:px-7">
        {section.sbrPoint ? (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            SBR punkt {section.sbrPoint}
          </p>
        ) : null}
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
          {section.title}
        </h2>
      </header>
      <div className="px-5 py-5 sm:px-7 sm:py-6">{children}</div>
    </section>
  )
}

function ContractParties({ report }: { report: EbInspectionReport }) {
  const vocabulary = resolveEbAgreementVocabulary(report.project.standardAgreement)
  const partyCards = [
    {
      label: vocabulary.clientLabel,
      name: report.project.clientName,
      orgNo: report.project.clientOrgNo,
      address: compact([
        report.project.clientAddress,
        compact([report.project.clientPostalCode, report.project.clientCity], ' '),
      ]),
    },
    {
      label: vocabulary.contractorLabel,
      name: report.project.contractorName,
      orgNo: report.project.contractorOrgNo,
      address: compact([
        report.project.contractorAddress,
        compact([report.project.contractorPostalCode, report.project.contractorCity], ' '),
      ]),
    },
  ]

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">Avtalsform</dt>
          <dd className="mt-1 text-base leading-7 text-slate-900">{vocabulary.agreementLine}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
            Avtalade arbeten
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-base leading-7 text-slate-900">
            {report.project.objectDescription?.trim() || '–'}
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.13em] text-slate-600">Parter</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {partyCards.map((party) => (
            <div key={party.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.11em] text-emerald-700">
                {party.label}
              </p>
              <p className="mt-2 font-semibold text-slate-950">{party.name?.trim() || '–'}</p>
              {party.address ? <p className="mt-1 text-sm leading-6 text-slate-700">{party.address}</p> : null}
              {party.orgNo ? <p className="mt-1 text-sm text-slate-600">Org.nr {party.orgNo}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Participants({ report, section }: { report: EbInspectionReport; section: EbReportDraftSection }) {
  const present = report.participants.filter((participant) => participant.attended)
  const groups = [
    {
      label: 'För beställaren',
      participants: present.filter((participant) => isParticipantFor(participant, 'client')),
    },
    {
      label: resolveEbAgreementVocabulary(report.project.standardAgreement).contractorShortLabel === 'Hantverkare'
        ? 'För hantverkaren'
        : 'För entreprenören',
      participants: present.filter((participant) => isParticipantFor(participant, 'contractor')),
    },
    {
      label: 'Övriga närvarande',
      participants: present.filter(
        (participant) => !isParticipantFor(participant, 'client') && !isParticipantFor(participant, 'contractor')
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <ReadableText text={section.text} />
      <div className="grid gap-3 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">{group.label}</h3>
            {group.participants.length > 0 ? (
              <div className="mt-3 space-y-3">
                {group.participants.map((participant, index) => (
                  <div key={participant.id ?? `${group.label}-${index}`}>
                    <p className="font-semibold text-slate-950">{participantName(participant)}</p>
                    {participant.personName && participant.companyName ? (
                      <p className="text-sm text-slate-600">{participant.companyName}</p>
                    ) : null}
                    {participant.roleLabel ? <p className="text-sm text-slate-600">{participant.roleLabel}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">–</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TestingDocumentation({
  report,
  section,
}: {
  report: EbInspectionReport
  section: EbReportDraftSection
}) {
  const documents = [...report.inspectionDocuments]
    .filter((document) => document.status === 'present')
    .sort((left, right) => left.sortOrder - right.sortOrder)
  const prose = normalizeText(section.text)
    .split(/\n{2,}/)
    .filter((block) => {
      const lines = printableLines(block)
      return !(
        lines.length > 0 &&
        lines.every(
          (line) =>
            line.startsWith('•') &&
            (/\bDatum:\s*/i.test(line) || /överlämnas\.?$/i.test(line))
        )
      )
    })
    .join('\n\n')

  return (
    <div className="space-y-5">
      <ReadableText text={prose} />
      <div>
        <h3 className="text-sm font-semibold text-slate-950">Redovisad dokumentation</h3>
        {documents.length > 0 ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {documents.map((document) => (
              <div key={document.documentTypeId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-950">{document.title}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {document.resultLabel?.toLocaleLowerCase('sv-SE').includes('överlämnas')
                    ? 'Överlämnas'
                    : `Daterad ${document.documentDate?.trim() || 'datum saknas'}`}
                </p>
                {document.note ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{document.note}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Inga dokument har markerats som redovisade.</p>
        )}
      </div>
    </div>
  )
}

function DrainageChecklist({ report, section }: { report: EbInspectionReport; section: EbReportDraftSection }) {
  const groups: Array<{ key: string; label: string; checkpoints: EbInspectionCheckpoint[] }> = []
  const groupByKey = new Map<string, (typeof groups)[number]>()
  let number = 0
  for (const checkpoint of sortCheckpoints(report.checkpoints.filter((item) => item.groupKey !== 'documents'))) {
    const groupKey = checkpoint.groupKey || 'other'
    let group = groupByKey.get(groupKey)
    if (!group) {
      group = { key: groupKey, label: checkpoint.groupLabel || 'Övrigt', checkpoints: [] }
      groups.push(group)
      groupByKey.set(groupKey, group)
    }
    group.checkpoints.push(checkpoint)
  }

  return (
    <div className="space-y-6">
      <ReadableText text={section.text} />
      {groups.length > 0 ? (
        groups.map((group) => (
          <div key={group.key}>
            <h3 className="text-base font-semibold text-slate-950">{group.label}</h3>
            <div className="mt-3 space-y-3">
              {group.checkpoints.map((checkpoint) => {
                number += 1
                return (
                  <div key={checkpoint.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                          {number}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-950">{checkpoint.title}</p>
                          {checkpoint.verificationMethod ? (
                            <p className="mt-1 text-sm text-slate-600">{checkpoint.verificationMethod}</p>
                          ) : null}
                        </div>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                        {checkpointStatusLabel(checkpoint.status)}
                      </span>
                    </div>
                    {checkpoint.comment ? (
                      <p className="mt-3 whitespace-pre-wrap border-l-2 border-emerald-300 pl-3 text-sm leading-6 text-slate-700">
                        {checkpoint.comment}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      ) : (
        <p className="text-sm text-slate-600">Ingen dräneringskontrollista är registrerad.</p>
      )}
    </div>
  )
}

function NoteHeading({ heading }: { heading: EbReportNoteHeading }) {
  return (
    <h3 className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-950">
      {heading.title}
    </h3>
  )
}

function DefectsAndNotes({
  report,
  section,
  notes,
  headingsByNoteId,
  trailingHeadings,
}: {
  report: EbInspectionReport
  section: EbReportDraftSection
  notes: EbNote[]
  headingsByNoteId: Map<string, EbReportNoteHeading[]>
  trailingHeadings: EbReportNoteHeading[]
}) {
  const markerSection = report.reportDraft.sections.find((candidate) => candidate.key === 'marker_legend')
  const deductionSection = report.reportDraft.sections.find((candidate) => candidate.key === 'deduction')
  const notesSection = report.reportDraft.sections.find((candidate) => candidate.key === 'notes')
  const visibleNotes = notesSection?.isRelevant === false ? [] : notes
  const usedMarkerKeys = new Set(visibleNotes.map((note) => note.markerKey).filter(Boolean))
  const markers = [...report.markers]
    .filter((marker) => usedMarkerKeys.has(marker.key))
    .sort((left, right) => left.sortOrder - right.sortOrder)

  return (
    <div className="space-y-6">
      <ReadableText text={section.text} />

      {markerSection?.isRelevant !== false ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-slate-950">Så läses noteringarna</h3>
          <div className="mt-3">
            <ReadableText text={markerSection?.text ?? ''} />
          </div>
          {markers.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {markers.map((marker) => (
                <span key={marker.key} className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-sm text-slate-700">
                  <strong className="text-emerald-800">{marker.key}</strong> · {marker.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4">
        {visibleNotes.map((note, index) => {
          const marker = report.markers.find((candidate) => candidate.key === note.markerKey)
          const location = noteLocation(note)
          return (
            <div key={note.id} className="space-y-3">
              {(headingsByNoteId.get(note.id) ?? []).map((heading) => (
                <NoteHeading key={heading.id} heading={heading} />
              ))}
              <article className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-950">
                    {report.inspection.variant}{report.inspection.sequenceNo}
                  </span>
                  {note.markerKey ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                      {note.markerKey}{marker?.label ? ` · ${marker.label}` : ''}
                    </span>
                  ) : null}
                  {note.statusLabel ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                      {note.statusLabel}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(150px,0.32fr)_1fr] sm:px-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">Del / rum</p>
                    <p className="mt-1 text-sm leading-6 text-slate-800">{location || '–'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">Notering</p>
                    <p className="mt-1 whitespace-pre-wrap text-base leading-7 text-slate-950">{note.noteText || '–'}</p>
                    {note.deductionAmount ? (
                      <p className="mt-3 text-sm font-semibold text-slate-700">
                        Uppskattad nedsättning: {note.deductionAmount}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            </div>
          )
        })}
        {trailingHeadings.map((heading) => (
          <NoteHeading key={heading.id} heading={heading} />
        ))}
        {visibleNotes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            Inga noteringar redovisas i den här rapportversionen.
          </p>
        ) : null}
      </div>

      {deductionSection?.isRelevant ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <h3 className="font-semibold text-amber-950">Nedsättning</h3>
          <div className="mt-2">
            <ReadableText text={deductionSection.text} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SectionContent({
  report,
  section,
  notes,
  headingsByNoteId,
  trailingHeadings,
}: {
  report: EbInspectionReport
  section: EbReportDraftSection
  notes: EbNote[]
  headingsByNoteId: Map<string, EbReportNoteHeading[]>
  trailingHeadings: EbReportNoteHeading[]
}) {
  if (section.key === 'contract_parties') return <ContractParties report={report} />
  if (section.key === 'participants') return <Participants report={report} section={section} />
  if (section.key === 'testing_documentation') {
    return <TestingDocumentation report={report} section={section} />
  }
  if (section.key === 'drainage_checklist') {
    return <DrainageChecklist report={report} section={section} />
  }
  if (section.key === 'defects_appendices') {
    return (
      <DefectsAndNotes
        report={report}
        section={section}
        notes={notes}
        headingsByNoteId={headingsByNoteId}
        trailingHeadings={trailingHeadings}
      />
    )
  }

  const warrantySection =
    section.key === 'reclamation_notice'
      ? report.reportDraft.sections.find((candidate) => candidate.key === 'warranty_end' && candidate.isRelevant)
      : null
  const continuedInspection = section.key === 'continued_final_inspection'
    ? compact([
        report.inspection.continuedFinalInspectionDate,
        report.inspection.continuedFinalInspectionTime?.slice(0, 5),
      ], ' kl. ')
    : null
  const warrantyScope = section.key === 'reclamation_notice' && report.inspection.warrantyEndDate && report.inspection.warrantyScope
    ? `${report.inspection.warrantyEndDate} för ${report.inspection.warrantyScope}`
    : null

  return (
    <div className="space-y-5">
      <ReadableText text={section.text} />
      {continuedInspection ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800">
          Enligt överenskommelse verkställs ny slutbesiktning {continuedInspection}.
        </p>
      ) : null}
      {warrantySection ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-950">Garantitid</h3>
          <div className="mt-2">
            <ReadableText text={warrantySection.text} />
          </div>
          {warrantyScope ? <p className="mt-2 text-sm leading-6 text-slate-700">{warrantyScope}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function Signature({
  report,
  hasImages,
}: {
  report: EbInspectionReport
  hasImages: boolean
}) {
  const section = report.reportDraft.sections.find((candidate) => candidate.key === 'signature_certificate')
  if (section?.isRelevant === false) return null

  const fallbackRows = printableLines(section?.text ?? '')
    .map(parseDefinition)
    .filter((row): row is NonNullable<ReturnType<typeof parseDefinition>> => Boolean(row))
  const fallbackName = fallbackRows.find((row) => row.label === 'Besiktningsman')?.value
  const signature = report.branding.signature
  const name = signature?.inspectorName || fallbackName || 'Besiktningsman'
  const signatureUrl = signature?.signatureUrl ?? report.branding.inspectorSignatureUrl
  const avatarUrl = signature?.avatarUrl ?? report.branding.inspectorAvatarUrl
  const credentials =
    signature?.credentialLines ??
    fallbackRows
      .filter((row) => !['Besiktningsman', 'Datum', 'Telefon', 'E-post'].includes(row.label))
      .map((row) => `${row.label}: ${row.value}`)
  const hasContent = Boolean(signature || signatureUrl || avatarUrl || fallbackName || credentials.length > 0)
  if (!hasContent) return null

  return (
    <section
      id="signature"
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="border-b border-slate-100 px-5 py-4 sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Fastställande</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">Underskrift</h2>
      </header>
      <div className="px-5 py-6 sm:px-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="h-20 w-20 rounded-xl border border-slate-200 object-cover" />
          ) : null}
          <div className="min-w-0">
            {signature?.locationAndDate ? (
              <p className="text-sm text-slate-600">{signature.locationAndDate}</p>
            ) : null}
            {signatureUrl ? (
              <img src={signatureUrl} alt={`Underskrift ${name}`} className="mt-3 max-h-20 max-w-56 object-contain" />
            ) : null}
            <p className="mt-3 text-lg font-semibold text-slate-950">{name}</p>
            {credentials.length > 0 ? (
              <div className="mt-1 space-y-0.5 text-sm leading-6 text-slate-600">
                {credentials.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {hasImages ? (
          <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-950">
            Signeringen omfattar detta utlåtande inklusive Bilaga 1 – Fotobilaga.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function ImageLightbox({
  images,
  activeIndex,
  onChange,
  onClose,
}: {
  images: PublicImage[]
  activeIndex: number
  onChange: (index: number) => void
  onClose: () => void
}) {
  const image = images[activeIndex]

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && activeIndex > 0) onChange(activeIndex - 1)
      if (event.key === 'ArrowRight' && activeIndex < images.length - 1) onChange(activeIndex + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeIndex, images.length, onChange, onClose])

  if (!image) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Bild ${activeIndex + 1} av ${images.length}`}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 text-white"
      onClick={onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p className="min-w-0 truncate text-sm font-semibold">
          {activeIndex + 1} av {images.length} · {image.reference}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
          aria-label="Stäng bildvisaren"
        >
          <X size={22} aria-hidden />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 py-3 sm:px-20" onClick={(event) => event.stopPropagation()}>
        {activeIndex > 0 ? (
          <button
            type="button"
            onClick={() => onChange(activeIndex - 1)}
            className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 sm:left-5"
            aria-label="Föregående bild"
          >
            <ChevronLeft size={28} aria-hidden />
          </button>
        ) : null}
        <img src={image.fullSrc} alt={image.alt} className="max-h-full max-w-full object-contain" />
        {activeIndex < images.length - 1 ? (
          <button
            type="button"
            onClick={() => onChange(activeIndex + 1)}
            className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 sm:right-5"
            aria-label="Nästa bild"
          >
            <ChevronRight size={28} aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-white/10 px-4 py-4 sm:px-6" onClick={(event) => event.stopPropagation()}>
        <p className="font-semibold">{image.reference}{image.location ? ` · ${image.location}` : ''}</p>
        {image.label ? <p className="mt-1 text-sm text-slate-200">{image.label}</p> : null}
        {image.noteText ? <p className="mt-1 text-sm text-slate-300">Notering: {image.noteText}</p> : null}
      </div>
    </div>
  )
}

function PhotoAppendix({
  groups,
  images,
  onOpen,
}: {
  groups: PublicImageGroup[]
  images: PublicImage[]
  onOpen: (id: string) => void
}) {
  if (images.length === 0) return null

  return (
    <section id="photo-appendix" className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Bilaga 1</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">Fotobilaga</h2>
          <p className="mt-1 text-sm text-slate-500">Klicka på en bild för att visa den i full storlek.</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
          {images.length} {images.length === 1 ? 'bild' : 'bilder'}
        </span>
      </header>
      <div className="space-y-8 px-5 py-6 sm:px-7">
        {groups.map((group) => (
          <div key={group.id}>
            {group.headings.map((heading) => (
              <NoteHeading key={heading.id} heading={heading} />
            ))}
            <div className={group.headings.length > 0 ? 'mt-4' : undefined}>
              <h3 className="font-semibold text-slate-950">
                {group.reference}{group.location ? ` · ${group.location}` : ''}
              </h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {group.images.map((image, imageIndex) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => onOpen(image.id)}
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                  >
                    <img src={image.src} alt={image.alt} className="aspect-[4/3] w-full bg-slate-100 object-cover transition duration-200 group-hover:scale-[1.01]" />
                    <span className="block border-t border-slate-200 bg-white px-4 py-3">
                      <span className="block text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
                        Bild {imageIndex + 1} av {group.images.length}
                      </span>
                      {image.label ? <span className="mt-1 block text-sm leading-6 text-slate-700">{image.label}</span> : null}
                      {imageIndex === 0 && image.noteText ? (
                        <span className="mt-1 block text-sm leading-6 text-slate-600">Notering: {image.noteText}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function PublicToolbar({
  shareEndpoint,
  shareUrl,
  pdfDownloadUrl,
  pdfStatus,
  pdfError,
  deliveryDocuments,
}: Pick<
  EbPublicReportSnapshotViewProps,
  'shareEndpoint' | 'shareUrl' | 'pdfDownloadUrl' | 'pdfStatus' | 'pdfError' | 'deliveryDocuments'
>) {
  return (
    <div className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Digitalt utlåtande</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-950">Entreprenadbesiktning</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {shareEndpoint && shareUrl ? (
              <ReportShareButton shareEndpoint={shareEndpoint} shareUrl={shareUrl} />
            ) : null}
            {pdfDownloadUrl ? (
              <Link
                href={pdfDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50"
              >
                <Download size={16} aria-hidden />
                Ladda ner PDF
              </Link>
            ) : (
              <span className="max-w-64 text-right text-xs leading-5 text-slate-500">
                {pdfStatus === 'failed'
                  ? `PDF-genereringen misslyckades${pdfError ? `: ${pdfError}` : '.'}`
                  : 'PDF-filen förbereds och blir snart tillgänglig.'}
              </span>
            )}
          </div>
        </div>

        {deliveryDocuments && deliveryDocuments.length > 0 ? (
          <section id="delivery-documents" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">Underlag i leveransen</h2>
                <p className="mt-0.5 text-xs text-slate-500">Dokument som hör till den fastställda rapportversionen.</p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800">
                {deliveryDocuments.length} dokument
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {deliveryDocuments.map((document) => {
                const label = document.title?.trim() || document.fileName?.trim() || 'Underlag'
                const size = formatFileSize(document.fileSizeBytes)
                return (
                  <Link
                    key={document.id}
                    href={document.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText size={17} className="shrink-0 text-emerald-700" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">{label}</span>
                        {size ? <span className="block text-xs text-slate-500">{size}</span> : null}
                      </span>
                    </span>
                    <Download size={16} className="shrink-0 text-emerald-700" aria-hidden />
                  </Link>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function Contents({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label="Innehåll">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.13em] text-slate-600">
        <List size={17} aria-hidden />
        Innehåll
      </div>
      <div className="mt-3 space-y-1.5">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="block rounded-lg px-3 py-2 text-sm leading-5 text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-900"
          >
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  )
}

export default function EbPublicReportSnapshotView({
  report,
  publishedAt,
  shareEndpoint,
  shareUrl,
  pdfDownloadUrl,
  pdfStatus = 'pending',
  pdfError = null,
  deliveryDocuments = [],
}: EbPublicReportSnapshotViewProps) {
  const notes = useMemo(() => sortNotes(report.notes), [report.notes])
  const headings = useMemo(
    () => sortHeadings(report.reportDraft.noteHeadings ?? []),
    [report.reportDraft.noteHeadings]
  )
  const headingsByNoteId = useMemo(() => {
    const grouped = new Map<string, EbReportNoteHeading[]>()
    for (const heading of headings) {
      if (!heading.beforeNoteId) continue
      grouped.set(heading.beforeNoteId, [...(grouped.get(heading.beforeNoteId) ?? []), heading])
    }
    return grouped
  }, [headings])
  const trailingHeadings = useMemo(
    () => headings.filter((heading) => !heading.beforeNoteId),
    [headings]
  )
  const visibleSections = useMemo(
    () =>
      report.reportDraft.sections.filter(
        (section) =>
          section.isRelevant &&
          !INTEGRATED_SECTION_KEYS.has(section.key) &&
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
  const checkpointNumberByNoteId = useMemo(() => {
    const map = new Map<string, number>()
    let number = 0
    for (const checkpoint of sortCheckpoints(report.checkpoints.filter((item) => item.groupKey !== 'documents'))) {
      number += 1
      if (checkpoint.noteId) map.set(checkpoint.noteId, number)
    }
    return map
  }, [report.checkpoints])
  const imageData = useMemo(() => {
    const groups: PublicImageGroup[] = []
    const allImages: PublicImage[] = []
    const drainage = isEbDrainageTemplate(report.project.projectTemplateKey)
    const displayNumberByNoteId = new Map(notes.map((note, index) => [note.id, index + 1]))
    const imagesByNoteId = new Map<string, EbNoteImage[]>()
    const seenByNoteId = new Map<string, Set<string>>()

    for (const image of report.images) {
      if (!image.noteId) continue
      const identity = image.sourceAttachmentId
        ? `source:${image.sourceAttachmentId}`
        : image.filePath
          ? `path:${image.filePath}`
          : `id:${image.id}`
      const seen = seenByNoteId.get(image.noteId) ?? new Set<string>()
      if (seen.has(identity)) continue
      seen.add(identity)
      seenByNoteId.set(image.noteId, seen)
      imagesByNoteId.set(image.noteId, [...(imagesByNoteId.get(image.noteId) ?? []), image])
    }

    let pendingHeadings: EbReportNoteHeading[] = []
    for (const note of notes) {
      const checkpointNumber = checkpointNumberByNoteId.get(note.id)
      if (drainage && !checkpointNumber) continue
      const noteHeadings = headingsByNoteId.get(note.id) ?? []
      if (noteHeadings.length > 0) pendingHeadings = [...pendingHeadings, ...noteHeadings]
      const noteImages = sortImages(imagesByNoteId.get(note.id) ?? [])
      if (noteImages.length === 0) continue
      const reference = checkpointNumber
        ? `Kontrollpunkt ${checkpointNumber}`
        : `Notering ${displayNumberByNoteId.get(note.id) ?? note.noteNumber ?? ''}`.trim()
      const group: PublicImageGroup = {
        id: `images-${note.id}`,
        headings: pendingHeadings,
        reference,
        location: noteLocation(note),
        images: [],
      }
      pendingHeadings = []
      noteImages.forEach((image, imageIndex) => {
        const publicImage: PublicImage = {
          id: `${note.id}-${image.id}-${imageIndex}`,
          src: imageProxyUrl(image, 1200, 72),
          fullSrc: imageProxyUrl(image, 2400, 88),
          alt: `${reference}, bild ${imageIndex + 1} av ${noteImages.length}`,
          reference,
          location: noteLocation(note),
          label: image.label?.trim() || null,
          noteText: note.noteText?.trim() || null,
        }
        group.images.push(publicImage)
        allImages.push(publicImage)
      })
      groups.push(group)
    }

    return { groups, images: allImages }
  }, [checkpointNumberByNoteId, headingsByNoteId, notes, report.images, report.project.projectTemplateKey])
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)
  const signatureSection = report.reportDraft.sections.find((section) => section.key === 'signature_certificate')
  const signatureFallbackRows = printableLines(signatureSection?.text ?? '')
    .map(parseDefinition)
    .filter((row): row is NonNullable<ReturnType<typeof parseDefinition>> => Boolean(row))
  const hasSignature = signatureSection?.isRelevant !== false && Boolean(
    report.branding.signature ||
      report.branding.inspectorSignatureUrl ||
      report.branding.inspectorAvatarUrl ||
      signatureFallbackRows.some((row) => row.label !== 'Datum')
  )
  const contentLinks = [
    ...visibleSections.map((section) => ({
      href: `#section-${section.key}`,
      label: `${section.sbrPoint ? `SBR ${section.sbrPoint} · ` : ''}${section.title}`,
    })),
    ...(hasSignature ? [{ href: '#signature', label: 'Underskrift och certifiering' }] : []),
    ...(imageData.images.length > 0 ? [{ href: '#photo-appendix', label: 'Bilaga 1 · Fotobilaga' }] : []),
  ]
  const documentTitle = reportDocumentTitle(report)
  const reference = reportReference(report)
  const objectIdentity =
    report.project.propertyDesignation?.trim() ||
    report.project.brfApartmentNumber?.trim() ||
    report.project.title.trim()
  const address = compact([report.project.address, report.project.postalCode, report.project.city]) || '–'
  const versionDate = formatDateTime(publishedAt || report.inspection.reportLockedAt)

  const openImage = (imageId: string) => {
    const index = imageData.images.findIndex((image) => image.id === imageId)
    if (index >= 0) setActiveImageIndex(index)
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <PublicToolbar
        shareEndpoint={shareEndpoint}
        shareUrl={shareUrl}
        pdfDownloadUrl={pdfDownloadUrl}
        pdfStatus={pdfStatus}
        pdfError={pdfError}
        deliveryDocuments={deliveryDocuments}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-2xl bg-emerald-950 text-white shadow-sm">
          <div className="grid lg:grid-cols-[1fr_320px]">
            <div className="p-6 sm:p-8 lg:p-10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-900 px-3 py-1 text-xs font-semibold text-emerald-50">
                  <CheckCircle2 size={14} aria-hidden />
                  Fastställd version
                </span>
                {reference ? (
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-emerald-50">
                    EB {reference}
                  </span>
                ) : null}
              </div>
              <p className="mt-6 text-sm font-semibold uppercase tracking-[0.17em] text-emerald-200">
                {report.inspection.variantLabel}
              </p>
              <h1 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                {documentTitle}
              </h1>
              <p className="mt-4 max-w-3xl text-lg leading-8 text-emerald-50/90">
                {report.project.objectDescription?.trim() || report.project.contractName?.trim() || report.project.title}
              </p>
              {versionDate ? <p className="mt-6 text-xs text-emerald-100/70">Fastställd {versionDate}</p> : null}
            </div>
            <div className="border-t border-white/10 bg-white/5 p-6 sm:p-8 lg:border-l lg:border-t-0">
              {report.branding.inspectorLogoUrl ? (
                <img
                  src={report.branding.inspectorLogoUrl}
                  alt="Besiktningsmannens logotyp"
                  className="mb-7 max-h-16 max-w-48 rounded-lg bg-white object-contain p-2"
                />
              ) : null}
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Objekt</dt>
                  <dd className="mt-1 font-semibold text-white">{objectIdentity}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Adress</dt>
                  <dd className="mt-1 leading-6 text-emerald-50">{address}</dd>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Datum</dt>
                    <dd className="mt-1 text-emerald-50">{report.inspection.date || '–'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Tid</dt>
                    <dd className="mt-1 text-emerald-50">{report.inspection.inspectionTime || '–'}</dd>
                  </div>
                </div>
                {report.inspection.assignmentNumber ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Uppdragsnummer</dt>
                    <dd className="mt-1 text-emerald-50">{report.inspection.assignmentNumber}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        </section>

        <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:hidden">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-950">Visa innehåll</summary>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <Contents links={contentLinks} />
          </div>
        </details>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="sticky top-5 hidden max-h-[calc(100vh-2.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:block">
            <Contents links={contentLinks} />
          </aside>

          <article className="space-y-4">
            {visibleSections.map((section) => (
              <SectionShell key={section.key} section={section}>
                <SectionContent
                  report={report}
                  section={section}
                  notes={notes}
                  headingsByNoteId={headingsByNoteId}
                  trailingHeadings={trailingHeadings}
                />
              </SectionShell>
            ))}

            <Signature report={report} hasImages={imageData.images.length > 0} />
            <PhotoAppendix groups={imageData.groups} images={imageData.images} onOpen={openImage} />
          </article>
        </div>

        <footer className="mt-8 rounded-2xl border border-slate-200 bg-white px-5 py-5 text-sm text-slate-600 sm:px-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-12">
              <div>
                {report.branding.footer.companyLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <div>
                {report.branding.footer.contactLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Skapat med</span>
              <img src={report.branding.besiktAppLogoUrl} alt="BesiktApp" className="max-h-7 max-w-28 object-contain" />
            </div>
          </div>
        </footer>
      </div>

      {activeImageIndex !== null ? (
        <ImageLightbox
          images={imageData.images}
          activeIndex={activeImageIndex}
          onChange={setActiveImageIndex}
          onClose={() => setActiveImageIndex(null)}
        />
      ) : null}
    </main>
  )
}
