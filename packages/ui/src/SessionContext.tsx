/**
 * SessionContext — React context providing the ISessionAdapter.
 *
 * Each app wraps its workspace with <SessionProvider adapter={...}>
 * and shared UI components access the adapter via useSession().
 */

import React, { createContext, useContext } from 'react'
import type { ISessionAdapter } from '@pixel-city/core/session'

const SessionContext = createContext<ISessionAdapter | null>(null)

export function SessionProvider({
  adapter,
  children,
}: {
  adapter: ISessionAdapter
  children: React.ReactNode
}) {
  return (
    <SessionContext.Provider value={adapter}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): ISessionAdapter {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
