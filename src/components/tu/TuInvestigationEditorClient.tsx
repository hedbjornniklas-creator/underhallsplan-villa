'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save } from 'lucide-react'
import DebouncedTextarea from '@/components/ob/DebouncedTextarea'
import type { TuInvestigationDetails, TuReportDraft, TuReportSectionKey } from '@/lib/tu/server'

function cloneDraftWithSection(draft: TuReportDraft, key: TuReportSectionKey, text: string): TuReportDraft {
  return {
    sections: draft.sections.map((section) => (section.key === key ? { ...section, text } : section)),
  }
}

function formatSavedAt(value: string | null) {
  if (!value) return 'Inte sparad'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export default function TuInvestigationEditorClient({
  initialInvestigation,
}: {
  initialInvestigation: TuInvestigationDetails
}) {
  const [investigation, setInvestigation] = useState(initialInvestigation)
  const [draft, setDraft] = useState<TuReportDraft>(initialInvestigation.reportDraft)
  const [title, setTitle] = useState(initialInvestigation.title)
  const [scopeDescription, setScopeDescription] = useState(initialInvestigation.scopeDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const draftRef = useRef(initialInvestigation.reportDraft)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const savePatch = async (body: Record<string, unknown>) => {
    setSaveState('saving')
    setError(null)
    const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setSaveState('idle')
      throw new Error(payload.error ?? 'Kunde inte spara TU-utredningen.')
    }
    if (payload.investigation) {
      setInvestigation(payload.investigation)
      if (payload.investigation.reportDraft) {
        setDraft(payload.investigation.reportDraft)
        draftRef.current = payload.investigation.reportDraft
      }
    }
    setSaveState('saved')
  }

  const saveTitleAndScope = async () => {
    try {
      await savePatch({ title, scopeDescription })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara.')
    }
  }

  const saveSection = async (key: TuReportSectionKey, value: string) => {
    const nextDraft = cloneDraftWithSection(draftRef.current, key, value)
    draftRef.current = nextDraft
    setDraft(nextDraft)
    try {
      await savePatch({ reportDraft: nextDraft })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara avsnittet.')
      throw saveError
    }
  }

  const locked = Boolean(investigation.reportLockedAt)

  return (
    <main className="min-h-screen bg-violet-50/40">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 md:px-6">
        <header className="space-y-4 border-b border-violet-100 pb-4">
          <Link
            href="/tu"
            className="inline-flex items-center gap-2 text-sm font-medium text-violet-800 hover:text-violet-950"
          >
            <ArrowLeft size={16} aria-hidden />
            Till TU
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">TU-utlåtande</p>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-950">{title}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {investigation.property?.address || 'Ingen adress'} {investigation.property?.city || ''}
              </p>
            </div>
            <div className="rounded-md border border-violet-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm">
              {saveState === 'saving' ? 'Sparar...' : `Sparad: ${formatSavedAt(investigation.updatedAt)}`}
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}
        {locked ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Utlåtandet är låst och kan inte ändras.
          </div>
        ) : null}

        <section className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-gray-600">Rubrik</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void saveTitleAndScope()}
                disabled={locked}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-gray-600">Utredningens omfattning</span>
              <textarea
                value={scopeDescription}
                onChange={(event) => setScopeDescription(event.target.value)}
                onBlur={() => void saveTitleAndScope()}
                disabled={locked}
                rows={3}
                className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </label>
          </div>
        </section>

        <section className="space-y-4">
          {draft.sections.map((section, index) => (
            <article key={section.key} className="rounded-lg border border-violet-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-950">
                  {index + 1}. {section.title}
                </h2>
                <Save size={16} className="text-violet-500" aria-hidden />
              </div>
              <DebouncedTextarea
                value={section.text}
                draftKey={`tu:${investigation.inspectionId}:${section.key}`}
                disabled={locked}
                rows={7}
                className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                onValueChange={(value) => {
                  const nextDraft = cloneDraftWithSection(draftRef.current, section.key, value)
                  draftRef.current = nextDraft
                  setDraft(nextDraft)
                }}
                onSave={(value) => saveSection(section.key, value)}
              />
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
