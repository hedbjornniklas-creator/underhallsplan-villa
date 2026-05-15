'use client'

import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'

type ProfileRow = {
  id: string
  full_name: string | null
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

type AddonServiceRow = {
  id: string
  key: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type ProfileAddonServiceRow = {
  id: string
  org_id: string
  profile_id: string
  addon_service_id: string
  is_enabled: boolean
  price_amount: number | null
  currency: string | null
}

type AddonOfferFormRow = {
  addon_service_id: string
  key: string
  name: string
  description: string | null
  is_enabled: boolean
  price_amount: string
  currency: string
}

type CertificationCatalogRow = {
  id: string
  key: string
  name: string
  description: string | null
  category: 'certification' | 'membership'
  requires_number: boolean
  requires_valid_to: boolean
  number_label: string | null
  valid_to_label: string | null
  sort_order: number
  is_active: boolean
}

type ProfileCertificationRow = {
  id: string
  org_id: string
  profile_id: string
  certification_id: string
  is_enabled: boolean
  number_value: string | null
  valid_to: string | null
}

type CertificationFormRow = {
  certification_id: string
  key: string
  name: string
  description: string | null
  category: 'certification' | 'membership'
  requires_number: boolean
  requires_valid_to: boolean
  number_label: string | null
  valid_to_label: string | null
  is_enabled: boolean
  number_value: string
  valid_to: string
}

function serializeProfileForm(form: ProfileForm) {
  return JSON.stringify({
    full_name: form.full_name ?? '',
    phone: form.phone ?? '',
    email: form.email ?? '',
    company_name: form.company_name ?? '',
    company_orgno: form.company_orgno ?? '',
    company_address: form.company_address ?? '',
    company_postal_code: form.company_postal_code ?? '',
    company_city: form.company_city ?? '',
    avatar_path: form.avatar_path ?? null,
    logo_path: form.logo_path ?? null,
  })
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

function normalizeCertificationCategory(value: unknown): 'certification' | 'membership' {
  return value === 'membership' ? 'membership' : 'certification'
}

function normalizeTextInput(value: string) {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
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
  const [orgId, setOrgId] = useState<string | null>(null)
  const [addonLoading, setAddonLoading] = useState(false)
  const [addonSaving, setAddonSaving] = useState(false)
  const [addonError, setAddonError] = useState<string | null>(null)
  const [addonSuccess, setAddonSuccess] = useState<string | null>(null)
  const [addonRows, setAddonRows] = useState<AddonOfferFormRow[]>([])
  const [certLoading, setCertLoading] = useState(false)
  const [certSaving, setCertSaving] = useState(false)
  const [certError, setCertError] = useState<string | null>(null)
  const [certSuccess, setCertSuccess] = useState<string | null>(null)
  const [certRows, setCertRows] = useState<CertificationFormRow[]>([])
  const profileHydratedRef = useRef(false)
  const lastSavedProfileSnapshotRef = useRef<string>('')

  const [form, setForm] = useState<ProfileForm>({
    full_name: '',
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
          'id, full_name, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, avatar_path, logo_path'
        )
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) {
        setError('Kunde inte hamta profil.')
        setLoading(false)
        return
      }

      const profile = data as ProfileRow | null
      const loadedForm: ProfileForm = {
        full_name: profile?.full_name ?? '',
        phone: profile?.phone ?? '',
        email: profile?.email ?? user.email ?? '',
        company_name: profile?.company_name ?? '',
        company_orgno: profile?.company_orgno ?? '',
        company_address: profile?.company_address ?? '',
        company_postal_code: profile?.company_postal_code ?? '',
        company_city: profile?.company_city ?? '',
        avatar_path: profile?.avatar_path ?? null,
        logo_path: profile?.logo_path ?? null,
      }
      setForm(loadedForm)
      lastSavedProfileSnapshotRef.current = serializeProfileForm(loadedForm)
      profileHydratedRef.current = true

      const activeOrgId = await loadAddonSettingsForProfile(user.id)
      await loadCertificationSettingsForProfile(user.id, activeOrgId)

      setLoading(false)
    }

    void loadProfile()
  }, [])

  const loadAddonSettingsForProfile = async (profileId: string): Promise<string | null> => {
    setAddonLoading(true)
    setAddonError(null)
    setAddonSuccess(null)

    const { data: memberData, error: memberError } = await (supabase as any)
      .from('org_members')
      .select('org_id')
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (memberError) {
      setAddonError('Kunde inte hamta organisationskoppling.')
      setAddonRows([])
      setAddonLoading(false)
      return null
    }

    const activeOrgId = (memberData?.org_id as string | undefined) ?? null
    setOrgId(activeOrgId)

    if (!activeOrgId) {
      setAddonError('Ingen organisationskoppling hittades.')
      setAddonRows([])
      setAddonLoading(false)
      return null
    }

    const { data: catalogData, error: catalogError } = await (supabase as any)
      .from('settings_addon_services')
      .select('id,key,name,description,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (catalogError) {
      setAddonError('Kunde inte hämta tilläggsuppdrag.')
      setAddonRows([])
      setAddonLoading(false)
      return activeOrgId
    }

    const catalogRows = (catalogData ?? []) as AddonServiceRow[]
    if (catalogRows.length === 0) {
      setAddonRows([])
      setAddonLoading(false)
      return activeOrgId
    }

    const { data: profileAddonsData, error: profileAddonsError } = await (supabase as any)
      .from('profile_addon_services')
      .select('id,org_id,profile_id,addon_service_id,is_enabled,price_amount,currency')
      .eq('org_id', activeOrgId)
      .eq('profile_id', profileId)

    if (profileAddonsError) {
      setAddonError('Kunde inte hämta dina tilläggsuppdrag.')
      setAddonRows([])
      setAddonLoading(false)
      return activeOrgId
    }

    const profileRows = (profileAddonsData ?? []) as ProfileAddonServiceRow[]
    const byAddonId = new Map(profileRows.map((row) => [row.addon_service_id, row]))

    setAddonRows(
      catalogRows.map((service) => {
        const existing = byAddonId.get(service.id)
        return {
          addon_service_id: service.id,
          key: service.key,
          name: service.name,
          description: service.description,
          is_enabled: existing?.is_enabled ?? false,
          price_amount: existing?.price_amount != null ? String(existing.price_amount) : '',
          currency: (existing?.currency ?? 'SEK').toUpperCase(),
        }
      })
    )

    setAddonLoading(false)
    return activeOrgId
  }

  const loadCertificationSettingsForProfile = async (
    profileId: string,
    activeOrgIdHint?: string | null
  ) => {
    setCertLoading(true)
    setCertError(null)
    setCertSuccess(null)

    let activeOrgId = activeOrgIdHint ?? null
    if (!activeOrgId) {
      const { data: memberData, error: memberError } = await (supabase as any)
        .from('org_members')
        .select('org_id')
        .eq('profile_id', profileId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (memberError) {
        setCertError('Kunde inte hamta organisationskoppling for certifieringar.')
        setCertRows([])
        setCertLoading(false)
        return
      }

      activeOrgId = (memberData?.org_id as string | undefined) ?? null
      if (activeOrgId) setOrgId(activeOrgId)
    }

    if (!activeOrgId) {
      setCertError('Ingen organisationskoppling hittades for certifieringar.')
      setCertRows([])
      setCertLoading(false)
      return
    }

    const { data: catalogData, error: catalogError } = await (supabase as any)
      .from('settings_certifications')
      .select(
        'id,key,name,description,category,requires_number,requires_valid_to,number_label,valid_to_label,sort_order,is_active'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (catalogError) {
      setCertError('Kunde inte hamta certifieringskatalogen.')
      setCertRows([])
      setCertLoading(false)
      return
    }

    const catalogRows = (catalogData ?? []) as CertificationCatalogRow[]
    if (catalogRows.length === 0) {
      setCertRows([])
      setCertLoading(false)
      return
    }

    const { data: profileCertData, error: profileCertError } = await (supabase as any)
      .from('profile_certifications')
      .select('id,org_id,profile_id,certification_id,is_enabled,number_value,valid_to')
      .eq('org_id', activeOrgId)
      .eq('profile_id', profileId)

    if (profileCertError) {
      setCertError('Kunde inte hamta dina certifieringar.')
      setCertRows([])
      setCertLoading(false)
      return
    }

    const profileRows = (profileCertData ?? []) as ProfileCertificationRow[]
    const byCertificationId = new Map(profileRows.map((row) => [row.certification_id, row]))

    setCertRows(
      catalogRows.map((catalogRow) => {
        const existing = byCertificationId.get(catalogRow.id)
        return {
          certification_id: catalogRow.id,
          key: catalogRow.key,
          name: catalogRow.name,
          description: catalogRow.description,
          category: normalizeCertificationCategory(catalogRow.category),
          requires_number: catalogRow.requires_number === true,
          requires_valid_to: catalogRow.requires_valid_to === true,
          number_label: catalogRow.number_label,
          valid_to_label: catalogRow.valid_to_label,
          is_enabled: existing?.is_enabled === true,
          number_value: String(existing?.number_value ?? ''),
          valid_to: String(existing?.valid_to ?? ''),
        }
      })
    )

    setCertLoading(false)
  }

  const handleChange = (key: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    if (!userId || loading || !profileHydratedRef.current) return

    const nextSnapshot = serializeProfileForm(form)
    if (nextSnapshot === lastSavedProfileSnapshotRef.current) return

    const timeoutId = window.setTimeout(async () => {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const payload = {
        id: userId,
        full_name: form.full_name || null,
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
        setError('Kunde inte autospara profil.')
        setSaving(false)
        return
      }

      lastSavedProfileSnapshotRef.current = nextSnapshot
      setSuccess('Profilen sparades automatiskt.')
      setSaving(false)
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [form, loading, userId])

  const handleAddonToggle = (addonServiceId: string, checked: boolean) => {
    setAddonRows((prev) =>
      prev.map((row) =>
        row.addon_service_id === addonServiceId ? { ...row, is_enabled: checked } : row
      )
    )
  }

  const handleAddonPriceChange = (addonServiceId: string, value: string) => {
    setAddonRows((prev) =>
      prev.map((row) =>
        row.addon_service_id === addonServiceId ? { ...row, price_amount: value } : row
      )
    )
  }

  const handleCertificationToggle = (certificationId: string, checked: boolean) => {
    setCertRows((prev) =>
      prev.map((row) =>
        row.certification_id === certificationId ? { ...row, is_enabled: checked } : row
      )
    )
  }

  const handleCertificationNumberChange = (certificationId: string, value: string) => {
    setCertRows((prev) =>
      prev.map((row) =>
        row.certification_id === certificationId ? { ...row, number_value: value } : row
      )
    )
  }

  const handleCertificationValidToChange = (certificationId: string, value: string) => {
    setCertRows((prev) =>
      prev.map((row) =>
        row.certification_id === certificationId ? { ...row, valid_to: value } : row
      )
    )
  }

  const handleSaveAddons = async () => {
    if (!userId || !orgId) {
      setAddonError('Ingen organisationskoppling hittades.')
      return
    }

    setAddonSaving(true)
    setAddonError(null)
    setAddonSuccess(null)

    const rows: Array<{
      org_id: string
      profile_id: string
      addon_service_id: string
      is_enabled: boolean
      price_amount: number | null
      currency: string
    }> = []

    for (const row of addonRows) {
      const raw = row.price_amount.trim()
      let parsedPrice: number | null = null

      if (raw !== '') {
        const parsed = Number(raw.replace(',', '.'))
        if (!Number.isFinite(parsed) || parsed < 0) {
          setAddonError(`Ogiltigt pris for: ${row.name}`)
          setAddonSaving(false)
          return
        }
        parsedPrice = Number(parsed.toFixed(2))
      }

      rows.push({
        org_id: orgId,
        profile_id: userId,
        addon_service_id: row.addon_service_id,
        is_enabled: row.is_enabled,
        price_amount: parsedPrice,
        currency: 'SEK',
      })
    }

    const { error: saveError } = await (supabase as any)
      .from('profile_addon_services')
      .upsert(rows, { onConflict: 'org_id,profile_id,addon_service_id' })

    if (saveError) {
      setAddonError('Kunde inte spara tilläggsuppdrag.')
      setAddonSaving(false)
      return
    }

    setAddonSuccess('Tilläggsuppdrag sparades.')
    setAddonSaving(false)
  }

  const handleSaveCertifications = async () => {
    if (!userId || !orgId) {
      setCertError('Ingen organisationskoppling hittades.')
      return
    }

    setCertSaving(true)
    setCertError(null)
    setCertSuccess(null)

    const rows: Array<{
      org_id: string
      profile_id: string
      certification_id: string
      is_enabled: boolean
      number_value: string | null
      valid_to: string | null
    }> = []

    for (const row of certRows) {
      const normalizedNumber = normalizeTextInput(row.number_value)
      const normalizedValidTo = normalizeTextInput(row.valid_to)

      if (row.is_enabled && row.requires_number && !normalizedNumber) {
        setCertError(`Fyll i ${row.number_label ?? 'nummer'} för: ${row.name}`)
        setCertSaving(false)
        return
      }

      if (row.is_enabled && row.requires_valid_to && !normalizedValidTo) {
        setCertError(`Fyll i ${row.valid_to_label ?? 'giltig till'} för: ${row.name}`)
        setCertSaving(false)
        return
      }

      if (normalizedValidTo && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValidTo)) {
        setCertError(`Ogiltigt datum för: ${row.name}`)
        setCertSaving(false)
        return
      }

      rows.push({
        org_id: orgId,
        profile_id: userId,
        certification_id: row.certification_id,
        is_enabled: row.is_enabled,
        number_value: normalizedNumber,
        valid_to: normalizedValidTo,
      })
    }

    const { error: saveError } = await (supabase as any)
      .from('profile_certifications')
      .upsert(rows, { onConflict: 'org_id,profile_id,certification_id' })

    if (saveError) {
      setCertError('Kunde inte spara certifieringar.')
      setCertSaving(false)
      return
    }

    setCertSuccess('Certifieringar sparades.')
    setCertSaving(false)
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
                  {'Autospar \u00e4r aktivt'}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Besiktningsman - profil</h1>
              </div>
              <div className="ml-auto text-xs font-medium text-gray-600">
                {saving ? 'Sparar...' : 'Autospar aktivt'}
              </div>
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
                      label="Ort"
                      value={form.company_city}
                      onChange={(value) => handleChange('company_city', value)}
                    />
                    <Field
                      label="Org.nr"
                      value={form.company_orgno}
                      onChange={(value) => handleChange('company_orgno', value)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

          </section>

          <section className="rounded-2xl border border-white/30 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Certifieringar och medlemskap</h2>
              <button
                type="button"
                onClick={() => void handleSaveCertifications()}
                disabled={certSaving || certLoading || loading}
                className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-50 disabled:text-indigo-700"
              >
                {certSaving ? 'Sparar...' : 'Spara certifieringar'}
              </button>
            </div>

            {certLoading ? <p className="text-sm text-gray-600">Laddar certifieringar...</p> : null}
            {certError ? <p className="mb-3 text-sm text-rose-700">{certError}</p> : null}
            {certSuccess ? <p className="mb-3 text-sm text-emerald-700">{certSuccess}</p> : null}

            {!certLoading && certRows.length === 0 ? (
              <p className="text-sm text-gray-600">Inga aktiva certifieringar finns i admin just nu.</p>
            ) : null}

            {!certLoading && certRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-3">Namn</th>
                      <th className="py-2 pr-3">Typ</th>
                      <th className="py-2 pr-3">Vald</th>
                      <th className="py-2 pr-3">Nummer</th>
                      <th className="py-2 pr-3">Giltig till</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {certRows.map((row) => (
                      <tr key={row.certification_id}>
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium text-gray-900">{row.name}</div>
                          {row.description ? (
                            <div className="mt-1 text-xs text-gray-600">{row.description}</div>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          {row.category === 'membership' ? 'Medlemskap' : 'Certifiering'}
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          <input
                            type="checkbox"
                            checked={row.is_enabled}
                            onChange={(event) =>
                              handleCertificationToggle(row.certification_id, event.target.checked)
                            }
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          {row.requires_number ? (
                            <input
                              type="text"
                              value={row.number_value}
                              onChange={(event) =>
                                handleCertificationNumberChange(row.certification_id, event.target.value)
                              }
                              placeholder={row.number_label ?? 'Nummer'}
                              className="w-40 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          ) : (
                            <span className="text-xs text-gray-500">Ej relevant</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          {row.requires_valid_to ? (
                            <input
                              type="date"
                              value={row.valid_to}
                              onChange={(event) =>
                                handleCertificationValidToChange(row.certification_id, event.target.value)
                              }
                              aria-label={row.valid_to_label ?? 'Giltig till'}
                              className="w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          ) : (
                            <span className="text-xs text-gray-500">Ej relevant</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/30 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Tilläggsuppdrag</h2>
              <button
                type="button"
                onClick={() => void handleSaveAddons()}
                disabled={addonSaving || addonLoading || loading}
                className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-50 disabled:text-indigo-700"
              >
                {addonSaving ? 'Sparar...' : 'Spara tilläggsuppdrag'}
              </button>
            </div>

            {addonLoading ? <p className="text-sm text-gray-600">Laddar tilläggsuppdrag...</p> : null}
            {addonError ? <p className="mb-3 text-sm text-rose-700">{addonError}</p> : null}
            {addonSuccess ? <p className="mb-3 text-sm text-emerald-700">{addonSuccess}</p> : null}

            {!addonLoading && addonRows.length === 0 ? (
              <p className="text-sm text-gray-600">Inga aktiva tilläggsuppdrag finns i admin just nu.</p>
            ) : null}

            {!addonLoading && addonRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-3">Tjänst</th>
                      <th className="py-2 pr-3">Erbjuds</th>
                      <th className="py-2 pr-3">Pris (SEK)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {addonRows.map((row) => (
                      <tr key={row.addon_service_id}>
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium text-gray-900">{row.name}</div>
                          {row.description ? (
                            <div className="mt-1 text-xs text-gray-600">{row.description}</div>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          <input
                            type="checkbox"
                            checked={row.is_enabled}
                            onChange={(event) =>
                              handleAddonToggle(row.addon_service_id, event.target.checked)
                            }
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.price_amount}
                            onChange={(event) =>
                              handleAddonPriceChange(row.addon_service_id, event.target.value)
                            }
                            placeholder="t.ex. 750"
                            className="w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
