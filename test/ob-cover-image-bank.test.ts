import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

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
