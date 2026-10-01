export function isImageAttachment(file: { type?: string; contentType?: string; fileName: string }) {
  return file.type === 'image' || /^image\//i.test(file.contentType ?? '') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.fileName)
}
