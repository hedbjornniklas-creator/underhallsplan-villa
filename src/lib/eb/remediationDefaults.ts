export type EbRemediationContractorSuggestion = {
  name: string
  companyName: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  source: 'report' | 'project'
}

type ContractorIdentity = {
  contractorName?: string | null
  contractorOrgNo?: string | null
  contractorEmail?: string | null
  contractorPhone?: string | null
}

type ContractorParticipant = {
  representsPartyKey?: string | null
  roleLabel?: string | null
  companyName?: string | null
  personName?: string | null
  email?: string | null
  phone?: string | null
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null
const identity = (value: unknown) => text(value)?.normalize('NFKC').toLocaleLowerCase('sv-SE') ?? ''
const sameIdentity = (left: unknown, right: unknown) => Boolean(identity(left) && identity(left) === identity(right))
const email = (value: unknown) => {
  const candidate = text(value)?.toLowerCase() ?? null
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null
}

/** A report date is an inherited default, never a replacement for a task's own date. */
export function ebRemediationReportDeadline(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null
  const date = new Date(`${candidate}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : null
}

/** Omitted assignment dates mean preserve; only an explicit null/empty string clears a date. */
export function ebRemediationAssignmentDueDate(payload: Record<string, unknown>): string | null | undefined {
  if (!Object.hasOwn(payload, 'dueDate') || payload.dueDate === undefined) return undefined
  if (payload.dueDate === null || payload.dueDate === '') return null
  if (typeof payload.dueDate !== 'string') throw new Error('EB_REMEDIATION_DATE_INVALID')
  const date = ebRemediationReportDeadline(payload.dueDate)
  if (!date) throw new Error('EB_REMEDIATION_DATE_INVALID')
  return date
}

/**
 * Suggestions belong only to the open, purchased buyer workspace. Frozen report
 * identities are authoritative. Live project contacts can supplement only the
 * same identifiable company, never a named person's record or a replaced company.
 */
export function ebRemediationContractorSuggestions(input: {
  state: string
  role: string
  paid: boolean
  reportProject: ContractorIdentity | null
  participants?: ContractorParticipant[]
  project?: ContractorIdentity | null
}): EbRemediationContractorSuggestion[] {
  if (input.state !== 'open' || input.role !== 'customer_owner' || !input.paid || !input.reportProject) return []
  const frozen = input.reportProject
  const company = text(frozen.contractorName)
  const candidates: EbRemediationContractorSuggestion[] = []
  if (company) candidates.push({ name: company, companyName: company, contactName: null,
    email: email(frozen.contractorEmail), phone: text(frozen.contractorPhone), source: 'report' })

  for (const participant of input.participants ?? []) {
    // An explicitly different party must not be reclassified by its name or role text.
    if (participant.representsPartyKey && participant.representsPartyKey !== 'contractor') continue
    const isContractor = participant.representsPartyKey === 'contractor' ||
      /entrepren|hantverk|näringsidk/i.test(participant.roleLabel ?? '') ||
      (sameIdentity(participant.companyName, company) || sameIdentity(participant.personName, company))
    if (!isContractor) continue
    const companyName = text(participant.companyName)
    const personName = text(participant.personName)
    const contactName = sameIdentity(companyName, personName) ? null : personName
    const name = companyName ?? contactName
    if (!name) continue
    candidates.push({ name, companyName, contactName, email: email(participant.email),
      phone: text(participant.phone), source: 'report' })
  }

  // Only the company-level candidate can receive company-level live contacts.
  // An organization-number disagreement overrides a matching company name.
  const live = input.project
  const orgNumber = (value: unknown) => text(value)?.replace(/[\s-]/g, '') ?? ''
  const orgNumbersDisagree = Boolean(orgNumber(frozen.contractorOrgNo) && orgNumber(live?.contractorOrgNo) &&
    orgNumber(frozen.contractorOrgNo) !== orgNumber(live?.contractorOrgNo))
  if (live && sameIdentity(company, live.contractorName) && !orgNumbersDisagree) {
    for (const candidate of candidates) {
      if (candidate.contactName || !sameIdentity(candidate.companyName, company)) continue
      const nextEmail = candidate.email ?? email(live.contractorEmail)
      const nextPhone = candidate.phone ?? text(live.contractorPhone)
      if (nextEmail !== candidate.email || nextPhone !== candidate.phone) {
        candidate.email = nextEmail
        candidate.phone = nextPhone
        candidate.source = 'project'
      }
    }
  }

  const distinct = candidates.filter((candidate, index, all) => all.findIndex((other) =>
    sameIdentity(other.name, candidate.name) && identity(other.companyName) === identity(candidate.companyName) &&
    identity(other.contactName) === identity(candidate.contactName) && other.email === candidate.email &&
    other.phone === candidate.phone) === index)
  // Do not show an empty generic duplicate when the report already identifies
  // one or more contact persons. Distinct people/contact channels stay choices.
  return distinct.filter((candidate) => candidate.contactName || candidate.email || candidate.phone ||
    !distinct.some((other) => other !== candidate && sameIdentity(other.companyName, candidate.companyName)))
}
