import { ACCENT_COLOR, REPORT_STYLES, mmToPx } from '@/lib/report/reportTokens'

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
  const lines = rawText.split(/\r?\n/)
  const firstLineIndex = lines.findIndex(line => line.trim().length > 0)
  const isLongform = variant === 'longform'
  const isGlossary = variant === 'glossary'
  const isLifespan = variant === 'lifespan'
  const baseFontSize = isLifespan ? '10pt' : REPORT_STYLES.BODY.fontSize
  const exceptionFontSize = isLifespan ? '11pt' : baseFontSize
  const isTwoColumn = variant === 'longform' || variant === 'glossary' || variant === 'lifespan'

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
    const nodes: JSX.Element[] = []
    let i = 0

    while (i < segment.length) {
      const line = segment[i]
      const trimmed = line.replace(/\s+$/, '')

      if (trimmed.trim().length === 0) {
        nodes.push(
          <div key={`appendix-blank-${offset + i}`} style={{ minHeight: '11pt' }} />
        )
        i += 1
        continue
      }

      const nextLine = segment[i + 1]
      const nextTrimmed = nextLine ? nextLine.replace(/\s+$/, '') : ''

      if (nextTrimmed.trim().length > 0) {
        nodes.push(
          <div
            key={`appendix-pair-${offset + i}`}
            style={{ breakInside: 'avoid', WebkitColumnBreakInside: 'avoid' }}
          >
            <div style={{ fontWeight: 700, fontSize: baseFontSize }}>{trimmed}</div>
            <div style={{ fontSize: baseFontSize }}>{nextTrimmed}</div>
          </div>
        )
        i += 2
        continue
      }

      nodes.push(
        <div
          key={`appendix-line-${offset + i}`}
          style={{ fontWeight: 400, fontSize: baseFontSize }}
        >
          {trimmed}
        </div>
      )
      i += 1
    }

    return nodes
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

  const renderLifespanLines = (segment: string[], offset: number) => {
    const nodes: JSX.Element[] = []
    const separatorCandidates = ['ƒ?', '–', '-']
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
      const left = line.slice(0, idx).replace(/^[\sƒ–-]+/, '').trim()
      const right = line.slice(idx + sep.length).trim()
      if (!right) return null
      return { left, right }
    }

    for (let i = 0; i < segment.length; i += 1) {
      const line = segment[i]
      const trimmed = line.trim()

      if (!trimmed) {
        nodes.push(
          <div key={`appendix-blank-${offset + i}`} style={{ minHeight: baseFontSize }} />
        )
        continue
      }

      if (isSeparatorLine(line)) {
        const parsed = splitLine(line)
        if (parsed) {
          nodes.push(
            <div
              key={`appendix-row-${offset + i}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: mmToPx(4),
                fontSize: baseFontSize,
                breakInside: 'avoid',
                WebkitColumnBreakInside: 'avoid',
              }}
            >
              <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{parsed.left}</div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{parsed.right}</div>
            </div>
          )
          if (parsed.left.includes('Nytt undertak, invändigt')) {
            nodes.push(
              <div
                key={`appendix-gap-${offset + i}`}
                style={{ minHeight: baseFontSize }}
              />
            )
          }
          continue
        }
      }

      const nextLine = segment[i + 1] ?? ''
      if (
        nextLine &&
        isSeparatorLine(nextLine) &&
        nextLine.trim().startsWith('(')
      ) {
        const parsedNext = splitLine(nextLine)
        if (parsedNext) {
          nodes.push(
            <div
              key={`appendix-row-${offset + i}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: mmToPx(4),
                fontSize: baseFontSize,
                breakInside: 'avoid',
                WebkitColumnBreakInside: 'avoid',
              }}
            >
              <div style={{ flex: 1 }}>{`${trimmed} ${parsedNext.left}`}</div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {parsedNext.right}
              </div>
            </div>
          )
          i += 1
          continue
        }
      }

      const nextHasSeparator = nextLine ? isSeparatorLine(nextLine) : false
      const isHeading = !isSeparatorLine(line) && (!nextLine || nextHasSeparator)

      if (isHeading) {
        nodes.push(
          <div
            key={`appendix-heading-${offset + i}`}
            style={{
              fontWeight: 700,
              fontSize: baseFontSize,
              breakInside: 'avoid',
              WebkitColumnBreakInside: 'avoid',
            }}
          >
            {trimmed}
          </div>
        )
      } else {
        nodes.push(
          <div
            key={`appendix-line-${offset + i}`}
            style={{
            fontWeight: 400,
            fontSize: baseFontSize,
            breakInside: 'avoid',
            WebkitColumnBreakInside: 'avoid',
          }}
        >
            {trimmed}
          </div>
        )
      }
    }

    return nodes
  }

  const renderLines = (segment: string[], offset: number) => {
    if (isGlossary) return renderGlossaryLines(segment, offset)
    if (isLifespan) return renderLifespanLines(segment, offset)
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
                columnCount: isTwoColumn ? 2 : 1,
                columnGap: mmToPx(12),
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
                columnCount: isTwoColumn ? 2 : 1,
                columnGap: mmToPx(12),
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
            columnCount: isTwoColumn ? 2 : 1,
            columnGap: mmToPx(12),
          }}
        >
          {renderLines(lines, 0)}
        </div>
      )}
    </div>
  )
}
