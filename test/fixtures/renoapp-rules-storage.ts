export const supabase = {
  storage: { from: () => ({ uploadToSignedUrl: async () => {
    sessionStorage.setItem('rules-editor-uploaded', '1')
    return { error: null }
  } }) },
}
