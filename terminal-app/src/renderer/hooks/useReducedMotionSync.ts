/**
 * useReducedMotionSync — L2
 *
 * Listens to `prefers-reduced-motion` and mirrors the flag onto the OfficeState
 * wake/sleep animation queue so transitions drain with zero stagger when the
 * user prefers reduced motion. One boolean, no other behavior.
 */
import { useEffect } from 'react'
import { getOfficeState } from '../office/officeStateRefs.js'

export function useReducedMotionSync(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      getOfficeState().wakeQueue.setReducedMotion(mql.matches)
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])
}
