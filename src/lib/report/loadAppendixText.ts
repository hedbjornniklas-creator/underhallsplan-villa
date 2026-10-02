import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { STB_REPORT_TERMS } from '@/content/standardtexts/status/originals'

export type AppendixTextId =
  | 'APPENDIX_1_VILLKOR_SELLER_SBR'
  | 'APPENDIX_1_VILLKOR_BUYER_SBR'
  | 'APPENDIX_1_VILLKOR_APARTMENT_SBR'
  | 'APPENDIX_1_VILLKOR_STATUS_SBR'
  | 'APPENDIX_2_LITEN_BYGGORDBOK_SBR'
  | 'APPENDIX_3_LIFESPAN_TABLE_SBR'

export function loadAppendixText(name: AppendixTextId): string {
  if (name === 'APPENDIX_1_VILLKOR_STATUS_SBR') return STB_REPORT_TERMS
  return loadStandardText(name)
}
