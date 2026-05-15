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

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-gray-300 py-7 print:break-inside-avoid">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-gray-950">{title}</h2>
      {children}
    </section>
  )
}

function InfoGrid({
  rows,
}: {
  rows: Array<[string, string | null | undefined]>
}) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
          <dt className="font-semibold text-gray-500">{label}</dt>
          <dd className="font-medium text-gray-950">{value || '-'}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function EbInspectionReportView({ report }: EbInspectionReportViewProps) {
  const notes = sortNotes(report.notes)
  const reportSections = report.reportDraft.sections.filter(
    (section) => section.isRelevant && section.key !== 'notes' && section.text.trim()
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

      <article className="eb-report-print-document mx-auto max-w-5xl bg-white px-10 py-12 shadow-sm print:shadow-none">
        <header className="border-b-4 border-gray-950 pb-8">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-800">
            {report.inspection.variantLabel}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-normal text-gray-950">Utlåtande</h1>
          <div className="mt-8 grid gap-6 sm:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-xl font-bold">{report.project.title}</p>
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

        <Section title="Grunduppgifter">
          <InfoGrid
            rows={[
              ['Entreprenad', report.project.contractName],
              ['Objekt', report.project.propertyDesignation],
              ['Objektsbeskrivning', report.project.objectDescription],
              ['Standardavtal', report.project.standardAgreement],
              ['Entreprenadform', report.project.contractForm],
              ['Upphandlingsform', report.project.procurementForm],
              ['Kontraktsdatum', formatDate(report.project.contractDate)],
            ]}
          />
        </Section>

        <Section title="Parter">
          <InfoGrid
            rows={[
              ['Beställare', report.project.clientName],
              ['Beställare org.nr', report.project.clientOrgNo],
              ['Entreprenör', report.project.contractorName],
              ['Entreprenör org.nr', report.project.contractorOrgNo],
            ]}
          />
        </Section>

        <Section title="Närvarande">
          {report.participants.length === 0 ? (
            <p className="text-sm text-gray-600">Inga deltagare registrerade.</p>
          ) : (
            <div className="divide-y divide-gray-200 border-y border-gray-200">
              {report.participants.map((participant, index) => (
                <div key={participant.id ?? index} className="grid gap-2 py-3 text-sm sm:grid-cols-[10rem_1fr_1fr]">
                  <span className="font-semibold text-gray-500">{participant.roleLabel || '-'}</span>
                  <span className="font-medium text-gray-950">{participant.companyName || '-'}</span>
                  <span className="text-gray-700">
                    {detailLine([participant.personName, participant.email, participant.phone])}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Utlåtandesektioner">
          <div className="space-y-5">
            {reportSections.map((section) => (
              <article key={section.key} className="break-inside-avoid">
                <div className="flex items-baseline gap-3">
                  {section.sbrPoint ? (
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
                      {section.sbrPoint}
                    </span>
                  ) : null}
                  <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-gray-950">
                    {section.title}
                  </h3>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-800">{section.text}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Noteringar">
          {notes.length === 0 ? (
            <p className="text-sm text-gray-600">Inga noteringar registrerade.</p>
          ) : (
            <div className="space-y-6">
              {notes.map((note, index) => {
                const images = imagesByNoteId.get(note.id) ?? []
                return (
                  <article key={note.id} className="break-inside-avoid border-t border-gray-200 pt-4 first:border-t-0 first:pt-0">
                    <div className="grid gap-3 sm:grid-cols-[4rem_4rem_1fr_8rem]">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Bet.</p>
                        <p className="mt-1 text-lg font-bold">{note.markerKey || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Nr</p>
                        <p className="mt-1 text-lg font-bold">{index + 1}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                          {detailLine([note.disciplineLabel, note.room, note.location, note.placeDetail])}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-950">{note.noteText}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Status</p>
                        <p className="mt-1 text-sm font-semibold">{note.statusLabel ?? note.statusKey}</p>
                      </div>
                    </div>
                    {images.length > 0 ? (
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {images.map((image) => (
                          <figure key={image.id} className="break-inside-avoid">
                            <img src={image.publicUrl} alt={image.label ?? 'Noteringsbild'} className="aspect-[4/3] w-full object-cover" />
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
