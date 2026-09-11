import type { RoundImageUploadItem } from './roundImageUploadQueue'

export function unplacedImagePlacement(): Pick<RoundImageUploadItem, 'sourceArea' | 'origin' | 'link'> {
  return {
    sourceArea: null,
    origin: {
      origin_interior_room_id: null,
      origin_exterior_observation_id: null,
      origin_exterior_item_id: null,
      origin_floor_label: null,
      origin_room_label: null,
      origin_room_type_key: null,
      origin_exterior_item_key: null,
    },
    link: {
      control_item_id: null,
      interior_room_id: null,
      exterior_observation_id: null,
      processing_status: 'unprocessed',
      ignored_at: null,
    },
  }
}

// Persist each file independently; one failed local save must not discard the rest.
export async function queueImageBatch(files: File[], enqueue: (file: File, index: number) => Promise<void>) {
  const failed: string[] = []
  for (const [index, file] of files.entries()) {
    try { await enqueue(file, index) }
    catch { failed.push(file.name) }
  }
  if (failed.length) {
    throw new Error(`${files.length - failed.length} av ${files.length} bilder sparades lokalt. Kunde inte spara: ${failed.join(', ')}. V\u00e4lj dessa bilder igen.`)
  }
}
