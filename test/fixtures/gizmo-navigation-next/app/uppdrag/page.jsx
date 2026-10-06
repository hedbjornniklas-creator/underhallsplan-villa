import UppdragScope from '@/components/tasks/UppdragScope'
import List from './list'
export const dynamic = 'force-dynamic'
export default async function Page() {
  await new Promise(resolve => setTimeout(resolve, 1500))
  return <UppdragScope><main className="gizmo-workspace p-6"><List /></main></UppdragScope>
}
