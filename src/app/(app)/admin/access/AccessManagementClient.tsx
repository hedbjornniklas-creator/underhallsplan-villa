'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Protected from '@/components/Protected'

type ScopeType = 'global' | 'brf' | 'organization' | 'property' | 'case'

type ProductItem = {
  id: string
  key: 'renoapp' | 'dashboard' | 'hushub_admin'
  label: string
  description: string | null
  modules: Array<{
    id: string
    key: string
    label: string
    description: string | null
  }>
  roles: Array<{
    id: string
    key: string
    label: string
    description: string | null
  }>
}

type UserAssignment = {
  id: string
  productId: string
  productKey: string
  productLabel: string
  moduleId: string | null
  moduleKey: string | null
  moduleLabel: string | null
  roleId: string
  roleKey: string
  roleLabel: string
  scopeType: ScopeType
  scopeId: string | null
  scopeLabel: string
  grantedReason: string | null
  expiresAt: string | null
  createdAt: string
}

type UserItem = {
  id: string
  fullName: string | null
  email: string | null
  orgName: string | null
  legacyAdmin: boolean
  productKeys: string[]
  assignments: UserAssignment[]
}

type ScopeOption = {
  id: string
  label: string
  meta: string | null
}

type AccessData = {
  products: ProductItem[]
  users: UserItem[]
  scopeOptions: {
    brfs: ScopeOption[]
    organizations: ScopeOption[]
  }
}

type GrantForm = {
  productId: string
  moduleId: string
  roleId: string
  scopeType: ScopeType
  scopeId: string
  grantedReason: string
  expiresAt: string
}

const SCOPE_LABELS: Record<ScopeType, string> = {
  global: 'Global',
  brf: 'BRF',
  organization: 'Organisation',
  property: 'Fastighet',
  case: 'Ärende',
}

function buildDefaultForm(products: ProductItem[]): GrantForm {
  const product = products[0]
  return {
    productId: product?.id ?? '',
    moduleId: product?.modules[0]?.id ?? '',
    roleId: product?.roles[0]?.id ?? '',
    scopeType: product?.key === 'dashboard' ? 'organization' : product?.key === 'hushub_admin' ? 'global' : 'brf',
    scopeId: '',
    grantedReason: '',
    expiresAt: '',
  }
}

function formatDateTime(value: string | null) {
  if (!value) return 'Ingen sluttid'
  return new Date(value).toLocaleString('sv-SE')
}

export default function AccessManagementClient() {
  const [data, setData] = useState<AccessData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [form, setForm] = useState<GrantForm>(buildDefaultForm([]))

  const load = async (preferredUserId?: string) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/access-management', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as AccessData & { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte läsa accesshanteringen.')
      }

      setData(payload)
      setForm((current) => {
        const next = buildDefaultForm(payload.products)
        return {
          ...next,
          productId: current.productId || next.productId,
          moduleId: current.moduleId,
          roleId: current.roleId,
          scopeType: current.scopeType,
          scopeId: current.scopeId,
          grantedReason: current.grantedReason,
          expiresAt: current.expiresAt,
        }
      })

      if (preferredUserId) {
        setSelectedUserId(preferredUserId)
        setExpandedUserId(preferredUserId)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa accesshanteringen.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const products = data?.products ?? []
  const users = data?.users ?? []
  const selectedProduct = products.find((product) => product.id === form.productId) ?? products[0] ?? null
  const availableRoles = selectedProduct?.roles ?? []
  const availableModules = selectedProduct?.modules ?? []

  useEffect(() => {
    if (!selectedProduct) return

    setForm((current) => {
      const nextScopeType: ScopeType =
        selectedProduct.key === 'dashboard'
          ? 'organization'
          : selectedProduct.key === 'hushub_admin'
            ? 'global'
            : current.scopeType === 'global'
              ? 'brf'
              : current.scopeType

      return {
        ...current,
        moduleId: availableModules.some((module) => module.id === current.moduleId)
          ? current.moduleId
          : selectedProduct.key === 'dashboard'
            ? ''
            : availableModules[0]?.id ?? '',
        roleId: availableRoles.some((role) => role.id === current.roleId)
          ? current.roleId
          : availableRoles[0]?.id ?? '',
        scopeType: nextScopeType,
        scopeId: nextScopeType === 'global' ? '' : current.scopeId,
      }
    })
  }, [selectedProduct, availableModules, availableRoles])

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return users
    return users.filter((user) => {
      const haystack = [
        user.fullName ?? '',
        user.email ?? '',
        user.orgName ?? '',
        ...user.assignments.map((assignment) => `${assignment.productLabel} ${assignment.roleLabel} ${assignment.scopeLabel}`),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(search)
    })
  }, [users, query])

  const scopeOptions = useMemo(() => {
    if (!data) return []
    if (form.scopeType === 'brf') return data.scopeOptions.brfs
    if (form.scopeType === 'organization') return data.scopeOptions.organizations
    return []
  }, [data, form.scopeType])

  const productCounts = useMemo(
    () => ({
      renoapp: users.filter((user) => user.productKeys.includes('renoapp')).length,
      dashboard: users.filter((user) => user.productKeys.includes('dashboard')).length,
      hushub_admin: users.filter((user) => user.productKeys.includes('hushub_admin')).length,
    }),
    [users]
  )

  const updateForm = (patch: Partial<GrantForm>) => {
    setForm((current) => ({ ...current, ...patch }))
  }

  const handleAssign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedUserId || !form.productId || !form.roleId || !form.scopeType) {
      setError('Välj användare, produkt, roll och scope.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/access-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: selectedUserId,
          productId: form.productId,
          moduleId: form.moduleId || null,
          roleId: form.roleId,
          scopeType: form.scopeType,
          scopeId: form.scopeType === 'global' ? null : form.scopeId,
          grantedReason: form.grantedReason || null,
          expiresAt: form.expiresAt || null,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara assignment.')
      }

      await load(selectedUserId)
      setForm((current) => ({
        ...current,
        grantedReason: '',
        expiresAt: '',
      }))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara assignment.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (assignmentId: string) => {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/access-management/${assignmentId}`, {
        method: 'DELETE',
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte inaktivera assignment.')
      }

      await load(selectedUserId)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte inaktivera assignment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Protected>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(255,251,245,0.95),rgba(247,242,235,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">HusHub Admin</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Accesshantering</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
            Hantera användares access till RenoApp, Dashboard och HusHub Admin via den normaliserade
            accessmodellen. Samma användare kan ha en, flera eller inga produktaccesser.
          </p>
        </section>

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-[28px] border border-stone-200/80 bg-white/92 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.38)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Ny tilldelning</p>
                <h2 className="mt-3 text-2xl font-semibold text-stone-900">Ge access</h2>
              </div>
              <Link
                href="/admin"
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Till admin
              </Link>
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleAssign}>
              <label className="text-sm font-semibold text-stone-800">
                Användare
                <select
                  className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                  value={selectedUserId}
                  onChange={(event) => {
                    setSelectedUserId(event.target.value)
                    setExpandedUserId(event.target.value || null)
                  }}
                >
                  <option value="">Välj användare</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {(user.fullName ?? user.email ?? user.id) + (user.email ? ` · ${user.email}` : '')}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-stone-800">
                  Produkt
                  <select
                    className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                    value={form.productId}
                    onChange={(event) => updateForm({ productId: event.target.value })}
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-stone-800">
                  Modul
                  <select
                    className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                    value={form.moduleId}
                    onChange={(event) => updateForm({ moduleId: event.target.value })}
                  >
                    <option value="">Ingen specifik modul</option>
                    {availableModules.map((module) => (
                      <option key={module.id} value={module.id}>
                        {module.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-stone-800">
                  Roll
                  <select
                    className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                    value={form.roleId}
                    onChange={(event) => updateForm({ roleId: event.target.value })}
                  >
                    {availableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-stone-800">
                  Scope
                  <select
                    className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                    value={form.scopeType}
                    onChange={(event) =>
                      updateForm({
                        scopeType: event.target.value as ScopeType,
                        scopeId: event.target.value === 'global' ? '' : form.scopeId,
                      })
                    }
                  >
                    {(['global', 'brf', 'organization', 'property', 'case'] as ScopeType[]).map((scopeType) => (
                      <option key={scopeType} value={scopeType}>
                        {SCOPE_LABELS[scopeType]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {form.scopeType !== 'global' ? (
                scopeOptions.length > 0 ? (
                  <label className="text-sm font-semibold text-stone-800">
                    {SCOPE_LABELS[form.scopeType]}
                    <select
                      className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                      value={form.scopeId}
                      onChange={(event) => updateForm({ scopeId: event.target.value })}
                    >
                      <option value="">Välj {SCOPE_LABELS[form.scopeType].toLowerCase()}</option>
                      {scopeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                          {option.meta ? ` · ${option.meta}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="text-sm font-semibold text-stone-800">
                    Scope-id
                    <input
                      className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                      value={form.scopeId}
                      onChange={(event) => updateForm({ scopeId: event.target.value })}
                      placeholder="Ange id för vald scope"
                    />
                  </label>
                )
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-stone-800">
                  Kommentar
                  <input
                    className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                    value={form.grantedReason}
                    onChange={(event) => updateForm({ grantedReason: event.target.value })}
                    placeholder="Valfri anteckning om varför access gavs"
                  />
                </label>

                <label className="text-sm font-semibold text-stone-800">
                  Gäller till
                  <input
                    type="datetime-local"
                    className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                    value={form.expiresAt}
                    onChange={(event) => updateForm({ expiresAt: event.target.value })}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-fit rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Sparar...' : 'Spara assignment'}
              </button>
            </form>
          </article>

          <article className="rounded-[28px] border border-stone-200/80 bg-white/92 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.38)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Översikt</p>
            <h2 className="mt-3 text-2xl font-semibold text-stone-900">Produkter</h2>
            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="text-sm font-semibold text-stone-900">RenoApp</div>
                <div className="mt-1 text-sm text-stone-600">{productCounts.renoapp} användare med access</div>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="text-sm font-semibold text-stone-900">Dashboard</div>
                <div className="mt-1 text-sm text-stone-600">{productCounts.dashboard} användare med access</div>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="text-sm font-semibold text-stone-900">HusHub Admin</div>
                <div className="mt-1 text-sm text-stone-600">{productCounts.hushub_admin} användare med access</div>
              </div>
            </div>
          </article>
        </section>

        <section className="mt-6 rounded-[28px] border border-stone-200/80 bg-white/92 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.38)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Användare</p>
              <h2 className="mt-3 text-2xl font-semibold text-stone-900">Aktiva assignments</h2>
            </div>
            <label className="block text-sm font-semibold text-stone-800 md:min-w-[320px]">
              Sök
              <input
                className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Sök på namn, e-post, produkt eller scope"
              />
            </label>
          </div>

          {loading ? (
            <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
              Läser användare och assignments...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
              Inga användare matchar sökningen.
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              {filteredUsers.map((user) => {
                const displayName = user.fullName ?? user.email ?? user.id
                const isExpanded = expandedUserId === user.id
                const isSelected = selectedUserId === user.id

                return (
                  <article
                    key={user.id}
                    className={`rounded-[24px] border p-5 transition ${
                      isSelected
                        ? 'border-stone-900 bg-stone-50 shadow-[0_18px_50px_-38px_rgba(41,37,36,0.45)]'
                        : 'border-stone-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-stone-900">{displayName}</h3>
                          {user.legacyAdmin ? (
                            <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                              Legacy admin
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-col gap-1 text-sm text-stone-600">
                          {user.email ? <span>{user.email}</span> : null}
                          {user.orgName ? <span>{user.orgName}</span> : null}
                          <span>{user.assignments.length} aktiva assignments</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {user.productKeys.length > 0 ? (
                            user.productKeys.map((productKey) => (
                              <span
                                key={`${user.id}-${productKey}`}
                                className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-700"
                              >
                                {productKey}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                              Ingen access
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedUserId(user.id)
                            setExpandedUserId(user.id)
                          }}
                          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                        >
                          Välj i formuläret
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedUserId((current) => (current === user.id ? null : user.id))}
                          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                        >
                          {isExpanded ? 'Dölj assignments' : 'Visa assignments'}
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="mt-5 border-t border-stone-200 pt-5">
                        {user.assignments.length === 0 ? (
                          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
                            Användaren har inga aktiva assignments.
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            {user.assignments.map((assignment) => (
                              <div
                                key={assignment.id}
                                className="rounded-2xl border border-stone-200 bg-stone-50 p-4"
                              >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap gap-2">
                                      <span className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-700">
                                        {assignment.productLabel}
                                      </span>
                                      {assignment.moduleLabel ? (
                                        <span className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-700">
                                          {assignment.moduleLabel}
                                        </span>
                                      ) : null}
                                      <span className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-700">
                                        {assignment.roleLabel}
                                      </span>
                                      <span className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-700">
                                        {assignment.scopeLabel}
                                      </span>
                                    </div>

                                    <div className="mt-3 text-sm text-stone-700">
                                      <p>Skapad: {formatDateTime(assignment.createdAt)}</p>
                                      <p className="mt-1">Gäller till: {formatDateTime(assignment.expiresAt)}</p>
                                      {assignment.grantedReason ? (
                                        <p className="mt-1 break-words">Kommentar: {assignment.grantedReason}</p>
                                      ) : null}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => void handleDeactivate(assignment.id)}
                                    disabled={saving}
                                    className="rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Inaktivera
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </Protected>
  )
}
