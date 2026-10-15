type AssignmentEditState = {
  status: string
  last_sent_at?: string | null
  accepted_at?: string | null
  booked_at?: string | null
  archived_at?: string | null
}

export function canEditObAssignment(assignment: AssignmentEditState | null | undefined): boolean {
  // A replacement draft can retain its early-start inspection link and converted_at.
  return Boolean(assignment && assignment.status === 'draft' &&
    !assignment.last_sent_at && !assignment.accepted_at &&
    !assignment.booked_at && !assignment.archived_at)
}

export const OB_ASSIGNMENT_CONTENT_LOCKED_MESSAGE =
  'Uppdragsbekräftelsen är låst för redigering. Skapa en ny uppdragsbekräftelse för att ändra uppgifterna.'
