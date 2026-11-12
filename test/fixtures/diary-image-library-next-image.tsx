import type { ImgHTMLAttributes } from 'react'
export default function PreviewImage({ fill, unoptimized, priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean; priority?: boolean }) {
  void unoptimized; void priority
  // This fixture mirrors next/image's fill positioning; it never accesses production.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} style={{ ...props.style, ...(fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : {}) }} />
}
