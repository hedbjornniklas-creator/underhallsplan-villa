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

export type TableColumn = {
  header: string
  key: string
  align?: 'left' | 'center' | 'right'
  widthPercent?: number
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
      type: 'table'
      rowsPath: string
      columns: TableColumn[]
      emptyPlaceholder?: string
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

export type DynamicAppendixConfig = {
  includeAreaMeasurement?: boolean
  includeMoistureControl?: boolean
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

const ASSIGNMENT_LABEL_SELLER = '\u00d6VERL\u00c5TELSEBESIKTNING F\u00d6R S\u00c4LJARE'
const ASSIGNMENT_LABEL_BUYER = '\u00d6VERL\u00c5TELSEBESIKTNING F\u00d6R K\u00d6PARE'
const ASSIGNMENT_LABEL_APARTMENT = 'L\u00c4GENHETSBESIKTNING'
const APPENDIX_1_LABEL_SELLER =
  'BILAGA 1: Villkor f\u00f6r \u00f6verl\u00e5telsebesiktning f\u00f6r s\u00e4ljare'
const APPENDIX_1_LABEL_BUYER =
  'BILAGA 1: Villkor f\u00f6r \u00f6verl\u00e5telsebesiktning f\u00f6r k\u00f6pare'
const APPENDIX_1_LABEL_APARTMENT = 'BILAGA 1: Villkor f\u00f6r l\u00e4genhetsbesiktning'

type ReportInspectionSide = 'buyer' | 'seller' | 'apartment'

const resolveInspectionSide = (
  inspectionSide: 'buyer' | 'seller' | 'apartment' | null | undefined
): ReportInspectionSide => {
  if (inspectionSide === 'seller') return 'seller'
  if (inspectionSide === 'apartment') return 'apartment'
  return 'buyer'
}

const buildObjectRows = (
  inspectionSide: ReportInspectionSide
): Array<{ label: string; value: TextSource }> => {
  if (inspectionSide === 'apartment') {
    return [
      {
        label: 'Bostadsr\u00e4ttsf\u00f6rening:',
        value: { kind: 'mock', path: 'mock.properties.brf_name' },
      },
      {
        label: 'L\u00e4genhetsnummer:',
        value: { kind: 'mock', path: 'mock.properties.apartment_number' },
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
        label: 'Bostadsr\u00e4ttsinnehavare:',
        value: { kind: 'mock', path: 'mock.properties.apartment_holder_name' },
      },
    ]
  }

  return [
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
      label: 'Fastighets\u00e4gare:',
      value: { kind: 'mock', path: 'mock.properties.owner_name' },
    },
  ]
}

export function buildReportSpec(params?: {
  inspectionSide?: 'buyer' | 'seller' | 'apartment' | null
  dynamicAppendices?: DynamicAppendixConfig
}): ReportSection[] {
  const inspectionSide = resolveInspectionSide(params?.inspectionSide)
  const assignmentLabel =
    inspectionSide === 'seller'
      ? ASSIGNMENT_LABEL_SELLER
      : inspectionSide === 'apartment'
        ? ASSIGNMENT_LABEL_APARTMENT
        : ASSIGNMENT_LABEL_BUYER
  const appendixLabel =
    inspectionSide === 'seller'
      ? APPENDIX_1_LABEL_SELLER
      : inspectionSide === 'apartment'
        ? APPENDIX_1_LABEL_APARTMENT
        : APPENDIX_1_LABEL_BUYER
  const appendixTitle = `${appendixLabel}.`
  const appendixId =
    inspectionSide === 'seller'
      ? 'APPENDIX_1_VILLKOR_SELLER_SBR'
      : inspectionSide === 'apartment'
        ? 'APPENDIX_1_VILLKOR_APARTMENT_SBR'
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
        block.type === 'twoColumn' &&
        block.rows.some((row) =>
          ['Fastighetsbeteckning:', 'Bostadsr\u00e4ttsf\u00f6rening:'].includes(row.label)
        )
      ) {
        return {
          ...block,
          rows: buildObjectRows(inspectionSide),
        }
      }
      if (
        block.type === 'text' &&
        block.source.kind === 'standardText' &&
        [
          'STD_ASSIGNMENT_SELLER_NOTICE',
          'STD_ASSIGNMENT_BUYER_NOTICE',
          'STD_ASSIGNMENT_APARTMENT_NOTICE',
        ].includes(block.source.id)
      ) {
        return {
          ...block,
          source: {
            ...block.source,
            id:
              inspectionSide === 'seller'
                ? 'STD_ASSIGNMENT_SELLER_NOTICE'
                : inspectionSide === 'apartment'
                  ? 'STD_ASSIGNMENT_APARTMENT_NOTICE'
                  : 'STD_ASSIGNMENT_BUYER_NOTICE',
          },
        }
      }
      return block
    })
  }

  if (inspectionSide === 'apartment') {
    const notesExteriorIndex = spec.findIndex((section) => section.id === 'notes')
    if (notesExteriorIndex >= 0) {
      spec.splice(notesExteriorIndex, 1)
    }

    const notesInteriorSection = spec.find((section) => section.id === 'notes-interior')
    if (notesInteriorSection) {
      notesInteriorSection.blocks = notesInteriorSection.blocks.map((block) => {
        if (
          block.type === 'heading' &&
          block.level === 3 &&
          block.text.toLowerCase().includes('insida')
        ) {
          return { ...block, text: 'L\u00e4genhet - insida' }
        }
        return block
      })
    }
  }

  const appendixSection = spec.find((section) => section.id === 'appendix-1')
  if (appendixSection) {
    appendixSection.title = appendixTitle
    appendixSection.appendixId = appendixId
  }

  const includeAreaMeasurement = params?.dynamicAppendices?.includeAreaMeasurement === true
  const includeMoistureControl = params?.dynamicAppendices?.includeMoistureControl === true
  const hasDynamicAppendices = includeAreaMeasurement || includeMoistureControl

  if (hasDynamicAppendices) {
    const tocSection = spec.find((section) => section.id === 'toc')
    const tocBlock = tocSection?.blocks.find((block) => block.type === 'toc') as
      | { type: 'toc'; entries: { label: string; sectionId?: string }[] }
      | undefined

    const appendix3Index = spec.findIndex((section) => section.id === 'appendix-3')
    const dynamicSections: ReportSection[] = []
    const dynamicTocEntries: Array<{ label: string; sectionId: string }> = []
    let appendixNo = 4

    if (includeAreaMeasurement) {
      const sectionId = `appendix-${appendixNo}-area-measurement`
      const title = `Bilaga ${appendixNo}: Areamätning av boarea`
      dynamicSections.push({
        id: sectionId,
        title,
        startOnNewPage: true,
        type: 'standard',
        blocks: [
          {
            type: 'heading',
            level: 2,
            text: `BILAGA ${appendixNo}: UPPMÄTNING AV BOAREA`,
            marginTopMm: 0,
            marginBottomMm: 2,
            accent: true,
            fontSizePt: 16,
          },
          {
            type: 'image',
            label: '',
            widthMm: 0,
            heightMm: 1.5,
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Uppmätning av boarea',
            marginTopMm: 0,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text: 'Tilläggsuppdrag i samband med överlåtelsebesiktning.',
            },
            marginTopMm: 0,
            marginBottomMm: 1,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text:
                'Villkoren för överlåtelsebesiktningen med vederbörliga villkor tillämpas även för detta tilläggsuppdrag och detta utlåtande, inklusive det som anges under rubrikerna "besiktningsmannens ansvar" och "äganderätt och nyttjanderätt till besiktningsutlåtandet".',
            },
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Objekt',
            marginTopMm: 0,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 3,
            labelWidthMm: 55,
            rows: [
              {
                label: 'Uppdragsnummer:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.object.assignment_number' },
              },
              {
                label: 'Adress:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.object.address' },
              },
              {
                label: 'Byggnadstyp:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.object.building_type' },
              },
              {
                label: 'Byggår:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.object.building_year' },
              },
              {
                label: 'Övrigt:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.object.object_other' },
              },
            ],
          },
          {
            type: 'heading',
            level: 3,
            text: 'Mätning',
            marginTopMm: 1,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 1,
            source: {
              kind: 'static',
              text: 'Mått är tagna på plats med instrument (märke och modell):',
            },
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 1,
            source: {
              kind: 'mock',
              path: 'mock.appendices.area_measurement.measurement.instrument',
            },
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 2,
            source: {
              kind: 'static',
              text: 'Uppmätning enligt SVENSK STANDARD SS 21054:2020',
            },
          },
          {
            type: 'heading',
            level: 3,
            text: 'Resultat',
            marginTopMm: 0,
            marginBottomMm: 1,
            fontSizePt: 12,
          },
          {
            type: 'table',
            rowsPath: 'mock.appendices.area_measurement.rows',
            emptyPlaceholder: 'Inga mätpunkter registrerade',
            columns: [
              { header: 'Våning/byggdel', key: 'floor_or_part', widthPercent: 46 },
              { header: 'Boarea', key: 'boarea_display', align: 'right', widthPercent: 27 },
              { header: 'Biarea', key: 'biarea_display', align: 'right', widthPercent: 27 },
            ],
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Sammanfattning',
            marginTopMm: 1,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 2,
            labelWidthMm: 55,
            rows: [
              {
                label: 'Byggnaden har en BOAREA om:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.summary.boarea_total' },
              },
              {
                label: 'Byggnaden har en BIAREA om:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.summary.biarea_total' },
              },
            ],
          },
          {
            type: 'heading',
            level: 3,
            text: 'Kommentar',
            marginTopMm: 1,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            source: { kind: 'mock', path: 'mock.appendices.area_measurement.measurement.comment' },
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Övrigt',
            marginTopMm: 0,
            marginBottomMm: 1,
            fontSizePt: 12,
          },
          {
            type: 'text',
            source: { kind: 'mock', path: 'mock.appendices.area_measurement.measurement.other_notes' },
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Signering',
            marginTopMm: 0,
            marginBottomMm: 1,
            fontSizePt: 12,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 2,
            labelWidthMm: 55,
            rows: [
              {
                label: 'Ort, datum:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.signing.place_date' },
              },
              {
                label: 'Besiktningsbolag:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.signing.company_name' },
              },
              {
                label: 'Namn och Efternamn:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.signing.inspector_name' },
              },
              {
                label: 'Behörighet:',
                value: [
                  {
                    kind: 'static',
                    text: 'Av SBR Diplomerad Areamätare (FÖR DIG SOM GÅTT SBRs kurs inom Areamätning)',
                  },
                  { kind: 'mock', path: 'mock.appendices.area_measurement.signing.secondary_qualification' },
                  { kind: 'mock', path: 'mock.appendices.area_measurement.signing.membership_line' },
                ],
              },
            ],
          },
        ],
      })
      dynamicTocEntries.push({
        label: `BILAGA ${appendixNo}: Areamätning av boarea`,
        sectionId,
      })
      appendixNo += 1
    }

    if (includeMoistureControl) {
      const sectionId = `appendix-${appendixNo}-moisture-control`
      const title = `Bilaga ${appendixNo}: Fuktkontroll av riskkonstruktion`
      dynamicSections.push({
        id: sectionId,
        title,
        startOnNewPage: true,
        type: 'standard',
        blocks: [
          {
            type: 'heading',
            level: 2,
            text: `BILAGA ${appendixNo}: FUKTKONTROLL`,
            marginTopMm: 0,
            marginBottomMm: 2,
            accent: true,
            fontSizePt: 16,
          },
          {
            type: 'image',
            label: '',
            widthMm: 0,
            heightMm: 1.5,
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Fuktkontroll av riskkonstruktion',
            marginTopMm: 0,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text: 'Tilläggsuppdrag i samband med överlåtelsebesiktning.',
            },
            marginTopMm: 0,
            marginBottomMm: 1,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text:
                'Villkoren för överlåtelsebesiktningen med vederbörliga villkor tillämpas även för detta tilläggsuppdrag och detta utlåtande, inklusive det som anges under rubrikerna "besiktningsmannens ansvar" och "äganderätt och nyttjanderätt till besiktningsutlåtandet".',
            },
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Objekt',
            marginTopMm: 0,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 3,
            labelWidthMm: 55,
            rows: [
              {
                label: 'Uppdragsnummer:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.assignment_number' },
              },
              {
                label: 'Adress:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.address' },
              },
              {
                label: 'Byggnadstyp:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.building_type' },
              },
              {
                label: 'Byggår:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.building_year' },
              },
              {
                label: 'Tillbyggd:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.extension_note' },
              },
              {
                label: 'Uppvärmning:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.heating' },
              },
              {
                label: 'Ventilation:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.ventilation' },
              },
              {
                label: 'Övrigt:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.object_other' },
              },
            ],
          },
          {
            type: 'heading',
            level: 3,
            text: 'Mätning',
            marginTopMm: 1,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 1,
            source: {
              kind: 'static',
              text: 'Fuktmätning utförs med instrument (märke och modell):',
            },
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 2,
            source: {
              kind: 'mock',
              path: 'mock.appendices.moisture_control.measurement.instrument',
            },
          },
          {
            type: 'heading',
            level: 3,
            text: 'Resultat',
            marginTopMm: 0,
            marginBottomMm: 1,
            fontSizePt: 12,
          },
          {
            type: 'table',
            rowsPath: 'mock.appendices.moisture_control.rows',
            emptyPlaceholder: 'Inga kontrollplatser registrerade',
            columns: [
              { header: 'Kontrollplats', key: 'location_display', widthPercent: 32 },
              { header: 'Resultat', key: 'result_display', widthPercent: 48 },
              { header: 'Kritisk nivå', key: 'critical_display', align: 'right', widthPercent: 20 },
            ],
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Kommentar',
            marginTopMm: 1,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            source: { kind: 'mock', path: 'mock.appendices.moisture_control.measurement.comment' },
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Kritiska värden',
            marginTopMm: 1,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text:
                'Kritiskt värde gällande relativ fuktighet (RF) ligger vid 75 %. Kritiskt värde gällande fuktkvot (FK) ligger vid 17 %.',
            },
            marginTopMm: 0,
            marginBottomMm: 2,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Övrigt',
            marginTopMm: 1,
            marginBottomMm: 2,
            fontSizePt: 12,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text:
                'Relativ fuktighet (RF) indikerar i procent hur mycket vattenånga som finns i luften i relation till hur mycket som maximalt kan finnas vid en viss temperatur. Fuktkvot (FK) indikerar i procent hur mycket vatten som finns i materialet i relation till vikten av torrt material.',
            },
            marginTopMm: 0,
            marginBottomMm: 3,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Signering',
            marginTopMm: 0,
            marginBottomMm: 1,
            fontSizePt: 12,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 2,
            labelWidthMm: 55,
            rows: [
              {
                label: 'Ort, datum:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.signing.place_date' },
              },
              {
                label: 'Besiktningsbolag:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.signing.company_name' },
              },
              {
                label: 'Namn och Efternamn:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.signing.inspector_name' },
              },
              {
                label: 'Behörighet:',
                value: [
                  {
                    kind: 'static',
                    text: 'Av SBR Diplomerad fuktkontrollant (FÖR DIG SOM GÅTT SBRs kurs inom fuktmätning)',
                  },
                  { kind: 'mock', path: 'mock.appendices.moisture_control.signing.secondary_qualification' },
                  { kind: 'mock', path: 'mock.appendices.moisture_control.signing.membership_line' },
                ],
              },
            ],
          },
        ],
      })
      dynamicTocEntries.push({
        label: `BILAGA ${appendixNo}: Fuktkontroll av riskkonstruktion`,
        sectionId,
      })
      appendixNo += 1
    }

    if (dynamicSections.length > 0) {
      if (appendix3Index >= 0) {
        spec.splice(appendix3Index + 1, 0, ...dynamicSections)
      } else {
        spec.push(...dynamicSections)
      }

      if (tocBlock?.entries && dynamicTocEntries.length > 0) {
        const appendix3TocIndex = tocBlock.entries.findIndex((entry) => entry.sectionId === 'appendix-3')
        if (appendix3TocIndex >= 0) {
          tocBlock.entries.splice(appendix3TocIndex + 1, 0, ...dynamicTocEntries)
        } else {
          tocBlock.entries.push(...dynamicTocEntries)
        }
      }
    }
  }

  return spec
}

