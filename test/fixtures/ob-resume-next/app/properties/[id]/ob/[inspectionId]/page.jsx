'use client'
import dynamic from 'next/dynamic'
// The fixture's synthetic room records use window/location. The page and router
// under test are production code; only data, auth and unrelated steps are mocked.
const Inspection = dynamic(() => import('@/app/(app)/properties/[id]/ob/[inspectionId]/page'), { ssr: false })
export default function Page() { return <Inspection /> }
