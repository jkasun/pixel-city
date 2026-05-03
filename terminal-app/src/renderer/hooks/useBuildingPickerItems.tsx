import type { QuickMenuItem } from '../QuickMenu.js'
import type { PlacedBuilding } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { BuildingIcon, CityIcon } from '../icons/index.js'

const BUILDING_ICON = <BuildingIcon />

const CITY_ICON = <CityIcon />

interface UseBuildingPickerItemsArgs {
  buildings: PlacedBuilding[]
  currentBuildingId: string | null
  currentRoute: 'city' | 'building'
  buildingDirs?: Record<string, string>
  handleOpenProject?: (cwd: string) => void
}

export function useBuildingPickerItems({ buildings, currentBuildingId, currentRoute, buildingDirs, handleOpenProject }: UseBuildingPickerItemsArgs): QuickMenuItem[] {
  const items: QuickMenuItem[] = []

  // Show "Go to City View" when inside a building
  if (currentRoute === 'building') {
    items.push({
      id: 'nav-city',
      label: 'Go to City View',
      category: 'action',
      icon: CITY_ICON,
      onSelect: () => { window.location.hash = '#city' },
    })
  }

  for (const building of buildings) {
    const isCurrent = building.uid === currentBuildingId
    items.push({
      id: `building-${building.uid}`,
      label: building.title || 'Untitled Building',
      description: isCurrent ? '(current)' : (building.description || undefined),
      category: 'action',
      icon: BUILDING_ICON,
      onSelect: async () => {
        // Read the dir fresh at click time so any mapping created mid-session
        // (e.g. just after first-entering a building) is picked up.
        let dir = buildingDirs?.[building.uid]
        if (!dir) {
          try {
            const { ipcRenderer } = (window as any).require('electron') as typeof import('electron')
            const res = await ipcRenderer.invoke('building-dirs-load')
            dir = res?.dirs?.[building.uid]
          } catch {}
        }
        if (dir && handleOpenProject) handleOpenProject(dir)
        window.location.hash = `#/building/${building.uid}`
      },
    })
  }

  return items
}
