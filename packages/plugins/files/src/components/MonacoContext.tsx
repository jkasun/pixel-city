import React, { createContext, useContext } from 'react'

/**
 * Context for platform-specific Monaco configuration.
 *
 * Each app (terminal-app, web-app) must set up Monaco workers and themes
 * before rendering EditorPanel. This context provides:
 * - monacoReady: whether Monaco has been configured
 * - getTheme: maps app theme name to Monaco theme name
 * - currentTheme: the current Monaco theme to use
 */
export interface MonacoConfig {
  /** Whether Monaco has been initialized (workers configured). */
  ready: boolean
  /** The current Monaco theme name (e.g. 'vs-dark', 'pixelcity-creme'). */
  currentTheme: string
}

const MonacoConfigContext = createContext<MonacoConfig>({
  ready: false,
  currentTheme: 'vs-dark',
})

export function MonacoConfigProvider({ config, children }: { config: MonacoConfig; children: React.ReactNode }) {
  return (
    <MonacoConfigContext.Provider value={config}>
      {children}
    </MonacoConfigContext.Provider>
  )
}

export function useMonacoConfig(): MonacoConfig {
  return useContext(MonacoConfigContext)
}
