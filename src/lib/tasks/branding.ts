export const TASK_ASSISTANT_NAME = 'Gizmo'

export function taskActorDisplayName(
  value: string | null | undefined,
  fallback = TASK_ASSISTANT_NAME,
  actorType?: string | null
) {
  const normalized = value?.trim()
  if (!normalized) return fallback
  return normalized === 'Signe' && (actorType === 'ai' || actorType === 'system')
    ? TASK_ASSISTANT_NAME
    : normalized
}
