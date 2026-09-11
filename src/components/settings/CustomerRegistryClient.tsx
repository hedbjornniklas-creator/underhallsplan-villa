'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type HTMLInputTypeAttribute,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import {
  Building2,
  CircleOff,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Upload,
  UserRound,
} from 'lucide-react'
import type {
  OrganizationCustomer,
  OrganizationCustomerInput,
  OrganizationCustomerType,
  OrganizationCustomerWorkspace,
} from '@/lib/customers/domain'
import ActionButton from '@/components/ui/ActionButton'
import { useToast } from '@/components/ui/AppToastProvider'

type CustomerForm = {
  customerType: OrganizationCustomerType
  name: string
  identityNumber: string
  email: string
  phone: string
  address: string
  addressLine2: string
  postalCode: string
  city: string
  countryCode: string
  invoiceSameAsCustomer: boolean
  invoiceName: string
  invoiceEmail: string
  invoiceAddress: string
  invoiceAddressLine2: string
  invoicePostalCode: string
  invoiceCity: string
  invoiceCountryCode: string
  invoiceReference: string
}

type ApiBody = {
  error?: string
  code?: string
  workspace?: OrganizationCustomerWorkspace
  customer?: OrganizationCustomer
}

const EMPTY_FORM: CustomerForm = {
  customerType: 'business',
  name: '',
  identityNumber: '',
  email: '',
  phone: '',
  address: '',
  addressLine2: '',
  postalCode: '',
  city: '',
  countryCode: 'SE',
  invoiceSameAsCustomer: true,
  invoiceName: '',
  invoiceEmail: '',
  invoiceAddress: '',
  invoiceAddressLine2: '',
  invoicePostalCode: '',
  invoiceCity: '',
  invoiceCountryCode: 'SE',
  invoiceReference: '',
}

function text(value: string | null) {
  return value ?? ''
}

function formFromCustomer(customer: OrganizationCustomer): CustomerForm {
  return {
    customerType: customer.customerType,
    name: customer.name,
    identityNumber: text(customer.identityNumber),
    email: text(customer.email),
    phone: text(customer.phone),
    address: text(customer.address),
    addressLine2: text(customer.addressLine2),
    postalCode: text(customer.postalCode),
    city: text(customer.city),
    countryCode: customer.countryCode || 'SE',
    invoiceSameAsCustomer: customer.invoiceSameAsCustomer,
    invoiceName: text(customer.invoiceName),
    invoiceEmail: text(customer.invoiceEmail),
    invoiceAddress: text(customer.invoiceAddress),
    invoiceAddressLine2: text(customer.invoiceAddressLine2),
    invoicePostalCode: text(customer.invoicePostalCode),
    invoiceCity: text(customer.invoiceCity),
    invoiceCountryCode: customer.invoiceCountryCode || 'SE',
    invoiceReference: text(customer.invoiceReference),
  }
}

function inputFromForm(form: CustomerForm): OrganizationCustomerInput {
  return {
    ...form,
    identityNumber: form.identityNumber,
    email: form.email,
    phone: form.phone,
    address: form.address,
    addressLine2: form.addressLine2,
    postalCode: form.postalCode,
    city: form.city,
    invoiceName: form.invoiceName,
    invoiceEmail: form.invoiceEmail,
    invoiceAddress: form.invoiceAddress,
    invoiceAddressLine2: form.invoiceAddressLine2,
    invoicePostalCode: form.invoicePostalCode,
    invoiceCity: form.invoiceCity,
    invoiceCountryCode: form.invoiceCountryCode,
    invoiceReference: form.invoiceReference,
  }
}

async function responseBody(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ApiBody
  if (!response.ok) throw new Error(body.error || 'Kundregistret kunde inte hanteras.')
  return body
}

function privateIdentityLabel(value: string | null) {
  if (!value) return null
  const ending = value.replace(/\D/gu, '').slice(-4)
  return ending ? `******-${ending}` : null
}

function customerSearchText(customer: OrganizationCustomer) {
  return [
    customer.customerNumber,
    customer.name,
    customer.identityNumber,
    customer.email,
    customer.phone,
    customer.city,
    customer.invoiceReference,
    customer.fortnoxCustomerNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('sv-SE')
}

export default function CustomerRegistryClient() {
  const toast = useToast()
  const [workspace, setWorkspace] = useState<OrganizationCustomerWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [editing, setEditing] = useState<OrganizationCustomer | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusCustomerId, setStatusCustomerId] = useState<string | null>(null)
  const [fortnoxCustomerId, setFortnoxCustomerId] = useState<string | null>(null)
  const fortnoxExportInFlightRef = useRef<string | null>(null)

  const load = useCallback(async (orgId?: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const body = await responseBody(
        await fetch(
          orgId
            ? `/api/settings/customers?orgId=${encodeURIComponent(orgId)}`
            : '/api/settings/customers',
          {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          }
        )
      )
      if (!body.workspace) throw new Error('Kundregistret gav inget svar.')
      setWorkspace(body.workspace)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Kundregistret kunde inte hämtas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visibleCustomers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('sv-SE')
    return (workspace?.customers ?? []).filter((customer) => {
      if (!showInactive && !customer.isActive) return false
      return !needle || customerSearchText(customer).includes(needle)
    })
  }, [search, showInactive, workspace])

  const replaceCustomer = (customer: OrganizationCustomer, orgId: string) => {
    setWorkspace((current) =>
      current?.organization.id === orgId
        ? {
            ...current,
            customers: current.customers.some((item) => item.id === customer.id)
              ? current.customers.map((item) => (item.id === customer.id ? customer : item))
              : [...current.customers, customer].sort(
                  (left, right) => Number(left.customerNumber) - Number(right.customerNumber)
                ),
          }
        : current
    )
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }

  const openEdit = (customer: OrganizationCustomer) => {
    setEditing(customer)
    setForm(formFromCustomer(customer))
    setFormOpen(true)
  }

  const closeForm = () => {
    setEditing(null)
    setFormOpen(false)
    setForm({ ...EMPTY_FORM })
  }

  const setField = <Key extends keyof CustomerForm>(key: Key, value: CustomerForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const switchOrganization = (orgId: string) => {
    if (
      saving ||
      statusCustomerId !== null ||
      fortnoxCustomerId !== null ||
      orgId === workspace?.organization.id
    ) {
      return
    }
    setEditing(null)
    setFormOpen(false)
    setForm({ ...EMPTY_FORM })
    setSearch('')
    setShowInactive(false)
    void load(orgId)
  }

  const saveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const targetOrgId = workspace?.organization.id
    if (!targetOrgId) {
      toast.error('Välj en organisation innan kunden sparas.')
      return
    }
    setSaving(true)
    try {
      const response = editing
        ? await fetch(`/api/settings/customers/${encodeURIComponent(editing.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              orgId: targetOrgId,
              version: editing.version,
              customer: inputFromForm(form),
            }),
          })
        : await fetch('/api/settings/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId: targetOrgId,
              customer: inputFromForm(form),
            }),
          })
      const body = await responseBody(response)
      if (!body.customer) throw new Error('Kunden kunde inte läsas efter sparandet.')
      replaceCustomer(body.customer, targetOrgId)
      toast.success(
        editing
          ? `Kund ${body.customer.customerNumber} har sparats.`
          : `Kund ${body.customer.customerNumber} har skapats.`
      )
      closeForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kunden kunde inte sparas.')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (customer: OrganizationCustomer) => {
    if (
      customer.isActive &&
      !window.confirm(
        `Vill du inaktivera kund ${customer.customerNumber} – ${customer.name}? Kunden raderas inte.`
      )
    ) {
      return
    }
    const targetOrgId = workspace?.organization.id
    if (!targetOrgId) {
      toast.error('Välj en organisation innan kundstatusen ändras.')
      return
    }
    setStatusCustomerId(customer.id)
    try {
      const body = await responseBody(
        await fetch(`/api/settings/customers/${encodeURIComponent(customer.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_active',
            orgId: targetOrgId,
            version: customer.version,
            isActive: !customer.isActive,
          }),
        })
      )
      if (!body.customer) throw new Error('Kundstatusen kunde inte läsas efter sparandet.')
      replaceCustomer(body.customer, targetOrgId)
      if (!body.customer.isActive) setShowInactive(true)
      toast.success(
        body.customer.isActive
          ? `Kund ${body.customer.customerNumber} är aktiv igen.`
          : `Kund ${body.customer.customerNumber} har inaktiverats.`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kundstatusen kunde inte ändras.')
    } finally {
      setStatusCustomerId(null)
    }
  }

  const exportToFortnox = async (customer: OrganizationCustomer) => {
    if (
      saving ||
      statusCustomerId !== null ||
      fortnoxExportInFlightRef.current !== null
    ) {
      return
    }
    const targetOrgId = workspace?.organization.id
    if (!targetOrgId) {
      toast.error('Välj en organisation innan kunden överförs.')
      return
    }
    if (
      !window.confirm(
        `Vill du koppla kund ${customer.customerNumber} – ${customer.name} till organisationens anslutna Fortnox-företag?\n\nHusHub skickar namn, postadress, e-post och telefon. För företagskunder skickas även organisationsnumret.`
      )
    ) {
      return
    }

    fortnoxExportInFlightRef.current = customer.id
    setFortnoxCustomerId(customer.id)
    try {
      const body = await responseBody(
        await fetch(
          `/api/integrations/fortnox/customers/${encodeURIComponent(customer.id)}/export`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              orgId: targetOrgId,
              version: customer.version,
            }),
          }
        )
      )
      if (
        !body.customer ||
        body.customer.id !== customer.id ||
        !body.customer.fortnoxCustomerNumber
      ) {
        throw new Error('Kopplingen till Fortnox kunde inte bekräftas. Ladda om sidan innan du försöker igen.')
      }
      replaceCustomer(body.customer, targetOrgId)
      toast.success(
        `Kund ${body.customer.customerNumber} är kopplad till Fortnox-kund ${body.customer.fortnoxCustomerNumber}.`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kunden kunde inte överföras till Fortnox.')
    } finally {
      if (fortnoxExportInFlightRef.current === customer.id) {
        fortnoxExportInFlightRef.current = null
      }
      setFortnoxCustomerId((current) => (current === customer.id ? null : current))
    }
  }

  const customerActionPending =
    saving || statusCustomerId !== null || fortnoxCustomerId !== null

  if (loading) {
    return (
      <section className="rounded-2xl border border-white/30 bg-white/90 p-6 text-sm text-gray-600 shadow-sm backdrop-blur-sm">
        Laddar kundregistret…
      </section>
    )
  }

  if (loadError || !workspace) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
        <h2 className="font-semibold text-rose-950">Kundregistret kunde inte öppnas</h2>
        <p className="mt-2 text-sm text-rose-800">{loadError}</p>
        <ActionButton
          tone="secondary"
          className="mt-4 rounded-lg px-4 py-2 text-sm"
          onClick={() => void load()}
        >
          Försök igen
        </ActionButton>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/30 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              {workspace.organization.name || 'Din organisation'}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-950">Kundregister</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
              Varje kund får ett eget HusHub-kundnummer i organisationen. När kunden är
              klar kan du överföra den till Fortnox; samma koppling återanvänds för framtida
              uppdrag.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-64">
            {workspace.organizations.length > 1 ? (
              <label className="space-y-1">
                <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Organisation
                </span>
                <select
                  value={workspace.organization.id}
                  disabled={
                    saving || statusCustomerId !== null || fortnoxCustomerId !== null
                  }
                  onChange={(event) => switchOrganization(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                >
                  {workspace.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name || 'Namnlös organisation'}
                      {organization.isDefault ? ' (standard)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {workspace.organization.canManage ? (
              <ActionButton
                tone="blue"
                icon={<Plus size={17} aria-hidden="true" />}
                className="rounded-lg px-4 py-2.5 text-sm"
                disabled={customerActionPending}
                onClick={openCreate}
              >
                Ny kund
              </ActionButton>
            ) : null}
          </div>
        </div>

        {!workspace.organization.canManage ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Du kan se kundregistret. En organisationsadministratör behöver göra ändringar.
          </div>
        ) : null}
      </section>

      {formOpen ? (
        <CustomerFormSection
          editing={editing}
          form={form}
          saving={saving}
          onChange={setField}
          onCancel={closeForm}
          onSubmit={saveCustomer}
        />
      ) : null}

      <section className="rounded-2xl border border-white/30 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Sök kunder</span>
            <Search
              size={17}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på kundnummer, namn, organisationsnummer eller e-post"
              className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Visa inaktiva
          </label>
        </div>

        {visibleCustomers.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center">
            <p className="font-medium text-gray-900">
              {workspace.customers.length === 0
                ? 'Inga kunder har skapats ännu.'
                : 'Inga kunder matchar sökningen.'}
            </p>
            {workspace.customers.length === 0 && workspace.organization.canManage ? (
              <button
                type="button"
                onClick={openCreate}
                className="mt-2 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
              >
                Skapa den första kunden
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mt-5 hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-3 font-semibold">Kundnr</th>
                    <th className="px-3 py-3 font-semibold">Kund</th>
                    <th className="px-3 py-3 font-semibold">Kontakt</th>
                    <th className="px-3 py-3 font-semibold">Fortnox</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    {workspace.organization.canManage ? (
                      <th className="px-3 py-3 text-right font-semibold">Åtgärder</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleCustomers.map((customer) => (
                    <CustomerTableRow
                      key={customer.id}
                      customer={customer}
                      canManage={workspace.organization.canManage}
                      statusBusy={statusCustomerId === customer.id}
                      fortnoxBusy={fortnoxCustomerId === customer.id}
                      actionsDisabled={customerActionPending}
                      onEdit={openEdit}
                      onExportToFortnox={exportToFortnox}
                      onToggleActive={toggleActive}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 space-y-3 md:hidden">
              {visibleCustomers.map((customer) => (
                <CustomerMobileCard
                  key={customer.id}
                  customer={customer}
                  canManage={workspace.organization.canManage}
                  statusBusy={statusCustomerId === customer.id}
                  fortnoxBusy={fortnoxCustomerId === customer.id}
                  actionsDisabled={customerActionPending}
                  onEdit={openEdit}
                  onExportToFortnox={exportToFortnox}
                  onToggleActive={toggleActive}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function CustomerFormSection({
  editing,
  form,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  editing: OrganizationCustomer | null
  form: CustomerForm
  saving: boolean
  onChange: <Key extends keyof CustomerForm>(key: Key, value: CustomerForm[Key]) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-lg">
      <form onSubmit={onSubmit}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-950">
              {editing ? `Redigera kund ${editing.customerNumber}` : 'Skapa kund'}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {editing
                ? 'Kundnumret och organisationstillhörigheten ändras aldrig.'
                : 'HusHub tilldelar nästa lediga kundnummer när kunden sparas.'}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Kundtyp"
            value={form.customerType}
            required
            onChange={(value) => {
              onChange('customerType', value as OrganizationCustomerType)
              onChange('identityNumber', '')
            }}
          >
            <option value="business">Företag / BRF</option>
            <option value="private">Privatperson</option>
          </SelectField>
          <TextField
            label="Namn"
            value={form.name}
            maxLength={200}
            required
            autoFocus
            autoComplete="organization"
            onChange={(value) => onChange('name', value)}
          />
          <TextField
            label={
              form.customerType === 'business'
                ? 'Organisationsnummer'
                : 'Personnummer (valfritt)'
            }
            value={form.identityNumber}
            placeholder={form.customerType === 'business' ? 'XXXXXX-XXXX' : 'ÅÅMMDD-XXXX'}
            required={form.customerType === 'business'}
            autoComplete="off"
            onChange={(value) => onChange('identityNumber', value)}
          />
          <TextField
            label="E-post"
            type="email"
            value={form.email}
            maxLength={254}
            autoComplete="email"
            onChange={(value) => onChange('email', value)}
          />
          <TextField
            label="Telefon"
            type="tel"
            value={form.phone}
            maxLength={50}
            autoComplete="tel"
            onChange={(value) => onChange('phone', value)}
          />
          <TextField
            label="Adress"
            value={form.address}
            maxLength={255}
            autoComplete="street-address"
            onChange={(value) => onChange('address', value)}
          />
          <TextField
            label="Adressrad 2"
            value={form.addressLine2}
            maxLength={255}
            onChange={(value) => onChange('addressLine2', value)}
          />
          <TextField
            label="Postnummer"
            value={form.postalCode}
            maxLength={32}
            autoComplete="postal-code"
            onChange={(value) => onChange('postalCode', value)}
          />
          <TextField
            label="Ort"
            value={form.city}
            maxLength={120}
            autoComplete="address-level2"
            onChange={(value) => onChange('city', value)}
          />
          <TextField
            label="Landskod"
            value={form.countryCode}
            maxLength={2}
            autoComplete="country"
            onChange={(value) => onChange('countryCode', value.toUpperCase())}
          />
        </div>

        <div className="mt-6 border-t border-gray-200 pt-5">
          <h3 className="font-semibold text-gray-950">Fakturauppgifter</h3>
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={form.invoiceSameAsCustomer}
              onChange={(event) => onChange('invoiceSameAsCustomer', event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Fakturamottagaren är samma som kunden
          </label>

          {!form.invoiceSameAsCustomer ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField
                label="Fakturamottagare"
                value={form.invoiceName}
                maxLength={200}
                required
                onChange={(value) => onChange('invoiceName', value)}
              />
              <TextField
                label="Faktura-e-post"
                type="email"
                value={form.invoiceEmail}
                maxLength={254}
                onChange={(value) => onChange('invoiceEmail', value)}
              />
              <TextField
                label="Fakturaadress"
                value={form.invoiceAddress}
                maxLength={255}
                onChange={(value) => onChange('invoiceAddress', value)}
              />
              <TextField
                label="Fakturaadress rad 2"
                value={form.invoiceAddressLine2}
                maxLength={255}
                onChange={(value) => onChange('invoiceAddressLine2', value)}
              />
              <TextField
                label="Fakturapostnummer"
                value={form.invoicePostalCode}
                maxLength={32}
                onChange={(value) => onChange('invoicePostalCode', value)}
              />
              <TextField
                label="Fakturaort"
                value={form.invoiceCity}
                maxLength={120}
                onChange={(value) => onChange('invoiceCity', value)}
              />
              <TextField
                label="Fakturaland"
                value={form.invoiceCountryCode}
                maxLength={2}
                onChange={(value) => onChange('invoiceCountryCode', value.toUpperCase())}
              />
            </div>
          ) : null}

          <div className="mt-4 max-w-xl">
            <TextField
              label="Standardreferens på faktura (valfritt)"
              value={form.invoiceReference}
              maxLength={120}
              onChange={(value) => onChange('invoiceReference', value)}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <ActionButton
            tone="secondary"
            className="rounded-lg px-4 py-2.5 text-sm"
            disabled={saving}
            onClick={onCancel}
          >
            Avbryt
          </ActionButton>
          <ActionButton
            type="submit"
            tone="blue"
            busy={saving}
            busyLabel="Sparar…"
            className="rounded-lg px-4 py-2.5 text-sm"
          >
            {editing ? 'Spara kund' : 'Skapa kund'}
          </ActionButton>
        </div>
      </form>
    </section>
  )
}

function CustomerTableRow({
  customer,
  canManage,
  statusBusy,
  fortnoxBusy,
  actionsDisabled,
  onEdit,
  onExportToFortnox,
  onToggleActive,
}: {
  customer: OrganizationCustomer
  canManage: boolean
  statusBusy: boolean
  fortnoxBusy: boolean
  actionsDisabled: boolean
  onEdit: (customer: OrganizationCustomer) => void
  onExportToFortnox: (customer: OrganizationCustomer) => void
  onToggleActive: (customer: OrganizationCustomer) => void
}) {
  const IdentityIcon = customer.customerType === 'business' ? Building2 : UserRound
  const identity =
    customer.customerType === 'business'
      ? customer.identityNumber
      : privateIdentityLabel(customer.identityNumber)

  return (
    <tr className={!customer.isActive ? 'bg-gray-50 text-gray-500' : 'text-gray-800'}>
      <td className="whitespace-nowrap px-3 py-4 align-top font-semibold text-gray-950">
        {customer.customerNumber}
      </td>
      <td className="px-3 py-4 align-top">
        <div className="flex items-start gap-2">
          <IdentityIcon
            size={17}
            className="mt-0.5 shrink-0 text-indigo-600"
            aria-hidden="true"
          />
          <div>
            <div className="font-medium text-gray-950">{customer.name}</div>
            <div className="mt-0.5 text-xs text-gray-500">
              {customer.customerType === 'business' ? 'Företag / BRF' : 'Privatperson'}
              {identity ? ` · ${identity}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-4 align-top">
        <div>{customer.email || 'Ingen e-post'}</div>
        <div className="mt-0.5 text-xs text-gray-500">{customer.phone || customer.city || '–'}</div>
      </td>
      <td className="px-3 py-4 align-top">
        {customer.fortnoxCustomerNumber ? (
          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            Kund {customer.fortnoxCustomerNumber}
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
            Inte kopplad
          </span>
        )}
      </td>
      <td className="px-3 py-4 align-top">
        <StatusBadge active={customer.isActive} />
      </td>
      {canManage ? (
        <td className="px-3 py-4 align-top">
          <div className="flex justify-end gap-2">
            {!customer.fortnoxCustomerNumber && customer.isActive ? (
              <ActionButton
                tone="emeraldSecondary"
                busy={fortnoxBusy}
                busyLabel="Överför…"
                disabled={actionsDisabled}
                icon={<Upload size={15} aria-hidden="true" />}
                className="rounded-lg px-3 py-2 text-xs"
                aria-label={`Överför kund ${customer.customerNumber} till Fortnox`}
                title="Överför och koppla kunden till Fortnox"
                onClick={() => void onExportToFortnox(customer)}
              >
                Till Fortnox
              </ActionButton>
            ) : null}
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => onEdit(customer)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              aria-label={`Redigera kund ${customer.customerNumber}`}
              title="Redigera"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <ActionButton
              tone="secondary"
              busy={statusBusy}
              disabled={actionsDisabled}
              icon={
                customer.isActive ? (
                  <CircleOff size={15} aria-hidden="true" />
                ) : (
                  <RotateCcw size={15} aria-hidden="true" />
                )
              }
              className="rounded-lg px-3 py-2 text-xs"
              onClick={() => void onToggleActive(customer)}
            >
              {customer.isActive ? 'Inaktivera' : 'Aktivera'}
            </ActionButton>
          </div>
        </td>
      ) : null}
    </tr>
  )
}

function CustomerMobileCard({
  customer,
  canManage,
  statusBusy,
  fortnoxBusy,
  actionsDisabled,
  onEdit,
  onExportToFortnox,
  onToggleActive,
}: {
  customer: OrganizationCustomer
  canManage: boolean
  statusBusy: boolean
  fortnoxBusy: boolean
  actionsDisabled: boolean
  onEdit: (customer: OrganizationCustomer) => void
  onExportToFortnox: (customer: OrganizationCustomer) => void
  onToggleActive: (customer: OrganizationCustomer) => void
}) {
  return (
    <article
      className={`rounded-xl border p-4 ${
        customer.isActive ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            Kund {customer.customerNumber}
          </p>
          <h3 className="mt-1 font-semibold text-gray-950">{customer.name}</h3>
          <p className="mt-1 text-xs text-gray-500">
            {customer.customerType === 'business' ? 'Företag / BRF' : 'Privatperson'}
          </p>
        </div>
        <StatusBadge active={customer.isActive} />
      </div>
      <dl className="mt-4 grid gap-2 text-sm">
        <div>
          <dt className="text-xs text-gray-500">E-post</dt>
          <dd className="break-all text-gray-800">{customer.email || '–'}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Fortnox</dt>
          <dd className="text-gray-800">
            {customer.fortnoxCustomerNumber
              ? `Kund ${customer.fortnoxCustomerNumber}`
              : 'Inte kopplad'}
          </dd>
        </div>
      </dl>
      {canManage ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {!customer.fortnoxCustomerNumber && customer.isActive ? (
            <ActionButton
              tone="emeraldSecondary"
              busy={fortnoxBusy}
              busyLabel="Överför…"
              disabled={actionsDisabled}
              icon={<Upload size={15} aria-hidden="true" />}
              className="rounded-lg px-3 py-2 text-xs"
              aria-label={`Överför kund ${customer.customerNumber} till Fortnox`}
              title="Överför och koppla kunden till Fortnox"
              onClick={() => void onExportToFortnox(customer)}
            >
              Till Fortnox
            </ActionButton>
          ) : null}
          <ActionButton
            tone="secondary"
            disabled={actionsDisabled}
            icon={<Pencil size={15} aria-hidden="true" />}
            className="rounded-lg px-3 py-2 text-xs"
            onClick={() => onEdit(customer)}
          >
            Redigera
          </ActionButton>
          <ActionButton
            tone="secondary"
            busy={statusBusy}
            disabled={actionsDisabled}
            icon={
              customer.isActive ? (
                <CircleOff size={15} aria-hidden="true" />
              ) : (
                <RotateCcw size={15} aria-hidden="true" />
              )
            }
            className="rounded-lg px-3 py-2 text-xs"
            onClick={() => void onToggleActive(customer)}
          >
            {customer.isActive ? 'Inaktivera' : 'Aktivera'}
          </ActionButton>
        </div>
      ) : null}
    </article>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'
      }`}
    >
      {active ? 'Aktiv' : 'Inaktiv'}
    </span>
  )
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  ...inputProps
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: HTMLInputTypeAttribute
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-700">{label}</span>
      <input
        {...inputProps}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-700">{label}</span>
      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      >
        {children}
      </select>
    </label>
  )
}
