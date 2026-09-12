'use client'

/* eslint-disable @next/next/no-img-element -- previews use versioned user-uploaded storage paths */

import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, ImagePlus, Save, ShieldCheck, UserRound } from 'lucide-react'
import type {
  OrganizationProfileCardValues,
  OrganizationProfileWorkspace,
} from '@/lib/organizations/profileCardTypes'

type MediaField = 'avatarPath' | 'logoPath' | 'signaturePath'
type TextField = Exclude<keyof OrganizationProfileCardValues, MediaField>

type ApiBody = {
  error?: string
  code?: string
  workspace?: OrganizationProfileWorkspace
  path?: string
  publicUrl?: string
}

function serialize(card: OrganizationProfileCardValues) {
  return JSON.stringify(card)
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
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [form, setForm] = useState(initialWorkspace.card)
  const [savedSnapshot, setSavedSnapshot] = useState(() => serialize(initialWorkspace.card))
  const [saving, setSaving] = useState(false)
  const [uploadingField, setUploadingField] = useState<MediaField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const dirty = serialize(form) !== savedSnapshot
  const organizationName = workspace.organization.name || 'Namnlös organisation'
  const canSave =
    !workspace.migrationRequired &&
    !saving &&
    !uploadingField &&
    form.displayName.trim().length > 0 &&
    form.companyName.trim().length > 0

  useEffect(() => {
    setWorkspace(initialWorkspace)
    setForm(initialWorkspace.card)
    setSavedSnapshot(serialize(initialWorkspace.card))
    setError(null)
    setSuccess(null)
  }, [initialWorkspace])

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
    if (!file || workspace.migrationRequired) return

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
      const response = await fetch(`/api/tu/profile-card/media?${params.toString()}`, {
        method: 'POST',
        body,
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const payload = await readApiBody(response)
      if (!response.ok || typeof payload.path !== 'string') {
        throw new Error(payload.error || 'Bilden kunde inte laddas upp.')
      }
      setMedia(field, payload.path)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Bilden kunde inte laddas upp.')
    } finally {
      setUploadingField(null)
    }
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/tu/profile-card', {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgId: workspace.organization.id,
          expectedVersion: workspace.version,
          card: form,
        }),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const payload = await readApiBody(response)
      if (!response.ok || !payload.workspace) {
        throw new Error(payload.error || 'Företagsprofilen kunde inte sparas.')
      }
      if (payload.workspace.organization.id !== workspace.organization.id) {
        throw new Error('Servern svarade med fel organisation. Ladda om sidan.')
      }

      setWorkspace(payload.workspace)
      setForm(payload.workspace.card)
      setSavedSnapshot(serialize(payload.workspace.card))
      setSuccess(`Företagsprofilen är sparad för ${organizationName}.`)
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Företagsprofilen kunde inte sparas.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
              Organisationsspecifikt visitkort
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{organizationName}</h2>
            <p className="mt-1 text-sm text-slate-600">
              Dessa uppgifter används bara när du arbetar och skickar TU-dokument för denna
              organisation.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-800">
            <ShieldCheck size={14} aria-hidden />
            {workspace.role === 'admin' ? 'Organisationsadministratör' : 'Besiktningsman'}
          </span>
        </div>

        {workspace.migrationRequired ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            SQL 07 behöver köras innan separata företagsprofiler kan sparas. Nu visas den äldre
            standardprofilen endast som förhandsvisning.
          </div>
        ) : !workspace.configured ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            Den här organisationen har ännu inget eget visitkort. Fyll i och spara innan du
            skickar uppdragsbekräftelser eller fastställer TU-utlåtanden.
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 size={17} aria-hidden />
            Eget visitkort är aktiverat för {organizationName}.
          </div>
        )}

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
          <TextInput label="Namn" required value={form.displayName} onChange={(value) => setText('displayName', value)} />
          <TextInput label="Titel/roll" value={form.title ?? ''} onChange={(value) => setText('title', value)} placeholder="Exempelvis certifierad besiktningsman" />
          <TextInput label="Telefon" value={form.phone ?? ''} onChange={(value) => setText('phone', value)} autoComplete="tel" />
          <TextInput label="E-post" type="email" value={form.email ?? ''} onChange={(value) => setText('email', value)} autoComplete="email" />
          <TextInput label="Företag" required value={form.companyName} onChange={(value) => setText('companyName', value)} autoComplete="organization" />
          <TextInput label="Organisationsnummer" value={form.companyOrgNo ?? ''} onChange={(value) => setText('companyOrgNo', value)} placeholder="XXXXXX-XXXX" inputMode="numeric" />
          <TextInput label="Företagsadress" value={form.companyAddress ?? ''} onChange={(value) => setText('companyAddress', value)} autoComplete="street-address" />
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <TextInput label="Postnummer" value={form.companyPostalCode ?? ''} onChange={(value) => setText('companyPostalCode', value)} autoComplete="postal-code" />
            <TextInput label="Ort" value={form.companyCity ?? ''} onChange={(value) => setText('companyCity', value)} autoComplete="address-level2" />
          </div>
        </div>

        <label className="mt-4 block space-y-1.5">
          <span className="text-sm font-medium text-slate-800">Sidfot i TU-utlåtanden</span>
          <textarea
            value={form.reportFooterText ?? ''}
            onChange={(event) => setText('reportFooterText', event.target.value)}
            rows={3}
            maxLength={2_000}
            placeholder="Valfri organisationsspecifik text"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
        </label>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <MediaInput
            label="Profilbild"
            field="avatarPath"
            value={form.avatarPath}
            shape="round"
            busy={uploadingField === 'avatarPath'}
            disabled={workspace.migrationRequired || Boolean(uploadingField)}
            onUpload={handleUpload}
            onRemove={() => setMedia('avatarPath', null)}
          />
          <MediaInput
            label="Företagslogotyp"
            field="logoPath"
            value={form.logoPath}
            busy={uploadingField === 'logoPath'}
            disabled={workspace.migrationRequired || Boolean(uploadingField)}
            onUpload={handleUpload}
            onRemove={() => setMedia('logoPath', null)}
          />
          <MediaInput
            label="Underskrift"
            field="signaturePath"
            value={form.signaturePath}
            busy={uploadingField === 'signaturePath'}
            disabled={workspace.migrationRequired || Boolean(uploadingField)}
            onUpload={handleUpload}
            onRemove={() => setMedia('signaturePath', null)}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <p className="text-xs text-slate-500">
            {dirty ? 'Du har osparade ändringar.' : `Sparat för ${organizationName}.`}
          </p>
          <button
            type="submit"
            disabled={!canSave || !dirty}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <Save size={17} aria-hidden />
            {saving ? 'Sparar…' : 'Spara företagsprofil'}
          </button>
        </div>
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
  ...inputProps
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  type?: 'text' | 'email'
  placeholder?: string
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'tel' | 'email'
}) {
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
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
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
        <button type="button" onClick={onRemove} className="mt-1 w-full text-center text-[11px] font-medium text-rose-700 hover:text-rose-900">
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
