'use client'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import Protected from '@/components/Protected'

type ScopeType = 'global' | 'brf' | 'organization' | 'property' | 'case'
type ProductKey = 'renoapp' | 'dashboard' | 'hushub_admin'
type StatusFilter = 'all' | 'active' | 'inactive'
type ProductFilter = 'all' | ProductKey
type UserTab = 'details' | 'history'

type ProductItem = {
  id: string
  key: ProductKey
  label: string
  description: string | null
  modules: Array<{ id: string; key: string; label: string; description: string | null }>
  roles: Array<{ id: string; key: string; label: string; description: string | null }>
}

type UserAssignment = {
  id: string
  productId: string
  productKey: ProductKey
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
  productKeys: ProductKey[]
  assignments: UserAssignment[]
}

type ScopeOption = { id: string; label: string; meta: string | null }
type AccessData = {
  products: ProductItem[]
  users: UserItem[]
  scopeOptions: { brfs: ScopeOption[]; organizations: ScopeOption[] }
}

type DialogState = { kind: 'user' | 'renoapp' | 'dashboard' | 'hushub_admin'; userId: string } | null
type RenoRow = { key: string; assignmentId: string | null; roleId: string; scopeId: string; note: string; expiresAt: string }
type DashboardRow = {
  moduleId: string
  label: string
  assignmentId: string | null
  enabled: boolean
  scopeId: string
  note: string
  expiresAt: string
}

const UI_RULES: Record<ProductKey, { modules: string[]; roles: string[] }> = {
  renoapp: { modules: ['board_portal'], roles: ['board_member', 'renoapp_admin'] },
  dashboard: { modules: ['inspections'], roles: ['inspector'] },
  hushub_admin: { modules: [], roles: ['hushub_superadmin'] },
}

function isDashboardAssignmentForCurrentUi(assignment: UserAssignment) {
  if (assignment.productKey !== 'dashboard') return false
  if (assignment.moduleKey === 'inspections' && assignment.roleKey === 'inspector') return true
  if (!assignment.moduleKey && (assignment.roleKey === 'inspector' || assignment.roleKey === 'dashboard_admin')) {
    return true
  }
  return false
}

function draftId() {
  return `draft-${Math.random().toString(36).slice(2, 9)}`
}

function trim(value: string | null | undefined) {
  return (value ?? '').trim()
}

function userName(user: UserItem) {
  return trim(user.fullName) || trim(user.email) || user.id
}

function formatDateTime(value: string | null) {
  if (!value) return 'Ingen sluttid'
  return new Date(value).toLocaleString('sv-SE')
}

function toInputDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

function toIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function Saucer({
  active,
  label,
  className = '',
}: {
  active: boolean
  label?: string
  className?: string
}) {
  return (
    <span
      className={[
        'inline-flex items-center justify-center rounded-full border text-[11px] font-semibold uppercase tracking-[0.16em] transition',
        label ? 'min-w-[42px] px-2.5 py-1' : 'h-7 w-7',
        active
          ? 'border-emerald-400 bg-emerald-500 text-white shadow-[0_10px_24px_-14px_rgba(16,185,129,0.95)]'
          : 'border-stone-300 bg-white text-stone-400',
        className,
      ].join(' ')}
    >
      {label ? (
        label
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
          <path d="M12 4c-4.8 0-8.7 2.1-8.7 4.7S7.2 13.4 12 13.4s8.7-2.1 8.7-4.7S16.8 4 12 4Zm-4.3 10.4a2 2 0 0 0-1.7.9l-.7 1.1c-.4.6 0 1.4.8 1.4h11.8c.7 0 1.2-.8.8-1.4l-.7-1.1a2 2 0 0 0-1.7-.9H7.7Z" />
        </svg>
      )}
    </span>
  )
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/45 p-4 sm:p-6">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-[0_40px_120px_-46px_rgba(28,25,23,0.6)]">
        <div className="flex items-start justify-between gap-6 border-b border-stone-200 px-6 py-5 sm:px-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
          >
            Stäng
          </button>
        </div>
        <div className="max-h-[calc(92vh-88px)] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export default function AccessManagementClient() {
  const [data, setData] = useState<AccessData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [productFilter, setProductFilter] = useState<ProductFilter>('all')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [userTab, setUserTab] = useState<UserTab>('details')
  const [fullName, setFullName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [renoRows, setRenoRows] = useState<RenoRow[]>([])
  const [dashboardRows, setDashboardRows] = useState<DashboardRow[]>([])
  const [hushubEnabled, setHushubEnabled] = useState(false)
  const [hushubNote, setHushubNote] = useState('')
  const [hushubExpiresAt, setHushubExpiresAt] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/access-management', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as AccessData & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte läsa accesshanteringen.')
      setData(payload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa accesshanteringen.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const rawProducts = data?.products ?? []
  const products = useMemo(
    () =>
      rawProducts.map((product) => ({
        ...product,
        modules:
          UI_RULES[product.key].modules.length > 0
            ? product.modules.filter((module) => UI_RULES[product.key].modules.includes(module.key))
            : [],
        roles: product.roles.filter((role) => UI_RULES[product.key].roles.includes(role.key)),
      })),
    [rawProducts]
  )

  const rawByKey = useMemo(() => new Map(rawProducts.map((product) => [product.key, product])), [rawProducts])
  const byKey = useMemo(() => new Map(products.map((product) => [product.key, product])), [products])

  const users = useMemo(
    () =>
      (data?.users ?? []).map((user) => {
        const assignments = {
          renoapp: user.assignments.filter(
            (assignment) =>
              assignment.productKey === 'renoapp' &&
              UI_RULES.renoapp.modules.includes(assignment.moduleKey ?? '') &&
              UI_RULES.renoapp.roles.includes(assignment.roleKey)
          ),
          dashboard: user.assignments.filter(
            (assignment) => isDashboardAssignmentForCurrentUi(assignment)
          ),
          hushub_admin: user.assignments.filter(
            (assignment) =>
              assignment.productKey === 'hushub_admin' && UI_RULES.hushub_admin.roles.includes(assignment.roleKey)
          ),
        }
        return {
          ...user,
          accessStatus: user.productKeys.length > 0 ? 'active' : 'inactive',
          summary: {
            renoapp: { active: assignments.renoapp.length > 0, count: assignments.renoapp.length },
            dashboard: {
              active: assignments.dashboard.length > 0,
              count: assignments.dashboard.length,
              labels: Array.from(new Set(assignments.dashboard.map((assignment) => assignment.moduleLabel || 'BesiktApp'))),
            },
            hushub_admin: { active: assignments.hushub_admin.length > 0, count: assignments.hushub_admin.length },
          },
          uiAssignments: assignments,
        }
      }),
    [data?.users]
  )

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLowerCase()
    return users.filter((user) => {
      if (statusFilter !== 'all' && user.accessStatus !== statusFilter) return false
      if (productFilter !== 'all' && !user.summary[productFilter].active) return false
      if (!search) return true
      return [userName(user), user.email ?? '', user.orgName ?? ''].join(' ').toLowerCase().includes(search)
    })
  }, [users, query, statusFilter, productFilter])

  const activeUser = useMemo(() => users.find((user) => user.id === dialog?.userId) ?? null, [users, dialog])

  useEffect(() => {
    if (!dialog || !activeUser) return
    setDialogError(null)
    if (dialog.kind === 'user') {
      setUserTab('details')
      setFullName(activeUser.fullName ?? '')
      setOrgName(activeUser.orgName ?? '')
      return
    }
    if (dialog.kind === 'renoapp') {
      const roleId = byKey.get('renoapp')?.roles[0]?.id ?? ''
      setRenoRows(
        activeUser.uiAssignments.renoapp.length > 0
          ? activeUser.uiAssignments.renoapp.map((assignment) => ({
              key: draftId(),
              assignmentId: assignment.id,
              roleId: assignment.roleId,
              scopeId: assignment.scopeId ?? '',
              note: assignment.grantedReason ?? '',
              expiresAt: toInputDateTime(assignment.expiresAt),
            }))
          : [{ key: draftId(), assignmentId: null, roleId, scopeId: '', note: '', expiresAt: '' }]
      )
      return
    }
    if (dialog.kind === 'dashboard') {
      const legacyDashboardAssignment =
        activeUser.uiAssignments.dashboard.find((item) => !item.moduleId) ?? null
      setDashboardRows(
        (byKey.get('dashboard')?.modules ?? []).map((module) => {
          const assignment =
            activeUser.uiAssignments.dashboard.find((item) => item.moduleId === module.id) ??
            (module.key === 'inspections' ? legacyDashboardAssignment : null)
          return {
            moduleId: module.id,
            label: module.label,
            assignmentId: assignment?.id ?? null,
            enabled: Boolean(assignment),
            scopeId: assignment?.scopeId ?? '',
            note: assignment?.grantedReason ?? '',
            expiresAt: toInputDateTime(assignment?.expiresAt ?? null),
          }
        })
      )
      return
    }
    const hushub = activeUser.uiAssignments.hushub_admin
    setHushubEnabled(hushub.length > 0)
    setHushubNote(hushub[0]?.grantedReason ?? '')
    setHushubExpiresAt(toInputDateTime(hushub[0]?.expiresAt ?? null))
  }, [dialog, activeUser, byKey])

  const postAssignment = async (payload: {
    profileId: string
    productId: string
    moduleId: string | null
    roleId: string
    scopeType: ScopeType
    scopeId: string | null
    grantedReason: string | null
    expiresAt: string | null
  }) => {
    const response = await fetch('/api/admin/access-management', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Kunde inte spara tilldelningen.')
  }

  const deleteAssignment = async (assignmentId: string) => {
    const response = await fetch(`/api/admin/access-management/${assignmentId}`, { method: 'DELETE' })
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Kunde inte inaktivera tilldelningen.')
  }

  const patchUser = async (payload: { profileId: string; fullName: string | null; orgName: string | null }) => {
    const response = await fetch('/api/admin/access-management', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Kunde inte uppdatera användaren.')
  }

  const closeDialog = () => {
    setDialogError(null)
    setDialog(null)
  }

  const saveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeUser) return
    setSaving(true)
    setDialogError(null)
    try {
      await patchUser({ profileId: activeUser.id, fullName: trim(fullName) || null, orgName: trim(orgName) || null })
      await load()
      closeDialog()
    } catch (saveError) {
      setDialogError(saveError instanceof Error ? saveError.message : 'Kunde inte uppdatera användaren.')
    } finally {
      setSaving(false)
    }
  }

  const saveReno = async () => {
    if (!activeUser) return
    const product = byKey.get('renoapp')
    const moduleId = product?.modules[0]?.id ?? null
    if (!product || !moduleId) {
      setDialogError('RenoApp-konfiguration saknas.')
      return
    }

    const rows = renoRows.filter((row) => row.assignmentId || row.roleId || row.scopeId || row.note || row.expiresAt)
    const seen = new Set<string>()
    for (const row of rows) {
      if (!row.roleId || !row.scopeId) {
        setDialogError('Varje RenoApp-rad måste ha roll och BRF.')
        return
      }
      const key = `${row.roleId}:${row.scopeId}`
      if (seen.has(key)) {
        setDialogError('Dubbla RenoApp-tilldelningar för samma roll och BRF är inte tillåtna.')
        return
      }
      seen.add(key)
    }

    setSaving(true)
    setDialogError(null)
    try {
      const originals = activeUser.uiAssignments.renoapp
      const handled = new Set<string>()
      for (const row of rows) {
        const original = row.assignmentId ? originals.find((item) => item.id === row.assignmentId) ?? null : null
        if (original?.id) handled.add(original.id)
        const keyChanged =
          Boolean(original) && (original?.roleId !== row.roleId || trim(original?.scopeId) !== trim(row.scopeId))
        if (original?.id && keyChanged) await deleteAssignment(original.id)
        await postAssignment({
          profileId: activeUser.id,
          productId: product.id,
          moduleId,
          roleId: row.roleId,
          scopeType: 'brf',
          scopeId: trim(row.scopeId) || null,
          grantedReason: trim(row.note) || null,
          expiresAt: toIso(row.expiresAt),
        })
      }
      for (const original of originals) {
        if (!handled.has(original.id)) await deleteAssignment(original.id)
      }
      await load()
      closeDialog()
    } catch (saveError) {
      setDialogError(saveError instanceof Error ? saveError.message : 'Kunde inte spara RenoApp-access.')
    } finally {
      setSaving(false)
    }
  }

  const saveDashboard = async () => {
    if (!activeUser) return
    const product = byKey.get('dashboard')
    const roleId = product?.roles[0]?.id ?? ''
    if (!product || !roleId) {
      setDialogError('Dashboard-konfiguration saknas.')
      return
    }
    for (const row of dashboardRows) {
      if (row.enabled && !row.scopeId) {
        setDialogError(`Välj organisation för ${row.label}.`)
        return
      }
    }

    setSaving(true)
    setDialogError(null)
    try {
      const originals = activeUser.uiAssignments.dashboard
      const handled = new Set<string>()
      for (const row of dashboardRows) {
        const original = row.assignmentId ? originals.find((item) => item.id === row.assignmentId) ?? null : null
        if (original?.id) handled.add(original.id)
        if (!row.enabled) {
          if (original?.id) await deleteAssignment(original.id)
          continue
        }
        const assignmentNeedsMigration =
          Boolean(original) &&
          (original?.moduleId !== row.moduleId ||
            original?.roleKey !== 'inspector' ||
            original?.scopeType !== 'organization' ||
            trim(original?.scopeId) !== trim(row.scopeId))

        if (original?.id && assignmentNeedsMigration) await deleteAssignment(original.id)
        await postAssignment({
          profileId: activeUser.id,
          productId: product.id,
          moduleId: row.moduleId,
          roleId,
          scopeType: 'organization',
          scopeId: trim(row.scopeId) || null,
          grantedReason: trim(row.note) || null,
          expiresAt: toIso(row.expiresAt),
        })
      }
      for (const original of originals) {
        if (!handled.has(original.id)) await deleteAssignment(original.id)
      }
      await load()
      closeDialog()
    } catch (saveError) {
      setDialogError(saveError instanceof Error ? saveError.message : 'Kunde inte spara Dashboard-access.')
    } finally {
      setSaving(false)
    }
  }

  const saveHushub = async () => {
    if (!activeUser) return
    const product = rawByKey.get('hushub_admin')
    const roleId = product?.roles.find((role) => role.key === 'hushub_superadmin')?.id ?? ''
    if (!product || !roleId) {
      setDialogError('HusHub Admin-konfiguration saknas.')
      return
    }

    setSaving(true)
    setDialogError(null)
    try {
      if (!hushubEnabled) {
        for (const assignment of activeUser.uiAssignments.hushub_admin) {
          await deleteAssignment(assignment.id)
        }
      } else {
        for (const module of product.modules) {
          await postAssignment({
            profileId: activeUser.id,
            productId: product.id,
            moduleId: module.id,
            roleId,
            scopeType: 'global',
            scopeId: null,
            grantedReason: trim(hushubNote) || null,
            expiresAt: toIso(hushubExpiresAt),
          })
        }
      }
      await load()
      closeDialog()
    } catch (saveError) {
      setDialogError(saveError instanceof Error ? saveError.message : 'Kunde inte spara HusHub Admin-access.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Protected>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Användare och access</h1>
        </header>

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="mt-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <h2 className="mr-auto text-xl font-semibold text-stone-900">Användare</h2>

            <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <span>Sök</span>
              <input
                className="w-[220px] rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-stone-900"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Namn eller e-post"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <span>Status</span>
              <select
                className="w-[150px] rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-stone-900"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">Alla</option>
                <option value="active">Med access</option>
                <option value="inactive">Utan access</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <span>Produkt</span>
              <select
                className="w-[170px] rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-stone-900"
                value={productFilter}
                onChange={(event) => setProductFilter(event.target.value as ProductFilter)}
              >
                <option value="all">Alla produkter</option>
                <option value="renoapp">RenoApp</option>
                <option value="dashboard">Dashboard</option>
                <option value="hushub_admin">HusHub Admin</option>
              </select>
            </label>
          </div>

          {loading ? (
            <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
              Läser användare och tilldelningar...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
              Inga användare matchar filtren.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Namn</th>
                    <th className="px-3 py-3">RenoApp</th>
                    <th className="px-3 py-3">Dashboard</th>
                    <th className="px-3 py-3">HusHub Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="border-b border-stone-200/80 text-sm text-stone-800">
                      <td className="w-16 px-3 py-3 align-middle">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'user', userId: user.id })}
                          className="inline-flex cursor-pointer transition hover:scale-105"
                          aria-label={user.accessStatus === 'active' ? 'Med access' : 'Ingen access'}
                          title={user.accessStatus === 'active' ? 'Med access' : 'Ingen access'}
                        >
                          <Saucer active={user.accessStatus === 'active'} />
                        </button>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'user', userId: user.id })}
                          className="truncate cursor-pointer text-left font-semibold text-stone-900 transition hover:text-stone-600"
                        >
                          {userName(user)}
                        </button>
                      </td>
                      <td className="w-20 px-3 py-3 align-middle">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'renoapp', userId: user.id })}
                          className="inline-flex cursor-pointer transition hover:scale-105"
                          aria-label={user.summary.renoapp.active ? 'RenoApp aktiv' : 'RenoApp inaktiv'}
                          title={user.summary.renoapp.active ? 'RenoApp aktiv' : 'RenoApp inaktiv'}
                        >
                          <Saucer active={user.summary.renoapp.active} label="RA" />
                        </button>
                      </td>
                      <td className="w-20 px-3 py-3 align-middle">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'dashboard', userId: user.id })}
                          className="inline-flex cursor-pointer transition hover:scale-105"
                          aria-label={user.summary.dashboard.active ? 'Dashboard aktiv' : 'Dashboard inaktiv'}
                          title={user.summary.dashboard.active ? 'Dashboard aktiv' : 'Dashboard inaktiv'}
                        >
                          <Saucer active={user.summary.dashboard.active} label="DB" />
                        </button>
                      </td>
                      <td className="w-20 px-3 py-3 align-middle">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'hushub_admin', userId: user.id })}
                          className="inline-flex cursor-pointer transition hover:scale-105"
                          aria-label={user.summary.hushub_admin.active ? 'HusHub Admin aktiv' : 'HusHub Admin inaktiv'}
                          title={user.summary.hushub_admin.active ? 'HusHub Admin aktiv' : 'HusHub Admin inaktiv'}
                        >
                          <Saucer active={user.summary.hushub_admin.active} label="HHA" className="min-w-[52px]" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {dialog?.kind === 'user' && activeUser ? (
          <Modal
            title={userName(activeUser)}
            subtitle="Grundläggande användaruppgifter och en enkel översikt över nuvarande accesshistorik."
            onClose={closeDialog}
          >
            <div className="grid gap-0 lg:grid-cols-[240px_1fr]">
              <aside className="border-b border-stone-200 bg-stone-50 p-6 lg:border-b-0 lg:border-r">
                <div className="text-xl font-semibold text-stone-900">{userName(activeUser)}</div>
                <div className="mt-2 text-sm text-stone-600">{activeUser.email ?? 'Ingen e-post'}</div>
                <nav className="mt-6 grid gap-2">
                  <button
                    type="button"
                    onClick={() => setUserTab('details')}
                    className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                      userTab === 'details'
                        ? 'bg-stone-900 text-white'
                        : 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100'
                    }`}
                  >
                    Användaruppgifter
                  </button>
                  <button
                    type="button"
                    onClick={() => setUserTab('history')}
                    className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                      userTab === 'history'
                        ? 'bg-stone-900 text-white'
                        : 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100'
                    }`}
                  >
                    Användarhistorik
                  </button>
                </nav>
              </aside>
              <div className="p-6 sm:p-8">
                {dialogError ? (
                  <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {dialogError}
                  </div>
                ) : null}

                {userTab === 'details' ? (
                  <form className="grid gap-5" onSubmit={(event) => void saveUser(event)}>
                    <label className="text-sm font-semibold text-stone-800">
                      Namn
                      <input
                        className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                      />
                    </label>
                    <label className="text-sm font-semibold text-stone-800">
                      E-post
                      <input
                        className="mt-2 w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-normal text-stone-500"
                        value={activeUser.email ?? ''}
                        readOnly
                      />
                      <span className="mt-2 block text-xs font-normal leading-5 text-stone-500">
                        E-post visas här men ändras inte från den här vyn ännu.
                      </span>
                    </label>
                    <label className="text-sm font-semibold text-stone-800">
                      Organisation
                      <input
                        className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                        value={orgName}
                        onChange={(event) => setOrgName(event.target.value)}
                      />
                    </label>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
                      <p className="font-semibold text-stone-800">Produktstatus</p>
                      <p className="mt-2">
                        RenoApp: {activeUser.summary.renoapp.count} · Dashboard: {activeUser.summary.dashboard.count} ·
                        HusHub Admin: {activeUser.summary.hushub_admin.active ? 'på' : 'av'}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-3">
                      <button
                        type="button"
                        onClick={closeDialog}
                        className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                      >
                        Stäng
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? 'Sparar...' : 'Spara'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid gap-3">
                    {activeUser.assignments.length === 0 ? (
                      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
                        Ingen historik eller aktiva tilldelningar ännu för den här användaren.
                      </div>
                    ) : (
                      activeUser.assignments
                        .slice()
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .slice(0, 8)
                        .map((assignment) => (
                          <div key={assignment.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                              <span>{assignment.productLabel}</span>
                              {assignment.moduleLabel ? <span>{assignment.moduleLabel}</span> : null}
                              <span>{assignment.roleLabel}</span>
                            </div>
                            <p className="mt-3 text-sm text-stone-700">{assignment.scopeLabel}</p>
                            <p className="mt-1 text-xs text-stone-500">Skapad {formatDateTime(assignment.createdAt)}</p>
                            {assignment.grantedReason ? (
                              <p className="mt-2 text-sm text-stone-600">Kommentar: {assignment.grantedReason}</p>
                            ) : null}
                          </div>
                        ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </Modal>
        ) : null}

        {dialog?.kind === 'renoapp' && activeUser ? (
          <Modal
            title={`RenoApp för ${userName(activeUser)}`}
            subtitle="Hantera BRF-bundna RenoApp-tilldelningar och roller."
            onClose={closeDialog}
          >
            <div className="p-6 sm:p-8">
              {dialogError ? (
                <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {dialogError}
                </div>
              ) : null}
              <div className="grid gap-4">
                {renoRows.map((row) => (
                  <div key={row.key} className="rounded-[24px] border border-stone-200 bg-stone-50 p-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="text-sm font-semibold text-stone-800">
                        BRF
                        <select
                          className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                          value={row.scopeId}
                          onChange={(event) =>
                            setRenoRows((current) =>
                              current.map((item) => (item.key === row.key ? { ...item, scopeId: event.target.value } : item))
                            )
                          }
                        >
                          <option value="">Välj BRF</option>
                          {(data?.scopeOptions.brfs ?? []).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-stone-800">
                        Roll
                        <select
                          className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                          value={row.roleId}
                          onChange={(event) =>
                            setRenoRows((current) =>
                              current.map((item) => (item.key === row.key ? { ...item, roleId: event.target.value } : item))
                            )
                          }
                        >
                          {(byKey.get('renoapp')?.roles ?? []).map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-stone-800">
                        Kommentar
                        <input
                          className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                          value={row.note}
                          onChange={(event) =>
                            setRenoRows((current) =>
                              current.map((item) => (item.key === row.key ? { ...item, note: event.target.value } : item))
                            )
                          }
                        />
                      </label>
                      <label className="text-sm font-semibold text-stone-800">
                        Gäller till
                        <input
                          type="datetime-local"
                          className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900"
                          value={row.expiresAt}
                          onChange={(event) =>
                            setRenoRows((current) =>
                              current.map((item) => (item.key === row.key ? { ...item, expiresAt: event.target.value } : item))
                            )
                          }
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setRenoRows((current) => current.filter((item) => item.key !== row.key))}
                        className="rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        Ta bort rad
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setRenoRows((current) => [
                      ...current,
                      { key: draftId(), assignmentId: null, roleId: byKey.get('renoapp')?.roles[0]?.id ?? '', scopeId: '', note: '', expiresAt: '' },
                    ])
                  }
                  className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Lägg till BRF-access
                </button>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                  >
                    Stäng
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveReno()}
                    disabled={saving}
                    className="rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? 'Sparar...' : 'Spara'}
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        ) : null}

        {dialog?.kind === 'dashboard' && activeUser ? (
          <Modal
            title={`Dashboard för ${userName(activeUser)}`}
            subtitle="Aktivera de Dashboard-moduler som användaren ska kunna öppna. Rollen sätts automatiskt till inspector."
            onClose={closeDialog}
          >
            <div className="p-6 sm:p-8">
              {dialogError ? (
                <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {dialogError}
                </div>
              ) : null}
              <div className="grid gap-4">
                {dashboardRows.map((row) => (
                  <div key={row.moduleId} className="rounded-[24px] border border-stone-200 bg-stone-50 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-lg font-semibold text-stone-900">{row.label}</div>
                        <p className="mt-1 text-sm text-stone-600">Aktivera modulen för vald organisation.</p>
                      </div>
                      <label className="inline-flex items-center gap-3 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(event) =>
                            setDashboardRows((current) =>
                              current.map((item) =>
                                item.moduleId === row.moduleId ? { ...item, enabled: event.target.checked } : item
                              )
                            )
                          }
                        />
                        Aktiv modul
                      </label>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <label className="text-sm font-semibold text-stone-800">
                        Organisation
                        <select
                          className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900 disabled:bg-stone-100"
                          value={row.scopeId}
                          disabled={!row.enabled}
                          onChange={(event) =>
                            setDashboardRows((current) =>
                              current.map((item) =>
                                item.moduleId === row.moduleId ? { ...item, scopeId: event.target.value } : item
                              )
                            )
                          }
                        >
                          <option value="">Välj organisation</option>
                          {(data?.scopeOptions.organizations ?? []).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-stone-800">
                        Gäller till
                        <input
                          type="datetime-local"
                          className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900 disabled:bg-stone-100"
                          value={row.expiresAt}
                          disabled={!row.enabled}
                          onChange={(event) =>
                            setDashboardRows((current) =>
                              current.map((item) =>
                                item.moduleId === row.moduleId ? { ...item, expiresAt: event.target.value } : item
                              )
                            )
                          }
                        />
                      </label>
                      <label className="text-sm font-semibold text-stone-800 lg:col-span-2">
                        Kommentar
                        <input
                          className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900 disabled:bg-stone-100"
                          value={row.note}
                          disabled={!row.enabled}
                          onChange={(event) =>
                            setDashboardRows((current) =>
                              current.map((item) => (item.moduleId === row.moduleId ? { ...item, note: event.target.value } : item))
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Stäng
                </button>
                <button
                  type="button"
                  onClick={() => void saveDashboard()}
                  disabled={saving}
                  className="rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>
          </Modal>
        ) : null}

        {dialog?.kind === 'hushub_admin' && activeUser ? (
          <Modal
            title={`HusHub Admin för ${userName(activeUser)}`}
            subtitle="Exklusiv systembehörighet. UI:t behandlar den som ett enda på- eller av-läge."
            onClose={closeDialog}
          >
            <div className="p-6 sm:p-8">
              {dialogError ? (
                <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {dialogError}
                </div>
              ) : null}
              <div className="rounded-[24px] border border-stone-200 bg-stone-50 p-5">
                <label className="inline-flex items-center gap-3 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800">
                  <input type="checkbox" checked={hushubEnabled} onChange={(event) => setHushubEnabled(event.target.checked)} />
                  HusHub Admin aktiv
                </label>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <label className="text-sm font-semibold text-stone-800">
                    Kommentar
                    <input
                      className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900 disabled:bg-stone-100"
                      value={hushubNote}
                      disabled={!hushubEnabled}
                      onChange={(event) => setHushubNote(event.target.value)}
                    />
                  </label>
                  <label className="text-sm font-semibold text-stone-800">
                    Gäller till
                    <input
                      type="datetime-local"
                      className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-normal text-stone-900 disabled:bg-stone-100"
                      value={hushubExpiresAt}
                      disabled={!hushubEnabled}
                      onChange={(event) => setHushubExpiresAt(event.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Stäng
                </button>
                <button
                  type="button"
                  onClick={() => void saveHushub()}
                  disabled={saving}
                  className="rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
      </main>
    </Protected>
  )
}
