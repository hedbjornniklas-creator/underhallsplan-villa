import type { ActionCaseAttachmentView } from './contracts'
import type { DiaryLibraryImage } from './projectDiary'
import { isImageAttachment } from './attachmentImages'

export type ProjectLibraryImage = ActionCaseAttachmentView & { source: 'project' | 'diary'; url: string; caption: string }
export const diaryImageCaption = (photo: DiaryLibraryImage) => ['Dagbok', photo.workDate, photo.personName, photo.company, photo.itemTitle].filter(Boolean).join(' · ')
export function projectLibraryImages(caseId: string, files: ActionCaseAttachmentView[], photos: DiaryLibraryImage[]): ProjectLibraryImage[] {
  return [
    ...files.filter(isImageAttachment).map(file => ({ ...file, source: 'project' as const, url: `/api/action-cases/${caseId}/attachments/${file.id}`, caption: 'Projektfil' })),
    ...photos.map(photo => ({ id: `diary:${photo.id}`, source: 'diary' as const, type: 'image' as const, actionCaseItemId: photo.itemId,
      title: photo.name, fileName: photo.name, contentType: photo.contentType, fileSizeBytes: photo.size, grantedParticipantIds: [], createdAt: photo.receivedAt,
      url: `/api/action-cases/${caseId}/diary/photos/${photo.id}`, caption: diaryImageCaption(photo) })),
  ]
}
