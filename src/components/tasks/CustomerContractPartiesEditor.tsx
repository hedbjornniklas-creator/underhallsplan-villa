'use client'

import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { ContractContractor, ContractParties } from '@/lib/action-cases/customerContractParties'

const field = 'mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50'
const button = 'inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold'

export function ContractCustomerEditor({ value, onChange }: { value: ContractParties; onChange: (value: ContractParties) => void }) {
  return <div className="space-y-5">
    {value.customers.map((customer, index) => <fieldset key={index} className="min-w-0 border-b border-slate-200 pb-4">
      <legend className="mb-3 text-sm font-semibold">Beställare {index + 1}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm">För- och efternamn *<input className={field} aria-label={`Beställare ${index + 1}: För- och efternamn`} autoComplete="name" maxLength={250} value={customer.name}
          onChange={(event) => onChange({ ...value, customers: value.customers.map((row, position) => position === index ? { ...row, name: event.target.value } : row) })} /></label>
        <label className="min-w-0 text-sm">Personnummer (valfritt)<input className={field} aria-label={`Beställare ${index + 1}: Personnummer`} autoComplete="off" maxLength={20} value={customer.personalNumber}
          onChange={(event) => onChange({ ...value, customers: value.customers.map((row, position) => position === index ? { ...row, personalNumber: event.target.value } : row) })} /></label>
      </div>
      {index > 0 && <button className={`${button} mt-3 text-rose-700`} onClick={() => onChange({ ...value, customers: value.customers.filter((_, position) => position !== index) })}><Trash2 size={16} /> Ta bort beställare {index + 1}</button>}
    </fieldset>)}
    {value.customers.length < 2 && <button className={button} onClick={() => onChange({ ...value, customers: [...value.customers, { name: '', personalNumber: '' }] })}><Plus size={16} /> Lägg till beställare</button>}
    <div className="grid gap-4 sm:grid-cols-2">
      {([['street', 'Gata/Box', true, 'street-address'], ['postalCode', 'Postnummer', true, 'postal-code'], ['city', 'Ort', true, 'address-level2'], ['phone', 'Telefon', false, 'tel'], ['mobile', 'Mobiltelefon', false, 'tel'], ['email', 'E-postadress', true, 'email']] as const).map(([key, label, required, autoComplete]) => <label key={key} className={`min-w-0 text-sm ${key === 'street' ? 'sm:col-span-2' : ''}`}>
        {label}{required ? ' *' : ' (valfritt)'}<input className={field} aria-label={`Beställare: ${label}`} autoComplete={autoComplete} type={key === 'email' ? 'email' : key === 'phone' || key === 'mobile' ? 'tel' : 'text'} maxLength={250} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />
      </label>)}
    </div>
  </div>
}

export function ContractContractorEditor({ value, source, onChange }: { value: ContractContractor; source?: Partial<ContractContractor>; onChange: (value: ContractContractor) => void }) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <a className="gizmo-back underline" href="/settings/organisation" target="_blank" rel="noreferrer">Organisationens företagsuppgifter</a>
      {source && <button className={button} onClick={() => onChange({ ...value, ...source })}><RotateCcw size={16} /> Hämta företagsuppgifter</button>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      {([['companyName', 'Firma', true], ['organizationNumber', 'Organisationsnummer', true], ['contactName', 'Kontaktperson', false], ['mobile', 'Mobiltelefon', false], ['street', 'Gata/Box', true], ['postalCode', 'Postnummer', true], ['city', 'Ort', true], ['phone', 'Telefon', false], ['fax', 'Fax', false], ['email', 'E-postadress', true]] as const).map(([key, label, required]) => <label key={key} className={`min-w-0 text-sm ${key === 'street' ? 'sm:col-span-2' : ''}`}>
        {label}{required ? ' *' : ' (valfritt)'}<input className={field} aria-label={`Entreprenör: ${label}`} type={key === 'email' ? 'email' : ['mobile', 'phone', 'fax'].includes(key) ? 'tel' : 'text'} maxLength={250} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />
      </label>)}
      <label className="text-sm">Godkänd för F-skatt *<select className={field} value={value.fTax} onChange={(event) => onChange({ ...value, fTax: event.target.value as ContractContractor['fTax'] })}>
        <option value="unreviewed">Ej kontrollerat</option><option value="yes">Ja</option><option value="no">Nej</option>
      </select></label>
    </div>
  </div>
}

export function ContractPartiesDocument({ value }: { value: ContractParties }) {
  const lines = (rows: (string | undefined)[]) => rows.filter(Boolean).map((text, index) => <dd key={index} className="mt-1 break-words">{text}</dd>)
  return <section className="grid gap-6 border-t border-slate-200 py-6 text-sm sm:grid-cols-2">
    <dl><dt className="font-semibold">Beställare</dt>{value.customers.map((customer, index) => <dd key={index} className="mt-2 font-medium">{customer.name}{customer.personalNumber && <span className="ml-2 font-normal">{customer.personalNumber}</span>}</dd>)}
      {lines([value.street, [value.postalCode, value.city].filter(Boolean).join(' '), value.phone && `Telefon: ${value.phone}`, value.mobile && `Mobil: ${value.mobile}`, value.email])}</dl>
    <dl><dt className="font-semibold">Entreprenör</dt>{lines([value.contractor.companyName, value.contractor.organizationNumber && `Org.nr: ${value.contractor.organizationNumber}`, value.contractor.contactName && `Kontaktperson: ${value.contractor.contactName}`, value.contractor.street,
      [value.contractor.postalCode, value.contractor.city].filter(Boolean).join(' '), value.contractor.phone && `Telefon: ${value.contractor.phone}`, value.contractor.mobile && `Mobil: ${value.contractor.mobile}`, value.contractor.fax && `Fax: ${value.contractor.fax}`, value.contractor.email,
      value.contractor.fTax === 'unreviewed' ? '' : `Godkänd för F-skatt: ${value.contractor.fTax === 'yes' ? 'Ja' : 'Nej'}`])}</dl>
  </section>
}
