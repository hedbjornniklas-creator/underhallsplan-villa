import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'

type Appendix = { bytes: Uint8Array; indices?: readonly number[] }

export async function appendPdfDocuments(base: Uint8Array, appendices: readonly Appendix[]): Promise<Buffer> {
  const document = await PDFDocument.load(base, { updateMetadata: false })
  for (const appendix of appendices) {
    const source = await PDFDocument.load(appendix.bytes, { updateMetadata: false })
    const indices = appendix.indices ?? source.getPageIndices()
    if (!indices.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= source.getPageCount()) || document.getPageCount() + indices.length > 200)
      throw new Error('PDF_APPEND_PAGES_INVALID')
    for (const index of indices) {
      const page = source.getPage(index)
      if (page.node.has(PDFName.of('AA'))) throw new Error('PDF_APPEND_INTERACTIVE')
      const annotations = page.node.Annots()
      for (let i = 0; i < (annotations?.size() ?? 0); i++) {
        const annotation = annotations!.lookup(i, PDFDict)
        if (annotation.get(PDFName.of('Subtype'))?.toString() !== '/Link' || annotation.has(PDFName.of('AA'))) throw new Error('PDF_APPEND_INTERACTIVE')
        const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict)
        const kind = action?.get(PDFName.of('S'))?.toString()
        if (kind && !['/URI', '/GoTo'].includes(kind)) throw new Error('PDF_APPEND_INTERACTIVE')
        if (kind === '/URI') {
          const uri = action!.lookup(PDFName.of('URI'))
          if (!(uri instanceof PDFString || uri instanceof PDFHexString) || !/^(https?:|mailto:)/iu.test(uri.decodeText())) throw new Error('PDF_APPEND_INTERACTIVE')
        }
      }
    }
    for (const page of await document.copyPages(source, [...indices])) document.addPage(page)
  }
  return Buffer.from(await document.save({ updateFieldAppearances: false }))
}

export async function appendPdfPages(base: Uint8Array, appendix: Uint8Array, indices: readonly number[]): Promise<Buffer> {
  return appendPdfDocuments(base, [{ bytes: appendix, indices }])
}
