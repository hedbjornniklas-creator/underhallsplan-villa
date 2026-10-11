import type { ContractSigningVersion } from './customerOffers'

export function activeSigningVersion(versions?: ContractSigningVersion[]) {
  return versions?.find((version) => !version.releasedAt)
}
export function signingPdfFilename(version: Pick<ContractSigningVersion, 'id' | 'version'>) {
  return `Avtal-v${version.version}-${version.id.slice(0, 8)}.pdf`
}
