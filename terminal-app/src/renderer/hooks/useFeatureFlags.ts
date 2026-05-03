import { useCallback } from 'react'

// Feature flags not available in local mode — all flags default to false.
export function useFeatureFlags() {
  const isEnabled = useCallback((_key: string): boolean => false, [])
  return { flags: {}, isEnabled }
}
