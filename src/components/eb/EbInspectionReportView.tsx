'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, FileText, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EbInspectionReport, EbNote, EbNoteImage } from '@/lib/eb/server'

type EbInspectionReportViewProps = {
  report: EbInspectionReport
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function formatTime(value: string | null) {
  if (!value) return ''
  return value.slice(0, 5)
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
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="eb-report-section break-inside-auto pt-4">
      <h2 className="mb-2 text-[12pt] font-bold leading-tight text-black">{title}</h2>
      {children}
    </section>
  )
}

function ReportHeader({ report }: { report: EbInspectionReport }) {
  return (
    <header className="mb-8">
      <div className="flex min-h-[22mm] items-start justify-between gap-8">
        <div className="flex min-h-[18mm] flex-1 items-start">
          {report.branding.inspectorLogoUrl ? (
            <img
              src={report.branding.inspectorLogoUrl}
              alt="Besiktningsmannens logotyp"
              className="max-h-[18mm] max-w-[70mm] object-contain"
            />
          ) : null}
        </div>
        <img
          src={report.branding.besiktAppLogoUrl}
          alt="BesiktApp"
          className="h-[13mm] w-auto object-contain"
        />
      </div>

      <div className="mt-8 text-center">
        <h1 className="text-[16pt] font-bold leading-tight text-black">
          Utlåtande över {report.inspection.variantLabel.toLowerCase()}
        </h1>
        <p className="mt-3 text-[14pt] font-bold text-black">
          {detailLine([report.project.address, report.project.postalCode, report.project.city])}
        </p>
      </div>

      <div className="mt-7 grid grid-cols-[1fr_47mm] gap-8 border-b border-black pb-4 text-[10.5pt] text-black">
        <div>
          <p className="font-bold">{report.project.title}</p>
          <p>{detailLine([report.project.propertyDesignation, report.project.municipality])}</p>
        </div>
        <dl className="grid gap-y-1">
          <div className="grid grid-cols-[24mm_1fr] gap-x-3">
            <dt>Besiktning:</dt>
            <dd>{report.inspection.variant}{report.inspection.sequenceNo}</dd>
          </div>
          <div className="grid grid-cols-[24mm_1fr] gap-x-3">
            <dt>Datum:</dt>
            <dd>{formatDate(report.inspection.date)}</dd>
          </div>
          <div className="grid grid-cols-[24mm_1fr] gap-x-3">
            <dt>Tid:</dt>
            <dd>{formatTime(report.inspection.inspectionTime) || '-'}</dd>
          </div>
        </dl>
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
      <h2 className="mb-3 text-[12pt] font-bold leading-tight text-black">Fotobilaga</h2>
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
  const reportSections = report.reportDraft.sections.filter(
    (section) =>
      section.isRelevant &&
      section.key !== 'notes' &&
      section.status !== 'missing' &&
      hasPrintableReportText(section.text)
  )
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

        {reportSections.map((section) => (
          <ReportSection
            key={section.key}
            title={section.sbrPoint ? `${section.sbrPoint}. ${section.title}` : section.title}
          >
            <ReportText text={section.text} />
          </ReportSection>
        ))}

        <section className="eb-report-section mt-8 break-before-page">
          <h2 className="mb-3 text-[13pt] font-bold leading-tight text-black">
            Bilaga 1 till utlåtande över {report.inspection.variantLabel.toLowerCase()}
          </h2>
          <NoteTable report={report} notes={notes} />
        </section>

        <PhotoAppendix report={report} notes={notes} imagesByNoteId={imagesByNoteId} />
      </article>
    </main>
  )
}
