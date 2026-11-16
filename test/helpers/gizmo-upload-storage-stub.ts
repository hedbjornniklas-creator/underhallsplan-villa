export const supabase = { storage: { from: (bucket: string) => ({
  uploadToSignedUrl: async (path: string, _token: string, file: File) => {
    const fixture = window as typeof window & { gizmoUpload?: (bucket: string, path: string, file: File) => Promise<{ error: unknown }> }
    if (!fixture.gizmoUpload) throw new Error('Missing isolated upload fixture')
    return fixture.gizmoUpload(bucket, path, file)
  },
}) } }
