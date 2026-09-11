'use client'

import { useEffect, useMemo, useState } from 'react'
import type { OrganizationCustomer, OrganizationCustomerWorkspace } from '@/lib/customers/domain'

export type AssignmentCustomerBinding =
  | {
      mode: 'existing'
      customerId: string
      customerVersion: number
    }
  | {
      mode: 'create'
      customerType: 'private' | 'business'
      identityNumber: string | null
    }

export type AssignmentCustomerDraft = {
  customerType: 'consumer' | 'business'
  identityNumber: string
  name: string
  email: string
  phone: string
  address: string
  postalCode: string
  city: string
  invoiceEmail: string
}

type CustomerWorkspaceResponse = {
  error?: string
  workspace?: OrganizationCustomerWorkspace
}

function customerLabel(customer: OrganizationCustomer) {
  return `${customer.customerNumber} – ${customer.name}${customer.email ? ` (${customer.email})` : ''}`
}

function draftSummary(draft: AssignmentCustomerDraft) {
  const address = [draft.address, [draft.postalCode, draft.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return [draft.name.trim(), draft.email.trim(), address].filter(Boolean)
}

export default function AssignmentCustomerSelector({
  organizationId,
  value,
  draft,
  disabled,
  onChange,
  onUseCustomer,
}: {
  organizationId: string
  value: AssignmentCustomerBinding | null
  draft: AssignmentCustomerDraft
  disabled: boolean
  onChange: (value: AssignmentCustomerBinding | null) => void
  onUseCustomer: (customer: OrganizationCustomer) => void
}) {
  const [workspace, setWorkspace] = useState<OrganizationCustomerWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    async function loadCustomers() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/settings/customers?orgId=${encodeURIComponent(organizationId)}`,
          {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
          }
        )
        const body = (await response.json().catch(() => ({}))) as CustomerWorkspaceResponse
        if (!response.ok || !body.workspace || !Array.isArray(body.workspace.customers)) {
          throw new Error(body.error || 'Kundregistret kunde inte hämtas.')
        }
        if (body.workspace.organization.id !== organizationId) {
          throw new Error('Kundregistret svarade för fel organisation. Ladda om sidan.')
        }
        if (current) setWorkspace(body.workspace)
      } catch (loadError) {
        if (current && !controller.signal.aborted) {
          setError(
            loadError instanceof Error ? loadError.message : 'Kundregistret kunde inte hämtas.'
          )
        }
      } finally {
        if (current) setLoading(false)
      }
    }

    void loadCustomers()
    return () => {
      current = false
      controller.abort()
    }
  }, [loadAttempt, organizationId])

  const activeCustomers = useMemo(
    () => workspace?.customers.filter((customer) => customer.isActive) ?? [],
    [workspace]
  )
  const selectedCustomerId = value?.mode === 'existing' ? value.customerId : ''
  const summary = draftSummary(draft)

  return (
    <section
      aria-labelledby="assignment-customer-heading"
      className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-3"
    >
      <div>
        <h4 id="assignment-customer-heading" className="text-sm font-semibold text-slate-950">
          Koppla till kundregistret
        </h4>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Välj en befintlig HusHub-kund eller bekräfta att en ny ska skapas av uppgifterna
          ovan. Ingen kund väljs automatiskt utifrån namn eller e-post.
        </p>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-slate-600" role="status">
          Hämtar kundregistret…
        </p>
      ) : error ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-rose-800">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 font-semibold text-rose-800 underline underline-offset-2"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            Försök igen
          </button>
        </div>
      ) : (
        <fieldset className="mt-3 space-y-3" disabled={disabled}>
          <legend className="sr-only">Välj hur uppdraget ska kopplas till en kund</legend>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={value?.mode === 'existing'}
              onClick={() => onChange(null)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                value?.mode === 'existing'
                  ? 'border-violet-500 bg-white font-semibold text-violet-900 ring-2 ring-violet-100'
                  : 'border-slate-300 bg-white text-slate-800 hover:border-violet-300'
              }`}
            >
              Välj befintlig kund
            </button>
            <button
              type="button"
              aria-pressed={value?.mode === 'create'}
              onClick={() =>
                onChange({
                  mode: 'create',
                  customerType: draft.customerType === 'business' ? 'business' : 'private',
                  identityNumber: draft.identityNumber.trim() || null,
                })
              }
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                value?.mode === 'create'
                  ? 'border-violet-500 bg-white font-semibold text-violet-900 ring-2 ring-violet-100'
                  : 'border-slate-300 bg-white text-slate-800 hover:border-violet-300'
              }`}
            >
              Skapa ny kund
            </button>
          </div>

          {value?.mode !== 'create' ? (
            <label className="block space-y-1">
              <span className="block text-xs font-medium text-slate-700">Befintlig kund</span>
              <select
                value={selectedCustomerId}
                disabled={disabled || activeCustomers.length === 0}
                onChange={(event) => {
                  const customer = activeCustomers.find((item) => item.id === event.target.value)
                  if (!customer) {
                    onChange(null)
                    return
                  }
                  onUseCustomer(customer)
                  onChange({
                    mode: 'existing',
                    customerId: customer.id,
                    customerVersion: customer.version,
                  })
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-100"
              >
                <option value="">
                  {activeCustomers.length === 0
                    ? 'Inga aktiva kunder finns'
                    : 'Välj kund…'}
                </option>
                {activeCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customerLabel(customer)}
                  </option>
                ))}
              </select>
              {value?.mode === 'existing' ? (
                <span className="block text-xs text-emerald-700">
                  Kundens sparade kontakt- och fakturauppgifter har hämtats till uppdraget.
                </span>
              ) : null}
            </label>
          ) : (
            <div className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                En ny kund skapas först när uppdraget sparas.
              </p>
              {summary.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-amber-800">Fyll i kunduppgifterna ovan.</p>
              )}
            </div>
          )}

          {!value ? (
            <p className="text-xs font-medium text-amber-800" role="status">
              Bekräfta ett kundval innan du sparar eller skickar uppdraget.
            </p>
          ) : null}
        </fieldset>
      )}
    </section>
  )
}
