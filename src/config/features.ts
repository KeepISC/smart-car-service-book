// Public build configuration; this is a UI rollout gate, not authorization.
export function isServiceHistoryEnabled(): boolean {
  return import.meta.env.VITE_SERVICE_HISTORY_ENABLED === 'true'
}
