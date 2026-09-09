export const RFQ_FILE_BUCKET = 'action-case-rfq-files'
export const RFQ_MAX_FILES = 30
export const RFQ_FILE_COLUMNS = 'id,file_name,content_type,file_size_bytes,storage_bucket,file_path,attachment_type'
export const RFQ_DELIVERY_COLUMNS = 'id,request_id,quote_id,expires_at,revoked_at,created_at,files'

export type RfqFile = { id: string; fileName: string; contentType: string; fileSizeBytes: number; type: 'image' | 'document' }
export type RfqDelivery = { id: string; expiresAt: string; revokedAt: string | null; createdAt: string; files: RfqFile[] }
export type RfqPublicView = RfqDelivery & { subject: string; body: string; supplierName: string; caseTitle: string; propertyAddress: string }

export function mapRfqDelivery(row: Record<string, unknown>): RfqDelivery {
  return { id: String(row.id), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at), files: (row.files as RfqFile[]).map(({ id, fileName, contentType, fileSizeBytes, type }) => ({ id, fileName, contentType, fileSizeBytes, type })) }
}
