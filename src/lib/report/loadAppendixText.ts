import { loadStandardText } from '@/content/standardtexts/loadStandardText'

export type AppendixTextId =
  | 'APPENDIX_1_VILLKOR_SELLER_SBR_2024'
  | 'APPENDIX_2_LITEN_BYGGORDBOK_SBR_2024'
  | 'APPENDIX_3_LIFESPAN_TABLE_SBR_2024'

export function loadAppendixText(name: AppendixTextId): string {
  return loadStandardText(name)
}
