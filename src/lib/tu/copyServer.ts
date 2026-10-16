import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizeTuOrdererRole } from './customerRole'
import { tuCopyCustomerAddress, tuCopyMatchesCustomer, tuCopyPartyFields, type TuCopyRegisteredCustomer, type TuCopySource } from './copy'

export async function getTuCopySource(orgId: string, inspectionId: string): Promise<TuCopySource | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inspectionId)) return null
  const admin = createSupabaseAdminClient()
  // Read directly: the normal report getter can assign a missing work number.
  const detailResult = await admin.from('technical_investigation_details')
    .select('inspection_id,property_id,assignment_id,title,report_template_key,property_object_type,scope_description,brf_name,apartment_number,apartment_holder_name,invoice_email,report_draft')
    .eq('org_id', orgId).eq('inspection_id', inspectionId).maybeSingle()
  if (detailResult.error) throw new Error('TU_COPY_SOURCE_FAILED')
  const detail = detailResult.data
  if (!detail) return null
  const inspectionResult = await admin.from('inspections')
    .select('customer_name,customer_email,customer_phone,customer_address,customer_postal_code,customer_city')
    .eq('id', inspectionId).eq('inspection_family', 'TU').maybeSingle()
  if (inspectionResult.error || !inspectionResult.data) throw new Error('TU_COPY_SOURCE_FAILED')
  const inspection = inspectionResult.data
  const propertyResult = detail.property_id ? await admin.from('properties')
    .select('address,postal_code,city,municipality,cadastral_id,owner_name')
    .eq('id', detail.property_id).maybeSingle() : { data: null, error: null }
  const assignmentResult = detail.assignment_id ? await admin.from('assignments')
    .select('customer_name,customer_email,customer_phone,customer_address,customer_postal_code,customer_city,invoice_email,invoice_name,invoice_address,personal_identity_number,orderer_role,price_amount,assignment_details,organization_customer_id')
    .eq('org_id', orgId).eq('id', detail.assignment_id).eq('assignment_type', 'TU').maybeSingle() : { data: null, error: null }
  if (propertyResult.error || assignmentResult.error) throw new Error('TU_COPY_SOURCE_FAILED')
  const property = propertyResult.data
  const assignment = assignmentResult.data
  const parties = tuCopyPartyFields(detail.report_draft)
  let linkedCustomer: TuCopyRegisteredCustomer | null = null
  if (assignment?.organization_customer_id) {
    const customer = await admin.from('organization_customers').select('id,version,is_active,customer_type,name,email,phone,address,postal_code,city,invoice_same_as_customer,invoice_name,invoice_email,invoice_address')
      .eq('org_id', orgId).eq('id', assignment.organization_customer_id).maybeSingle()
    if (customer.error) throw new Error('TU_COPY_SOURCE_FAILED')
    linkedCustomer = customer.data as TuCopyRegisteredCustomer | null
  }
  const assignmentDetails = assignment?.assignment_details as { customerType?: string } | null
  const source: TuCopySource = {
    inspectionId,
    title: detail.title ?? 'Teknisk utredning',
    reportTemplateKey: detail.report_template_key ?? '',
    objectType: detail.property_object_type === 'apartment' ? 'apartment' : 'villa',
    customerType: assignmentDetails?.customerType === 'business' ? 'business' : 'consumer',
    customerName: parties.customerName ?? inspection.customer_name ?? assignment?.customer_name ?? '',
    customerEmail: parties.customerEmail ?? inspection.customer_email ?? assignment?.customer_email ?? '',
    customerPhone: parties.customerPhone ?? inspection.customer_phone ?? assignment?.customer_phone ?? '',
    ...tuCopyCustomerAddress(parties.customerAddress,
      inspection.customer_address ?? assignment?.customer_address ?? '',
      inspection.customer_postal_code ?? assignment?.customer_postal_code ?? '',
      inspection.customer_city ?? assignment?.customer_city ?? ''),
    invoiceEmail: detail.invoice_email ?? assignment?.invoice_email ?? '',
    customerIdentityNumber: parties.customerIdentityNumber ?? assignment?.personal_identity_number ?? '',
    customerRole: normalizeTuOrdererRole(parties.customerRole ?? assignment?.orderer_role) ?? '',
    invoiceName: parties.invoiceName ?? assignment?.invoice_name ?? '',
    invoiceAddress: parties.invoiceAddress ?? assignment?.invoice_address ?? '',
    propertyAddress: property?.address ?? '', propertyPostalCode: property?.postal_code ?? '',
    propertyCity: property?.city ?? '', propertyMunicipality: property?.municipality ?? '',
    propertyOwnerName: parties.propertyOwnerName ?? property?.owner_name ?? '',
    cadastralId: property?.cadastral_id ?? '', brfName: detail.brf_name ?? '',
    apartmentNumber: detail.apartment_number ?? '', apartmentHolderName: detail.apartment_holder_name ?? '',
    scopeDescription: detail.scope_description ?? '',
    priceAmount: assignment?.price_amount == null ? '' : String(assignment.price_amount),
    customerBinding: null,
  }
  if (linkedCustomer && tuCopyMatchesCustomer(source, linkedCustomer)) {
    source.customerBinding = { mode: 'existing', customerId: linkedCustomer.id, customerVersion: Number(linkedCustomer.version) }
  }
  return source
}
