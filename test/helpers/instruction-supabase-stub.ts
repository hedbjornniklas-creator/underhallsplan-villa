export const supabase = { storage: { from: () => ({
  async uploadToSignedUrl(path: string, _token: string, file: File) {
    const response = await fetch(`/test/upload/${encodeURIComponent(path)}`, { method: 'PUT', body: file })
    return { error: response.ok ? null : { message: 'Simulated upload failure' } }
  },
}) } }
