import type { TuAnalysisItem } from '@/lib/tu/analysis'

export type TuAppendixSourceImage = {
  id: string
  sectionKey: 'bank' | 'appendix' | 'cover'
  caption: string | null
  reportCaption?: string | null
}

export type TuAppendixSuggestion = {
  imageId: string
  caption: string
  groupLabel: string
  reason: string
  sourceItemId: string
  sortOrder: number
}

const GENERIC_IMAGE_CAPTION = /^(?:bild|foto|besiktningsbild)(?:\s+\d+)?$/i

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

export function isGenericTuImageCaption(value: string | null | undefined) {
  const caption = clean(value)
  return !caption || GENERIC_IMAGE_CAPTION.test(caption)
}

export function effectiveTuReportImageCaption(image: TuAppendixSourceImage) {
  return clean(image.reportCaption) || clean(image.caption)
}

export function resolveTuPrintImageCaption(
  image: TuAppendixSourceImage,
  index: number
) {
  return effectiveTuReportImageCaption(image) || `Bild ${index + 1}`
}

function conciseCaption(value: string) {
  const caption = clean(value)
  if (caption.length <= 320) return caption

  const shortened = caption.slice(0, 320)
  const sentenceEnd = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf(';'))
  if (sentenceEnd >= 120) return shortened.slice(0, sentenceEnd + 1)
  return `${shortened.slice(0, 317).trimEnd()}...`
}

function groupLabel(item: TuAnalysisItem) {
  const source = item.sourceObservations.find((observation) => (
    clean(observation.location) || clean(observation.buildingComponent)
  ))
  const sourceLabel = [clean(source?.location), clean(source?.buildingComponent)]
    .filter(Boolean)
    .join(' · ')
  return sourceLabel || clean(item.title) || 'Övriga bilder'
}

function suggestedCaption(item: TuAnalysisItem, image: TuAppendixSourceImage) {
  const existingCaption = effectiveTuReportImageCaption(image)
  if (item.itemType !== 'report_image' && !isGenericTuImageCaption(existingCaption)) {
    return conciseCaption(existingCaption)
  }
  return conciseCaption(item.summary)
}

function suggestionReason(item: TuAnalysisItem) {
  if (item.itemType === 'report_image') return 'AI:n bedömer att bilden stödjer utlåtandets centrala innehåll.'
  return `Bilden är kopplad till den rapportrelevanta observationen ”${clean(item.title)}”.`
}

export function buildTuAppendixSuggestions(input: {
  items: TuAnalysisItem[]
  images: TuAppendixSourceImage[]
  maxSuggestions?: number
}) {
  const maxSuggestions = Math.max(1, input.maxSuggestions ?? 12)
  const imageById = new Map(
    input.images
      .filter((image) => image.sectionKey === 'bank')
      .map((image) => [image.id, image])
  )
  const eligibleItems = input.items
    .filter((item) => item.reviewStatus !== 'rejected')
    .sort((left, right) => left.sortOrder - right.sortOrder)
  const reportImageItems = eligibleItems.filter((item) => item.itemType === 'report_image')
  const sourceItems = reportImageItems.length > 0
    ? reportImageItems
    : eligibleItems.filter((item) => item.itemType === 'image_observation' && item.includeInReport)
  const seenImageIds = new Set<string>()
  const suggestions: TuAppendixSuggestion[] = []

  for (const item of sourceItems) {
    for (const imageId of item.sourceImageIds) {
      const image = imageById.get(imageId)
      if (!image || seenImageIds.has(imageId)) continue

      const caption = suggestedCaption(item, image)
      if (isGenericTuImageCaption(caption)) continue

      seenImageIds.add(imageId)
      suggestions.push({
        imageId,
        caption,
        groupLabel: groupLabel(item),
        reason: suggestionReason(item),
        sourceItemId: item.id,
        sortOrder: suggestions.length * 10 + 10,
      })
      if (suggestions.length >= maxSuggestions) return suggestions
    }
  }

  return suggestions
}
