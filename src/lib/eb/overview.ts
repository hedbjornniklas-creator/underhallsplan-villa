import type { EbInspectionSummary, EbProjectListItem } from './server'
// @ts-expect-error Node's native TypeScript tests require the extension.
import { getEbInspectionLifecycle } from './inspectionLifecycle.ts'

export type EbOverviewFilter = 'active' | 'closed' | 'all'
export type EbOverviewSort = 'date-desc' | 'date-asc' | 'customer' | 'address'
export type EbOverviewItem = {
  id: string; project: EbProjectListItem; inspection: EbInspectionSummary; title: string; address: string; customer: string
  lifecycle: ReturnType<typeof getEbInspectionLifecycle>
}
export function buildEbOverviewItems(projects: EbProjectListItem[]): EbOverviewItem[] {
  return projects.flatMap(project => project.inspections.map(inspection => ({
    id: inspection.inspectionId, project, inspection, title: `${inspection.variantLabel} ${inspection.sequenceNo}`,
    address: project.address || project.propertyDesignation || project.brfApartmentNumber || 'Adress saknas',
    customer: inspection.clientName || project.clientName || 'Beställare saknas',
    lifecycle: getEbInspectionLifecycle(inspection, project.status),
  })))
}
export function selectEbOverviewPage(items: EbOverviewItem[], input: {
  search?: string; filter?: EbOverviewFilter; sort?: EbOverviewSort; attentionOnly?: boolean
  showArchived?: boolean; page?: number; pageSize?: number
} = {}) {
  const search = (input.search || '').trim().toLocaleLowerCase('sv-SE')
  const visible = items.filter(item => (input.showArchived || !['archived', 'cancelled'].includes(item.lifecycle.workStatus))
    && (!search || [item.title, item.address, item.project.title, item.project.city, item.project.propertyDesignation,
      item.project.brfApartmentNumber, item.customer, item.inspection.assignmentNumber].filter(Boolean).join(' ').toLocaleLowerCase('sv-SE').includes(search)))
  const active = (item: EbOverviewItem) => item.lifecycle.isOpen || item.lifecycle.needsAttention
  const counts = { all: visible.length, active: visible.filter(active).length,
    closed: visible.filter(item => item.lifecycle.workStatus === 'completed' && !item.lifecycle.needsAttention).length }
  const rows = visible.filter(item => (input.filter === 'closed' ? item.lifecycle.workStatus === 'completed' && !item.lifecycle.needsAttention
    : input.filter === 'all' ? true : active(item)) && (!input.attentionOnly || item.lifecycle.needsAttention))
  const collator = new Intl.Collator('sv-SE', { numeric: true, sensitivity: 'base' })
  rows.sort((a, b) => {
    if (input.sort === 'customer' || input.sort === 'address') {
      const compared = collator.compare(a[input.sort], b[input.sort]); if (compared) return compared
    } else {
      if (!a.inspection.date && b.inspection.date) return 1
      if (a.inspection.date && !b.inspection.date) return -1
      const compared = (a.inspection.date || '').localeCompare(b.inspection.date || '')
      if (compared) return input.sort === 'date-asc' ? compared : -compared
    }
    return collator.compare(a.project.title, b.project.title) || collator.compare(a.title, b.title) || a.id.localeCompare(b.id)
  })
  const pageSize = [10, 25, 50].includes(input.pageSize || 0) ? input.pageSize! : 10
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.max(1, Math.min(pages, Math.floor(input.page || 1)))
  const start = (page - 1) * pageSize
  return { items: rows.slice(start, start + pageSize), total: rows.length, counts, page, pages, start, pageSize }
}
