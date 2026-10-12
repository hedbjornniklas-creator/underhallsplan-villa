'use client'

/* eslint-disable @next/next/no-img-element -- previews use versioned user-uploaded storage paths */

import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  Download,
  ImagePlus,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import type {
  OrganizationProfileCardValues,
  OrganizationProfileWorkspace,
} from '@/lib/organizations/profileCardTypes'
import {
  checkedProfileWorkspace,
  mergeSavedProfileCard,
  personalProfileValues,
  profileValidationErrors,
  savedPersonalValuesMatch,
  serializeProfileCard,
} from '@/lib/organizations/profileCardAutosave'

type MediaField = 'avatarPath' | 'signaturePath'
type TextField = Exclude<keyof OrganizationProfileCardValues, MediaField>

type ApiBody = {
  error?: string
  code?: string
  workspace?: OrganizationProfileWorkspace
  path?: string
  publicUrl?: string
}

function publicMediaUrl(path: string | null) {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
    return path
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '')
  return base ? `${base}/storage/v1/object/public/property-media/${path}` : null
}

async function readApiBody(response: Response) {
  return (await response.json().catch(() => ({}))) as ApiBody
}

export default function TuOrganizationProfileEditor({
  initialWorkspace,
}: {
  initialWorkspace: OrganizationProfileWorkspace
}) {
  // Same-organization refreshes must not discard a local draft. A different
  // organization or signed-in profile gets a fresh editor and request lifetime.
  return <ProfileEditor key={`${initialWorkspace.organization.id}:${initialWorkspace.profileId}`} initialWorkspace={initialWorkspace} />
}

function ProfileEditor({ initialWorkspace }: { initialWorkspace: OrganizationProfileWorkspace }) {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [form, setForm] = useState(initialWorkspace.card)
  const [savedSnapshot, setSavedSnapshot] = useState(() => serializeProfileCard(initialWorkspace.card))
  const [saving, setSaving] = useState(false)
  const [importingLegacyMedia, setImportingLegacyMedia] = useState(false)
  const [uploadingField, setUploadingField] = useState<MediaField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveConflict, setSaveConflict] = useState(false)
  const [retryImport, setRetryImport] = useState(false)
  const operation = useRef<'save' | 'upload' | 'import' | null>(null)
  const lifetime = useRef(0)
  const dirty = serializeProfileCard(form) !== savedSnapshot
  const validationErrors = profileValidationErrors(form)
  const organizationName = workspace.organization.name || 'Namnlös organisation'
  const canSave =
    !workspace.migrationRequired &&
    !saving &&
    !importingLegacyMedia &&
    !uploadingField &&
    !saveConflict &&
    !retryImport &&
    Object.keys(validationErrors).length === 0 &&
    form.companyName.trim().length > 0
  const legacyMediaFields = (['avatarPath', 'signaturePath'] as const).filter(
    (field) => !form[field] && workspace.legacyMediaAvailable[field]
  )
  const canImportLegacyMedia =
    workspace.configured
    && !workspace.migrationRequired
    && workspace.version !== null
    && legacyMediaFields.length > 0
    && !dirty
    && !saving
    && !uploadingField
    && !importingLegacyMedia
    && (!saveError || retryImport)
    && !saveConflict

  useEffect(() => {
    lifetime.current += 1
    return () => { lifetime.current += 1 }
  }, [])

  useEffect(() => {
    let linkApproved = false
    let approvalTimer: number | undefined
    const beforeSwitch = (event: Event) => {
      if (operation.current || saving || uploadingField || importingLegacyMedia) { event.preventDefault(); return }
      const detail = (event as CustomEvent<{ confirmed?: boolean }>).detail
      if (linkApproved) { if (detail) detail.confirmed = true; return }
      if (event.defaultPrevented) return
      if ((dirty || saveError) && !detail?.confirmed) {
        if (!window.confirm('Profiländringarna är inte sparade ännu. Vill du lämna dem?')) event.preventDefault()
        else if (detail) detail.confirmed = true
      }
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || saveError || operation.current || saving || uploadingField || importingLegacyMedia) { event.preventDefault(); event.returnValue = '' }
    }
    // Next client-side links do not trigger beforeunload. Cover the topbar and
    // other same-tab links as well as the explicit organization switch event.
    const beforeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const target = new URL(link.href, window.location.href)
      const current = new URL(window.location.href)
      if (!['http:', 'https:'].includes(target.protocol) ||
        (target.origin === current.origin && target.pathname === current.pathname && target.search === current.search)) return
      const allowed = window.dispatchEvent(new CustomEvent('hushub:before-organization-switch', {
        cancelable: true, detail: { orgId: workspace.organization.id },
      }))
      if (!allowed) { event.preventDefault(); event.stopPropagation(); return }
      linkApproved = true
      // A browser can run microtasks between capture and React's bubble handler.
      // Keep this click's approval until the next task to avoid a second prompt.
      window.clearTimeout(approvalTimer)
      approvalTimer = window.setTimeout(() => { linkApproved = false }, 0)
    }
    window.addEventListener('hushub:before-organization-switch', beforeSwitch)
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeLink, true)
    return () => {
      window.removeEventListener('hushub:before-organization-switch', beforeSwitch)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeLink, true)
      window.clearTimeout(approvalTimer)
    }
  }, [dirty, saveError, saving, uploadingField, importingLegacyMedia, workspace.organization.id])

  const previewAddress = useMemo(
    () =>
      [
        form.companyAddress,
        [form.companyPostalCode, form.companyCity].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', '),
    [form.companyAddress, form.companyCity, form.companyPostalCode]
  )

  const setText = (field: TextField, value: string) => {
    if (workspace.migrationRequired || retryImport || operation.current === 'import') return
    setSuccess(null)
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const setMedia = (field: MediaField, value: string | null) => {
    setSuccess(null)
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>, field: MediaField) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || workspace.migrationRequired || saveConflict || retryImport || operation.current) return

    operation.current = 'upload'
    const generation = lifetime.current
    setUploadingField(field)
    setError(null)
    setSuccess(null)
    try {
      const body = new FormData()
      body.set('file', file)
      const params = new URLSearchParams({
        orgId: workspace.organization.id,
        field,
      })
      const response = await fetch(`/api/organizations/member-profile/media?${params.toString()}`, {
        method: 'POST',
        body,
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const payload = await readApiBody(response)
      if (generation !== lifetime.current) return
      if (!response.ok || typeof payload.path !== 'string') {
        throw new Error(payload.error || 'Bilden kunde inte laddas upp.')
      }
      setMedia(field, payload.path)
    } catch (uploadError) {
      if (generation !== lifetime.current) return
      setError(uploadError instanceof Error ? uploadError.message : 'Bilden kunde inte laddas upp.')
    } finally {
      if (generation === lifetime.current) { operation.current = null; setUploadingField(null) }
    }
  }

  const handleLegacyMediaImport = async () => {
    if (!canImportLegacyMedia || workspace.version === null || operation.current) return

    operation.current = 'import'
    const generation = lifetime.current
    const submitted = form
    setImportingLegacyMedia(true)
    setError(null)
    setSaveError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/organizations/member-profile', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'import_legacy_media',
          orgId: workspace.organization.id,
          expectedVersion: workspace.version,
        }),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const payload = await readApiBody(response)
      if (generation !== lifetime.current) return
      if (!response.ok || !payload.workspace) {
        if (response.status === 409) {
          setSaveConflict(true)
          throw new Error('Profilen har ändrats på annat håll. Ladda om profilen innan du hämtar bilder igen.')
        }
        throw new Error(payload.error || 'De tidigare profilbilderna kunde inte hämtas.')
      }
      const confirmed = checkedProfileWorkspace(payload.workspace, workspace)
      setWorkspace(confirmed)
      setForm(current => mergeSavedProfileCard(current, submitted, confirmed.card))
      setSavedSnapshot(serializeProfileCard(confirmed.card))
      setRetryImport(false)
      setSuccess('Tidigare profilbild och underskrift har hämtats där de saknades.')
    } catch (importError) {
      if (generation !== lifetime.current) return
      setRetryImport(true)
      // Import also writes the card. An uncertain response must stop later PUTs
      // from claiming the old version is still current.
      setSaveError(
        importError instanceof Error
          ? importError.message
          : 'De tidigare profilbilderna kunde inte hämtas.'
      )
    } finally {
      if (generation === lifetime.current) { operation.current = null; setImportingLegacyMedia(false) }
    }
  }

  const saveProfile = useCallback(async () => {
    if (!canSave || operation.current || (!dirty && !saveError && workspace.version !== null)) return

    operation.current = 'save'
    const generation = lifetime.current
    const submitted = form
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch('/api/organizations/member-profile', {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgId: workspace.organization.id,
          expectedVersion: workspace.version,
          card: personalProfileValues(submitted),
        }),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const payload = await readApiBody(response)
      if (generation !== lifetime.current) return
      if (!response.ok || !payload.workspace) {
        if (response.status === 409) {
          setSaveConflict(true)
          throw new Error('Profilen har ändrats på annat håll. Dina ändringar finns kvar här. Kopiera dem innan du laddar om sidan.')
        }
        throw new Error(payload.error || 'Autosparandet kunde inte bekräftas. Dina ändringar finns kvar här. Försök spara igen.')
      }
      const confirmed = checkedProfileWorkspace(payload.workspace, workspace)
      if (!savedPersonalValuesMatch(confirmed.card, submitted)) {
        throw new Error('De sparade uppgifterna kunde inte bekräftas. Dina ändringar finns kvar här. Ladda om sidan innan du fortsätter.')
      }
      setWorkspace(confirmed)
      setForm(current => mergeSavedProfileCard(current, submitted, confirmed.card))
      setSavedSnapshot(serializeProfileCard(confirmed.card))
    } catch (saveError) {
      if (generation !== lifetime.current) return
      setSaveError(
        saveError instanceof Error && !(saveError instanceof TypeError) ? saveError.message : 'Kunde inte nå servern. Dina ändringar finns kvar här. Försök spara igen.'
      )
    } finally {
      if (generation === lifetime.current) { operation.current = null; setSaving(false) }
    }
  }, [canSave, dirty, form, saveError, workspace])

  useEffect(() => {
    if (!dirty || !canSave || saveError) return
    const timer = window.setTimeout(() => { void saveProfile() }, 700)
    return () => window.clearTimeout(timer)
  }, [canSave, dirty, saveError, saveProfile])

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (retryImport) void handleLegacyMediaImport()
    else void saveProfile()
  }

  const status = saving ? 'Sparar…'
    : uploadingField ? 'Laddar upp bild…'
      : importingLegacyMedia ? 'Hämtar tidigare bilder…'
        : workspace.migrationRequired ? 'Autosparning är inte tillgänglig.'
          : saveError ? 'Inte sparat – autosparningen är pausad.'
            : dirty ? canSave ? 'Osparade ändringar – sparas automatiskt…' : 'Kontrollera uppgifterna – inte sparat.'
              : workspace.version === null ? 'Profilen är inte sparad ännu.' : 'Alla ändringar är sparade.'

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
              Min profil
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{organizationName}</h2>
            <p className="mt-1 text-sm text-slate-600">
              Här ändrar du dina egna uppgifter i {organizationName}. Företagsuppgifterna och logotypen är gemensamma för alla medlemmar.
            </p>
            <p className="mt-1 text-xs text-slate-500">Dina ändringar sparas automatiskt efter en kort paus i skrivandet.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-800">
            <ShieldCheck size={14} aria-hidden />
            {workspace.role === 'admin' ? 'Organisationsadministratör' : 'Besiktningsman'}
          </span>
        </div>

        {workspace.migrationRequired ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            Organisationsinställningarna är ännu inte aktiverade. Kontakta HusHub-administratören.
          </div>
        ) : !workspace.configured ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            {!workspace.companyConfigured ? 'Organisationens gemensamma företagsuppgifter behöver först bekräftas av en organisationsadministratör. Dina personuppgifter kan sparas redan nu.' : 'Fyll i din personprofil. Ändringarna sparas automatiskt. Är uppgifterna redan rätt kan du välja Bekräfta min profil.'}
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 size={17} aria-hidden />
            Eget visitkort är aktiverat för {organizationName}.
          </div>
        )}

        {legacyMediaFields.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-violet-950">Tidigare profilbilder finns</p>
              <p className="mt-0.5 text-xs leading-5 text-violet-800">
                Hämta saknade bilder till just {organizationName}. Befintliga bilder ersätts inte.
                {dirty ? ' Vänta tills dina övriga ändringar har sparats.' : ''}
              </p>
            </div>
            <button
              type="button"
              disabled={!canImportLegacyMedia}
              onClick={() => void handleLegacyMediaImport()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300 bg-white px-4 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Download size={16} aria-hidden />
              {importingLegacyMedia ? 'Hämtar…' : 'Hämta bilder'}
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
          </p>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <TextInput label="Namn" required maxLength={200} disabled={workspace.migrationRequired || importingLegacyMedia || retryImport} error={dirty ? validationErrors.displayName : undefined} value={form.displayName} onChange={(value) => setText('displayName', value)} />
          <TextInput label="Titel/roll" maxLength={160} disabled={workspace.migrationRequired || importingLegacyMedia || retryImport} error={dirty ? validationErrors.title : undefined} value={form.title ?? ''} onChange={(value) => setText('title', value)} placeholder="Exempelvis certifierad besiktningsman" />
          <TextInput label="Telefon" maxLength={80} disabled={workspace.migrationRequired || importingLegacyMedia || retryImport} error={dirty ? validationErrors.phone : undefined} value={form.phone ?? ''} onChange={(value) => setText('phone', value)} autoComplete="tel" />
          <TextInput label="Arbetsmejl i organisationen" type="email" maxLength={320} disabled={workspace.migrationRequired || importingLegacyMedia || retryImport} error={dirty ? validationErrors.email : undefined} value={form.email ?? ''} onChange={(value) => setText('email', value)} autoComplete="email" />
        </div>

        <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-950">
          <p className="font-semibold">Företagsuppgifter från {organizationName}</p>
          <p className="mt-1">{form.companyName}{form.companyOrgNo ? ` · ${form.companyOrgNo}` : ''}</p>
          {previewAddress ? <p>{previewAddress}</p> : null}
          <p className="mt-2 text-xs">Din arbetsmejl ändrar inte mejladressen du använder för att logga in.</p>
          <Link href={`/settings/organisation?orgId=${encodeURIComponent(workspace.organization.id)}`} className="mt-3 inline-block font-semibold underline">Öppna organisationens inställningar</Link>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <MediaInput
            label="Profilbild"
            field="avatarPath"
            value={form.avatarPath}
            shape="round"
            busy={uploadingField === 'avatarPath'}
            disabled={workspace.migrationRequired || saving || saveConflict || retryImport || Boolean(uploadingField) || importingLegacyMedia}
            onUpload={handleUpload}
            onRemove={() => setMedia('avatarPath', null)}
          />
          <MediaInput
            label="Underskrift"
            field="signaturePath"
            value={form.signaturePath}
            busy={uploadingField === 'signaturePath'}
            disabled={workspace.migrationRequired || saving || saveConflict || retryImport || Boolean(uploadingField) || importingLegacyMedia}
            onUpload={handleUpload}
            onRemove={() => setMedia('signaturePath', null)}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm text-slate-600">
            {status}
          </p>
          <button
            type="submit"
            disabled={retryImport ? !canImportLegacyMedia : !canSave || (!dirty && !saveError && workspace.version !== null)}
            aria-busy={saving || importingLegacyMedia}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <Save size={17} aria-hidden />
            {saving ? 'Sparar…' : importingLegacyMedia ? 'Hämtar bilder…' : retryImport ? 'Försök hämta bilder igen' : saveError ? 'Försök spara igen' : workspace.version === null ? 'Bekräfta min profil' : 'Spara nu'}
          </button>
        </div>
        {saveError && <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"><p>{saveError}</p><button type="button" className="mt-2 font-semibold underline" disabled={saving || importingLegacyMedia || Boolean(uploadingField)} onClick={() => { if (window.confirm('Ladda om profilen från servern? Osparade ändringar på den här sidan försvinner.')) window.location.reload() }}>Ladda om profilen</button></div>}
      </form>

      <aside className="h-fit rounded-2xl border border-violet-100 bg-white p-5 shadow-sm lg:sticky lg:top-20">
        <div className="flex items-center gap-2 text-sm font-semibold text-violet-800">
          <Building2 size={18} aria-hidden />
          Förhandsvisning
        </div>
        <div className="mt-4 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5">
          <div className="flex items-start gap-3">
            <PreviewImage path={form.avatarPath} label="Profilbild" round fallback={<UserRound size={24} aria-hidden />} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-950">{form.displayName || 'Namn saknas'}</p>
              {form.title ? <p className="truncate text-xs text-slate-600">{form.title}</p> : null}
              <p className="mt-1 truncate text-sm text-slate-800">{form.companyName || organizationName}</p>
            </div>
          </div>
          {form.logoPath ? (
            <div className="mt-4 flex min-h-20 items-center justify-center rounded-xl border border-slate-200 bg-white p-3">
              <PreviewImage path={form.logoPath} label="Företagslogotyp" contain />
            </div>
          ) : null}
          <dl className="mt-4 space-y-2 text-xs text-slate-600">
            {form.companyOrgNo ? <PreviewLine label="Org.nr" value={form.companyOrgNo} /> : null}
            {previewAddress ? <PreviewLine label="Adress" value={previewAddress} /> : null}
            {form.phone ? <PreviewLine label="Telefon" value={form.phone} /> : null}
            {form.email ? <PreviewLine label="E-post" value={form.email} /> : null}
          </dl>
          {form.signaturePath ? (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="h-16">
                <PreviewImage path={form.signaturePath} label="Underskrift" contain />
              </div>
              <p className="mt-1 text-xs font-medium text-slate-700">{form.displayName}</p>
            </div>
          ) : null}
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Visitkortet fryses in i varje fastställt utlåtande. Senare profiländringar påverkar inte
          äldre dokument.
        </p>
      </aside>
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  required,
  type = 'text',
  error,
  ...inputProps
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  type?: 'text' | 'email'
  error?: string
  disabled?: boolean
  maxLength?: number
  placeholder?: string
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'tel' | 'email'
}) {
  const errorId = useId()
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium text-slate-800">
        {label}{required ? <span className="ml-1 text-rose-600">*</span> : null}
      </span>
      <input
        {...inputProps}
        type={type}
        required={required}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
      <span id={errorId} className="block min-h-5 text-xs text-rose-700">{error}</span>
    </label>
  )
}

function MediaInput({
  label,
  field,
  value,
  shape,
  busy,
  disabled,
  onUpload,
  onRemove,
}: {
  label: string
  field: MediaField
  value: string | null
  shape?: 'round'
  busy: boolean
  disabled: boolean
  onUpload: (event: ChangeEvent<HTMLInputElement>, field: MediaField) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <div className="mt-2 flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-2">
        {value ? (
          <PreviewImage path={value} label={label} round={shape === 'round'} contain={shape !== 'round'} />
        ) : (
          <ImagePlus size={24} className="text-slate-400" aria-hidden />
        )}
      </div>
      <label className={`mt-2 block text-center text-xs font-semibold ${disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-violet-700 hover:text-violet-900'}`}>
        {busy ? 'Laddar upp…' : value ? 'Byt bild' : 'Ladda upp'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => void onUpload(event, field)}
        />
      </label>
      {value ? (
        <button type="button" disabled={disabled} onClick={onRemove} className="mt-1 w-full text-center text-[11px] font-medium text-rose-700 hover:text-rose-900 disabled:opacity-40">
          Ta bort från visitkortet
        </button>
      ) : null}
    </div>
  )
}

function PreviewImage({
  path,
  label,
  round,
  contain,
  fallback,
}: {
  path: string | null
  label: string
  round?: boolean
  contain?: boolean
  fallback?: ReactNode
}) {
  const resolvedSrc = publicMediaUrl(path)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = resolvedSrc && failedSrc !== resolvedSrc ? resolvedSrc : null

  if (!src) {
    return (
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center bg-white text-slate-400 ${round ? 'rounded-full border border-violet-100' : ''}`}>
        {fallback ?? <ImagePlus size={22} aria-hidden />}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={label}
      onError={() => setFailedSrc(resolvedSrc)}
      className={`${round ? 'h-14 w-14 rounded-full' : 'h-full w-full'} ${contain ? 'object-contain' : 'object-cover'}`}
    />
  )
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-700">{value}</dd>
    </div>
  )
}
