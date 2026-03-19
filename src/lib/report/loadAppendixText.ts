import { loadStandardText } from '@/content/standardtexts/loadStandardText'

export type AppendixTextId =
  | 'APPENDIX_1_VILLKOR_SELLER_SBR'
  | 'APPENDIX_1_VILLKOR_BUYER_SBR'
  | 'APPENDIX_1_VILLKOR_APARTMENT_SBR'
  | 'APPENDIX_2_LITEN_BYGGORDBOK_SBR'
  | 'APPENDIX_3_LIFESPAN_TABLE_SBR'

export function loadAppendixText(name: AppendixTextId): string {
  return loadStandardText(name)
}
