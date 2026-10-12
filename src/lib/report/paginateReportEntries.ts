type MeasuredEntry = {
  kind: 'block' | 'spacer'
  sectionStartOnNewPage?: boolean
  keepWithNext?: boolean
}

/** Paginate measured blocks, including the space used by a repeated page heading. */
export function paginateReportEntries<T extends MeasuredEntry>(
  entries: readonly T[],
  availableHeight: number,
  heightOf: (entry: T) => number,
  pageHeading: (entry: T) => { entry: T; height: number } | null = () => null,
  flowOversizedGroups = false
): T[][] {
  const pages: T[][] = []
  let current: T[] = []
  let height = 0
  const flush = () => {
    if (current.some(entry => entry.kind === 'block')) pages.push(current)
    current = []
    height = 0
  }

  for (const [index, entry] of entries.entries()) {
    const entryHeight = heightOf(entry)
    if (entry.kind === 'block' && entry.sectionStartOnNewPage && current.length) flush()
    if (entry.kind === 'spacer' && !current.length) continue
    // Keep appendix headings with the following measured block when the group fits a page.
    let groupHeight = entryHeight
    for (let nextIndex = index + 1; entries[nextIndex - 1].keepWithNext; nextIndex++) {
      const next = entries[nextIndex]
      if (!next || next.kind === 'spacer' || next.sectionStartOnNewPage) break
      groupHeight += heightOf(next)
    }
    const startsGroup = !flowOversizedGroups || index === 0 ||
      !entries[index - 1].keepWithNext || entries[index - 1].kind === 'spacer' || entry.sectionStartOnNewPage
    const headingHeight = entry.keepWithNext ? pageHeading(entry)?.height ?? 0 : 0
    // A long observation can span pages. Do not move its remaining text/photos
    // as a new group after its first segment has already been placed.
    if (flowOversizedGroups && groupHeight + headingHeight > availableHeight) {
      const next = entries[index + 1]
      groupHeight = next && next.kind === 'block' && !next.sectionStartOnNewPage
        ? entryHeight + heightOf(next) : entryHeight
    }
    if (startsGroup && entry.keepWithNext && groupHeight + headingHeight <= availableHeight &&
        height + groupHeight > availableHeight && current.length) flush()
    if (height + entryHeight > availableHeight && current.length) {
      flush()
      if (entry.kind === 'spacer') continue
    }
    if (!current.length) {
      const heading = pageHeading(entry)
      if (heading) {
        current.push(heading.entry)
        height += heading.height
      }
    }
    current.push(entry)
    height += entryHeight
  }
  flush()
  return pages
}
