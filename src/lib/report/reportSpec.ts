import type { StandardTextId } from '@/content/standardtexts/registry'
import type { AppendixTextId } from '@/lib/report/loadAppendixText'

export type TextSource =
  | { kind: 'static'; text: string }
  | { kind: 'standardText'; id: StandardTextId }
  | { kind: 'mock'; path: string }

export type TwoColumnRow = {
  label: string
  value: TextSource | TextSource[]
  note?: {
    text: string
    fontSizePt?: number
    color?: string
  }
}

export type ReportBlock =
  | {
      type: 'heading'
      level: 1 | 2 | 3
      text: string
      marginTopMm: number
      marginBottomMm: number
      accent?: boolean
      fontSizePt?: number
      align?: 'left' | 'center' | 'right'
    }
  | {
      type: 'text'
      source: TextSource
      marginTopMm: number
      marginBottomMm: number
      small?: boolean
    }
  | {
      type: 'boxedText'
      source: TextSource
      marginTopMm: number
      marginBottomMm: number
      small?: boolean
    }
  | {
      type: 'field'
      label: string
      path: string
      marginTopMm: number
      marginBottomMm: number
    }
  | {
      type: 'image'
      label: string
      widthMm: number
      heightMm: number
      marginTopMm: number
      marginBottomMm: number
    }
  | {
      type: 'pageBreak'
      label?: string
      marginTopMm: number
      marginBottomMm: number
    }
  | {
      type: 'toc'
      entries: {
        label: string
        sectionId?: string
      }[]
      marginTopMm: number
      marginBottomMm: number
    }
  | {
      type: 'list'
      itemsPath: string
      emptyPlaceholder?: string
      rowGapMm?: number
      marginTopMm: number
      marginBottomMm: number
    }
  | {
      type: 'inspectionBlocks'
      itemsPath: string
      marginTopMm: number
      marginBottomMm: number
    }
  | {
      type: 'twoColumn'
      rows: TwoColumnRow[]
      labelWidthMm?: number
      rowGapMm?: number
      marginTopMm: number
      marginBottomMm: number
    }
  | {
      type: 'handlingarLayout'
      labels: {
        provided: string
        info: string
        faults: string
      }
      infoDisclaimer: string
      renovationsLabel: string
      emptyPlaceholder?: string
      labelWidthMm?: number
      rowGapMm?: number
      marginTopMm: number
      marginBottomMm: number
    }

export type ReportSection = {
  id: string
  title?: string
  startOnNewPage: boolean
  type?: 'cover' | 'standard' | 'appendix'
  appendixId?: AppendixTextId
  blocks: ReportBlock[]
}

export const REPORT_SPEC: ReportSection[] = [
  {
    id: 'cover',
    title: 'Omslag',
    startOnNewPage: true,
    type: 'cover',
    blocks: [],
  },
  {
    id: 'toc',
    title: 'Innehållsförteckning',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 1,
        text: 'INNEHÅLLSFÖRTECKNING',
        marginTopMm: 4.7625,
        marginBottomMm: 4,
        accent: true,
      },
      {
        type: 'image',
        label: '',
        widthMm: 0,
        heightMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'toc',
        marginTopMm: 2,
        marginBottomMm: 4,
        entries: [
          {
            label: 'ÖVERLÅTELSEBESIKTNING FÖR SÄLJARE',
            sectionId: 'assignment',
          },
          {
            label: 'HANDLINGAR OCH UPPLYSNINGAR',
            sectionId: 'handlingar',
          },
          {
            label: 'OKULÄR BESIKTNING',
            sectionId: 'okular',
          },
          {
            label: 'BILAGA 1: Villkor för överlåtelsebesiktning för säljare',
            sectionId: 'appendix-1',
          },
          {
            label: 'BILAGA 2: Liten Byggordbok',
            sectionId: 'appendix-2',
          },
          {
            label: 'BILAGA 3: Tekniska medellivslängder',
            sectionId: 'appendix-3',
          },
        ],
      },
    ],
  },
  {
    id: 'assignment',
    title: 'Övergripande uppdrag',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: 'ÖVERLÅTELSEBESIKTNING FÖR SÄLJARE',
        marginTopMm: 4.7625,
        marginBottomMm: 4,
        accent: true,
        fontSizePt: 18,
        align: 'center',
      },
      {
        type: 'image',
        label: '',
        widthMm: 0,
        heightMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'heading',
        level: 3,
        text: 'Objekt',
        marginTopMm: 4,
        marginBottomMm: 2,
        fontSizePt: 12,
      },
      {
        type: 'twoColumn',
        marginTopMm: 0,
        marginBottomMm: 3,
        labelWidthMm: 65,
        rows: [
          {
            label: 'Fastighetsbeteckning:',
            value: { kind: 'mock', path: 'mock.properties.cadastral_id' },
          },
          {
            label: 'Adress:',
            value: { kind: 'mock', path: 'mock.properties.address' },
          },
          {
            label: 'Kommun:',
            value: { kind: 'mock', path: 'mock.properties.municipality' },
          },
          {
            label: 'Fastighetsägare:',
            value: { kind: 'mock', path: 'mock.properties.owner_name' },
          },
        ],
      },
      {
        type: 'heading',
        level: 3,
        text: 'Uppdragsgivare',
        marginTopMm: 4,
        marginBottomMm: 2,
        fontSizePt: 12,
      },
      {
        type: 'twoColumn',
        marginTopMm: 0,
        marginBottomMm: 3,
        labelWidthMm: 65,
        rows: [
          {
            label: 'Namn:',
            value: { kind: 'mock', path: 'mock.inspections.client_name' },
          },
          {
            label: 'Uppdragsnummer:',
            value: { kind: 'mock', path: 'mock.inspections.assignment_number' },
          },
        ],
      },
      {
        type: 'heading',
        level: 3,
        text: 'Besiktningsman',
        marginTopMm: 4,
        marginBottomMm: 2,
        fontSizePt: 12,
      },
      {
        type: 'twoColumn',
        marginTopMm: 0,
        marginBottomMm: 3,
        labelWidthMm: 65,
        rows: [
          {
            label: 'Namn:',
            value: [
              { kind: 'mock', path: 'mock.profile.full_name' },
              { kind: 'mock', path: 'mock.profile.sbr_group' },
              { kind: 'mock', path: 'mock.profile.sbr_status' },
            ],
          },
          {
            label: 'Certifieringsnummer:',
            value: { kind: 'static', text: '--' },
          },
          {
            label: 'Telefon:',
            value: { kind: 'mock', path: 'mock.profile.phone' },
          },
          {
            label: 'E-post:',
            value: { kind: 'mock', path: 'mock.profile.email' },
          },
        ],
      },
      {
        type: 'text',
        source: {
          kind: 'static',
          text:
            'Besiktningsmannen är medlem i Svenska Byggingenjörers Riksförbund (SBR) och är registrerad i SBR:s förteckning över besiktningsmän med därtill hörande förpliktelser.',
        },
        marginTopMm: 2,
        marginBottomMm: 4,
      },
      {
        type: 'heading',
        level: 3,
        text: 'Besiktningsuppdrag',
        marginTopMm: 4,
        marginBottomMm: 2,
        fontSizePt: 12,
      },
      {
        type: 'twoColumn',
        marginTopMm: 0,
        marginBottomMm: 3,
        labelWidthMm: 65,
        rows: [
          {
            label: 'Omfattning:',
            value: { kind: 'mock', path: 'mock.inspections.scope_text' },
          },
          {
            label: 'Besiktningsdag:',
            value: { kind: 'mock', path: 'mock.inspections.date_time' },
          },
          {
            label: 'Närvarande:',
            value: { kind: 'mock', path: 'mock.inspections.attendees_text' },
          },
        ],
      },
      {
        type: 'text',
        source: { kind: 'standardText', id: 'STD_ASSIGNMENT_SELLER_NOTICE' },
        marginTopMm: 0,
        marginBottomMm: 4,
      },
    ],
  },
  {
    id: 'handlingar',
    title: 'Handlingar och upplysningar',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: 'HANDLINGAR OCH UPPLYSNINGAR',
        marginTopMm: 0,
        marginBottomMm: 3,
        accent: true,
      },
      {
        type: 'image',
        label: '',
        widthMm: 0,
        heightMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'handlingarLayout',
        labels: {
          provided: 'Tillhandahållna handlingar:',
          info: 'Information från uppdragsgivare, fastighetsägare, eller dess ombud:',
          faults: 'Upplysningar om fel i fastigheten:',
        },
        infoDisclaimer:
          'Under denna rubrik är samtliga uppgifter lämnade av fastighetsägare eller dess ombud. Uppgifterna är inte kontrollerade av besiktningsmannen.',
        renovationsLabel: 'Följande renoveringar och underhåll är utförda;',
        emptyPlaceholder: '--',
        labelWidthMm: 37,
        rowGapMm: 8,
        marginTopMm: 2,
        marginBottomMm: 4,
      },
    ],
  },
  {
    id: 'okular',
    title: 'Okulär besiktning',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: 'OKULÄR BESIKTNING',
        marginTopMm: 0,
        marginBottomMm: 3,
        accent: true,
      },
      {
        type: 'image',
        label: '',
        widthMm: 0,
        heightMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'twoColumn',
        labelWidthMm: 37,
        rowGapMm: 4,
        marginTopMm: 0,
        marginBottomMm: 2,
        rows: [
          {
            label: 'Särskilda förutsättningar vid besiktningen:',
            value: { kind: 'standardText', id: 'STD_VISUAL_INSPECTION_CONDITIONS' },
          },
          {
            label: 'Muntliga uppgifter:',
            value: { kind: 'standardText', id: 'STD_VISUAL_INSPECTION_ORAL' },
          },
        ],
      },
    ],
  },
  {
    id: 'building-data',
    title: 'Byggnadsdata',
    startOnNewPage: false,
    blocks: [
      {
        type: 'text',
        source: { kind: 'mock', path: 'mock.buildingData.text' },
        marginTopMm: 0,
        marginBottomMm: 4,
      },
    ],
  },
  {
    id: 'notes',
    title: 'Noteringar',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: 'Noteringar',
        marginTopMm: 0,
        marginBottomMm: 3,
        accent: true,
      },
      {
        type: 'image',
        label: '',
        widthMm: 0,
        heightMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'heading',
        level: 3,
        text: 'Byggnad - utsida',
        marginTopMm: 0,
        marginBottomMm: 2,
        fontSizePt: 11,
      },
      {
        type: 'inspectionBlocks',
        itemsPath: 'mock.exterior.blocks',
        marginTopMm: 0,
        marginBottomMm: 4,
      },
    ],
  },
  {
    id: 'notes-interior',
    title: 'Noteringar',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: 'Noteringar',
        marginTopMm: 0,
        marginBottomMm: 3,
        accent: true,
      },
      {
        type: 'image',
        label: '',
        widthMm: 0,
        heightMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'heading',
        level: 3,
        text: 'Byggnad - insida',
        marginTopMm: 0,
        marginBottomMm: 2,
        fontSizePt: 11,
      },
      {
        type: 'inspectionBlocks',
        itemsPath: 'mock.interior.blocks',
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'boxedText',
        source: { kind: 'standardText', id: 'STD_FTU_GENERAL_NOTICE' },
        marginTopMm: 2,
        marginBottomMm: 0,
      },
    ],
  },
  {
    id: 'appendix-1',
    title: 'BILAGA 1: Villkor för överlåtelsebesiktning för säljare.',
    startOnNewPage: true,
    type: 'appendix',
    appendixId: 'APPENDIX_1_VILLKOR_SELLER_SBR',
    blocks: [],
  },
  {
    id: 'appendix-2',
    title: 'Bilaga 2 – Begreppsförklaringar',
    startOnNewPage: true,
    type: 'appendix',
    appendixId: 'APPENDIX_2_LITEN_BYGGORDBOK_SBR',
    blocks: [],
  },
  {
    id: 'appendix-3',
    title: 'BILAGA 3: TEKNISKA MEDELLIVSLÄNGDER',
    startOnNewPage: true,
    type: 'appendix',
    appendixId: 'APPENDIX_3_LIFESPAN_TABLE_SBR',
    blocks: [],
  },
]

const ASSIGNMENT_LABEL_SELLER = 'ÖVERLÅTELSEBESIKTNING FÖR SÄLJARE'
const ASSIGNMENT_LABEL_BUYER = 'ÖVERLÅTELSEBESIKTNING FÖR KÖPARE'
const APPENDIX_1_LABEL_SELLER =
  'BILAGA 1: Villkor för överlåtelsebesiktning för säljare'
const APPENDIX_1_LABEL_BUYER =
  'BILAGA 1: Villkor för överlåtelsebesiktning för köpare'

export function buildReportSpec(params?: {
  inspectionSide?: 'buyer' | 'seller' | null
}): ReportSection[] {
  const inspectionSide = params?.inspectionSide === 'seller' ? 'seller' : 'buyer'
  const assignmentLabel =
    inspectionSide === 'seller' ? ASSIGNMENT_LABEL_SELLER : ASSIGNMENT_LABEL_BUYER
  const appendixLabel =
    inspectionSide === 'seller' ? APPENDIX_1_LABEL_SELLER : APPENDIX_1_LABEL_BUYER
  const appendixTitle = `${appendixLabel}.`
  const appendixId =
    inspectionSide === 'seller'
      ? 'APPENDIX_1_VILLKOR_SELLER_SBR'
      : 'APPENDIX_1_VILLKOR_BUYER_SBR'

  const spec = JSON.parse(JSON.stringify(REPORT_SPEC)) as ReportSection[]

  const tocSection = spec.find((section) => section.id === 'toc')
  const tocBlock = tocSection?.blocks.find((block) => block.type === 'toc') as
    | { type: 'toc'; entries: { label: string; sectionId?: string }[] }
    | undefined
  if (tocBlock?.entries) {
    tocBlock.entries = tocBlock.entries.map((entry) => {
      if (entry.sectionId === 'assignment') {
        return { ...entry, label: assignmentLabel }
      }
      if (entry.sectionId === 'appendix-1') {
        return { ...entry, label: appendixLabel }
      }
      return entry
    })
  }

  const assignmentSection = spec.find((section) => section.id === 'assignment')
  if (assignmentSection) {
    assignmentSection.blocks = assignmentSection.blocks.map((block) => {
      if (block.type === 'heading' && block.level === 2) {
        return { ...block, text: assignmentLabel }
      }
      if (
        block.type === 'text' &&
        block.source.kind === 'standardText' &&
        block.source.id === 'STD_ASSIGNMENT_SELLER_NOTICE'
      ) {
        return {
          ...block,
          source: {
            ...block.source,
            id:
              inspectionSide === 'seller'
                ? 'STD_ASSIGNMENT_SELLER_NOTICE'
                : 'STD_ASSIGNMENT_BUYER_NOTICE',
          },
        }
      }
      return block
    })
  }

  const appendixSection = spec.find((section) => section.id === 'appendix-1')
  if (appendixSection) {
    appendixSection.title = appendixTitle
    appendixSection.appendixId = appendixId
  }

  return spec
}



