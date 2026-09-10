'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeFortnoxOrganizationNumber } from '@/lib/fortnox/domain'

type ConnectionStatus = {
  companyName: string
  organizationNumber: string
  grantedScopes: string[]
  status: 'connected' | 'needs_reauthorization'
  connectedAt: string
  lastVerifiedAt: string
}

type OrganizationStatus = {
  id: string
  name: string
  organizationNumber: string | null
  isDefault: boolean
  canManage: boolean
  connection: ConnectionStatus | null
}

type SettingsPayload = {
  configured: boolean
  organizations: OrganizationStatus[]
}

type Notice = {
  tone: 'success' | 'warning' | 'error'
  message: string
}

const CALLBACK_NOTICES: Readonly<Record<string, Notice>> = Object.freeze({
  connected: {
    tone: 'success',
    message: 'Fortnox har anslutits och verifierats.',
  },
  cancelled: {
    tone: 'warning',
    message: 'Godkännandet i Fortnox avbröts. Ingen anslutning ändrades.',
  },
  login_required: {
    tone: 'error',
    message: 'Du behöver logga in i HusHub igen innan Fortnox-anslutningen kan slutföras.',
  },
  hushub_access_denied: {
    tone: 'error',
    message: 'Du saknar åtkomst eller administratörsbehörighet för organisationen i HusHub.',
  },
  fortnox_access_denied: {
    tone: 'error',
    message: 'Fortnox nekade auktoriseringen. Starta om anslutningen och godkänn åtkomsten.',
  },
  permission_or_license_missing: {
    tone: 'error',
    message:
      'Kontot saknar nödvändig behörighet eller licens i Fortnox. Be en Fortnox-systemadministratör kontrollera åtkomsten.',
  },
  scope_missing: {
    tone: 'error',
    message:
      'Fortnox gav inte alla behörigheter som behövs för företagsinformation, kunder och fakturor. Återanslut och godkänn de begärda behörigheterna.',
  },
  state_invalid: {
    tone: 'error',
    message:
      'Anslutningsförsöket är ogiltigt, har gått ut eller har redan använts. Starta ett nytt försök.',
  },
  callback_invalid: {
    tone: 'error',
    message: 'Returen från Fortnox är ogiltig. Starta ett nytt anslutningsförsök.',
  },
  superseded: {
    tone: 'warning',
    message: 'Det här anslutningsförsöket ersattes av ett nyare. Slutför det senaste försöket.',
  },
  organization_mismatch: {
    tone: 'error',
    message: 'Det valda Fortnox-företaget har ett annat organisationsnummer.',
  },
  tenant_conflict: {
    tone: 'error',
    message: 'Det valda Fortnox-företaget är redan anslutet till en annan organisation.',
  },
  configuration_error: {
    tone: 'error',
    message: 'Fortnox-anslutningen är inte färdigkonfigurerad på servern.',
  },
  provider_unavailable: {
    tone: 'error',
    message: 'Fortnox kunde inte nås eller verifieras. Försök igen om en stund.',
  },
  failed: {
    tone: 'error',
    message: 'Fortnox-anslutningen kunde inte slutföras. Starta om anslutningen.',
  },
})

const UNVERIFIED_CONNECTED_NOTICE: Notice = Object.freeze({
  tone: 'warning',
  message:
    'Returen från Fortnox mottogs, men anslutningen kunde inte bekräftas för organisationen. Kontrollera statusen och försök vid behov igen.',
})

const API_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  UNAUTHORIZED: 'Logga in för att fortsätta.',
  PRODUCT_ACCESS_REQUIRED: 'Du saknar behörighet till BesiktApp.',
  MODULE_ACCESS_REQUIRED: 'Du saknar behörighet att hantera organisationens Fortnox-anslutning.',
  FORTNOX_ORIGIN_FORBIDDEN: 'Otillåten begäran.',
  FORTNOX_ORGANIZATION_INVALID: 'Organisationen är ogiltig.',
  FORTNOX_ORGANIZATION_MEMBER_REQUIRED: 'Du saknar tillgång till organisationen.',
  FORTNOX_ORGANIZATION_ADMIN_REQUIRED:
    'Endast en organisationsadministratör kan hantera Fortnox-anslutningen.',
  FORTNOX_ORGANIZATION_NOT_FOUND: 'Organisationen kunde inte hittas.',
  FORTNOX_ORGANIZATION_NUMBER_INVALID: 'Ange ett giltigt svenskt organisationsnummer.',
  FORTNOX_ORGANIZATION_NUMBER_REQUIRED:
    'Spara organisationens organisationsnummer innan Fortnox ansluts.',
  FORTNOX_ORGANIZATION_NUMBER_LOCKED:
    'Organisationsnumret måste stämma med det anslutna Fortnox-företaget.',
  FORTNOX_CONNECTION_NOT_FOUND:
    'Det finns ingen Fortnox-anslutning att kontrollera för organisationen.',
  FORTNOX_VERIFICATION_SUPERSEDED:
    'Anslutningen ändrades medan kontrollen pågick. Den aktuella statusen har hämtats på nytt.',
  FORTNOX_PERMISSION_OR_LICENSE_MISSING:
    'Kontot saknar nödvändig behörighet eller licens i Fortnox.',
  FORTNOX_REQUIRED_SCOPE_MISSING:
    'Fortnox gav inte alla behörigheter för företagsinformation, kunder och fakturor. Återanslut Fortnox.',
  FORTNOX_ORGANIZATION_MISMATCH:
    'Fortnox-företaget stämmer inte med organisationens organisationsnummer.',
  FORTNOX_COMPANY_VERIFICATION_FAILED:
    'Fortnox-företaget kunde inte verifieras säkert. Återanslut Fortnox.',
  FORTNOX_CLIENT_CREDENTIALS_REJECTED:
    'Fortnox avvisade anslutningen. Återanslut Fortnox.',
  FORTNOX_ACCESS_TOKEN_REJECTED:
    'Fortnox avvisade åtkomsten. Återanslut Fortnox.',
  FORTNOX_INVALID_TENANT:
    'Den sparade Fortnox-anslutningen är ogiltig. Återanslut Fortnox.',
  FORTNOX_INVALID_PROVIDER_RESPONSE: 'Fortnox returnerade ett oväntat svar.',
  FORTNOX_PROVIDER_REQUEST_FAILED: 'Anropet till Fortnox misslyckades.',
  FORTNOX_TEMPORARILY_UNAVAILABLE:
    'Fortnox kan inte nås just nu. Försök igen om en stund.',
  FORTNOX_CONFIGURATION_MISSING:
    'Fortnox-anslutningen är inte konfigurerad på servern.',
  FORTNOX_CONFIGURATION_INVALID:
    'Fortnox-anslutningens serverkonfiguration är ogiltig.',
  FORTNOX_DATABASE_NOT_READY:
    'Databasstödet för Fortnox behöver installeras innan anslutningen kan användas.',
  FORTNOX_DATABASE_FAILED: 'Fortnox-anslutningen kunde inte läsas eller sparas just nu.',
  FORTNOX_REQUEST_INVALID: 'Begäran är ogiltig.',
  FORTNOX_REQUEST_TOO_LARGE: 'Begäran är för stor.',
  FORTNOX_CONTENT_TYPE_INVALID: 'Begäran har ett format som inte stöds.',
})

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseConnection(value: unknown): ConnectionStatus | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  if (
    typeof value.companyName !== 'string' ||
    normalizeFortnoxOrganizationNumber(value.organizationNumber) !==
      value.organizationNumber ||
    !Array.isArray(value.grantedScopes) ||
    !value.grantedScopes.every(
      (scope): scope is string => typeof scope === 'string' && SCOPE_PATTERN.test(scope)
    ) ||
    (value.status !== 'connected' && value.status !== 'needs_reauthorization') ||
    typeof value.connectedAt !== 'string' ||
    typeof value.lastVerifiedAt !== 'string'
  ) {
    return undefined
  }

  return {
    companyName: value.companyName,
    organizationNumber: String(value.organizationNumber),
    grantedScopes: value.grantedScopes,
    status: value.status,
    connectedAt: value.connectedAt,
    lastVerifiedAt: value.lastVerifiedAt,
  }
}

function parseSettings(value: unknown): SettingsPayload | null {
  if (!isRecord(value) || typeof value.configured !== 'boolean' || !Array.isArray(value.organizations)) {
    return null
  }

  const organizations: OrganizationStatus[] = []
  for (const candidate of value.organizations) {
    if (!isRecord(candidate)) return null
    const connection = parseConnection(candidate.connection)
    if (
      !UUID_PATTERN.test(String(candidate.id ?? '')) ||
      typeof candidate.name !== 'string' ||
      candidate.name.length === 0 ||
      candidate.name.length > 255 ||
      (candidate.organizationNumber !== null &&
        normalizeFortnoxOrganizationNumber(candidate.organizationNumber) !==
          candidate.organizationNumber) ||
      typeof candidate.isDefault !== 'boolean' ||
      typeof candidate.canManage !== 'boolean' ||
      connection === undefined
    ) {
      return null
    }

    organizations.push({
      id: String(candidate.id).toLowerCase(),
      name: candidate.name,
      organizationNumber:
        candidate.organizationNumber === null ? null : String(candidate.organizationNumber),
      isDefault: candidate.isDefault,
      canManage: candidate.canManage,
      connection,
    })
  }

  return { configured: value.configured, organizations }
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as unknown
    if (
      isRecord(payload) &&
      typeof payload.code === 'string' &&
      Object.prototype.hasOwnProperty.call(API_ERROR_MESSAGES, payload.code)
    ) {
      return API_ERROR_MESSAGES[payload.code]
    }
  } catch {
    // The response is deliberately treated as opaque.
  }
  return fallback
}

function formatOrganizationNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  return digits.length > 6 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits
}

function formatVerifiedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Okänd tid'
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function scopeLabel(scope: string) {
  if (scope === 'companyinformation') return 'Företagsinformation'
  if (scope === 'customer') return 'Kundregister'
  if (scope === 'invoice') return 'Fakturor'
  return scope
}

function NoticeBox({ notice }: { notice: Notice }) {
  const className =
    notice.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : notice.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-rose-200 bg-rose-50 text-rose-800'

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${className}`} role="status">
      {notice.message}
    </div>
  )
}

export default function FortnoxConnectionCard({
  externalNavigationBlocked,
}: {
  externalNavigationBlocked: boolean
}) {
  const preferredOrgId = useRef<string | null>(null)
  const pendingConnectedCallback = useRef<{ orgId: string | null } | null>(null)
  const callbackProcessed = useRef(false)
  const selectedOrgIdRef = useRef('')
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [organizationNumber, setOrganizationNumber] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<Notice | null>(null)
  const [callbackNotice, setCallbackNotice] = useState<Notice | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (callbackProcessed.current) return
    callbackProcessed.current = true

    const url = new URL(window.location.href)
    const callbackStatus = url.searchParams.get('fortnox')
    const callbackOrgId = url.searchParams.get('orgId')
    const normalizedCallbackOrgId =
      callbackOrgId && UUID_PATTERN.test(callbackOrgId) ? callbackOrgId.toLowerCase() : null
    const notice =
      callbackStatus && Object.prototype.hasOwnProperty.call(CALLBACK_NOTICES, callbackStatus)
        ? CALLBACK_NOTICES[callbackStatus]
        : null

    if (callbackStatus === 'connected') {
      pendingConnectedCallback.current = { orgId: normalizedCallbackOrgId }
    } else if (notice) {
      setCallbackNotice(notice)
    }
    preferredOrgId.current = normalizedCallbackOrgId

    if (url.searchParams.has('fortnox') || url.searchParams.has('orgId')) {
      url.searchParams.delete('fortnox')
      url.searchParams.delete('orgId')
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`
      )
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError(null)

    void (async () => {
      try {
        const response = await fetch('/api/integrations/fortnox/status', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(
            await responseError(response, 'Fortnox-inställningarna kunde inte hämtas.')
          )
        }
        const parsed = parseSettings((await response.json()) as unknown)
        if (!parsed) throw new Error('Fortnox-inställningarna hade ett oväntat format.')
        if (controller.signal.aborted) return

        const pendingCallback = pendingConnectedCallback.current
        if (pendingCallback) {
          const confirmed = Boolean(
            pendingCallback.orgId &&
              parsed.organizations.some(
                (organization) =>
                  organization.id === pendingCallback.orgId &&
                  organization.connection?.status === 'connected'
              )
          )
          pendingConnectedCallback.current = null
          setCallbackNotice(
            confirmed ? CALLBACK_NOTICES.connected : UNVERIFIED_CONNECTED_NOTICE
          )
        }

        setSettings(parsed)
        setSelectedOrgId((current) => {
          const preferred = preferredOrgId.current
          if (preferred && parsed.organizations.some((organization) => organization.id === preferred)) {
            preferredOrgId.current = null
            return preferred
          }
          if (current && parsed.organizations.some((organization) => organization.id === current)) {
            return current
          }
          return (
            parsed.organizations.find((organization) => organization.isDefault)?.id ??
            parsed.organizations[0]?.id ??
            ''
          )
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setSettings(null)
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Fortnox-inställningarna kunde inte hämtas.'
        )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [reloadKey])

  const selectedOrganization = useMemo(
    () =>
      settings?.organizations.find((organization) => organization.id === selectedOrgId) ?? null,
    [selectedOrgId, settings]
  )

  useEffect(() => {
    selectedOrgIdRef.current = selectedOrgId
  }, [selectedOrgId])

  useEffect(() => {
    setOrganizationNumber(selectedOrganization?.organizationNumber ?? '')
  }, [selectedOrganization?.id, selectedOrganization?.organizationNumber])

  const organizationNumberIsValid =
    normalizeFortnoxOrganizationNumber(organizationNumber) === organizationNumber
  const organizationNumberIsDirty =
    Boolean(selectedOrganization) &&
    organizationNumber !== (selectedOrganization?.organizationNumber ?? '')
  const organizationNumberHasError =
    organizationNumberIsDirty && !organizationNumberIsValid

  async function saveOrganizationNumber() {
    if (!selectedOrganization || !organizationNumberIsValid || !selectedOrganization.canManage) return
    const targetOrgId = selectedOrganization.id
    const targetOrganizationNumber = organizationNumber
    setSaving(true)
    setActionNotice(null)

    try {
      const response = await fetch('/api/integrations/fortnox/organization-number', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: targetOrgId,
          organizationNumber: targetOrganizationNumber,
        }),
      })
      if (!response.ok) {
        throw new Error(await responseError(response, 'Organisationsnumret kunde inte sparas.'))
      }
      const payload = (await response.json()) as unknown
      if (
        !isRecord(payload) ||
        normalizeFortnoxOrganizationNumber(payload.organizationNumber) !==
          payload.organizationNumber
      ) {
        throw new Error('Servern returnerade ett oväntat svar.')
      }

      const savedNumber = String(payload.organizationNumber)
      setSettings((current) =>
        current
          ? {
              ...current,
              organizations: current.organizations.map((organization) =>
                organization.id === targetOrgId
                  ? { ...organization, organizationNumber: savedNumber }
                  : organization
              ),
            }
          : current
      )
      if (selectedOrgIdRef.current === targetOrgId) {
        setOrganizationNumber(savedNumber)
        setActionNotice({
          tone: 'success',
          message: 'Organisationens organisationsnummer har sparats.',
        })
      }
    } catch (error) {
      if (selectedOrgIdRef.current === targetOrgId) {
        setActionNotice({
          tone: 'error',
          message:
            error instanceof Error ? error.message : 'Organisationsnumret kunde inte sparas.',
        })
      }
    } finally {
      setSaving(false)
    }
  }

  async function verifyConnection() {
    if (!selectedOrganization?.connection || !selectedOrganization.canManage) return
    const targetOrgId = selectedOrganization.id
    setChecking(true)
    setActionNotice(null)

    try {
      const response = await fetch('/api/integrations/fortnox/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: targetOrgId }),
      })
      if (!response.ok) {
        throw new Error(
          await responseError(response, 'Fortnox-anslutningen kunde inte kontrolleras.')
        )
      }

      const payload = (await response.json()) as unknown
      const verifiedConnection =
        isRecord(payload) ? parseConnection(payload.connection) : undefined
      if (!verifiedConnection) throw new Error('Servern returnerade ett oväntat svar.')

      setSettings((current) =>
        current
          ? {
              ...current,
              organizations: current.organizations.map((organization) =>
                organization.id === targetOrgId
                  ? { ...organization, connection: verifiedConnection }
                  : organization
              ),
            }
          : current
      )
      if (selectedOrgIdRef.current === targetOrgId) {
        setActionNotice({
          tone: 'success',
          message: 'Fortnox-anslutningen har verifierats.',
        })
      }
    } catch (error) {
      if (selectedOrgIdRef.current === targetOrgId) {
        setActionNotice({
          tone: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Fortnox-anslutningen kunde inte kontrolleras.',
        })
      }
      setReloadKey((value) => value + 1)
    } finally {
      setChecking(false)
    }
  }

  const connection = selectedOrganization?.connection ?? null
  const canSubmitConnection = Boolean(
      settings?.configured &&
      selectedOrganization?.canManage &&
      selectedOrganization.organizationNumber &&
      organizationNumberIsValid &&
      !organizationNumberIsDirty &&
      !saving &&
      !checking &&
      !externalNavigationBlocked &&
      !leaving
  )

  return (
    <section
      className="rounded-2xl border border-white/30 bg-white/90 p-5 shadow-sm backdrop-blur-sm"
      aria-labelledby="fortnox-settings-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
            Integration
          </p>
          <h2 id="fortnox-settings-heading" className="mt-1 text-lg font-semibold text-gray-900">
            Fortnox
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
            Anslut organisationens Fortnox-företag. HusHub sparar företagsidentiteten, men inga
            Fortnox-token eller andra hemligheter.
          </p>
        </div>
        <span aria-live="polite" role="status">
        {loading ? (
          <span
            className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
          >
            Hämtar…
          </span>
        ) : loadError || !selectedOrganization ? (
          <span
            className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"
          >
            Status okänd
          </span>
        ) : connection ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              connection.status === 'connected'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {connection.status === 'connected' ? 'Ansluten' : 'Behöver återanslutas'}
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
            Inte ansluten
          </span>
        )}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {callbackNotice ? <NoticeBox notice={callbackNotice} /> : null}
        {actionNotice ? <NoticeBox notice={actionNotice} /> : null}

        {loading ? (
          <p className="text-sm text-gray-600" role="status">
            Hämtar Fortnox-status…
          </p>
        ) : null}

        {!loading && loadError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="mt-2 font-semibold underline underline-offset-2"
            >
              Försök igen
            </button>
          </div>
        ) : null}

        {!loading && settings && settings.organizations.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Du saknar ett aktivt organisationsmedlemskap. Kontakta en administratör.
          </p>
        ) : null}

        {!loading && settings && selectedOrganization ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="block text-sm font-medium text-gray-800">
                {settings.organizations.length > 1 ? (
                  <label>
                    Organisation
                  <select
                    value={selectedOrgId}
                    disabled={saving || checking || leaving}
                    onChange={(event) => {
                      selectedOrgIdRef.current = event.target.value
                      setSelectedOrgId(event.target.value)
                      setActionNotice(null)
                      setCallbackNotice(null)
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600"
                  >
                    {settings.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                        {organization.isDefault ? ' (standard)' : ''}
                      </option>
                    ))}
                  </select>
                  </label>
                ) : (
                  <>
                    <span>Organisation</span>
                    <span className="mt-1 block rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-normal text-gray-900">
                      {selectedOrganization.name}
                    </span>
                  </>
                )}
              </div>

              <div>
                <label htmlFor="fortnox-organization-number" className="block text-sm font-medium text-gray-800">
                  Organisationens organisationsnummer
                </label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="fortnox-organization-number"
                    value={organizationNumber}
                    onChange={(event) => setOrganizationNumber(formatOrganizationNumber(event.target.value))}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={11}
                    placeholder="XXXXXX-XXXX"
                    readOnly={!selectedOrganization.canManage || Boolean(connection)}
                    disabled={saving || checking || leaving}
                    aria-invalid={organizationNumberHasError}
                    aria-describedby={
                      organizationNumberHasError
                        ? 'fortnox-organization-number-help fortnox-organization-number-error'
                        : 'fortnox-organization-number-help'
                    }
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 read-only:cursor-default read-only:bg-gray-100 read-only:text-gray-600 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600"
                  />
                  {!connection && selectedOrganization.canManage ? (
                    <button
                      type="button"
                      onClick={() => void saveOrganizationNumber()}
                      disabled={
                        !organizationNumberIsValid ||
                        !organizationNumberIsDirty ||
                        saving ||
                        checking ||
                        leaving
                      }
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      {saving ? 'Sparar…' : 'Spara org.nr'}
                    </button>
                  ) : null}
                </div>
                <p id="fortnox-organization-number-help" className="mt-1 text-xs leading-5 text-gray-500">
                  Detta är organisationens juridiska identitet och är separat från profiluppgifterna ovan.
                  {connection ? ' Numret är låst till det verifierade Fortnox-företaget.' : ''}
                </p>
                {organizationNumberHasError ? (
                  <p
                    id="fortnox-organization-number-error"
                    className="mt-1 text-xs text-rose-700"
                  >
                    Ange ett giltigt organisationsnummer i formatet XXXXXX-XXXX.
                  </p>
                ) : null}
              </div>
            </div>

            {connection ? (
              <div
                className={`rounded-xl border p-4 ${
                  connection.status === 'connected'
                    ? 'border-emerald-200 bg-emerald-50/70'
                    : 'border-amber-200 bg-amber-50/70'
                }`}
              >
                <p
                  className={`font-semibold ${
                    connection.status === 'connected' ? 'text-emerald-950' : 'text-amber-950'
                  }`}
                >
                  {connection.status === 'connected'
                    ? `Fortnox anslutet – ${connection.companyName}`
                    : `Fortnox behöver återanslutas – ${connection.companyName}`}
                </p>
                <dl
                  className={`mt-3 grid gap-2 text-sm sm:grid-cols-2 ${
                    connection.status === 'connected' ? 'text-emerald-950' : 'text-amber-950'
                  }`}
                >
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Org.nr</dt>
                    <dd>{connection.organizationNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Senast verifierad</dt>
                    <dd>{formatVerifiedAt(connection.lastVerifiedAt)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Behörighet</dt>
                    <dd>{connection.grantedScopes.map(scopeLabel).join(', ')}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-700">
                Ingen Fortnox-anslutning finns för {selectedOrganization.name}.
              </p>
            )}

            {!settings.configured ? (
              <p className="text-sm text-amber-800">
                Serverns Fortnox-konfiguration saknas. En systemadministratör måste lägga in Client ID och
                Client Secret innan anslutningen kan startas.
              </p>
            ) : null}
            {!selectedOrganization.canManage ? (
              <p className="text-sm text-gray-600">
                Du kan se statusen, men endast en organisationsadministratör kan ändra anslutningen.
              </p>
            ) : null}
            {selectedOrganization.canManage && !selectedOrganization.organizationNumber ? (
              <p className="text-sm text-amber-800">
                Spara organisationens organisationsnummer innan du ansluter Fortnox.
              </p>
            ) : null}
            {organizationNumberIsDirty ? (
              <p className="text-sm text-amber-800">
                Spara organisationsnumret innan du fortsätter till Fortnox.
              </p>
            ) : null}
            {externalNavigationBlocked ? (
              <p className="text-sm text-amber-800">
                Vänta tills andra ändringar på sidan har sparats innan du fortsätter till Fortnox.
              </p>
            ) : null}

            {selectedOrganization.canManage ? (
              <div className="flex flex-wrap gap-2">
                {connection ? (
                  <button
                    type="button"
                    onClick={() => void verifyConnection()}
                    disabled={!settings.configured || saving || checking || leaving}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    {checking ? 'Kontrollerar…' : 'Kontrollera anslutning'}
                  </button>
                ) : null}
                <form
                  method="post"
                  action="/api/integrations/fortnox/connect"
                  onSubmit={() => setLeaving(true)}
                >
                  <input type="hidden" name="orgId" value={selectedOrganization.id} />
                  <button
                    type="submit"
                    disabled={!canSubmitConnection}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-200"
                  >
                    {leaving
                      ? 'Öppnar Fortnox…'
                      : externalNavigationBlocked
                        ? 'Väntar på sparning…'
                      : connection
                        ? 'Återanslut Fortnox'
                        : 'Anslut Fortnox'}
                  </button>
                </form>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}
