import { notFound, redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireOrgContext } from '@/lib/assignments/server'
import { buildReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'
import { buildReportSpec } from '@/lib/report/reportSpec'
import {
  createReportSnapshotPayloadV1,
  type ReportSnapshotPayloadV1,
} from '@/lib/report/pdfV2/renderStructuredPdfV2'
import ReportSnapshotView from '@/components/report/ReportSnapshotView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Förhandsgranskning utlåtande',
  robots: {
    index: false,
    follow: false,
  },
}

type InspectionForPreview = {
  id: string
  property_id: string | null
  inspection_side: 'buyer' | 'seller' | 'apartment' | null
}

export default async function ReportPreviewPage({
  params,
}: {
  params: Promise<{ inspectionId: string }>
}) {
  const { inspectionId } = await params

  let org: Awaited<ReturnType<typeof requireOrgContext>>
  try {
    org = await requireOrgContext()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED' || message === 'ORG_MEMBERSHIP_REQUIRED') {
      redirect('/login')
    }
    throw error
  }

  const admin = createSupabaseAdminClient()

  const { data: inspectionData, error: inspectionError } = await admin
    .from('inspections')
    .select('id,property_id,inspection_side')
    .eq('id', inspectionId)
    .maybeSingle()

  if (inspectionError) {
    throw new Error(inspectionError.message ?? 'Kunde inte läsa besiktning.')
  }

  const inspection = (inspectionData ?? null) as InspectionForPreview | null
  if (!inspection) notFound()

  const { data: assignmentData, error: assignmentError } = await admin
    .from('assignments')
    .select('id,property_id')
    .eq('org_id', org.orgId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (assignmentError) {
    throw new Error(assignmentError.message ?? 'Kunde inte läsa uppdragsbekräftelse.')
  }

  if (!assignmentData) {
    const { data: propertyData, error: propertyError } = await admin
      .from('properties')
      .select('id')
      .eq('id', inspection.property_id)
      .eq('owner', org.userId)
      .maybeSingle()

    if (propertyError) {
      throw new Error(propertyError.message ?? 'Kunde inte verifiera besiktningsaccess.')
    }
    if (!propertyData) notFound()
  }

  const propertyId = (assignmentData?.property_id as string | null) ?? inspection.property_id
  if (!propertyId) {
    throw new Error('Besiktningen saknar kopplad fastighet.')
  }

  const inspectionSideRaw =
    inspection.inspection_side === 'seller'
      ? 'seller'
      : inspection.inspection_side === 'apartment'
        ? 'apartment'
        : 'buyer'
  const specInspectionSide = inspectionSideRaw === 'seller' ? 'seller' : 'buyer'
  const reportData = await buildReportDataV2({
    inspectionId,
    propertyId,
  })
  const reportSpec = buildReportSpec({ inspectionSide: specInspectionSide })
  const snapshot: ReportSnapshotPayloadV1 = createReportSnapshotPayloadV1({
    inspectionId,
    propertyId,
    inspectionSide: inspectionSideRaw,
    reportData,
    reportSpec,
  })

  return (
    <ReportSnapshotView
      snapshot={snapshot}
      heading="Förhandsgranska utlåtande"
      subtitle="Live-visning före skick. Ingen låsning har gjorts ännu."
      showPdfActions={false}
      showHeader={false}
    />
  )
}
