'use client'

import { useEffect, useState } from 'react'

type UserGroup = {
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  members: Array<{
    profileId: string
    fullName: string | null
    email: string | null
    role: 'board' | 'admin'
    acceptedAt: string | null
  }>
  pendingInvites: Array<{
    id: string
    fullName: string | null
    email: string
    expiresAt: string
    createdAt: string
  }>
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function formatRole(role: 'board' | 'admin') {
  return role === 'admin' ? 'Admin' : 'Styrelsemedlem'
}

export default function RenoAppUsersPage() {
  const [items, setItems] = useState<UserGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteFormByBrf, setInviteFormByBrf] = useState<Record<string, { fullName: string; email: string }>>({})
  const [submittingBrfId, setSubmittingBrfId] = useState<string | null>(null)
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null)
  const [removingMemberKey, setRemovingMemberKey] = useState<string | null>(null)

  const refreshUsers = async () => {
    const response = await fetch('/api/renoapp/app/users', { cache: 'no-store' })
    const payload = (await response.json().catch(() => ({}))) as { items?: UserGroup[]; error?: string }

    if (!response.ok) {
      throw new Error(payload.error ?? 'Kunde inte läsa RenoApp-användare.')
    }

    setItems(payload.items ?? [])
  }

  useEffect(() => {
    let active = true

    const loadUsers = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/app/users', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { items?: UserGroup[]; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa RenoApp-användare.')
        }

        if (active) {
          setItems(payload.items ?? [])
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa RenoApp-användare.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadUsers()

    return () => {
      active = false
    }
  }, [])

  const updateInviteField = (brfId: string, field: 'fullName' | 'email', value: string) => {
    setInviteFormByBrf((current) => ({
      ...current,
      [brfId]: {
        fullName: current[brfId]?.fullName ?? '',
        email: current[brfId]?.email ?? '',
        [field]: value,
      },
    }))
  }

  const handleCreateInvite = async (brfId: string) => {
    const fullName = inviteFormByBrf[brfId]?.fullName ?? ''
    const email = inviteFormByBrf[brfId]?.email ?? ''

    setSubmittingBrfId(brfId)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/app/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brfId, fullName, email }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        invite?: { emailSent?: boolean; emailError?: string | null }
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte skapa invite.')
      }

      await refreshUsers()
      setInviteFormByBrf((current) => ({
        ...current,
        [brfId]: { fullName: '', email: '' },
      }))

      if (payload.invite?.emailError && !payload.invite.emailSent) {
        setError(payload.invite.emailError)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa invite.')
    } finally {
      setSubmittingBrfId(null)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    setRevokingInviteId(inviteId)
    setError(null)

    try {
      const response = await fetch(`/api/renoapp/app/users/invite/${inviteId}`, {
        method: 'DELETE',
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte återkalla invite.')
      }

      await refreshUsers()
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Kunde inte återkalla invite.')
    } finally {
      setRevokingInviteId(null)
    }
  }

  const handleRemoveMember = async (brfId: string, profileId: string) => {
    const memberKey = `${brfId}:${profileId}`
    setRemovingMemberKey(memberKey)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/app/users/member', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brfId, profileId }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte ta bort anvÃ¤ndaren.')
      }

      await refreshUsers()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Kunde inte ta bort anvÃ¤ndaren.')
    } finally {
      setRemovingMemberKey(null)
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Användare</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">RenoApp-användare</h2>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
          Här visas aktiva BRF-medlemmar och väntande invites för de BRF:er som du har åtkomst till.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      {loading ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Laddar användare...
        </section>
      ) : items.length === 0 ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Inga BRF-användare hittades ännu.
        </section>
      ) : (
        <section className="grid gap-5">
          {items.map((group) => (
            <article
              key={group.brf.id}
              className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    {group.brf.slug ?? 'BRF'}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-stone-900">{group.brf.name ?? 'Namnlös BRF'}</h3>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                  <span className="rounded-full border border-stone-200 px-3 py-2">
                    {group.members.length} aktiva
                  </span>
                  <span className="rounded-full border border-stone-200 px-3 py-2">
                    {group.pendingInvites.length} väntande
                  </span>
                </div>
              </div>

              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
                  <p className="text-sm font-semibold text-stone-900">Aktiva användare</p>
                  {group.members.length === 0 ? (
                    <p className="mt-3 text-sm text-stone-700">Ingen användare är aktiv ännu.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {group.members.map((member) => (
                        <li
                          key={member.profileId}
                          className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700"
                        >
                          <p className="font-medium text-stone-900">{member.fullName ?? 'Namn saknas'}</p>
                          <p>{member.email ?? '-'}</p>
                          <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
                            {formatRole(member.role)} · accepterad {formatDateTime(member.acceptedAt)}
                          </p>
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => void handleRemoveMember(group.brf.id, member.profileId)}
                              disabled={removingMemberKey === `${group.brf.id}:${member.profileId}`}
                              className="rounded-full border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {removingMemberKey === `${group.brf.id}:${member.profileId}`
                                ? 'Tar bort...'
                                : 'Ta bort anvandare'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
                  <p className="text-sm font-semibold text-stone-900">Lägg till användare</p>
                  <div className="mt-3 grid gap-3 rounded-2xl border border-stone-200 bg-white p-4">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-stone-800">Namn</span>
                      <input
                        value={inviteFormByBrf[group.brf.id]?.fullName ?? ''}
                        onChange={(event) => updateInviteField(group.brf.id, 'fullName', event.target.value)}
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                        placeholder="Namn"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-stone-800">E-post</span>
                      <input
                        value={inviteFormByBrf[group.brf.id]?.email ?? ''}
                        onChange={(event) => updateInviteField(group.brf.id, 'email', event.target.value)}
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                        placeholder="namn@exempel.se"
                        type="email"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleCreateInvite(group.brf.id)}
                      disabled={submittingBrfId === group.brf.id}
                      className="rounded-full bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submittingBrfId === group.brf.id ? 'Skickar...' : 'Skicka invite'}
                    </button>
                  </div>

                  <p className="mt-5 text-sm font-semibold text-stone-900">Väntande invites</p>
                  {group.pendingInvites.length === 0 ? (
                    <p className="mt-3 text-sm text-stone-700">Inga invites väntar på accept ännu.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {group.pendingInvites.map((invite) => (
                        <li
                          key={invite.id}
                          className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700"
                        >
                          <p className="font-medium text-stone-900">{invite.fullName ?? 'Namn saknas'}</p>
                          <p>{invite.email}</p>
                          <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
                            skapad {formatDateTime(invite.createdAt)} · giltig till {formatDateTime(invite.expiresAt)}
                          </p>
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => void handleRevokeInvite(invite.id)}
                              disabled={revokingInviteId === invite.id}
                              className="rounded-full border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {revokingInviteId === invite.id ? 'Återkallar...' : 'Återkalla invite'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
