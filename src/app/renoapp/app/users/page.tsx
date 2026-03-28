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
                        <li key={member.profileId} className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                          <p className="font-medium text-stone-900">{member.fullName ?? 'Namn saknas'}</p>
                          <p>{member.email ?? '-'}</p>
                          <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
                            {formatRole(member.role)} · accepterad {formatDateTime(member.acceptedAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
                  <p className="text-sm font-semibold text-stone-900">Väntande invites</p>
                  {group.pendingInvites.length === 0 ? (
                    <p className="mt-3 text-sm text-stone-700">Inga invites väntar på accept ännu.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {group.pendingInvites.map((invite) => (
                        <li key={invite.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                          <p className="font-medium text-stone-900">{invite.fullName ?? 'Namn saknas'}</p>
                          <p>{invite.email}</p>
                          <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
                            skapad {formatDateTime(invite.createdAt)} · giltig till {formatDateTime(invite.expiresAt)}
                          </p>
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
