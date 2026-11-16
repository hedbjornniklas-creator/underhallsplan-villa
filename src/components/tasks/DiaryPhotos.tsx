'use client'
/* eslint-disable @next/next/no-img-element -- Originals use authenticated diary URLs. */
import { useState } from 'react'
import ActionCaseImageViewer from './ActionCaseImageViewer'

export default function DiaryPhotos({ endpoint, photos }: { endpoint: string; photos: { id: string; name: string }[] }) {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const url = (id: string) => `${endpoint}/photos/${id}`
  return <>
    <div className="diary-record-photos">{photos.map(photo => <button type="button" key={photo.id} onClick={() => setOpenedId(photo.id)} title={`Granska ${photo.name}`} aria-label={`Granska ${photo.name}`}><img src={url(photo.id)} alt={photo.name} loading="lazy" /></button>)}</div>
    {openedId && <ActionCaseImageViewer caseId="" images={photos.map(photo => ({ id: photo.id, fileName: photo.name, title: null }))} openedId={openedId} onOpen={setOpenedId} onClose={() => setOpenedId(null)} urlForFile={url} />}
  </>
}
