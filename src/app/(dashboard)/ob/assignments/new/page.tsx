import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { getAssignmentTermsDocument } from '@/lib/assignments/terms'
import NewAssignmentClient from './NewAssignmentClient'

export default function NewAssignmentPage() {
  const sellerTemplate = loadStandardText('STD_ASSIGNMENT_TEMPLATE_SELLER_2026')
  const buyerTemplate = loadStandardText('STD_ASSIGNMENT_TEMPLATE_BUYER_2026')
  const apartmentTemplate = loadStandardText('STD_ASSIGNMENT_TEMPLATE_APARTMENT_2026')
  const statusTemplate = getAssignmentTermsDocument('status').text

  return (
    <NewAssignmentClient
      sellerTemplate={sellerTemplate}
      buyerTemplate={buyerTemplate}
      apartmentTemplate={apartmentTemplate}
      statusTemplate={statusTemplate}
    />
  )
}
