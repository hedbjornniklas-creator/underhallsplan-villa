export const BESIKT_START = {
  ob: { name: 'Överlåtelsebesiktning', href: '/ob', action: 'Förbered uppdragsbekräftelse',
    instruction: 'Fyll i kund, fastighet och uppdragets omfattning. Granska uppgifterna innan du skickar till kunden.',
    next: 'När uppdraget är bokat kan du starta besiktningen från uppdragsbekräftelsen. Du kan också skapa en tom besiktning på startsidan.' },
  eb: { name: 'Entreprenadbesiktning', href: '/eb', action: 'Förbered en entreprenad',
    instruction: 'Börja med entreprenadens namn och adress. Därefter lägger du till parter och den besiktning som ska göras.',
    next: 'Kontrollera parter, datum och omfattning innan du skickar kallelser. Granska sedan utlåtandet innan det lämnas vidare.' },
  tu: { name: 'Tekniska utredningar', href: '/tu', action: 'Förbered en utredning',
    instruction: 'Ange objekt, beställare och vad som ska utredas. Du kan börja direkt eller använda uppdragsbekräftelsen på startsidan.',
    next: 'Samla underlag och iakttagelser i utredningen. Kontrollera slutsatser och dina avsändaruppgifter innan utlåtandet skickas.' },
} as const
export type BesiktStartModule = keyof typeof BESIKT_START
export function startModule(value: unknown): BesiktStartModule | null {
  return typeof value === 'string' && Object.hasOwn(BESIKT_START, value) ? value as BesiktStartModule : null
}
export type StartProfile = { full_name?: string | null; email?: string | null; company_name?: string | null }
export function missingStartProfile(profile: StartProfile | null): string[] {
  const missing = []
  if (!profile?.full_name?.trim()) missing.push('namn')
  if (!profile?.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) missing.push('giltig e-postadress')
  if (!profile?.company_name?.trim()) missing.push('företagsnamn')
  return missing
}
export function startStorageKey(userId: string, module: BesiktStartModule) { return `besiktapp:start:v1:${userId}:${module}` }
