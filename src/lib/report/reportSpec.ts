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
    title: 'InnehÃ¥llsfÃ¶rteckning',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 1,
        text: 'INNEHÃ…LLSFÃ–RTECKNING',
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
            label: 'Ã–VERLÃ…TELSEBESIKTNING FÃ–R SÃ„LJARE',
            sectionId: 'assignment',
          },
          {
            label: 'HANDLINGAR OCH UPPLYSNINGAR',
            sectionId: 'handlingar',
          },
          {
            label: 'OKULÃ„R BESIKTNING',
            sectionId: 'okular',
          },
          {
            label: 'BILAGA 1: Villkor fÃ¶r Ã¶verlÃ¥telsebesiktning fÃ¶r sÃ¤ljare',
            sectionId: 'appendix-1',
          },
          {
            label: 'BILAGA 2: Liten Byggordbok',
            sectionId: 'appendix-2',
          },
          {
            label: 'BILAGA 3: Tekniska medellivslÃ¤ngder',
            sectionId: 'appendix-3',
          },
        ],
      },
    ],
  },
  {
    id: 'assignment',
    title: 'Ã–vergripande uppdrag',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: 'Ã–VERLÃ…TELSEBESIKTNING FÃ–R SÃ„LJARE',
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
            label: 'FastighetsÃ¤gare:',
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
            'Besiktningsmannen Ã¤r medlem i Svenska ByggingenjÃ¶rers RiksfÃ¶rbund (SBR) och Ã¤r registrerad i SBR:s fÃ¶rteckning Ã¶ver besiktningsmÃ¤n med dÃ¤rtill hÃ¶rande fÃ¶rpliktelser.',
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
            label: 'NÃ¤rvarande:',
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
          provided: 'TillhandahÃ¥llna handlingar:',
          info: 'Information frÃ¥n uppdragsgivare, fastighetsÃ¤gare, eller dess ombud:',
          faults: 'Upplysningar om fel i fastigheten:',
        },
        infoDisclaimer:
          'Under denna rubrik Ã¤r samtliga uppgifter lÃ¤mnade av fastighetsÃ¤gare eller dess ombud. Uppgifterna Ã¤r inte kontrollerade av besiktningsmannen.',
        renovationsLabel: 'FÃ¶ljande renoveringar och underhÃ¥ll Ã¤r utfÃ¶rda;',
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
    title: 'OkulÃ¤r besiktning',
    startOnNewPage: true,
    blocks: [
      {
        type: 'heading',
        level: 2,
        text: 'OKULÃ„R BESIKTNING',
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
            label: 'SÃ¤rskilda fÃ¶rutsÃ¤ttningar vid besiktningen:',
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
    title: 'BILAGA 1: Villkor fÃ¶r Ã¶verlÃ¥telsebesiktning fÃ¶r sÃ¤ljare.',
    startOnNewPage: true,
    type: 'appendix',
    appendixId: 'APPENDIX_1_VILLKOR_SELLER_SBR',
    blocks: [],
  },
  {
    id: 'appendix-2',
    title: 'Bilaga 2 â€“ BegreppsfÃ¶rklaringar',
    startOnNewPage: true,
    type: 'appendix',
    appendixId: 'APPENDIX_2_LITEN_BYGGORDBOK_SBR',
    blocks: [],
  },
  {
    id: 'appendix-3',
    title: 'BILAGA 3: TEKNISKA MEDELLIVSLÃ„NGDER',
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
      const title = `Bilaga ${appendixNo}: Aream\u00e4tning av boarea`
      dynamicSections.push({
        id: sectionId,
        title,
        startOnNewPage: true,
        type: 'standard',
        blocks: [
          {
            type: 'heading',
            level: 2,
            text: `BILAGA ${appendixNo}: UPPM\u00c4TNING AV BOAREA`,
            marginTopMm: 0,
            marginBottomMm: 1.2,
            accent: true,
            fontSizePt: 14,
          },
          {
            type: 'image',
            label: '',
            widthMm: 0,
            heightMm: 1.2,
            marginTopMm: 0,
            marginBottomMm: 1.5,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text:
                'Till\u00e4ggsuppdrag i samband med \u00f6verl\u00e5telsebesiktning. Villkoren f\u00f6r \u00f6verl\u00e5telsebesiktningen g\u00e4ller \u00e4ven denna bilaga.',
            },
            marginTopMm: 0,
            marginBottomMm: 1.2,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Objekt',
            marginTopMm: 0.3,
            marginBottomMm: 1.2,
            fontSizePt: 11,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 1.6,
            labelWidthMm: 52,
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
                label: 'Bygg\u00e5r:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.object.building_year' },
              },
              {
                label: '\u00d6vrigt:',
                value: { kind: 'mock', path: 'mock.appendices.area_measurement.object.object_other' },
              },
            ],
          },
          {
            type: 'heading',
            level: 3,
            text: 'M\u00e4tning',
            marginTopMm: 0.3,
            marginBottomMm: 1,
            fontSizePt: 11,
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 0.6,
            source: {
              kind: 'static',
              text: 'M\u00e5tt \u00e4r tagna p\u00e5 plats med instrument (m\u00e4rke och modell):',
            },
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 0.6,
            source: {
              kind: 'mock',
              path: 'mock.appendices.area_measurement.measurement.instrument',
            },
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 1.2,
            source: {
              kind: 'static',
              text: 'Uppm\u00e4tning enligt Svensk Standard SS 21054:2020.',
            },
          },
          {
            type: 'heading',
            level: 3,
            text: 'Resultat',
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'table',
            rowsPath: 'mock.appendices.area_measurement.rows',
            emptyPlaceholder: 'Inga m\u00e4tpunkter registrerade',
            columns: [
              { header: 'V\u00e5ning/byggdel', key: 'floor_or_part', widthPercent: 46 },
              { header: 'Boarea', key: 'boarea_display', align: 'right', widthPercent: 27 },
              { header: 'Biarea', key: 'biarea_display', align: 'right', widthPercent: 27 },
            ],
            marginTopMm: 0,
            marginBottomMm: 1.2,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Sammanfattning',
            marginTopMm: 0.3,
            marginBottomMm: 0.9,
            fontSizePt: 11,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 1.2,
            labelWidthMm: 52,
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
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'text',
            source: { kind: 'mock', path: 'mock.appendices.area_measurement.measurement.comment' },
            marginTopMm: 0,
            marginBottomMm: 1.2,
          },
          {
            type: 'heading',
            level: 3,
            text: '\u00d6vrigt',
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'text',
            source: { kind: 'mock', path: 'mock.appendices.area_measurement.measurement.other_notes' },
            marginTopMm: 0,
            marginBottomMm: 1.2,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Signering',
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 0.8,
            labelWidthMm: 52,
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
                label: 'Beh\u00f6righet:',
                value: [
                  {
                    kind: 'static',
                    text:
                      'Av SBR Diplomerad Aream\u00e4tare (F\u00d6R DIG SOM G\u00c5TT SBR:s kurs inom aream\u00e4tning)',
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
        label: `BILAGA ${appendixNo}: Aream\u00e4tning av boarea`,
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
            marginBottomMm: 1.2,
            accent: true,
            fontSizePt: 14,
          },
          {
            type: 'image',
            label: '',
            widthMm: 0,
            heightMm: 1.2,
            marginTopMm: 0,
            marginBottomMm: 1.5,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text:
                'Till\u00e4ggsuppdrag i samband med \u00f6verl\u00e5telsebesiktning. Villkoren f\u00f6r \u00f6verl\u00e5telsebesiktningen g\u00e4ller \u00e4ven denna bilaga.',
            },
            marginTopMm: 0,
            marginBottomMm: 1.2,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Objekt',
            marginTopMm: 0.3,
            marginBottomMm: 1,
            fontSizePt: 11,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 1.2,
            labelWidthMm: 52,
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
                label: 'Bygg\u00e5r:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.building_year' },
              },
              {
                label: 'Tillbyggd:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.extension_note' },
              },
              {
                label: 'Uppv\u00e4rmning:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.heating' },
              },
              {
                label: 'Ventilation:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.ventilation' },
              },
              {
                label: '\u00d6vrigt:',
                value: { kind: 'mock', path: 'mock.appendices.moisture_control.object.object_other' },
              },
            ],
          },
          {
            type: 'heading',
            level: 3,
            text: 'M\u00e4tning',
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 0.6,
            source: {
              kind: 'static',
              text: 'Fuktm\u00e4tning utf\u00f6rs med instrument (m\u00e4rke och modell):',
            },
          },
          {
            type: 'text',
            marginTopMm: 0,
            marginBottomMm: 1,
            source: {
              kind: 'mock',
              path: 'mock.appendices.moisture_control.measurement.instrument',
            },
          },
          {
            type: 'heading',
            level: 3,
            text: 'Resultat',
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'table',
            rowsPath: 'mock.appendices.moisture_control.rows',
            emptyPlaceholder: 'Inga kontrollplatser registrerade',
            columns: [
              { header: 'Kontrollplats', key: 'location_display', widthPercent: 32 },
              { header: 'Resultat', key: 'result_display', widthPercent: 48 },
              { header: 'Kritisk niv\u00e5', key: 'critical_display', align: 'right', widthPercent: 20 },
            ],
            marginTopMm: 0,
            marginBottomMm: 1.2,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Kommentar',
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'text',
            source: { kind: 'mock', path: 'mock.appendices.moisture_control.measurement.comment' },
            marginTopMm: 0,
            marginBottomMm: 1,
          },
          {
            type: 'text',
            source: {
              kind: 'static',
              text: 'Kritiska v\u00e4rden: RF 75 % och FK 17 %.',
            },
            marginTopMm: 0,
            marginBottomMm: 1.1,
          },
          {
            type: 'heading',
            level: 3,
            text: 'Signering',
            marginTopMm: 0.3,
            marginBottomMm: 0.8,
            fontSizePt: 11,
          },
          {
            type: 'twoColumn',
            marginTopMm: 0,
            marginBottomMm: 0.8,
            labelWidthMm: 52,
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
                label: 'Beh\u00f6righet:',
                value: [
                  {
                    kind: 'static',
                    text:
                      'Av SBR Diplomerad fuktkontrollant (F\u00d6R DIG SOM G\u00c5TT SBR:s kurs inom fuktm\u00e4tning)',
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


