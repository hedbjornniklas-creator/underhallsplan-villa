import type { ReactNode } from 'react'
import { footerImageSrc } from '@/lib/report/reportAssets'
import {
  FONT_FAMILY,
  LINE_HEIGHT,
  FOOTER_MARK_HEIGHT_MM,
  FOOTER_MARK_WIDTH_MM,
  PAGE_HEIGHT_MM,
  PAGE_PADDING_MM,
  PAGE_WIDTH_MM,
  TEXT_COLOR,
  mmToPx,
} from '@/lib/report/reportTokens'

type ReportPageProps = {
  children: ReactNode
  header?: ReactNode
  footerNote?: ReactNode
  pageNumber?: number
  footerLeftLines?: string[]
  footerRightLines?: string[]
  footerCenterLines?: string[]
}

export default function ReportPage({
  children,
  header,
  footerNote,
  pageNumber,
  footerLeftLines = [],
  footerRightLines = [],
  footerCenterLines = [],
}: ReportPageProps) {
  const footerInfoHeightMm = 12
  const footerInfoGapMm = 4
  const hasFooterInfo = footerLeftLines.length > 0 || footerRightLines.length > 0
  const footerInfoHeight = hasFooterInfo
    ? footerInfoHeightMm + footerInfoGapMm
    : 0
  return (
    <div
      style={{
        width: mmToPx(PAGE_WIDTH_MM),
        minHeight: mmToPx(PAGE_HEIGHT_MM),
        backgroundColor: '#ffffff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        border: '1px solid #e2e8f0',
        margin: `${mmToPx(6)} auto`,
        paddingTop: mmToPx(PAGE_PADDING_MM.top),
        paddingRight: mmToPx(PAGE_PADDING_MM.right),
        paddingBottom: mmToPx(
          PAGE_PADDING_MM.bottom + FOOTER_MARK_HEIGHT_MM + footerInfoHeight
        ),
        paddingLeft: mmToPx(PAGE_PADDING_MM.left),
        fontFamily: FONT_FAMILY,
        color: TEXT_COLOR,
        lineHeight: LINE_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {header && (
        <div
          style={{
            marginTop: mmToPx(-PAGE_PADDING_MM.top / 2),
            marginBottom: mmToPx(6),
          }}
        >
          {header}
        </div>
      )}

      <div style={{ flex: 1 }}>{children}</div>

      {hasFooterInfo && (
        <div
          style={{
            position: 'absolute',
            left: mmToPx(PAGE_PADDING_MM.left),
            right: mmToPx(PAGE_PADDING_MM.right),
            bottom: mmToPx(FOOTER_MARK_HEIGHT_MM + footerInfoGapMm),
            height: mmToPx(footerInfoHeightMm),
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11pt',
            color: '#000000',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: mmToPx(1) }}>
            {footerLeftLines.map((line, index) => (
              <div key={`footer-left-${index}`}>{line}</div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: mmToPx(1),
              textAlign: 'right',
            }}
          >
            {footerRightLines.map((line, index) => (
              <div key={`footer-right-${index}`}>{line}</div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: mmToPx(FOOTER_MARK_HEIGHT_MM),
        }}
      >
        <img
          src={footerImageSrc}
          alt="Sidfot"
          style={{
            width: mmToPx(FOOTER_MARK_WIDTH_MM),
            height: mmToPx(FOOTER_MARK_HEIGHT_MM),
            objectFit: 'cover',
            margin: '0 auto',
            display: 'block',
          }}
        />
        {footerCenterLines.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              textAlign: 'center',
              fontSize: '9pt',
              color: '#ffffff',
              lineHeight: 1.2,
            }}
          >
            {footerCenterLines.map((line, index) => (
              <div key={`footer-center-${index}`}>{line}</div>
            ))}
          </div>
        )}
        {pageNumber ? (
          <div
            style={{
              position: 'absolute',
              right: mmToPx(PAGE_PADDING_MM.right),
              bottom: mmToPx(2),
              fontSize: '9pt',
              color: '#64748b',
            }}
          >
            {footerNote}
            Sida {pageNumber}
          </div>
        ) : null}
      </div>
    </div>
  )
}
