declare global { interface Window { reportTexts: Record<string, string> } }
export function loadStandardText(id: string) {
  if (!(id in window.reportTexts)) throw new Error(`Missing report text ${id}`)
  return window.reportTexts[id]
}
export const loadAppendixText = loadStandardText
