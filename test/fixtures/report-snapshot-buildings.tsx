import { createRoot } from 'react-dom/client'
import ReportSnapshotView from '../../src/components/report/ReportSnapshotView'
import { snapshotWithBuildings } from './report-snapshot-buildings-data'

const snapshot = snapshotWithBuildings()
if (new URLSearchParams(location.search).has('single')) {
  Object.assign(snapshot.reportData.mock, { appendices: {} })
}
createRoot(document.getElementById('root')!).render(<ReportSnapshotView snapshot={snapshot} />)
