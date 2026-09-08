import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FlowBuilder from '../../src/app/(app)/admin/renoapp/flow-builder/page'

createRoot(document.getElementById('root')!).render(<StrictMode><FlowBuilder /></StrictMode>)
