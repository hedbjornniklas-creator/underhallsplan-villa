import { defaultCoverIllustrationSrc, sbrLogoSrc } from '@/lib/report/reportAssets'
import {
  ACCENT_COLOR,
  REPORT_STYLES,
  SBR_LOGO_HEIGHT_MM,
  SBR_LOGO_WIDTH_MM,
  mmToPx,
} from '@/lib/report/reportTokens'

type ReportCoverPageProps = {
  companyLogoUrl?: string | null
  cadastralId?: string
  address?: string
  inspectionDate?: string
  assignmentNumber?: string
  coverIllustrationUrl?: string | null
  coverNotice?: string
}

export default function ReportCoverPage({
  companyLogoUrl,
  cadastralId,
  address,
  inspectionDate,
  assignmentNumber,
  coverIllustrationUrl,
  coverNotice = '',
}: ReportCoverPageProps) {
  const coverSrc = coverIllustrationUrl || defaultCoverIllustrationSrc

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: mmToPx(8),
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: mmToPx(2) }}>
          <img
            src={sbrLogoSrc}
            alt="SBR logotyp"
            style={{
              width: mmToPx(SBR_LOGO_WIDTH_MM),
              height: mmToPx(SBR_LOGO_HEIGHT_MM),
              objectFit: 'contain',
            }}
          />
          <div style={{ fontSize: '12pt', color: '#334155' }}>
            Besiktningsdag: {inspectionDate ?? 'saknas'}
          </div>
        </div>
        {companyLogoUrl ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              width: mmToPx(SBR_LOGO_WIDTH_MM),
              marginLeft: 'auto',
            }}
          >
            <img
              src={companyLogoUrl}
              alt="Företagslogga"
              style={{
                width: mmToPx(SBR_LOGO_WIDTH_MM),
                height: mmToPx(SBR_LOGO_HEIGHT_MM),
                objectFit: 'contain',
              }}
            />
            <div style={{ fontSize: '12pt', color: '#334155', marginTop: mmToPx(1) }}>
              UN: {assignmentNumber ?? 'saknas'}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              width: mmToPx(SBR_LOGO_WIDTH_MM),
              marginLeft: 'auto',
            }}
          >
            <div
              style={{
                width: mmToPx(SBR_LOGO_WIDTH_MM),
                height: mmToPx(SBR_LOGO_HEIGHT_MM),
                border: '1px dashed #94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: REPORT_STYLES.SMALL.fontSize,
                color: '#64748b',
              }}
            >
              Företagslogga
            </div>
            <div style={{ fontSize: '12pt', color: '#334155', marginTop: mmToPx(1) }}>
              UN: {assignmentNumber ?? 'saknas'}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: mmToPx(6) }}>
        <div style={{ fontSize: '18pt', color: ACCENT_COLOR }}>
          Utlåtande över
        </div>
        <div
          style={{
            fontSize: '18pt',
            fontWeight: REPORT_STYLES.H1.fontWeight,
            color: ACCENT_COLOR,
            textTransform: 'uppercase',
            marginTop: mmToPx(2),
          }}
        >
          ÖVERLÅTELSEBESIKTNING
        </div>
        <div
          style={{
            height: mmToPx(1.5),
            backgroundColor: ACCENT_COLOR,
            marginTop: mmToPx(3),
          }}
        />
      </div>

      <div style={{ marginTop: mmToPx(6), marginBottom: mmToPx(6), fontSize: '16pt' }}>
        <div style={{ marginBottom: mmToPx(2) }}>
          <strong>Fastighetsbeteckning:</strong> {cadastralId ?? 'saknas'}
        </div>
        <div>
          <strong>Adress:</strong> {address ?? 'saknas'}
        </div>
      </div>

      <div
        style={{
          marginTop: mmToPx(8),
          marginBottom: mmToPx(6),
          height: mmToPx(110),
          border: '1px solid #cbd5e1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
        }}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt="Omslagsillustration"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <div style={{ color: '#64748b' }}>Omslagsillustration</div>
        )}
      </div>
      <div
        style={{
          textAlign: 'center',
          fontSize: '11pt',
          whiteSpace: 'pre-wrap',
          color: '#000000',
        }}
      >
        {coverNotice}
      </div>
    </div>
  )
}

