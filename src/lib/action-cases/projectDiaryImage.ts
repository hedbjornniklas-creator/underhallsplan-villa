import sharp from 'sharp'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { DIARY_IMAGE_TYPES, DIARY_MAX_PHOTO_BYTES } from './projectDiary.ts'

export async function validateDiaryImage(bytes: Buffer, contentType: string, expectedSize: number) {
  try {
    if (bytes.length !== expectedSize || bytes.length < 1 || bytes.length > DIARY_MAX_PHOTO_BYTES || !DIARY_IMAGE_TYPES.includes(contentType as typeof DIARY_IMAGE_TYPES[number])) throw new Error()
    const matches = contentType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    if (!matches) throw new Error()
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }), meta = await image.metadata()
    if (`image/${meta.format}` !== contentType || (meta.pages || 1) !== 1 || !meta.width || !meta.height) throw new Error()
    await image.resize(1, 1).raw().toBuffer()
  } catch { throw new Error('PROJECT_DIARY_PHOTO') }
}
