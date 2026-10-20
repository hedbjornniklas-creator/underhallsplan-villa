type PreviousInspectionImage = {
  label?: string | null
  reusedFrom?: {
    variant: string
    sequenceNo: number
    inspectionDate: string | null
  } | null
}

const VARIANT_NAMES: Record<string, string> = {
  SLB: 'slutbesiktning',
  FB: 'förbesiktning',
  EB: 'efterbesiktning',
  GB: 'garantibesiktning',
  KSB: 'kompletterande slutbesiktning',
  SAB: 'särskild besiktning',
}

/** Kept separate from the editable caption: an old photo must not look newly taken. */
export function ebImageOriginLabel(image: PreviousInspectionImage): string | null {
  const source = image.reusedFrom
  if (!source) return null
  const variant = VARIANT_NAMES[source.variant] ?? 'besiktning'
  const number = Number.isSafeInteger(source.sequenceNo) && source.sequenceNo > 0
    ? ` ${source.sequenceNo}` : ''
  const date = source.inspectionDate && /^\d{4}-\d{2}-\d{2}$/.test(source.inspectionDate)
    ? ` · ${source.inspectionDate}` : ''
  return `Bild från tidigare ${variant}${number}${date}`
}

/** Copy exports also carry the origin in their caption for older consumers. */
export function ebImageDisplayCaption(image: PreviousInspectionImage): string | null {
  const origin = ebImageOriginLabel(image)
  const caption = image.label?.trim()
  if (!caption) return null
  return (origin ? caption.split('\n').filter(line => line.trim() !== origin).join('\n') : caption).trim() || null
}
