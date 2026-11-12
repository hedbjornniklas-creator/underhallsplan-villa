import type { ImgHTMLAttributes } from 'react'
export default function PreviewImage({ priority, fill, unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean; unoptimized?: boolean }) {
  void priority; void unoptimized
  return <img {...props} style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...props.style } : props.style} />
}
