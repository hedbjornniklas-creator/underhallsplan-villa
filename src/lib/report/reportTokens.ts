export const FONT_FAMILY = 'Calibri, sans-serif'
export const ACCENT_COLOR = '#5B9BD5'
export const TEXT_COLOR = '#000000'
export const BASE_FONT_PT = 11
export const APPENDIX_FONT_PT = 9.5
export const LINE_HEIGHT = 1.15
export const PAGE_WIDTH_MM = 210
export const PAGE_HEIGHT_MM = 297
export const PAGE_PADDING_MM = {
  top: 20,
  right: 18,
  bottom: 20,
  left: 18,
}
export const SBR_LOGO_WIDTH_MM = 36.1
export const SBR_LOGO_HEIGHT_MM = 20.3
export const FOOTER_MARK_WIDTH_MM = 212
export const FOOTER_MARK_HEIGHT_MM = 17.3

export function mmToPx(mm: number): string {
  return `${(mm * 96) / 25.4}px`
}

export type ReportStylePreset = {
  fontSize: string
  fontWeight: number
  color: string
  marginTopMm: number
  marginBottomMm: number
}

export const REPORT_STYLES: Record<'H1' | 'H2' | 'H3' | 'BODY' | 'SMALL', ReportStylePreset> = {
  H1: {
    fontSize: '18pt',
    fontWeight: 700,
    color: ACCENT_COLOR,
    marginTopMm: 6,
    marginBottomMm: 4,
  },
  H2: {
    fontSize: '13pt',
    fontWeight: 700,
    color: ACCENT_COLOR,
    marginTopMm: 5,
    marginBottomMm: 3,
  },
  H3: {
    fontSize: '11pt',
    fontWeight: 700,
    color: TEXT_COLOR,
    marginTopMm: 4,
    marginBottomMm: 2,
  },
  BODY: {
    fontSize: `${BASE_FONT_PT}pt`,
    fontWeight: 400,
    color: TEXT_COLOR,
    marginTopMm: 2,
    marginBottomMm: 2,
  },
  SMALL: {
    fontSize: '9pt',
    fontWeight: 400,
    color: TEXT_COLOR,
    marginTopMm: 1,
    marginBottomMm: 1,
  },
}
