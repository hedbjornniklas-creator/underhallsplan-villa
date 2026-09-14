import Image from 'next/image'
import Link from 'next/link'

export default function RenoAppBrand({ href = '/renoapp' }: { href?: string }) {
  return (
    <Link href={href} className="reno-brand" aria-label="RenoApp, startsida">
      <Image src="/renoapp/brand/logo.svg" alt="RenoApp" width={267} height={64} priority />
    </Link>
  )
}
