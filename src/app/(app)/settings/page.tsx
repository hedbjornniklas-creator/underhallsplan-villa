'use client'

import { useEffect, useState, ChangeEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'
import { supabase } from '@/lib/supabaseClient'

type Profile = {
  id: string
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  phone: string | null
  email: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  avatar_path: string | null
  logo_path: string | null
}

// Separat form-typ så alla textfält är rena string
type ProfileForm = {
  full_name: string
  sbr_group: string
  sbr_status: string
  membership_number: string
  phone: string
  email: string
  company_name: string
  company_orgno: string
  company_address: string
  company_postal_code: string
  company_city: string
  avatar_path: string | null
  logo_path: string | null
}

export default function SettingsOverview() {
  const { isAdmin, loading: profileLoading } = useProfile()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<ProfileForm>({
    full_name: '',
    sbr_group: '',
    sbr_status: '',
    membership_number: '',
    phone: '',
    email: '',
    company_name: '',
    company_orgno: '',
    company_address: '',
    company_postal_code: '',
    company_city: '',
    avatar_path: null,
    logo_path: null,
  })

  useEffect(() => {
    const loadProfile = async () => {
      setLoadingProfile(true)
      setError(null)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Kunde inte hämta användare.')
        setLoadingProfile(false)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, sbr_group, sbr_status, membership_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, avatar_path, logo_path'
        )
        .eq('id', user.id)
        .single()

      // Om ingen profil finns ännu – skapa tom form med email ifylld
      if (error || !data) {
        const p: Profile = {
          id: user.id,
          full_name: null,
          sbr_group: null,
          sbr_status: null,
          membership_number: null,
          phone: null,
          email: user.email ?? null,
          company_name: null,
          company_orgno: null,
          company_address: null,
          company_postal_code: null,
          company_city: null,
          avatar_path: null,
          logo_path: null,
        }
        setProfile(p)
        setForm(prev => ({
          ...prev,
          email: user.email ?? '',
        }))
        setLoadingProfile(false)
        return
      }

      const p = data as Profile
      setProfile(p)
      setForm({
        full_name: p.full_name ?? '',
        sbr_group: p.sbr_group ?? '',
        sbr_status: p.sbr_status ?? '',
        membership_number: p.membership_number ?? '',
        phone: p.phone ?? '',
        email: p.email ?? '',
        company_name: p.company_name ?? '',
        company_orgno: p.company_orgno ?? '',
        company_address: p.company_address ?? '',
        company_postal_code: p.company_postal_code ?? '',
        company_city: p.company_city ?? '',
        avatar_path: p.avatar_path,
        logo_path: p.logo_path,
      })
      setLoadingProfile(false)
    }

    loadProfile()
  }, [])

  const handleChange = (key: keyof ProfileForm, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    setError(null)

    const updatePayload = {
      full_name: form.full_name || null,
      sbr_group: form.sbr_group || null,
      sbr_status: form.sbr_status || null,
      membership_number: form.membership_number || null,
      phone: form.phone || null,
      email: form.email || null,
      company_name: form.company_name || null,
      company_orgno: form.company_orgno || null,
      company_address: form.company_address || null,
      company_postal_code: form.company_postal_code || null,
      company_city: form.company_city || null,
      avatar_path: form.avatar_path,
      logo_path: form.logo_path,
    }

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', profile.id)

    if (error) {
      setError('Kunde inte spara din profil.')
      setSaving(false)
      return
    }

    setSaving(false)
    alert('Profilen sparades.')
  }

  const handleImageUpload = async (
    e: ChangeEvent<HTMLInputElement>,
    field: 'avatar_path' | 'logo_path'
  ) => {
    if (!profile) return
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const filePath = `profiles/${profile.id}/${field}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('property-media')
        .upload(filePath, file, { upsert: true })

      if (uploadErr) throw uploadErr

      const { data } = supabase.storage
        .from('property-media')
        .getPublicUrl(filePath)

      const publicURL = `${data.publicUrl}?v=${Date.now()}`

      setForm(prev => ({
        ...prev,
        [field]: publicURL,
      }))
    } catch {
      alert('Kunde inte ladda upp bilden.')
    } finally {
      e.target.value = ''
    }
  }

  if (profileLoading || loadingProfile) {
    return (
      <Protected>
        <div className="p-6">Laddar…</div>
      </Protected>
    )
  }

  if (!isAdmin) {
    return (
      <Protected>
        <div className="p-6 text-rose-700">Åtkomst nekad.</div>
      </Protected>
    )
  }

  // Cards för inställningssidor – inkl. nya Kontrollpunkter
  const cards = [
    {
      title: 'Handlingar & upplysningar',
      desc: 'Redigera katalogen för handlingar/upplysningar.',
      href: '/settings/handlingar-upplysningar',
    },
    {
      title: 'Förutsättningar',
      desc: 'Rubriker, dropdowns och värden för Punkt 2 (Förutsättningar).',
      href: '/settings/forutsattningar',
    },
    {
      title: 'ÖB – utsida',
      desc: 'Katalog för utvändiga punkter i ÖB.',
      href: '/settings/utsida',
    },
    {
      title: 'Insida',
      desc: 'Katalog för invändiga punkter (UHP).',
      href: '/settings/insida',
    },
    {
      title: 'ÖB – insida',
      desc: 'Rumstyper och fält för invändig överlåtelsebesiktning.',
      href: '/settings/ob-insida',
    },
    {
      title: 'Kontrollpunkter',
      desc: 'Standardiserade kontrollfrågor kopplade till utsida/insida.',
      href: '/settings/ob-control-points',
    },
  ]

  return (
    <Protected>
      <div className="p-4 md:p-6 space-y-6">
        <h1 className="text-xl md:text-2xl font-semibold">Settings</h1>

        {/* Visitkort / profil */}
        <section className="rounded-2xl border bg-white p-5 md:p-6 shadow-sm space-y-5">
          <h2 className="text-lg font-semibold">Besiktningsman – profil</h2>

          <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
            {/* Bilder */}
            <div className="space-y-6">
              {/* Avatar */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-600">
                  Bild på besiktningsman
                </div>
                <div className="flex items-center gap-3">
                  {form.avatar_path ? (
                    <Image
                      src={form.avatar_path}
                      alt="Besiktningsman"
                      width={96}
                      height={96}
                      className="h-24 w-24 rounded-full object-cover border"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border bg-gray-50 text-xs text-gray-400">
                      Ingen bild
                    </div>
                  )}
                  <label className="cursor-pointer rounded-md border px-3 py-1.5 text-xs hover:bg-gray-50">
                    Byt bild
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => handleImageUpload(e, 'avatar_path')}
                    />
                  </label>
                </div>
              </div>

              {/* Logga */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-600">
                  Företagslogga
                </div>
                <div className="flex items-center gap-3">
                  {form.logo_path ? (
                    <Image
                      src={form.logo_path}
                      alt="Företagslogga"
                      width={120}
                      height={60}
                      className="h-16 w-32 rounded-md object-contain border bg-white"
                    />
                  ) : (
                    <div className="flex h-16 w-32 items-center justify-center rounded-md border bg-gray-50 text-xs text-gray-400">
                      Ingen logga
                    </div>
                  )}
                  <label className="cursor-pointer rounded-md border px-3 py-1.5 text-xs hover:bg-gray-50">
                    Byt logga
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => handleImageUpload(e, 'logo_path')}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Formulär */}
            <div className="space-y-4">
              {/* Visitkorts-preview */}
              <div className="rounded-lg border bg-gray-50 p-4">
                <div className="mb-2 text-xs font-semibold uppercase text-gray-500">
                  Visitkort (för utlåtanden)
                </div>

                <div className="space-y-2 text-sm text-gray-800">
                  <div>
                    <span className="font-semibold">
                      {form.full_name || 'Ditt namn'}
                    </span>
                    {form.sbr_group && (
                      <div className="text-xs text-gray-600">
                        {form.sbr_group}
                      </div>
                    )}
                    {form.sbr_status && (
                      <div className="text-xs text-gray-600">
                        {form.sbr_status}
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-gray-700">
                    Medlemsnummer: {form.membership_number || '—'}
                  </div>

                  <div className="text-xs text-gray-700">
                    Telefon: {form.phone || '—'}
                  </div>

                  <div className="text-xs text-gray-700">
                    E-post: {form.email || '—'}
                  </div>

                  <div className="mt-2 text-xs text-gray-700">
                    {form.company_name && <div>{form.company_name}</div>}
                    {form.company_orgno && (
                      <div>Org.nr: {form.company_orgno}</div>
                    )}
                    {form.company_address && (
                      <div>
                        {form.company_address}
                        {form.company_postal_code &&
                          `, ${form.company_postal_code}`}{' '}
                        {form.company_city}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Fält */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Namn
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.full_name}
                    onChange={e => handleChange('full_name', e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    SBR-grupp
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.sbr_group}
                    onChange={e => handleChange('sbr_group', e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    SBR-status
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.sbr_status}
                    onChange={e => handleChange('sbr_status', e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Medlemsnummer
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.membership_number}
                    onChange={e =>
                      handleChange('membership_number', e.target.value)
                    }
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Telefon
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.phone}
                    onChange={e => handleChange('phone', e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    E-post
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.email}
                    onChange={e => handleChange('email', e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Företagsnamn
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.company_name}
                    onChange={e =>
                      handleChange('company_name', e.target.value)
                    }
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Org.nr
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.company_orgno}
                    onChange={e =>
                      handleChange('company_orgno', e.target.value)
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-gray-600">
                    Företagsadress
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.company_address}
                    onChange={e =>
                      handleChange('company_address', e.target.value)
                    }
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Postnummer
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.company_postal_code}
                    onChange={e =>
                      handleChange('company_postal_code', e.target.value)
                    }
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Ort
                  </label>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.company_city}
                    onChange={e =>
                      handleChange('company_city', e.target.value)
                    }
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? 'Sparar…' : 'Spara profil'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Settings-kort */}
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map(c => (
            <Link
              key={c.href}
              href={c.href}
              className="block rounded-2xl border hover:shadow-md p-5"
            >
              <h2 className="text-lg font-semibold">{c.title}</h2>
              <p className="text-sm text-gray-600 mt-1.5">{c.desc}</p>
              <div className="mt-4">
                <span className="underline text-sm">Öppna</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Protected>
  )
}
