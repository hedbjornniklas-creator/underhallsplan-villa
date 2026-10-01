// Uploads in the isolated UI fixture never contact live storage.
export const supabase = { storage: { from: () => ({
  uploadToSignedUrl: async () => ({ data: null, error: { message: 'Uppladdning är avstängd i den fiktiva demonstrationen.' } })
}) } }
