type ReviewSection = { key: string }

// These legacy sections no longer have their own output. Their facts belong to
// reclamation_notice and remedy_deadline; keep the stored sections untouched.
const RETIRED_REVIEW_SECTION_KEYS = new Set(['warranty_end', 'after_inspection'])

const REVIEW_SECTION_CHILDREN: Record<string, readonly string[]> = {
  defects_appendices: ['marker_legend', 'deduction', 'notes'],
  distribution_list: ['signature_certificate'],
}

/** Follow report order without presenting a second editor for integrated parts. */
export function ebReviewSectionKeys(sections: readonly ReviewSection[]): string[] {
  const presentKeys = new Set(sections.map((section) => section.key))
  const groupedKeys = new Set(
    Object.entries(REVIEW_SECTION_CHILDREN)
      .filter(([parent]) => presentKeys.has(parent))
      .flatMap(([, children]) => children)
  )

  return sections
    .filter(
      (section) =>
        !RETIRED_REVIEW_SECTION_KEYS.has(section.key) && !groupedKeys.has(section.key)
    )
    .map((section) => section.key)
}

export function ebReviewChildSectionKeys(
  parentKey: string,
  sections: readonly ReviewSection[]
): string[] {
  if (!sections.some((section) => section.key === parentKey)) return []
  const children = REVIEW_SECTION_CHILDREN[parentKey] ?? []
  return sections
    .filter((section) => children.includes(section.key))
    .map((section) => section.key)
}
