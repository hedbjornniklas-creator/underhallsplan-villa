'use client'

import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'

type ProfileRow = {
  id: string
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
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

type ProfileForm = {
  full_name: string
  sbr_group: string
  sbr_status: string
  membership_number: string
  certification_number: string
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

function resolvePublicMediaUrl(path: string | null | undefined) {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null

  if (path.startsWith('/storage/')) return `${base}${path}`
  if (path.startsWith('storage/')) return `${base}/${path}`
  if (path.startsWith('/')) return path

  return `${base}/storage/v1/object/public/property-media/${path}`
}

export default function ObSettingsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [avatarLoadError, setAvatarLoadError] = useState(false)
  const [logoLoadError, setLogoLoadError] = useState(false)

  const [form, setForm] = useState<ProfileForm>({
    full_name: '',
    sbr_group: '',
    sbr_status: '',
    membership_number: '',
    certification_number: '',
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
    setAvatarLoadError(false)
  }, [form.avatar_path])

  useEffect(() => {
    setLogoLoadError(false)
  }, [form.logo_path])

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Kunde inte hamta anvandare.')
        setLoading(false)
        return
      }

      setUserId(user.id)

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select(
          'id, full_name, sbr_group, sbr_status, membership_number, certification_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, avatar_path, logo_path'
        )
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) {
        setError('Kunde inte hamta profil.')
        setLoading(false)
        return
      }

      const profile = data as ProfileRow | null
      setForm({
        full_name: profile?.full_name ?? '',
        sbr_group: profile?.sbr_group ?? '',
        sbr_status: profile?.sbr_status ?? '',
        membership_number: profile?.membership_number ?? '',
        certification_number: profile?.certification_number ?? '',
        phone: profile?.phone ?? '',
        email: profile?.email ?? user.email ?? '',
        company_name: profile?.company_name ?? '',
        company_orgno: profile?.company_orgno ?? '',
        company_address: profile?.company_address ?? '',
        company_postal_code: profile?.company_postal_code ?? '',
        company_city: profile?.company_city ?? '',
        avatar_path: profile?.avatar_path ?? null,
        logo_path: profile?.logo_path ?? null,
      })

      setLoading(false)
    }

    void loadProfile()
  }, [])

  const handleChange = (key: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!userId) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    const payload = {
      id: userId,
      full_name: form.full_name || null,
      sbr_group: form.sbr_group || null,
      sbr_status: form.sbr_status || null,
      membership_number: form.membership_number || null,
      certification_number: form.certification_number || null,
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

    const { error: saveError } = await supabase.from('profiles').upsert(payload)

    if (saveError) {
      setError('Kunde inte spara profil.')
      setSaving(false)
      return
    }

    setSuccess('Profilen sparades.')
    setSaving(false)
  }

  const handleImageUpload = async (
    event: ChangeEvent<HTMLInputElement>,
    field: 'avatar_path' | 'logo_path'
  ) => {
    if (!userId) return
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const filePath = `profiles/${userId}/${field}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('property-media')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('property-media').getPublicUrl(filePath)
      const publicUrl = `${data.publicUrl}?v=${Date.now()}`

      setForm((prev) => ({ ...prev, [field]: publicUrl }))
    } catch {
      setError('Kunde inte ladda upp bilden.')
    } finally {
      event.target.value = ''
    }
  }

  const avatarSrc = resolvePublicMediaUrl(form.avatar_path)
  const logoSrc = resolvePublicMediaUrl(form.logo_path)
  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/ob')
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden p-4 md:p-6">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(120% 100% at 50% 100%, rgba(56,189,248,0.28) 0%, rgba(56,189,248,0) 55%), radial-gradient(90% 70% at 20% 40%, rgba(14,165,233,0.3) 0%, rgba(14,165,233,0) 55%), linear-gradient(180deg, #020617 0%, #07143a 42%, #0b2f73 100%), url('/ob-settings-bg.jpg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-black/45" />
        <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,rgba(125,211,252,0.28)_1px,transparent_1px),linear-gradient(to_bottom,rgba(125,211,252,0.28)_1px,transparent_1px)] [background-size:72px_72px]" />

        <div className="relative mx-auto max-w-5xl space-y-4">
          <header className="rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="group relative">
                <button
                  type="button"
                  onClick={handleBack}
                  aria-label="Tillbaka"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                </button>
                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-rose-300 bg-rose-600 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-75 group-hover:opacity-100 group-focus-within:opacity-100 group-active:opacity-100">
                  {'Kom ih\u00e5g att spara f\u00f6rst'}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Besiktningsman - profil</h1>
              </div>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || loading}
                className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {saving ? 'Sparar...' : 'Spara profil'}
              </button>
            </div>
          </header>

          <section className="rounded-2xl border border-white/30 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
            {loading ? <p className="text-sm text-gray-600">Laddar...</p> : null}
            {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
            {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

            {!loading ? (
              <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-center text-xs font-medium text-gray-600">{'Bild p\u00e5 dig'}</div>
                    <label className="group relative block h-[12.6rem] w-[12.6rem] cursor-pointer overflow-hidden rounded-full border border-gray-300 bg-white">
                      {avatarSrc && !avatarLoadError ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarSrc}
                          alt="Besiktningsman"
                          className="h-full w-full object-cover"
                          onError={() => setAvatarLoadError(true)}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gray-50 text-xs text-gray-400">
                          Ingen bild
                        </div>
                      )}
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                        Byt bild
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => void handleImageUpload(event, 'avatar_path')}
                      />
                    </label>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="text-center text-xs font-medium text-gray-600">{'F\u00f6retagslogga'}</div>
                    <label className="group relative block h-[12.6rem] w-[12.6rem] cursor-pointer overflow-hidden rounded-md border border-gray-300 bg-white">
                      {logoSrc && !logoLoadError ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoSrc}
                          alt="F\u00f6retagslogga"
                          className="h-full w-full object-contain"
                          onError={() => setLogoLoadError(true)}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gray-50 text-xs text-gray-400">
                          Ingen logga
                        </div>
                      )}
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                        Byt bild
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => void handleImageUpload(event, 'logo_path')}
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Namn"
                      value={form.full_name}
                      onChange={(value) => handleChange('full_name', value)}
                    />
                    <Field
                      label={'F\u00f6retag'}
                      value={form.company_name}
                      onChange={(value) => handleChange('company_name', value)}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Telefon"
                      value={form.phone}
                      onChange={(value) => handleChange('phone', value)}
                    />
                    <Field
                      label="Adress"
                      value={form.company_address}
                      onChange={(value) => handleChange('company_address', value)}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="E-post"
                      value={form.email}
                      onChange={(value) => handleChange('email', value)}
                    />
                    <Field
                      label="Postnummer"
                      value={form.company_postal_code}
                      onChange={(value) => handleChange('company_postal_code', value)}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="SBR-status"
                      value={form.sbr_status}
                      onChange={(value) => handleChange('sbr_status', value)}
                    />
                    <Field
                      label="Ort"
                      value={form.company_city}
                      onChange={(value) => handleChange('company_city', value)}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="SBR-grupp"
                      value={form.sbr_group}
                      onChange={(value) => handleChange('sbr_group', value)}
                    />
                    <Field
                      label="Org.nr"
                      value={form.company_orgno}
                      onChange={(value) => handleChange('company_orgno', value)}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="SBR-Medlemsnummer"
                      value={form.membership_number}
                      onChange={(value) => handleChange('membership_number', value)}
                    />
                    <div className="hidden sm:block" aria-hidden="true" />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Certifieringsnummer"
                      value={form.certification_number}
                      onChange={(value) => handleChange('certification_number', value)}
                    />
                    <div className="hidden sm:block" aria-hidden="true" />
                  </div>
                </div>
              </div>
            ) : null}

          </section>
        </div>
      </main>
    </Protected>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </label>
  )
}
