import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const inputPath = path.join(projectRoot, 'docs', 'RENOAPP_FLOW_BUILDER_HELP.md')
const outputPath = path.join(projectRoot, 'docs', 'RENOAPP_FLOW_BUILDER_HELP.pdf')

const source = fs.readFileSync(inputPath, 'utf8').replace(/\r/g, '')

function normalizeMarkdownLine(line) {
  if (/^#{1,6}\s+/.test(line)) {
    return line.replace(/^#{1,6}\s+/, '').trim().toUpperCase()
  }
  if (/^\s*-\s+/.test(line)) {
    return `- ${line.replace(/^\s*-\s+/, '').trim()}`
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    return line.trim()
  }
  return line.trim()
}

function wrapLine(text, maxChars) {
  if (!text) return ['']
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }

  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

function markdownToLines(markdown) {
  const raw = markdown.split('\n').map(normalizeMarkdownLine)
  const wrapped = []
  const maxChars = 98

  for (const line of raw) {
    if (!line) {
      wrapped.push('')
      continue
    }
    wrapped.push(...wrapLine(line, maxChars))
  }

  return wrapped
}

function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function paginate(lines, linesPerPage) {
  const pages = []
  let current = []

  for (const line of lines) {
    if (current.length >= linesPerPage) {
      pages.push(current)
      current = []
    }
    current.push(line)
  }

  if (current.length > 0) pages.push(current)
  return pages
}

function buildPdf(pages) {
  const objects = []

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = null
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'

  const pageIds = []
  let objectId = 4

  for (const pageLines of pages) {
    const contentId = objectId++
    const pageId = objectId++
    pageIds.push(pageId)

    const textOps = []
    textOps.push('BT')
    textOps.push('/F1 11 Tf')
    textOps.push('14 TL')
    textOps.push('1 0 0 1 50 792 Tm')

    let first = true
    for (const line of pageLines) {
      if (!first) textOps.push('T*')
      textOps.push(`(${escapePdfText(line)}) Tj`)
      first = false
    }

    textOps.push('ET')
    const streamContent = `${textOps.join('\n')}\n`
    const streamBytes = Buffer.from(streamContent, 'latin1')

    objects[contentId] = `<< /Length ${streamBytes.length} >>\nstream\n${streamContent}endstream`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
  }

  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  const parts = []
  const offsets = [0]

  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')
  parts.push(header)

  let cursor = header.length

  for (let i = 1; i < objects.length; i++) {
    const objText = `${i} 0 obj\n${objects[i]}\nendobj\n`
    const objBytes = Buffer.from(objText, 'latin1')
    offsets[i] = cursor
    parts.push(objBytes)
    cursor += objBytes.length
  }

  const xrefStart = cursor
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  parts.push(Buffer.from(xref, 'latin1'))
  parts.push(Buffer.from(trailer, 'latin1'))

  return Buffer.concat(parts)
}

const lines = markdownToLines(source)
const pages = paginate(lines, 50)
const pdfBuffer = buildPdf(pages)

fs.writeFileSync(outputPath, pdfBuffer)
console.log(`Created ${outputPath} (${pdfBuffer.length} bytes, ${pages.length} pages)`)
