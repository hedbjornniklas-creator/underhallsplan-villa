import type { ImgHTMLAttributes } from 'react'
export default function PreviewImage({ priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) {
  void priority
  return <img {...props} />
}
