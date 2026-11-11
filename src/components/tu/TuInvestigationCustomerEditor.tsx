'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Save } from 'lucide-react'
import { TuCustomerFields, TuInvoiceFields, tuCustomerFormFromAssignment, tuCustomerFromForm } from './TuCustomerFields'
import { parseTuCustomer, type TuCustomer } from '@/lib/tu/customer'
import { useToast } from '@/components/ui/AppToastProvider'

export default function TuInvestigationCustomerEditor({ customer, disabled, onSave, pendingRef }: {
  customer: TuCustomer | null | undefined; disabled: boolean
  onSave: (customer: TuCustomer) => Promise<void>
  pendingRef: RefObject<boolean>
}) {
  const [form, setForm] = useState(() => tuCustomerFormFromAssignment({ assignment_details: { tuCustomer: customer } }))
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const currentCustomer = tuCustomerFromForm(form)
  const dirty = (Object.keys(currentCustomer) as Array<keyof TuCustomer>).some(key => currentCustomer[key] !== customer?.[key])
  useEffect(() => {
    pendingRef.current = dirty || busy
    const prevent = (event: Event) => {
      if (!pendingRef.current) return
      event.preventDefault()
      if (event instanceof BeforeUnloadEvent) event.returnValue = ''
      else toast.error('Spara best\u00e4llaruppgifterna innan du byter organisation.')
    }
    window.addEventListener('beforeunload', prevent)
    window.addEventListener('hushub:before-organization-switch', prevent)
    return () => {
      pendingRef.current = false
      window.removeEventListener('beforeunload', prevent)
      window.removeEventListener('hushub:before-organization-switch', prevent)
    }
  }, [dirty, busy, pendingRef, toast])
  return <section className="space-y-3 border-t border-violet-100 pt-4">
    <h3 className="font-semibold">{'Best\u00e4llartyp och kontakt'}</h3>
    <TuCustomerFields value={form} disabled={disabled || busy} onChange={(key, value) => setForm(current => ({ ...current, [key]: value }))} />
    <TuInvoiceFields value={form} disabled={disabled || busy} onChange={(key, value) => setForm(current => ({ ...current, [key]: value }))} />
    <button type="button" disabled={disabled || busy || !dirty} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-violet-200 px-3 text-sm font-medium text-violet-700 disabled:opacity-50"
      onClick={async () => {
        try {
          const value = parseTuCustomer(tuCustomerFromForm(form))
          setBusy(true)
          await onSave(value)
          setForm(tuCustomerFormFromAssignment({ assignment_details: { tuCustomer: value } }))
          toast.success('Best\u00e4llaruppgifterna \u00e4r sparade.')
        }
        catch (error) { toast.error(error) } finally { setBusy(false) }
      }}><Save size={16} />{busy ? 'Sparar...' : 'Spara best\u00e4llaruppgifter'}</button>
  </section>
}
