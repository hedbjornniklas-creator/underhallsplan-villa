// Bound new protocol text entries before the existing measured page planner runs.
// Preserve every character; old report blocks never opt into this splitting.
export function protocolTextChunks(text: string): string[] {
  const chunks: string[] = []
  let remaining = text
  while (remaining.length) {
    let end = Math.min(600, remaining.length), lines = 0
    for (let index = 0; index < end; index++) {
      if (remaining[index] === '\n' && ++lines === 10) { end = index + 1; break }
    }
    if (end < remaining.length && remaining[end - 1] !== '\n') {
      const boundary = Math.max(remaining.lastIndexOf(' ', end - 1), remaining.lastIndexOf('\n', end - 1))
      if (boundary >= end / 2) end = boundary + 1
    }
    chunks.push(remaining.slice(0, end)); remaining = remaining.slice(end)
  }
  return chunks
}
