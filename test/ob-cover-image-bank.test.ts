import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node strip-types requires the explicit extension.
import { resolveInspectionCoverUrl } from '../src/lib/ob/inspectionCoverUrl.ts'

const read = (file: string) => readFileSync(new URL('../src/components/ob/' + file, import.meta.url), 'utf8')

test('cover selection copies a file and never moves or deletes the source image', () => {
  const source = read('ObCoverImageBank.tsx')
  assert.match(source, /\.eq\('inspection_id', inspectionId\)/)
  assert.match(source, /building_part_id\.eq\.\$\{partId\},building_part_id\.is\.null/)
  assert.match(source, /offset \+= 500/)
  assert.match(source, /\.download\(image.file_path\)/)
  assert.match(source, /new File\(\[data\]/)
  assert.match(source, /await onSelect\(file\)/)
  assert.doesNotMatch(source, /\.(delete|remove|update)\(/)
})

test('both cover entry points offer the bank and retain previous cover files', () => {
  for (const name of ['ObBuildingCover.tsx', 'ObStepGrunddata.tsx']) {
    const source = read(name)
    assert.match(source, /<ObCoverImageBank/)
    const cover = name === 'ObStepGrunddata.tsx'
      ? source.slice(source.indexOf('const uploadInspectionCoverFile'), source.indexOf('const handleInspectionCoverUpload'))
      : source
    assert.doesNotMatch(cover, /\.remove\(/)
    assert.match(cover, /return false/)
    assert.match(cover, /return true/)
  }
})

test('conditions use the same cover panel without requiring building activation', () => {
  const conditions = read('ObStepForutsattningar.tsx')
  assert.match(conditions, /const panelEntries = \[\s*\{\s*key: BUILDING_COVER_PANEL_KEY/)
  assert.match(conditions, /onInspectionUpdated=\{handleCoverUpdated\}/)
  assert.match(read('ObStepGrunddata.tsx'), /!workspace && !buildingContext\?\.overview.structure/)
  const cover = read('ObBuildingCover.tsx')
  assert.match(cover, /if \(selected.partId\)/)
  assert.match(cover, /enqueueObGrunddataWrite\(inspectionId/)
  assert.match(cover, /update\(\{ cover_path: selected.path \}\)\.eq\('id', inspectionId\)\.is\('locked_at', null\)/)
  assert.match(cover, /recordObGrunddataWriteResult/)
  assert.doesNotMatch(cover, /requestBuildingCommand\([^\n]*'activate'/)
})

test('both cover views preserve stored absolute, storage-prefixed and bucket-relative image paths', () => {
  const publicUrl = (path: string) => `https://storage.example.invalid/storage/v1/object/public/inspection-images/${path}`
  assert.equal(resolveInspectionCoverUrl(null, publicUrl), null)
  assert.equal(resolveInspectionCoverUrl('https://images.example.invalid/cover.jpg', publicUrl), 'https://images.example.invalid/cover.jpg')
  assert.equal(resolveInspectionCoverUrl('/local-cover.jpg', publicUrl), '/local-cover.jpg')
  assert.equal(resolveInspectionCoverUrl('inspection/cover/image.jpg', publicUrl), publicUrl('inspection/cover/image.jpg'))
  for (const path of ['/storage/v1/object/public/inspection-images/image.jpg', 'storage/v1/object/public/inspection-images/image.jpg']) {
    assert.equal(resolveInspectionCoverUrl(path, publicUrl), 'https://storage.example.invalid/storage/v1/object/public/inspection-images/image.jpg')
  }
})
