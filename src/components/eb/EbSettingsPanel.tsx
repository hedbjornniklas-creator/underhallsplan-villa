'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { EbToastProvider, useEbToast } from '@/components/eb/EbToastProvider'
import ActionButton from '@/components/ui/ActionButton'
import { supabase } from '@/lib/supabaseClient'

type SettingRow = {
  id: string
  key: string
  label: string
  description?: string | null
  sort_order?: number | null
  is_active?: boolean | null
  is_default?: boolean | null
  littera_prefix?: string | null
  color_token?: string | null
}

type SettingsState = {
  types: SettingRow[]
  disciplines: SettingRow[]
  statuses: SettingRow[]
  markers: SettingRow[]
}

type SettingsQueryResult = {
  data: SettingRow[] | null
  error: unknown | null
}

type SettingsQuery = {
  order: (column: string, options?: { ascending?: boolean }) => PromiseLike<SettingsQueryResult>
}

type SettingsTableQuery = {
  select: (columns: string) => SettingsQuery
}

type EbSettingsClient = {
  from: (table: string) => SettingsTableQuery
}

const EMPTY_STATE: SettingsState = {
  types: [],
  disciplines: [],
  statuses: [],
  markers: [],
}

const TABLES = {
  types: 'settings_eb_inspection_types',
  disciplines: 'settings_eb_disciplines',
  statuses: 'settings_eb_note_statuses',
  markers: 'settings_eb_note_markers',
} as const

function isMissingTableError(error: unknown) {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')

  return message.includes('42P01') || message.toLowerCase().includes('does not exist')
}

function SettingsCard({
  title,
  rows,
  columns,
}: {
  title: string
  rows: SettingRow[]
  columns: Array<'key' | 'label' | 'littera_prefix' | 'color_token' | 'is_default'>
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-700">{title}</h3>
        <span className="text-xs text-stone-500">{rows.length} rader</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-stone-600">Inga aktiva rader.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
                {columns.includes('key') ? <th className="py-2 pr-3">Nyckel</th> : null}
                {columns.includes('label') ? <th className="py-2 pr-3">Namn</th> : null}
                {columns.includes('littera_prefix') ? <th className="py-2 pr-3">Littera</th> : null}
                {columns.includes('color_token') ? <th className="py-2 pr-3">Färg</th> : null}
                {columns.includes('is_default') ? <th className="py-2 pr-3">Standard</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.includes('key') ? <td className="py-2 pr-3 font-mono text-xs">{row.key}</td> : null}
                  {columns.includes('label') ? <td className="py-2 pr-3 font-medium text-stone-900">{row.label}</td> : null}
                  {columns.includes('littera_prefix') ? <td className="py-2 pr-3">{row.littera_prefix ?? '-'}</td> : null}
                  {columns.includes('color_token') ? <td className="py-2 pr-3">{row.color_token ?? '-'}</td> : null}
                  {columns.includes('is_default') ? <td className="py-2 pr-3">{row.is_default ? 'Ja' : '-'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function EbSettingsPanelContent() {
  const { showError } = useEbToast()
  const [settings, setSettings] = useState<SettingsState>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const client = supabase as unknown as EbSettingsClient

    const [types, disciplines, statuses, markers] = await Promise.all([
      client
        .from(TABLES.types)
        .select('id,key,label,description,sort_order,is_active,is_default')
        .order('sort_order', { ascending: true }),
      client
        .from(TABLES.disciplines)
        .select('id,key,label,littera_prefix,description,sort_order,is_active')
        .order('sort_order', { ascending: true }),
      client
        .from(TABLES.statuses)
        .select('id,key,label,description,color_token,sort_order,is_active,is_default')
        .order('sort_order', { ascending: true }),
      client
        .from(TABLES.markers)
        .select('id,key,label,description,color_token,sort_order,is_active')
        .order('sort_order', { ascending: true }),
    ])

    const firstError = [types.error, disciplines.error, statuses.error, markers.error].find(Boolean)
    if (firstError) {
      const message = isMissingTableError(firstError)
        ? 'EB-inställningarna saknar databasmigreringen.'
        : 'Kunde inte hämta EB-inställningarna.'
      setSettings(EMPTY_STATE)
      setError(message)
      showError(message)
      setLoading(false)
      return
    }

    setSettings({
      types: (types.data ?? []) as SettingRow[],
      disciplines: (disciplines.data ?? []) as SettingRow[],
      statuses: (statuses.data ?? []) as SettingRow[],
      markers: (markers.data ?? []) as SettingRow[],
    })
    setLoading(false)
  }, [showError])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [load])

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">EB-grundinställningar</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-emerald-900">
              Första versionen delar BesiktApp-admin med ÖB och visar de val som SLB-flödet bygger på.
            </p>
          </div>
          <ActionButton
            type="button"
            onClick={() => void load()}
            busy={loading}
            busyLabel="Laddar …"
            icon={<RefreshCw size={15} aria-hidden="true" />}
            busyIcon={<RefreshCw size={15} className="animate-spin" aria-hidden="true" />}
            tone="emeraldSecondary"
            className="rounded-lg px-3 py-2 text-sm font-semibold"
          >
            Ladda om
          </ActionButton>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsCard title="Besiktningstyper" rows={settings.types} columns={['key', 'label', 'is_default']} />
        <SettingsCard title="Fack" rows={settings.disciplines} columns={['key', 'label', 'littera_prefix']} />
        <SettingsCard title="Noteringsstatusar" rows={settings.statuses} columns={['key', 'label', 'color_token', 'is_default']} />
        <SettingsCard title="Beteckningar" rows={settings.markers} columns={['key', 'label', 'color_token']} />
      </div>
    </div>
  )
}

export default function EbSettingsPanel() {
  return (
    <EbToastProvider>
      <EbSettingsPanelContent />
    </EbToastProvider>
  )
}
