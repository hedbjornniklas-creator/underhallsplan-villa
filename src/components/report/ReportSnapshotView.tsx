import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { ReportSnapshotPayloadV1 } from '@/lib/report/pdfV2/renderStructuredPdfV2'
import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { loadAppendixText } from '@/lib/report/loadAppendixText'
import {
  defaultCoverIllustrationSrc,
  footerImageSrc,
  hushubLogoSrc,
  sbrLogoSrc,
} from '@/lib/report/reportAssets'

type SnapshotInspectionBlock = {
  title?: string | null
  noteText?: string | null
  riskText?: string | null
  ftuText?: string | null
  photoUrls?: string[] | null
  hasDeviations?: boolean | null
}

type SnapshotIconName = 'note' | 'risk' | 'ftu'

function SnapshotIcon({ name }: { name: SnapshotIconName }) {
  const baseStyle: CSSProperties = {
    width: '13px',
    height: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 13px',
    position: 'relative',
    marginTop: '2px',
  }

  if (name === 'note') {
    return (
      <span style={baseStyle} aria-hidden="true">
        <span
          style={{
            width: '11px',
            height: '12px',
            border: '1.5px solid #5b9bd5',
            borderRadius: '2px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '2px',
            padding: '2px',
          }}
        >
          <span style={{ height: '1px', backgroundColor: '#5b9bd5' }} />
          <span style={{ height: '1px', backgroundColor: '#5b9bd5' }} />
          <span style={{ height: '1px', width: '70%', backgroundColor: '#5b9bd5' }} />
        </span>
      </span>
    )
  }

  if (name === 'risk') {
    return (
      <span
        style={{
          ...baseStyle,
          borderRadius: '999px',
          border: '1.5px solid #b45309',
          color: '#b45309',
          fontSize: '10px',
          fontWeight: 700,
          lineHeight: 1,
        }}
        aria-hidden="true"
      >
        !
      </span>
    )
  }

  return (
    <span style={baseStyle} aria-hidden="true">
      <span
        style={{
          width: '8px',
          height: '8px',
          border: '1.7px solid #374151',
          borderRadius: '999px',
          position: 'absolute',
          left: '1px',
          top: '1px',
        }}
      />
      <span
        style={{
          width: '6px',
          height: '1.7px',
          backgroundColor: '#374151',
          position: 'absolute',
          right: '0px',
          bottom: '1px',
          transform: 'rotate(45deg)',
          transformOrigin: 'center',
          borderRadius: '999px',
        }}
      />
    </span>
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => entry as Record<string, unknown>)
}

type ReportSnapshotViewProps = {
  snapshot: ReportSnapshotPayloadV1
  heading?: string
  subtitle?: string
  pdfInlineUrl?: string | null
  pdfDownloadUrl?: string | null
  pdfStatus?: 'pending' | 'processing' | 'ready' | 'failed' | null
  pdfError?: string | null
  showPdfActions?: boolean
  showHeader?: boolean
}

function repairMojibake(value: string) {
  return String(value ?? '')
    .replace(/\u00c3\u0192\u00c2\u00a4/g, '\u00e4')
    .replace(/\u00c3\u0192\u00c2\u00a5/g, '\u00e5')
    .replace(/\u00c3\u0192\u00c2\u00b6/g, '\u00f6')
    .replace(/\u00c3\u0192\u00e2\u20ac\u017e/g, '\u00c4')
    .replace(/\u00c3\u0192\u00e2\u20ac\u00a6/g, '\u00c5')
    .replace(/\u00c3\u0192\u00e2\u20ac\u201c/g, '\u00d6')
    .replace(/\u00c3\u0192\u00c2\u00a9/g, '\u00e9')
    .replace(/\u00c3\u0192\u00e2\u20ac\u00b0/g, '\u00c9')
    .replace(/\u00c3\u00a4/g, '\u00e4')
    .replace(/\u00c3\u00a5/g, '\u00e5')
    .replace(/\u00c3\u00b6/g, '\u00f6')
    .replace(/\u00c3\u201e/g, '\u00c4')
    .replace(/\u00c3\u2026/g, '\u00c5')
    .replace(/\u00c3\u2013/g, '\u00d6')
    .replace(/\u00c3\u00a9/g, '\u00e9')
    .replace(/\u00c3\u2030/g, '\u00c9')
}

function toText(value: unknown, fallback = '--') {
  if (value === null || value === undefined) return fallback
  const normalized = repairMojibake(String(value)).trim()
  return normalized === '' ? fallback : normalized
}

function getByPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return null
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function getTextByPath(root: Record<string, unknown>, path: string, fallback = '--') {
  return toText(getByPath(root, path), fallback)
}

function getBlockArrayByPath(root: Record<string, unknown>, path: string) {
  const value = getByPath(root, path)
  if (!Array.isArray(value)) return [] as SnapshotInspectionBlock[]
  return value as SnapshotInspectionBlock[]
}

function getListByPath(root: Record<string, unknown>, path: string) {
  const value = getByPath(root, path)
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((entry) => repairMojibake(entry).trim())
      .filter(Boolean)
  }
  return [] as string[]
}

function formatSnapshotTimestamp(value: string | null | undefined) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function renderBlocks(items: SnapshotInspectionBlock[]) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-600">Inga noteringar.</p>
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const title = toText(item.title, 'Del')
        const note = toText(item.noteText, '--')
        const risk = toText(item.riskText, '')
        const ftu = toText(item.ftuText, '')
        const photos = Array.isArray(item.photoUrls) ? item.photoUrls.filter(Boolean) : []
        return (
          <article
            key={`${title}-${index}`}
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 flex items-start gap-2 whitespace-pre-wrap text-sm text-gray-700">
              <SnapshotIcon name="note" />
              <span>{note}</span>
            </p>
            {risk ? (
              <p className="mt-2 flex items-start gap-2 whitespace-pre-wrap text-xs text-rose-800">
                <SnapshotIcon name="risk" />
                <span>
                  <span className="font-semibold">Risk:</span> {risk}
                </span>
              </p>
            ) : null}
            {ftu ? (
              <p className="mt-1 flex items-start gap-2 whitespace-pre-wrap text-xs text-amber-800">
                <SnapshotIcon name="ftu" />
                <span>
                  <span className="font-semibold">FTU:</span> {ftu}
                </span>
              </p>
            ) : null}
            {photos.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {photos.map((photoUrl, photoIndex) => (
                  <img
                    key={`${title}-${index}-photo-${photoIndex}`}
                    src={photoUrl}
                    alt={`Foto ${photoIndex + 1}`}
                    className="h-36 w-full rounded-md border border-gray-200 object-cover"
                  />
                ))}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function filterApartmentBuildingData(raw: string) {
  const text = raw.trim()
  if (!text || text === '--') return ''

  const keepPrefixes = ['väderlek:', 'byggnadsår:', 'ombyggnadsår:']
  const keptLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => keepPrefixes.some((prefix) => line.toLowerCase().startsWith(prefix)))

  if (!keptLines.some((line) => line.toLowerCase().startsWith('ombyggnadsår:'))) {
    keptLines.push('Ombyggnadsår: --')
  }

  return keptLines.join('\n')
}

function normalizeInspectionSide(
  value: ReportSnapshotPayloadV1['inspectionSide']
): 'buyer' | 'seller' | 'apartment' {
  if (value === 'seller') return 'seller'
  if (value === 'apartment') return 'apartment'
  return 'buyer'
}

function interpolateAssignmentNotice(text: string, assignmentDate: string) {
  return repairMojibake(text)
    .replace(/ÅÅÅÅ-MM-DD/g, assignmentDate)
    .replace(/\{\{\s*assignment_confirmation_date\s*\}\}/g, assignmentDate)
}

function resolveAppendix1Id(inspectionSide: 'buyer' | 'seller' | 'apartment') {
  if (inspectionSide === 'seller') return 'APPENDIX_1_VILLKOR_SELLER_SBR'
  if (inspectionSide === 'apartment') return 'APPENDIX_1_VILLKOR_APARTMENT_SBR'
  return 'APPENDIX_1_VILLKOR_BUYER_SBR'
}

function toImageUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '--') return null
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
    return trimmed
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base}/storage/v1/object/public/inspection-images/${trimmed}`
}

export default function ReportSnapshotView(props: ReportSnapshotViewProps) {
  const inspectionSide = normalizeInspectionSide(props.snapshot.inspectionSide)
  const isApartment = inspectionSide === 'apartment'
  const heading =
    props.heading ?? (isApartment ? 'Lägenhetsbesiktning' : 'Besiktningsutlåtande')
  const subtitle =
    props.subtitle ?? `Låst och publicerat: ${formatSnapshotTimestamp(props.snapshot.createdAt)}`
  const showHeader = props.showHeader !== false
  const showActions =
    props.showPdfActions !== false &&
    Boolean(props.pdfDownloadUrl)
  const showPendingPdfNotice =
    props.showPdfActions !== false &&
    !showActions &&
    (props.pdfStatus === 'pending' || props.pdfStatus === 'processing')
  const showFailedPdfNotice =
    props.showPdfActions !== false &&
    !showActions &&
    props.pdfStatus === 'failed'

  const mock = (props.snapshot.reportData?.mock ?? {}) as Record<string, unknown>
  const exteriorBlocks = getBlockArrayByPath(mock, 'exterior.blocks')
  const interiorBlocks = getBlockArrayByPath(mock, 'interior.blocks')
  const buildingDataTextRaw = getTextByPath(mock, 'buildingData.text', '')
  const buildingDataText = isApartment
    ? filterApartmentBuildingData(buildingDataTextRaw)
    : buildingDataTextRaw
  const attendeesText = getTextByPath(mock, 'inspections.attendees_text', '--')
  const assignmentConfirmationText = getTextByPath(
    mock,
    'inspections.assignment_confirmation_text',
    '--'
  )

  const providedDocuments = getListByPath(mock, 'documents.provided')
  const disclosureInfo = getTextByPath(mock, 'disclosures.acquisition_text', '--')
  const renovations = getListByPath(mock, 'disclosures.renovations')
  const faults = getListByPath(mock, 'disclosures.property_faults')

  const assignmentDate = getTextByPath(mock, 'inspections.assignment_confirmation_date', '--')
  const assignmentNoticeId =
    inspectionSide === 'seller'
      ? 'STD_ASSIGNMENT_SELLER_NOTICE'
      : inspectionSide === 'apartment'
        ? 'STD_ASSIGNMENT_APARTMENT_NOTICE'
        : 'STD_ASSIGNMENT_BUYER_NOTICE'
  const assignmentNoticeText = interpolateAssignmentNotice(
    loadStandardText(assignmentNoticeId),
    assignmentDate
  )

  const visualConditionsText = loadStandardText('STD_VISUAL_INSPECTION_CONDITIONS')
  const visualOralText = loadStandardText('STD_VISUAL_INSPECTION_ORAL')
  const appendix1Text = loadAppendixText(resolveAppendix1Id(inspectionSide))
  const appendix2Text = loadAppendixText('APPENDIX_2_LITEN_BYGGORDBOK_SBR')
  const appendix3Text = loadAppendixText('APPENDIX_3_LIFESPAN_TABLE_SBR')
  const appendices = asRecord(mock.appendices)
  const areaMeasurementAppendix = asRecord(appendices.area_measurement)
  const moistureControlAppendix = asRecord(appendices.moisture_control)
  const areaMeasurementEnabled = areaMeasurementAppendix.enabled === true
  const moistureControlEnabled = moistureControlAppendix.enabled === true
  const areaMeasurementNumber = areaMeasurementEnabled ? 4 : null
  const moistureControlNumber = moistureControlEnabled
    ? areaMeasurementEnabled
      ? 5
      : 4
    : null
  const areaObject = asRecord(areaMeasurementAppendix.object)
  const areaMeasurement = asRecord(areaMeasurementAppendix.measurement)
  const areaSummary = asRecord(areaMeasurementAppendix.summary)
  const areaSigning = asRecord(areaMeasurementAppendix.signing)
  const areaRows = asRecordArray(areaMeasurementAppendix.rows)
  const moistureObject = asRecord(moistureControlAppendix.object)
  const moistureMeasurement = asRecord(moistureControlAppendix.measurement)
  const moistureSigning = asRecord(moistureControlAppendix.signing)
  const moistureRows = asRecordArray(moistureControlAppendix.rows)
  const companyLogoUrl = toImageUrl(getTextByPath(mock, 'company.logo_url', ''))
  const coverImageUrl =
    toImageUrl(getTextByPath(mock, 'properties.cover_path', '')) ?? defaultCoverIllustrationSrc

  const companyAddress = [
    getTextByPath(mock, 'profile.company_address', ''),
    getTextByPath(mock, 'profile.company_postal_code', ''),
    getTextByPath(mock, 'profile.company_city', ''),
  ]
    .filter((part) => part && part !== '--')
    .join(' ')

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-4">
        {showHeader ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr_auto] md:items-center">
              <div className="flex items-center gap-2 justify-self-start">
                <img
                  src={hushubLogoSrc}
                  alt="HusHub-logotyp"
                  className="h-10 w-auto object-contain"
                />
                <span className="text-2xl font-semibold tracking-tight text-slate-900">HusHub</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {companyLogoUrl ? (
                  <img
                    src={companyLogoUrl}
                    alt="Besiktningsmannens logotyp"
                    className="h-10 w-10 rounded-md border border-slate-200 bg-white object-contain"
                  />
                ) : null}
                <div className="text-center">
                  <h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
                  <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
                </div>
                <img
                  src={sbrLogoSrc}
                  alt="SBR-logotyp"
                  className="h-10 w-auto rounded-md border border-slate-200 bg-white p-1"
                />
              </div>
              <div className="flex flex-wrap gap-2 md:justify-self-end">
                {showActions ? (
                  <Link
                    href={props.pdfDownloadUrl as string}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    Ladda ner PDF
                  </Link>
                ) : null}
                {showPendingPdfNotice ? (
                  <p className="max-w-xs text-right text-xs text-amber-700">
                    PDF genereras fortfarande i bakgrunden.
                  </p>
                ) : null}
                {showFailedPdfNotice ? (
                  <p className="max-w-xs text-right text-xs text-rose-700">
                    PDF-generering misslyckades
                    {props.pdfError ? `: ${props.pdfError}` : '.'}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <img
            src={coverImageUrl}
            alt="Omslagsbild"
            className="h-56 w-full bg-slate-100 object-contain sm:h-64"
          />
          {isApartment ? (
            <div className="grid gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-700 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Bostadsrättsförening
                </div>
                <div>{getTextByPath(mock, 'properties.brf_name')}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Lägenhetsnummer
                </div>
                <div>{getTextByPath(mock, 'properties.apartment_number')}</div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid items-start gap-4 lg:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Objekt</h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-700">
              {isApartment ? (
                <>
                  <div>
                    <dt className="text-xs text-slate-500">Bostadsrättsförening</dt>
                    <dd>{getTextByPath(mock, 'properties.brf_name')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Lägenhetsnummer</dt>
                    <dd>{getTextByPath(mock, 'properties.apartment_number')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Bostadsrättsinnehavare</dt>
                    <dd>{getTextByPath(mock, 'properties.apartment_holder_name')}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt className="text-xs text-slate-500">Fastighetsbeteckning</dt>
                    <dd>{getTextByPath(mock, 'properties.cadastral_id')}</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="text-xs text-slate-500">Adress</dt>
                <dd>{getTextByPath(mock, 'properties.address')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Kommun</dt>
                <dd>{getTextByPath(mock, 'properties.municipality')}</dd>
              </div>
              {!isApartment ? (
                <div>
                  <dt className="text-xs text-slate-500">Fastighetsägare</dt>
                  <dd>{getTextByPath(mock, 'properties.owner_name')}</dd>
                </div>
              ) : null}
            </dl>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Uppdragsgivare
            </h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-700">
              <div>
                <dt className="text-xs text-slate-500">Namn</dt>
                <dd>{getTextByPath(mock, 'inspections.client_name')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Uppdragsnummer</dt>
                <dd>{getTextByPath(mock, 'inspections.assignment_number')}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Besiktningsman
            </h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-700">
              <div>
                <dt className="text-xs text-slate-500">Namn</dt>
                <dd className="whitespace-pre-line">
                  {[
                    getTextByPath(mock, 'profile.full_name'),
                    getTextByPath(mock, 'profile.sbr_group', ''),
                    getTextByPath(mock, 'profile.sbr_status', ''),
                  ]
                    .filter((line) => line && line !== '--')
                    .join('\n')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Certifieringsnummer</dt>
                <dd>--</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Telefon</dt>
                <dd>{getTextByPath(mock, 'profile.phone')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">E-post</dt>
                <dd>{getTextByPath(mock, 'profile.email')}</dd>
              </div>
            </dl>
            <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
              Besiktningsmannen är medlem i Svenska Byggingenjörers Riksförbund (SBR) och är registrerad i SBR:s förteckning över besiktningsmän med därtill hörande förpliktelser.
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Besiktningsuppdrag
            </h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-700">
              <div>
                <dt className="text-xs text-slate-500">Omfattning</dt>
                <dd className="whitespace-pre-wrap">{getTextByPath(mock, 'inspections.scope_text')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Besiktningsdag</dt>
                <dd>{getTextByPath(mock, 'inspections.date_time')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Närvarande</dt>
                <dd className="whitespace-pre-wrap">{attendeesText}</dd>
              </div>
            </dl>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{assignmentNoticeText}</p>
          </article>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Handlingar och upplysningar
          </h2>

          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <article>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Tillhandahållna handlingar
              </h3>
              {providedDocuments.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {providedDocuments.map((line, idx) => (
                    <li key={`provided-${idx}`}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">--</p>
              )}
            </article>

            <article className="lg:col-span-2">
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Information från uppdragsgivare, fastighetsägare eller ombud
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                Under denna rubrik är samtliga uppgifter lämnade av fastighetsägare eller dess ombud. Uppgifterna är inte kontrollerade av besiktningsmannen.
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{disclosureInfo}</p>

              {renovations.length > 0 ? (
                <>
                  <p className="mt-2 text-sm font-medium text-slate-800">
                    Följande renoveringar och underhåll är utförda:
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {renovations.map((line, idx) => (
                      <li key={`renovation-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase text-slate-500">
              Upplysningar om fel i fastigheten
            </h3>
            {faults.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {faults.map((line, idx) => (
                  <li key={`fault-${idx}`}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-600">--</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Okulär besiktning
          </h2>
          <div className="mt-2 space-y-3 text-sm text-slate-700">
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Särskilda förutsättningar vid besiktningen
              </h3>
              <p className="mt-1 whitespace-pre-wrap">{visualConditionsText}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Muntliga uppgifter</h3>
              <p className="mt-1 whitespace-pre-wrap">{visualOralText}</p>
            </div>
          </div>
        </section>

        {buildingDataText ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Förutsättningar
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{buildingDataText}</p>
          </section>
        ) : null}

        {!isApartment ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Noteringar - byggnad utsida
            </h2>
            <div className="mt-3">{renderBlocks(exteriorBlocks)}</div>
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            {isApartment ? 'Noteringar - lägenhet insida' : 'Noteringar - byggnad insida'}
          </h2>
          <div className="mt-3">{renderBlocks(interiorBlocks)}</div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Bilagor</h2>
          <div className="mt-3 space-y-3">
            <details className="rounded-md border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                Bilaga 1 - Villkor
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{appendix1Text}</p>
            </details>
            <details className="rounded-md border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                Bilaga 2 - Begreppsförklaringar
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{appendix2Text}</p>
            </details>
            <details className="rounded-md border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                Bilaga 3 - Tekniska medellivslängder
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{appendix3Text}</p>
            </details>
            {areaMeasurementNumber ? (
              <details className="rounded-md border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                  Bilaga {areaMeasurementNumber} - Areamätning av boarea
                </summary>
                <div className="mt-3 space-y-3 text-sm text-slate-700">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Uppdragsnummer</div>
                      <div>{toText(areaObject.assignment_number)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Adress</div>
                      <div>{toText(areaObject.address)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Byggnadstyp</div>
                      <div>{toText(areaObject.building_type)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Byggår</div>
                      <div>{toText(areaObject.building_year)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Mätinstrument</div>
                    <div>{toText(areaMeasurement.instrument)}</div>
                  </div>
                  {areaRows.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="py-1 pr-2 font-semibold">Våning/byggdel</th>
                            <th className="py-1 pr-2 font-semibold">Boarea</th>
                            <th className="py-1 font-semibold">Biarea</th>
                          </tr>
                        </thead>
                        <tbody>
                          {areaRows.map((row, index) => (
                            <tr key={`area-row-${index}`} className="border-b border-slate-100 align-top">
                              <td className="py-1 pr-2">{toText(row.floor_or_part)}</td>
                              <td className="py-1 pr-2">{toText(row.boarea_display)}</td>
                              <td className="py-1">{toText(row.biarea_display)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">BOAREA</div>
                      <div>{toText(areaSummary.boarea_total)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">BIAREA</div>
                      <div>{toText(areaSummary.biarea_total)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Kommentar</div>
                    <div className="whitespace-pre-wrap">{toText(areaMeasurement.comment)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Övrigt</div>
                    <div className="whitespace-pre-wrap">{toText(areaMeasurement.other_notes)}</div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Ort, datum</div>
                      <div>{toText(areaSigning.place_date)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Besiktningsbolag</div>
                      <div>{toText(areaSigning.company_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Namn och efternamn</div>
                      <div>{toText(areaSigning.inspector_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Behörighet</div>
                      <div className="whitespace-pre-wrap">
                        {toText(areaSigning.secondary_qualification)}
                        {toText(areaSigning.membership_line, '') ? `\n${toText(areaSigning.membership_line, '')}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            ) : null}
            {moistureControlNumber ? (
              <details className="rounded-md border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                  Bilaga {moistureControlNumber} - Fuktkontroll av riskkonstruktion
                </summary>
                <div className="mt-3 space-y-3 text-sm text-slate-700">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Uppdragsnummer</div>
                      <div>{toText(moistureObject.assignment_number)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Adress</div>
                      <div>{toText(moistureObject.address)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Byggnadstyp</div>
                      <div>{toText(moistureObject.building_type)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Byggår</div>
                      <div>{toText(moistureObject.building_year)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Uppvärmning</div>
                      <div>{toText(moistureObject.heating)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Ventilation</div>
                      <div>{toText(moistureObject.ventilation)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Mätinstrument</div>
                    <div>{toText(moistureMeasurement.instrument)}</div>
                  </div>
                  {moistureRows.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="py-1 pr-2 font-semibold">Kontrollplats</th>
                            <th className="py-1 pr-2 font-semibold">Resultat</th>
                            <th className="py-1 font-semibold">Kritisk nivå</th>
                          </tr>
                        </thead>
                        <tbody>
                          {moistureRows.map((row, index) => (
                            <tr key={`moisture-row-${index}`} className="border-b border-slate-100 align-top">
                              <td className="py-1 pr-2 whitespace-pre-wrap">{toText(row.location_display)}</td>
                              <td className="py-1 pr-2 whitespace-pre-wrap">{toText(row.result_display)}</td>
                              <td className="py-1">{toText(row.critical_display)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Kommentar</div>
                    <div className="whitespace-pre-wrap">{toText(moistureMeasurement.comment)}</div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Ort, datum</div>
                      <div>{toText(moistureSigning.place_date)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Besiktningsbolag</div>
                      <div>{toText(moistureSigning.company_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Namn och efternamn</div>
                      <div>{toText(moistureSigning.inspector_name)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Behörighet</div>
                      <div className="whitespace-pre-wrap">
                        {toText(moistureSigning.secondary_qualification)}
                        {toText(moistureSigning.membership_line, '') ? `\n${toText(moistureSigning.membership_line, '')}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <img src={footerImageSrc} alt="Sidfot" className="h-14 w-full object-cover" />
        </section>
      </div>
    </main>
  )
}
