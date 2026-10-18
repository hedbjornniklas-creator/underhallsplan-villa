// Isolated choice-file UI fixture: bytes stay on this localhost server.
export const supabase = { storage: { from: () => ({
  uploadToSignedUrl: async (path: string, _token: string, file: File) => {
    const response = await fetch(`/__test__/choice-pdf-upload/${encodeURIComponent(path)}`, { method: 'PUT', body: file })
    return { data: null, error: response.ok ? null : { message: 'Fiktiv uppladdning misslyckades.' } }
  }
}) } }
