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

function ReportText({ text }: { text: string }) {
  const blocks = normalizeReportText(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)

  if (blocks.length === 0) return null

  return (
    <div className="space-y-3 text-[13px] leading-5 text-gray-900">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
        const labelRows = lines.map(parseLabelLine)
        const isDefinitionBlock = labelRows.length > 0 && labelRows.every(Boolean)

        if (isDefinitionBlock) {
          return (
            <dl key={`${blockIndex}-${block}`} className="grid gap-y-1">
              {labelRows.map((row, rowIndex) => row ? (
                <div key={`${row.label}-${rowIndex}`} className="grid gap-x-4 sm:grid-cols-[11rem_1fr]">
                  <dt className="font-semibold text-gray-600">{row.label}</dt>
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

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-gray-300 py-4 print:py-3">
      <h2 className="mb-2 text-[13px] font-bold text-gray-950">{title}</h2>
      {children}
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
      section.text.trim()
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
    <main className="eb-report-print-root min-h-screen bg-gray-100 text-gray-950 print:min-h-0 print:bg-white">
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

      <article className="eb-report-print-document mx-auto max-w-5xl bg-white px-10 py-8 shadow-sm print:shadow-none">
        <header className="border-b-2 border-gray-950 pb-5">
          <h1 className="text-2xl font-bold tracking-normal text-gray-950">
            Utlåtande över {report.inspection.variantLabel.toLowerCase()}
          </h1>
          <div className="mt-5 grid gap-5 sm:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-lg font-bold">{report.project.title}</p>
              <p className="mt-1 text-sm text-gray-700">
                {detailLine([report.project.address, report.project.postalCode, report.project.city])}
              </p>
              <p className="mt-1 text-sm text-gray-700">
                {detailLine([report.project.propertyDesignation, report.project.municipality])}
              </p>
            </div>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-gray-500">Besiktning</dt>
                <dd className="font-bold">{report.inspection.variant}{report.inspection.sequenceNo}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-gray-500">Datum</dt>
                <dd>{formatDate(report.inspection.date)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-gray-500">Tid</dt>
                <dd>{formatTime(report.inspection.inspectionTime) || '-'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-gray-500">Noteringsserie</dt>
                <dd>{report.project.notePrefix}</dd>
              </div>
            </dl>
          </div>
        </header>

        {reportSections.map((section) => (
          <Section
            key={section.key}
            title={section.sbrPoint ? `${section.sbrPoint}. ${section.title}` : section.title}
          >
            <ReportText text={section.text} />
          </Section>
        ))}
        <Section title="Noteringar">
          {notes.length === 0 ? (
            <p className="text-sm text-gray-600">Inga noteringar registrerade.</p>
          ) : (
            <div>
              {notes.map((note, index) => {
                const images = imagesByNoteId.get(note.id) ?? []
                const notePlace = detailLine([note.room, note.location, note.placeDetail])
                return (
                  <article key={note.id} className="break-inside-avoid border-t border-gray-200 py-3 first:border-t-0 first:pt-0">
                    <div className="grid gap-3 sm:grid-cols-[6rem_1fr_7rem]">
                      <div className="text-sm">
                        <p className="text-[11px] font-semibold text-gray-500">Nr / bet.</p>
                        <p className="mt-1 font-bold text-gray-950">
                          {report.project.notePrefix} {note.noteNumber ?? index + 1}
                        </p>
                        <p className="font-bold text-gray-950">{note.markerKey || '-'}</p>
                      </div>
                      <div>
                        {notePlace !== '-' ? (
                          <p className="text-[12px] font-semibold text-gray-600">{notePlace}</p>
                        ) : null}
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-gray-950">{note.noteText}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-500">Status</p>
                        <p className="mt-1 text-[13px] font-semibold">{note.statusLabel ?? note.statusKey}</p>
                      </div>
                    </div>
                    {images.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-3 sm:pl-[6rem]">
                        {images.map((image) => (
                          <figure key={image.id} className="break-inside-avoid">
                            <img
                              src={image.publicUrl}
                              alt={image.label ?? 'Noteringsbild'}
                              className="h-32 w-40 bg-gray-50 object-contain print:h-[32mm] print:w-[42mm]"
                            />
                          </figure>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </Section>

        <Section title="Underskrift">
          <div className="mt-12 grid gap-10 sm:grid-cols-2">
            <div className="border-t border-gray-400 pt-3 text-sm text-gray-700">Besiktningsman</div>
            <div className="border-t border-gray-400 pt-3 text-sm text-gray-700">Datum</div>
          </div>
        </Section>
      </article>
    </main>
  )
}



