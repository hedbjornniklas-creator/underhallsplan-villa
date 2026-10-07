'use client'

import { useRef, useState } from 'react'
import { Building2, Link2, Loader2, Plus, Search } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { emptyPropertyDetails, propertyFields, propertyIdentityKey, type ProjectPropertyLink, type RegisteredProperty } from '@/lib/properties/identity'
import { editContractProperty, emptyContractDetails, type CustomerContractDetails } from '@/lib/action-cases/customerContract'

const field = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50'
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50'

export default function CustomerContractPropertyEditor({ caseId, value, street, link, busy, onChange, onBind }: {
  caseId: string
  value?: CustomerContractDetails
  street: string
  link?: ProjectPropertyLink
  busy: boolean
  onChange: (value: CustomerContractDetails) => void
  onBind: (binding: Record<string, unknown>) => Promise<boolean>
}) {
  const details = value ?? emptyContractDetails()
  const property = details.property ?? emptyPropertyDetails(street)
  const legacy = details.propertyReference ?? (!details.property ? details.fields.property.text : '')
  const [options, setOptions] = useState<RegisteredProperty[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [bindingMode, setBindingMode] = useState<'existing' | 'create' | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const request = useRef<{ key: string; id: string } | null>(null)
  const toast = useToast()
  const linked = Boolean(link?.property && details.property?.sourcePropertyId === link.property.id)
  const registered = propertyIdentityKey(property) !== null
  const selected = options?.find((row) => row.id === selectedId)
  const visible = options?.filter((row) => `${row.cadastralDesignation} ${row.municipality} ${row.street} ${row.city} ${row.name}`.toLowerCase().includes(search.toLowerCase())) ?? []

  async function load() {
    if (loading || busy) return
    setLoading(true)
    try {
      const response = await fetch(`/api/action-cases/${caseId}/properties`, { signal: AbortSignal.timeout(15000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setOptions(result.properties)
    } catch (error) { toast.error(error, 'Fastigheterna kunde inte hämtas. Försök igen.') }
    finally { setLoading(false) }
  }
  async function bind(mode: 'existing' | 'create') {
    if (busy || bindingMode) return
    const data = mode === 'existing' ? { mode, propertyId: selectedId, property: selected } : { mode, property }
    const key = JSON.stringify(data)
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    setBindingMode(mode)
    try {
      if (await onBind({ ...data, requestId: request.current.id })) {
        request.current = null
      }
    } finally { setBindingMode(null) }
  }
  return <div className="space-y-5">
    {legacy && !linked && <p className="break-words border-l-2 border-amber-300 pl-3 text-sm text-slate-600">{legacy}</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {propertyFields.map(({ key, title, max, required }) => <label key={key} className={`block min-w-0 text-sm font-medium ${key === 'street' ? 'sm:col-span-2' : ''}`}>
        {title}{required ? ' *' : ' (valfritt)'}
        <input aria-label={title} className={field} maxLength={max} autoComplete="off" value={property[key]}
          onChange={(event) => onChange(editContractProperty(details, { [key]: event.target.value }, street))} />
      </label>)}
    </div>
    {linked && <p className="flex items-center gap-2 text-sm text-emerald-800"><Link2 size={16} aria-hidden="true" /> Kopplad i HusHub: {link?.property?.cadastralDesignation}, {link?.property?.municipality}</p>}
    {link?.property && !linked && <p className="text-sm text-amber-800">Fastighetsuppgifterna har ändrats. Koppla rätt fastighet i HusHub.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || loading || !link?.available} onClick={() => options ? setOptions(null) : void load()}>
        {loading ? <Loader2 size={17} className="animate-spin" /> : <Building2 size={17} />} Välj från HusHub
      </button>
      {!linked && <button type="button" className={button} disabled={busy || !registered || !link?.available} onClick={() => void bind('create')}>
        {bindingMode === 'create' ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />} Registrera fastigheten
      </button>}
    </div>
    {link?.available === false && <p className="text-sm text-amber-800">Fastighetskopplingen behöver aktiveras av administratören.</p>}
    {options && <div className="space-y-3 border-t border-slate-200 pt-4">
      <label className="block text-sm"><span className="inline-flex items-center gap-2"><Search size={15} /> Sök fastighet</span>
        <input aria-label="Sök fastighet" className={field} value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <label className="block text-sm">Fastighet i HusHub
        <select aria-label="Fastighet i HusHub" className={field} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Välj fastighet</option>
          {visible.map((row) => <option key={row.id} value={row.id}>{[row.cadastralDesignation || row.name, row.municipality, row.street].filter(Boolean).join(' · ')}</option>)}
        </select>
      </label>
      {!visible.length && <p className="text-sm text-slate-600">Inga fastigheter hittades.</p>}
      {selected && <p className="text-sm text-slate-600">{[selected.street, selected.postalCode, selected.city].filter(Boolean).join(', ')}</p>}
      <button type="button" className={button} disabled={busy || !selected || (linked && selected.id === details.property?.sourcePropertyId && propertyFields.every(({ key }) => selected[key] === property[key]))} onClick={() => void bind('existing')}>
        {bindingMode === 'existing' ? <Loader2 size={17} className="animate-spin" /> : <Link2 size={17} />} Använd fastigheten
      </button>
    </div>}
  </div>
}
