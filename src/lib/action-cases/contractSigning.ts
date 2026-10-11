// @ts-expect-error Node strip-types tests require the explicit extension.
import { offerPublishIssues, type CustomerOfferDraft, type ContractSigningVersion } from './customerOffers.ts'

export function contractSigningIssues(draft: CustomerOfferDraft): string[] {
  return [...offerPublishIssues(draft, undefined, 'paper'), ...(draft.contractParties ? [] : ['Fyll i beställare och entreprenör i avtalet före låsning.'])]
}
export function activeSigningVersion(versions?: ContractSigningVersion[]) {
  return versions?.find((version) => !version.releasedAt)
}
export function signingPdfFilename(version: Pick<ContractSigningVersion, 'id' | 'version'>) {
  return `Avtal-v${version.version}-${version.id.slice(0, 8)}.pdf`
}
