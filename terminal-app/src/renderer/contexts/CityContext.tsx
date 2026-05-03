import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import type { PlacedBuilding } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { subscribeToCityLayoutUpdates } from '../city/cityLayoutDbLocal.js'
import { loadSessionState, saveSessionState } from '../settings.js'

export type CityRoute = 'city' | 'building'
// Widened to string so dynamic plugin tabs can be registered at runtime.
// Built-in tab IDs: 'office' | 'board' | 'files' | 'git' | 'assets' | 'browser' | 'messages'
export type OfficeViewTab = string

const DEFAULT_CITY_ID = 'default-city'

interface CityContextValue {
  activeCityId: string | null
  setActiveCityId: (id: string | null) => void
  // Navigation
  currentRoute: CityRoute
  currentBuildingId: string | null
  currentBuildingIdRef: React.RefObject<string | null>
  buildings: PlacedBuilding[]
  officeViewTab: OfficeViewTab
  setOfficeViewTab: React.Dispatch<React.SetStateAction<OfficeViewTab>>
  sidebarVisible: boolean
  setSidebarVisible: React.Dispatch<React.SetStateAction<boolean>>
  toggleSidebar: () => void
}

const CityContext = createContext<CityContextValue | null>(null)

let _citySession: ReturnType<typeof loadSessionState> | null = null
function getCitySession() {
  if (!_citySession) _citySession = loadSessionState()
  return _citySession
}

export function CityContextProvider({ children }: { children: React.ReactNode }) {
  // Single-city mode: always use the default city ID
  const [activeCityId] = useState<string>(DEFAULT_CITY_ID)
  const setActiveCityId = useCallback((_id: string | null) => {}, [])

  const [currentRoute, setCurrentRoute] = useState<CityRoute>(() => {
    const hash = window.location.hash.replace(/^#\/?/, '')
    if (/^building\//.test(hash)) return 'building'
    return getCitySession().currentRoute ?? 'city'
  })
  const [currentBuildingId, setCurrentBuildingId] = useState<string | null>(() => {
    const hash = window.location.hash.replace(/^#\/?/, '')
    const m = hash.match(/^building\/(.+)$/)
    if (m) return m[1]
    return getCitySession().currentBuildingId ?? null
  })
  const [officeViewTab, setOfficeViewTab] = useState<OfficeViewTab>(() => (getCitySession().officeViewTab as OfficeViewTab) ?? 'office')
  const [sidebarVisible, setSidebarVisible] = useState(() => getCitySession().sidebarVisible ?? true)
  const toggleSidebar = useCallback(() => setSidebarVisible(v => !v), [])
  const [buildings, setBuildings] = useState<PlacedBuilding[]>([])

  // Subscribe to city layout for buildings list
  useEffect(() => {
    return subscribeToCityLayoutUpdates((layout) => {
      setBuildings(layout?.buildings ?? [])
    }, activeCityId)
  }, [activeCityId])

  // Restore hash from session on startup
  useEffect(() => {
    const currentHash = window.location.hash.replace(/^#\/?/, '')
    const hashHasBuilding = /^building\//.test(currentHash)
    if (!hashHasBuilding) {
      const s = getCitySession()
      if (s.currentBuildingId && s.currentRoute === 'building') {
        window.location.hash = `#/building/${s.currentBuildingId}`
      } else if (window.location.hash && window.location.hash !== '#/') {
        window.location.hash = '#/'
      }
    }
  }, [])

  // Validate restored building still exists once buildings load
  useEffect(() => {
    if (currentBuildingId && buildings.length > 0) {
      const exists = buildings.some(b => b.uid === currentBuildingId)
      if (!exists) {
        window.location.hash = '#/'
      }
    }
  }, [buildings])

  // Persist navigation state
  useEffect(() => { saveSessionState({ currentRoute, currentBuildingId }) }, [currentRoute, currentBuildingId])
  useEffect(() => { saveSessionState({ officeViewTab }) }, [officeViewTab])
  useEffect(() => { saveSessionState({ sidebarVisible }) }, [sidebarVisible])

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace(/^#\/?/, '')
      const m = hash.match(/^building\/(.+)$/)
      if (m) {
        setCurrentRoute('building')
        setCurrentBuildingId(m[1])
        setSidebarVisible(true)
      } else {
        setCurrentRoute('city')
        setCurrentBuildingId(null)
        setOfficeViewTab('office')
      }
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const currentBuildingIdRef = useRef(currentBuildingId)
  useEffect(() => { currentBuildingIdRef.current = currentBuildingId }, [currentBuildingId])

  return (
    <CityContext.Provider value={{
      activeCityId,
      setActiveCityId,
      currentRoute,
      currentBuildingId,
      currentBuildingIdRef,
      buildings,
      officeViewTab,
      setOfficeViewTab,
      sidebarVisible,
      setSidebarVisible,
      toggleSidebar,
    }}>
      {children}
    </CityContext.Provider>
  )
}

export function useCityContext() {
  const ctx = useContext(CityContext)
  if (!ctx) throw new Error('useCityContext must be used within CityContextProvider')
  return ctx
}
