export function resolveInspectionCoverUrl(
  path: string | null | undefined,
  publicUrl: (path: string) => string
): string | null {
  if (!path) return null
  if (/^https?:\/\//.test(path)) return path
  if (/^\/?storage\//.test(path)) {
    return new URL(path.startsWith('/') ? path : `/${path}`, publicUrl(path)).href
  }
  if (path.startsWith('/')) return path
  return publicUrl(path)
}
