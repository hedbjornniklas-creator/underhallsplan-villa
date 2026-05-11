export type InspectionAssignmentNumberRow = {
  assignment_number?: string | null
}

export function buildInspectionAssignmentNumberPrefix(date: string | null | undefined) {
  const match = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const [, year, month, day] = match
  return `${year}-${month}${day}`
}

export function isInspectionAssignmentNumberForDate(
  assignmentNumber: string | null | undefined,
  date: string | null | undefined
) {
  const prefix = buildInspectionAssignmentNumberPrefix(date)
  if (!prefix) return false

  return new RegExp(`^${prefix}-\\d{2,}$`).test(String(assignmentNumber ?? '').trim())
}

export function getNextInspectionAssignmentNumber(
  date: string | null | undefined,
  rows: InspectionAssignmentNumberRow[]
) {
  const prefix = buildInspectionAssignmentNumberPrefix(date)
  if (!prefix) return null

  let maxSeq = 0
  rows.forEach((row) => {
    const number = String(row.assignment_number ?? '').trim()
    if (!number.startsWith(`${prefix}-`)) return

    const suffix = number.slice(prefix.length + 1)
    const parsed = Number.parseInt(suffix, 10)
    if (Number.isFinite(parsed) && parsed > maxSeq) {
      maxSeq = parsed
    }
  })

  return `${prefix}-${String(maxSeq + 1).padStart(2, '0')}`
}
