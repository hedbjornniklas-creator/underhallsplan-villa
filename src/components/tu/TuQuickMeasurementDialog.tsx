'use client'

import { useState } from 'react'
import { ChevronDown, Loader2, Ruler, Save, X } from 'lucide-react'
import type { TuFieldQueueController } from '@/hooks/useTuFieldQueue'

type Props = {
  locked: boolean
  queue: TuFieldQueueController
  onClose: () => void
  onQueued?: () => void
}

const MEASUREMENT_TYPES = [
  'Fuktindikering',
  'Relativ fuktighet (RF)',
  'Fuktkvot (FK)',
  'Temperatur',
  'Yttemperatur',
  'Annan instrumentmätning',
]

function suggestedUnit(measurementType: string) {
  if (measurementType.includes('(RF)') || measurementType.includes('(FK)')) return '%'
  if (measurementType.toLocaleLowerCase('sv-SE').includes('temperatur')) return '°C'
  return ''
}

export default function TuQuickMeasurementDialog({ locked, queue, onClose, onQueued }: Props) {
  const [measurementType, setMeasurementType] = useState('Fuktindikering')
  const [valueText, setValueText] = useState('')
  const [unit, setUnit] = useState('')
  const [location, setLocation] = useState('')
  const [method, setMethod] = useState('')
  const [instrument, setInstrument] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (locked || saving) return
    if (!measurementType.trim() || !valueText.trim()) {
      setError('Ange typ och resultat.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await queue.enqueueMeasurement({
        measurementType,
        valueText,
        unit,
        location,
        method,
        instrument,
        note,
      })
      onQueued?.()
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara mätningen.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end justify-center bg-gray-950/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tu-quick-measurement-title"
    >
      <div className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-lg bg-white shadow-2xl sm:max-w-xl sm:rounded-lg">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-800">
              <Ruler size={19} aria-hidden />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase text-violet-700">Fältloggen</p>
              <h2 id="tu-quick-measurement-title" className="mt-0.5 text-lg font-semibold text-gray-950">
                Ny instrumentmätning
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Typ och resultat räcker på plats. Resten kan kompletteras under Sortera och granska.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Stäng mätningen"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium text-gray-800">Mättyp *</span>
              <select
                value={measurementType}
                onChange={(event) => {
                  const nextType = event.target.value
                  setMeasurementType(nextType)
                  if (!unit.trim()) setUnit(suggestedUnit(nextType))
                }}
                autoFocus
                className="h-12 w-full rounded-md border border-gray-300 bg-white px-3 text-base outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
              >
                {MEASUREMENT_TYPES.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-800">Resultat *</span>
                <input
                  value={valueText}
                  onChange={(event) => setValueText(event.target.value)}
                  inputMode="decimal"
                  placeholder="Exempel: 12,4"
                  className="h-12 w-full rounded-md border border-gray-300 px-3 text-base outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-800">Enhet</span>
                <input
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder="%, °C"
                  className="h-12 w-full rounded-md border border-gray-300 px-3 text-base outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                />
              </label>
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-800">Plats eller rum <span className="font-normal text-gray-500">(valfritt)</span></span>
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Exempel: Sovrum, tak vid fläck"
              className="h-12 w-full rounded-md border border-gray-300 px-3 text-base outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
            />
          </label>

          <details className="group rounded-md border border-gray-200">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-gray-800 [&::-webkit-details-marker]:hidden">
              Fler uppgifter
              <span className="inline-flex items-center gap-2 text-xs font-normal text-gray-500">
                Kan fyllas i senare
                <ChevronDown size={15} className="transition group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="grid gap-4 border-t border-gray-200 p-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-800">Metod</span>
                <input
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  placeholder="Exempel: indikativ ytmätning"
                  className="h-11 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-800">Instrument</span>
                <input
                  value={instrument}
                  onChange={(event) => setInstrument(event.target.value)}
                  placeholder="Modell eller inventarienummer"
                  className="h-11 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-sm font-medium text-gray-800">Kommentar</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="Material, mätpunkt, referens eller andra förutsättningar."
                  className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100"
                />
              </label>
            </div>
          </details>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <span className="hidden text-xs text-gray-500 sm:block">Sparas lokalt och synkas i bakgrunden.</span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={locked || saving || !measurementType.trim() || !valueText.trim()}
            aria-busy={saving}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-auto"
          >
            {saving ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Save size={17} aria-hidden />}
            {saving ? 'Sparar lokalt...' : 'Spara mätning'}
          </button>
        </div>
      </div>
    </div>
  )
}
