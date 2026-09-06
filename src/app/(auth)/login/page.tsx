import PublicLogin from '@/components/public/PublicLogin'
import { getPublicLoginDestination } from '@/lib/publicNavigation'

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[]; reset?: string | string[] }>
}) {
  const params = await searchParams
  return <PublicLogin destination={getPublicLoginDestination(params.next)} resetSuccess={params.reset === 'success'} />
}
