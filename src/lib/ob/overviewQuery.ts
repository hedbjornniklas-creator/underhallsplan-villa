import type { OverviewPageOptions } from './overview'

export class InvalidOverviewQuery extends Error {}

export function parseOverviewQuery(params: URLSearchParams): OverviewPageOptions {
  const search = (params.get('search') ?? '').trim()
  if (search.length > 200) throw new InvalidOverviewQuery('Sökningen får innehålla högst 200 tecken.')
  const filter = params.get('filter') ?? 'all'
  const sort = params.get('sort') ?? 'date-desc'
  if (!['all', 'active', 'closed'].includes(filter) || !['date-desc', 'date-asc', 'customer', 'address'].includes(sort)) {
    throw new InvalidOverviewQuery('Ogiltigt filter eller sortering.')
  }
  function boolean(key: string) {
    const value = params.get(key) ?? 'false'
    if (value !== 'true' && value !== 'false') throw new InvalidOverviewQuery('Ogiltigt filter.')
    return value === 'true'
  }
  const pageText = params.get('page') ?? '1'
  const sizeText = params.get('pageSize') ?? '10'
  if (!/^[1-9]\d{0,5}$/.test(pageText) || !['10', '25', '50'].includes(sizeText)) {
    throw new InvalidOverviewQuery('Ogiltig sida eller antal rader.')
  }
  return {
    search, filter: filter as OverviewPageOptions['filter'], sort: sort as OverviewPageOptions['sort'],
    attentionOnly: boolean('attentionOnly'), showArchived: boolean('showArchived'),
    page: Number(pageText), pageSize: Number(sizeText) as OverviewPageOptions['pageSize'],
  }
}
