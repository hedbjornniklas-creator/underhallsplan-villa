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
            label: '1. HANDLINGAR OCH UPPLYSNINGAR',
            sectionId: 'handlingar',
          },
          {
            label: '2. OKULÄR BESIKTNING',
            sectionId: 'okular',
          },
          {
            label: '3. RISKANALYS',
            sectionId: 'risk',
          },
          {
            label: '4. FORTSATT TEKNISK UTREDNING',
            sectionId: 'ftu',
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
        source: {
          kind: 'static',
          text: 'Uppdraget utförs enligt ”villkor för överlåtelsebesiktning för säljare enligt SBR modellen”.',
        },
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'text',
        source: { kind: 'mock', path: 'mock.inspections.assignment_confirmation_text' },
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'text',
        source: {
          kind: 'static',
          text: 'Innan besiktningen påbörjades gjordes en genomgång av uppdragsbekräftelsen.',
        },
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'text',
        source: {
          kind: 'static',
          text:
            'Besiktningsmannen ansvarar inte för fel och är inte skyldig att betala för krav som reklamerats respektive framställts senare än två år efter att uppdraget avslutats.',
        },
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'text',
        source: {
          kind: 'static',
          text:
            'Uppdraget är avslutat i och med att besiktningsmannen översänt utlåtandet till uppdragsgivaren.',
        },
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
        text: '1. HANDLINGAR OCH UPPLYSNINGAR',
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
        type: 'heading',
        level: 3,
        text: 'Tillhandahållna handlingar:',
        marginTopMm: 2,
        marginBottomMm: 2,
        fontSizePt: 11,
      },
      {
        type: 'list',
        itemsPath: 'mock.documents.provided',
        emptyPlaceholder: '--',
        rowGapMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'heading',
        level: 3,
        text: 'Information från uppdragsgivare, fastighetsägare, eller dess ombud:',
        marginTopMm: 4,
        marginBottomMm: 2,
        fontSizePt: 11,
      },
      {
        type: 'text',
        source: {
          kind: 'static',
          text:
            'Under denna rubrik är samtliga uppgifter lämnade av fastighetsägare eller dess ombud. Uppgifterna är inte kontrollerade av besiktningsmannen.',
        },
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'text',
        source: { kind: 'mock', path: 'mock.disclosures.acquisition_text' },
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'text',
        source: {
          kind: 'static',
          text: 'Följande renoveringar och underhåll är utförda;',
        },
        marginTopMm: 0,
        marginBottomMm: 2,
      },
      {
        type: 'list',
        itemsPath: 'mock.disclosures.renovations',
        rowGapMm: 1.5,
        marginTopMm: 0,
        marginBottomMm: 4,
      },
      {
        type: 'heading',
        level: 3,
        text: 'Upplysningar om fel i fastigheten:',
        marginTopMm: 2,
        marginBottomMm: 2,
        fontSizePt: 11,
      },
      {
        type: 'list',
        itemsPath: 'mock.disclosures.property_faults',
        rowGapMm: 1.5,
        marginTopMm: 0,
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
        text: '2. OKULÄR BESIKTNING',
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
        type: 'text',
        source: { kind: 'standardText', id: 'STD_VISUAL_INSPECTION_PREFACE' },
        marginTopMm: 0,
        marginBottomMm: 3,
      },
      {
        type: 'text',
        source: { kind: 'static', text: '' },
        marginTopMm: 0,
        marginBottomMm: 4,
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
    ],
  },
  {
    id: 'risk',
    title: 'Riskanalys',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: '3. RISKANALYS',
        marginTopMm: 0,
        marginBottomMm: 3,
        accent: true,
      },
      {
        type: 'text',
        source: { kind: 'standardText', id: 'STD_RISK_GENERAL_NOTICE' },
        marginTopMm: 0,
        marginBottomMm: 3,
      },
      {
        type: 'text',
        source: { kind: 'mock', path: 'mock.risk.text' },
        marginTopMm: 0,
        marginBottomMm: 4,
      },
    ],
  },
  {
    id: 'ftu',
    title: 'Fortsatt teknisk utredning',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: '4. FORTSATT TEKNISK UTREDNING',
        marginTopMm: 0,
        marginBottomMm: 3,
        accent: true,
      },
      {
        type: 'text',
        source: { kind: 'standardText', id: 'STD_FTU_GENERAL_NOTICE' },
        marginTopMm: 0,
        marginBottomMm: 3,
      },
      {
        type: 'text',
        source: { kind: 'mock', path: 'mock.ftu.text' },
        marginTopMm: 0,
        marginBottomMm: 4,
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
    title: 'Bilaga 3 – Normala livslängder och underhållsintervall',
    startOnNewPage: true,
    type: 'appendix',
    appendixId: 'APPENDIX_3_LIFESPAN_TABLE_SBR',
    blocks: [],
  },
]



