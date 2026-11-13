'use client'

import { TU_CUSTOMER_LABELS, readTuCustomer, tuCustomerKind, type TuCustomerKind, type TuCustomer } from '@/lib/tu/customer'

export type TuCustomerForm = {
  customerType: TuCustomerKind
  customerIdentityNumber: string
  contactName: string
  contactRole: string
  invoiceName: string
  invoiceAddress: string
  invoiceReference: string
}

export const EMPTY_TU_CUSTOMER_FORM: TuCustomerForm = {
  customerType: 'consumer', customerIdentityNumber: '', contactName: '', contactRole: '',
  invoiceName: '', invoiceAddress: '', invoiceReference: '',
}

export function tuCustomerFromForm(form: TuCustomerForm): TuCustomer {
  return { version: 1, kind: form.customerType, identityNumber: form.customerIdentityNumber,
    contactName: form.contactName, contactRole: form.contactRole, invoiceName: form.invoiceName,
    invoiceAddress: form.invoiceAddress, invoiceReference: form.invoiceReference }
}

export function tuCustomerFormFromAssignment(assignment: {
  assignment_details?: Record<string, unknown> | null
  personal_identity_number?: string | null
  invoice_name?: string | null
  invoice_address?: string | null
}): TuCustomerForm {
  const customer = readTuCustomer(assignment.assignment_details?.tuCustomer)
  return { ...EMPTY_TU_CUSTOMER_FORM,
    customerType: customer?.kind ?? tuCustomerKind(assignment.assignment_details),
    customerIdentityNumber: customer?.identityNumber ?? assignment.personal_identity_number ?? '',
    contactName: customer?.contactName ?? '', contactRole: customer?.contactRole ?? '',
    invoiceName: customer?.invoiceName ?? assignment.invoice_name ?? '',
    invoiceAddress: customer?.invoiceAddress ?? assignment.invoice_address ?? '',
    invoiceReference: customer?.invoiceReference ?? '',
  }
}

export function TuCustomerFields({ value, onChange, disabled = false, kindReadOnly = false, identityReadOnly = false }: {
  value: TuCustomerForm
  onChange: <K extends keyof TuCustomerForm>(key: K, value: TuCustomerForm[K]) => void
  disabled?: boolean
  kindReadOnly?: boolean
  identityReadOnly?: boolean
}) {
  const organization = value.customerType !== 'consumer'
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <label className="block text-sm text-slate-700">{'Best\u00e4llartyp'}
      <select aria-label={'Best\u00e4llartyp'} disabled={kindReadOnly} value={value.customerType}
        onChange={event => onChange('customerType', event.target.value as TuCustomerKind)}
        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base">
        {Object.entries(TU_CUSTOMER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <CustomerField disabled={identityReadOnly} label={organization ? 'Organisationsnummer' : 'Personnummer (valfritt)'} value={value.customerIdentityNumber} onChange={text => onChange('customerIdentityNumber', text)} />
      <CustomerField label={organization ? 'Kontaktperson' : 'Kontaktperson (om annan)'} value={value.contactName} onChange={text => onChange('contactName', text)} />
      <CustomerField label="Kontaktpersonens roll" value={value.contactRole} onChange={text => onChange('contactRole', text)} />
    </div>
  </fieldset>
}

export function TuInvoiceFields({ value, onChange, disabled = false }: {
  value: TuCustomerForm; onChange: <K extends keyof TuCustomerForm>(key: K, value: TuCustomerForm[K]) => void; disabled?: boolean
}) {
  const same = !value.invoiceName && !value.invoiceAddress
  return <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
    <CustomerField label="Fakturamottagare (om annan)" value={value.invoiceName} onChange={text => onChange('invoiceName', text)} placeholder={same ? 'Samma som best\u00e4llaren' : undefined} />
    <CustomerField label="Fakturareferens" value={value.invoiceReference} onChange={text => onChange('invoiceReference', text)} />
    <label className="min-w-0 text-sm text-slate-700 sm:col-span-2">Fakturaadress (om annan)
      <textarea rows={2} value={value.invoiceAddress} placeholder={'Samma som best\u00e4llaren'} onChange={event => onChange('invoiceAddress', event.target.value)}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-3 text-base" />
    </label>
  </fieldset>
}

function CustomerField({ label, value, onChange, placeholder, disabled }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean }) {
  return <label className="min-w-0 text-sm text-slate-700">{label}
    <input disabled={disabled} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base disabled:bg-slate-50" />
  </label>
}
