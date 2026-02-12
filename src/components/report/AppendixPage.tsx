import { ACCENT_COLOR, REPORT_STYLES, mmToPx } from '@/lib/report/reportTokens'
import type { ReactElement } from 'react'

type AppendixPageProps = {
  title: string
  rawText: string
  variant?: 'longform' | 'glossary' | 'lifespan'
  showTitle?: boolean
}

export default function AppendixPage({
  title,
  rawText,
  variant = 'longform',
  showTitle = true,
}: AppendixPageProps) {
  const rawLines = rawText.split(/\r?\n/)
  const lines = rawLines.reduce<string[]>((acc, line) => {
    const isBlank = line.trim().length === 0
    if (isBlank && acc.length === 0) return acc
    if (isBlank && acc[acc.length - 1]?.trim().length === 0) return acc
    acc.push(line)
    return acc
  }, [])
  while (lines.length && lines[lines.length - 1].trim().length === 0) {
    lines.pop()
  }
  const firstLineIndex = lines.findIndex(line => line.trim().length > 0)
  const isLongform = variant === 'longform'
  const isGlossary = variant === 'glossary'
  const isLifespan = variant === 'lifespan'
  const baseFontSize = isLifespan ? '10pt' : REPORT_STYLES.BODY.fontSize
  const exceptionFontSize = isLifespan ? '11pt' : baseFontSize
  const columnStyles = {}

  const exceptionHeadings = [
    'Vid köp av en fastighet bör man räkna med olika intervall för renovering och underhåll.',
    'Byggmaterial och konstruktioner har begränsad livslängd.',
    'Anmärkning:',
    'Till grund för livslängdsuppgifter finns bland annat Meddelande M84:10 Statens Institut för Byggnadsforskning, Sammanställning av livslängdsuppgifter, SABO-avskrivningsregler samt erfarenhetsmässiga värden.',
  ]

  const exceptionIndexes = lines.reduce<number[]>((acc, line, index) => {
    const trimmed = line.trim()
    if (exceptionHeadings.some(heading => trimmed.startsWith(heading))) {
      acc.push(index)
    }
    return acc
  }, [])

  const exceptionStart = exceptionIndexes.length > 0 ? Math.min(...exceptionIndexes) : -1
  const exceptionEnd = exceptionIndexes.length > 0 ? Math.max(...exceptionIndexes) : -1

  const renderGlossaryLines = (segment: string[], offset: number) => {
    const entries: Array<{ term: string; definition?: string }> = []
    let i = 0

    while (i < segment.length) {
      const line = segment[i]?.trim() ?? ''
      if (!line) {
        i += 1
        continue
      }
      const nextLine = segment[i + 1]?.trim() ?? ''
      if (nextLine) {
        entries.push({ term: line, definition: nextLine })
        i += 2
      } else {
        entries.push({ term: line })
        i += 1
      }
    }

    const splitIndex = Math.ceil(entries.length / 2)
    const left = entries.slice(0, splitIndex)
    const right = entries.slice(splitIndex)

    const renderColumn = (items: Array<{ term: string; definition?: string }>, colIndex: number) => (
      <div
        key={`appendix-col-${colIndex}`}
        style={{ display: 'flex', flexDirection: 'column', gap: '6pt' }}
      >
        {items.map((entry, entryIndex) => (
          <div
            key={`appendix-entry-${colIndex}-${entryIndex}`}
            style={{ breakInside: 'avoid' }}
          >
            <div style={{ fontWeight: 700, fontSize: baseFontSize }}>{entry.term}</div>
            {entry.definition ? (
              <div style={{ fontSize: baseFontSize }}>{entry.definition}</div>
            ) : null}
          </div>
        ))}
      </div>
    )

    return [
      <div
        key={`appendix-glossary-${offset}`}
        style={{ display: 'flex', gap: mmToPx(12) }}
      >
        <div style={{ flex: 1 }}>{renderColumn(left, 0)}</div>
        <div style={{ flex: 1 }}>{renderColumn(right, 1)}</div>
      </div>,
    ]
  }

  const renderPlainLines = (
    segment: string[],
    offset: number,
    fontSizeOverride?: string
  ) =>
    segment.map((line, index) => {
      if (line.trim().length === 0) {
        return (
          <div
            key={`appendix-blank-${offset + index}`}
            style={{ minHeight: fontSizeOverride ?? baseFontSize }}
          />
        )
      }

      const trimmed = line.replace(/\s+$/, '')
      const isFirst = offset + index === firstLineIndex
      const isHeading =
        isLongform &&
        !isFirst &&
        trimmed.length > 0 &&
        trimmed.length < 50 &&
        !trimmed.includes('.')
      const emphasizeFirst = isLongform && isFirst
      const fontSize = fontSizeOverride ?? (emphasizeFirst ? '12pt' : baseFontSize)

      return (
        <div
          key={`appendix-line-${offset + index}`}
          style={{
            fontSize,
            fontWeight: emphasizeFirst || isHeading ? 700 : 400,
            whiteSpace: 'pre-wrap',
          }}
        >
          {trimmed}
        </div>
      )
    })

  const renderLifespanColumns = (segment: string[], offset: number) => {
    type LifespanEntry =
      | { kind: 'heading'; text: string }
      | { kind: 'row'; left: string; right: string }
      | { kind: 'gap' }

    const separatorCandidates = ['|', 'Æ’?', 'â€“', '-']
    const isSeparatorLine = (line: string) =>
      separatorCandidates.some((sep) => line.includes(sep))

    const splitLine = (line: string) => {
      let idx = -1
      let sep = ''
      separatorCandidates.forEach((candidate) => {
        const lastIndex = line.lastIndexOf(candidate)
        if (lastIndex > idx) {
          idx = lastIndex
          sep = candidate
        }
      })
      if (idx === -1) return null
      const left = line.slice(0, idx).replace(/^[\s|Æ’â€“-]+/, '').trim()
      const right = line.slice(idx + sep.length).trim()
      if (!right) return null
      return { left, right }
    }

    const entries: LifespanEntry[] = []
    for (let i = 0; i < segment.length; i += 1) {
      const line = segment[i] ?? ''
      const trimmed = line.trim()

      if (!trimmed) {
        entries.push({ kind: 'gap' })
        continue
      }

      if (trimmed.startsWith('#')) {
        continue
      }

      if (isSeparatorLine(line)) {
        const parsed = splitLine(line)
        if (parsed) {
          entries.push({ kind: 'row', left: parsed.left, right: parsed.right })
          if (parsed.left.includes('Nytt undertak, invÃ¤ndigt')) {
            entries.push({ kind: 'gap' })
          }
          continue
        }
      }

      const nextLine = segment[i + 1] ?? ''
      if (nextLine && isSeparatorLine(nextLine) && nextLine.trim().startsWith('(')) {
        const parsedNext = splitLine(nextLine)
        if (parsedNext) {
          entries.push({
            kind: 'row',
            left: `${trimmed} ${parsedNext.left}`,
            right: parsedNext.right,
          })
          i += 1
          continue
        }
      }

      const nextHasSeparator = nextLine ? isSeparatorLine(nextLine) : false
      const isHeading = !isSeparatorLine(line) && (!nextLine || nextHasSeparator)

      entries.push(
        isHeading
          ? { kind: 'heading', text: trimmed }
          : { kind: 'row', left: trimmed, right: '' }
      )
    }

    const blocks: LifespanEntry[][] = []
    let current: LifespanEntry[] = []
    entries.forEach((entry) => {
      if (entry.kind === 'heading' && current.length > 0) {
        blocks.push(current)
        current = [entry]
      } else {
        current.push(entry)
      }
    })
    if (current.length > 0) blocks.push(current)

    const blockSize = (block: LifespanEntry[]) =>
      block.reduce((sum, entry) => sum + (entry.kind === 'gap' ? 0.5 : 1), 0)

    const totalSize = blocks.reduce((sum, block) => sum + blockSize(block), 0)
    const targetSize = totalSize / 2
    const leftBlocks: LifespanEntry[][] = []
    const rightBlocks: LifespanEntry[][] = []
    let running = 0

    blocks.forEach((block) => {
      const size = blockSize(block)
      if (leftBlocks.length === 0 || running + size <= targetSize) {
        leftBlocks.push(block)
        running += size
      } else {
        rightBlocks.push(block)
      }
    })

    const renderColumn = (columnBlocks: LifespanEntry[][], colIndex: number) => (
      <div
        key={`appendix-lifespan-col-${offset}-${colIndex}`}
        style={{ display: 'flex', flexDirection: 'column', gap: '6pt' }}
      >
        {columnBlocks.flat().map((entry, entryIndex) => {
          if (entry.kind === 'gap') {
            return (
              <div
                key={`appendix-lifespan-gap-${colIndex}-${entryIndex}`}
                style={{ minHeight: baseFontSize }}
              />
            )
          }
          if (entry.kind === 'heading') {
            return (
              <div
                key={`appendix-lifespan-heading-${colIndex}-${entryIndex}`}
                style={{
                  fontWeight: 700,
                  fontSize: baseFontSize,
                  breakInside: 'avoid',
                }}
              >
                {entry.text}
              </div>
            )
          }
          return (
            <div
              key={`appendix-lifespan-row-${colIndex}-${entryIndex}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: mmToPx(4),
                fontSize: baseFontSize,
                breakInside: 'avoid',
              }}
            >
              <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{entry.left}</div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{entry.right}</div>
            </div>
          )
        })}
      </div>
    )

    return [
      <div
        key={`appendix-lifespan-${offset}`}
        style={{ display: 'flex', gap: mmToPx(12) }}
      >
        <div style={{ flex: 1 }}>{renderColumn(leftBlocks, 0)}</div>
        <div style={{ flex: 1 }}>{renderColumn(rightBlocks, 1)}</div>
      </div>,
    ]
  }
const renderLines = (segment: string[], offset: number) => {
    if (isGlossary) return renderGlossaryLines(segment, offset)
    if (isLifespan) return renderLifespanColumns(segment, offset)
    return renderPlainLines(segment, offset)
  }

  return (
    <div>
      {showTitle && (
        <>
          <div
            style={{
              fontSize: REPORT_STYLES.H1.fontSize,
              fontWeight: 700,
              color: ACCENT_COLOR,
              marginBottom: '6pt',
            }}
          >
            {title}
          </div>
          <div
            style={{
              height: mmToPx(1.5),
              backgroundColor: ACCENT_COLOR,
              marginBottom: '6pt',
            }}
          />
        </>
      )}
      {variant === 'lifespan' && exceptionStart >= 0 ? (
        <>
          {exceptionStart > 0 && (
            <div
            style={{
              fontSize: baseFontSize,
              color: '#000000',
              lineHeight: 1.15,
              ...columnStyles,
              marginBottom: '6pt',
            }}
            >
              {renderLines(lines.slice(0, exceptionStart), 0)}
            </div>
          )}
          <div
            style={{
              fontSize: baseFontSize,
              color: '#000000',
              lineHeight: 1.15,
              columnCount: 1,
              marginBottom: '6pt',
            }}
          >
            {renderPlainLines(lines.slice(exceptionStart, exceptionEnd + 1), exceptionStart)}
          </div>
          {exceptionEnd + 1 < lines.length && (
            <div
            style={{
              fontSize: baseFontSize,
              color: '#000000',
              lineHeight: 1.15,
              ...columnStyles,
            }}
            >
              {renderLines(lines.slice(exceptionEnd + 1), exceptionEnd + 1)}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            fontSize: baseFontSize,
            color: '#000000',
            lineHeight: 1.15,
            ...columnStyles,
          }}
        >
          {renderLines(lines, 0)}
        </div>
      )}
    </div>
  )
}
