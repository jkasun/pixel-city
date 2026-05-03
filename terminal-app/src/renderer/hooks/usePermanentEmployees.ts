/**
 * usePermanentEmployees — L2 Hook
 *
 * Owns the full permanent employee lifecycle inside OfficeApp:
 *   - Hire modal state and makePermanent logic
 *   - Fire modal state and firePermanent logic
 *   - 100ms poll: offline perm-agent spawn detection (with dedup guard) + seat auto-save
 *
 * Zero JSX. Depends on: officeRegistry (L1), getOfficeState (L1 ref), platform().
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { buildWingName } from '@pixel-city/shared/utils/agentAddress'
import { platform } from '../platform/index.js'
import { officeRegistry, getOfficeState } from '../office/officeStateRefs.js'
import { createEmployeeInRtdb, deleteEmployeeFromRtdb } from '../employee/employeeDbLocal.js'
import { employeeStore } from '../employee/EmployeeStore.js'
import { syncPermanentGhosts } from '../office/syncPermanentGhosts.js'
import type { PermanentEmployeeData, PermanentEmployeeSettings, BuildingInfo } from '../office/officeAppTypes.js'
import type { FullOfficeViewHandle } from '@pixel-city/plugin-office/components'
import permanentEmployeeInstructions from '../../../system-prompts/permanent-employee-instructions.md?raw'

export interface UsePermanentEmployeesOptions {
  buildingId: string | null
  buildingInfo: BuildingInfo | null
  projectCwd: string | null | undefined
  activeFloorIdRef: React.RefObject<string>
  agentIdsRef: React.RefObject<string[] | undefined>
  /** Ref that holds a Set of agentIds currently being spawned (not yet in agentIds state) */
  pendingSpawnRef: React.RefObject<Set<string>>
  viewRef: React.RefObject<FullOfficeViewHandle | null>
  sendPtyInput: (id: string, msg: string) => boolean
  onAddAgent?: (id: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
  onRemoveAgent?: (id: string) => void
  /** Setter for the React-side permId↔agentId map. makePermanent must keep this in sync with the registry. */
  setAgentPermanentIdMap: React.Dispatch<React.SetStateAction<Map<string, string>>>
  ready: boolean
  onTick: () => void
}

export interface UsePermanentEmployeesResult {
  showMakePermanentModal: boolean
  setShowMakePermanentModal: React.Dispatch<React.SetStateAction<boolean>>
  showFireConfirmModal: boolean
  setShowFireConfirmModal: React.Dispatch<React.SetStateAction<boolean>>
  makePermanent: (name: string, handle: string, role: string, personality: string) => Promise<{ ok: true } | { ok: false; error: string }>
  firePermanent: () => Promise<void>
}

export function usePermanentEmployees({
  buildingId,
  projectCwd,
  activeFloorIdRef,
  agentIdsRef,
  pendingSpawnRef,
  viewRef,
  sendPtyInput,
  onAddAgent,
  onRemoveAgent,
  setAgentPermanentIdMap,
  ready,
  onTick,
}: UsePermanentEmployeesOptions): UsePermanentEmployeesResult {
  const [showMakePermanentModal, setShowMakePermanentModal] = useState(false)
  const [showFireConfirmModal, setShowFireConfirmModal] = useState(false)

  // ── Poll: spawn offline perm agents on select + seat auto-save ────────────
  useEffect(() => {
    if (!ready) return
    const interval = setInterval(() => {
      const os = getOfficeState()
      const id = os.selectedAgentId
      const currentAgentIds = agentIdsRef.current

      // Spawn session for selected permanent employee that has no active session.
      // Guard with pendingSpawnRef to prevent double-spawn within the React state update window.
      // Skip synth ghost IDs — clicking a ghost to wake is wired in PR 2.
      if (id !== null && !id.startsWith('synth-') && currentAgentIds && !currentAgentIds.includes(id) && !pendingSpawnRef.current.has(id)) {
        const ch = os.characters.get(id)
        if (ch?.isPermanent) {
          pendingSpawnRef.current.add(id)
          onAddAgent?.(id, ch.palette, ch.name ?? `Agent #${id}`, ch.model ?? 'sonnet', buildingId ?? null, undefined, ch.permanentId ?? undefined)
        }
      }
      // Clear pending entries once agentIds has caught up
      for (const pending of pendingSpawnRef.current) {
        if (currentAgentIds?.includes(pending)) pendingSpawnRef.current.delete(pending)
      }

      // Auto-save permanent employee seat when it changes. Skip synth ghosts — they don't own their seat.
      for (const [, ch] of os.characters) {
        if (!ch.isPermanent || !ch.permanentId || ch.matrixEffect === 'despawn') continue
        if (ch.id.startsWith('synth-')) continue
        const buildingSnap = buildingId ? officeRegistry.getBuilding(buildingId) : null
        const lastSeat = buildingSnap?.seatMap.get(ch.id)
        if (ch.seatId !== lastSeat) {
          buildingSnap?.seatMap.set(ch.id, ch.seatId ?? null)
          employeeStore.update(ch.permanentId, { seatId: ch.seatId ?? undefined })
        }
      }

      // Synthesize ghost Characters for offline permanent employees on the active floor.
      syncPermanentGhosts(os, buildingId ?? null, activeFloorIdRef.current)
    }, 100)
    return () => clearInterval(interval)
  }, [ready, onAddAgent, buildingId, agentIdsRef, pendingSpawnRef])

  // ── Hire ──────────────────────────────────────────────────────────────────

  const makePermanent = useCallback(async (
    name: string,
    handle: string,
    role: string,
    personality: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const selectedId = viewRef.current?.selectedId ?? null
    if (selectedId === null) return { ok: false, error: 'No agent selected' }
    const os = getOfficeState()
    const ch = os.characters.get(selectedId)
    if (!ch || ch.isSubagent || ch.isPermanent) return { ok: false, error: 'This character cannot be hired' }

    // Folder name = ID. Each project has its own .pixelcity/agents/ so handles
    // are unique within a project (no cross-building prefix needed).
    const folderId = handle

    const settings: PermanentEmployeeSettings = {
      palette: ch.palette,
      hueShift: ch.hueShift,
      seatId: ch.seatId,
      name,
      handle,
      role: role || undefined,
      personality: personality || undefined,
      officeId: buildingId ?? null,
      floorId: activeFloorIdRef.current,
      model: ch.model ?? 'sonnet',
    }

    const soulParts = [
      `# ${name}`,
      '',
      `**Role:** ${role || 'Employee'}`,
      ...(personality ? [`**Personality:** ${personality}`, ''] : ['']),
      '## About',
      '',
      `${name} is a permanent employee at Pixel City.`,
    ]
    const soul = soulParts.join('\n')

    try {
      const result = await createEmployeeInRtdb(folderId, settings, soul)
      if (!result.success) {
        console.warn('Failed to create permanent employee:', result.error)
        const friendly = result.error === 'Employee already exists'
          ? `An employee with handle "${handle}" already exists in this building — pick a different handle.`
          : (result.error ?? 'Failed to create permanent employee')
        return { ok: false, error: friendly }
      }
    } catch (err) {
      console.warn('Failed to create permanent employee:', err)
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }

    ch.isPermanent = true
    ch.permanentId = folderId
    ch.name = name
    ch.role = role || undefined
    ch.floorId = activeFloorIdRef.current

    const empData: PermanentEmployeeData = { id: folderId, settings, soul }
    officeRegistry.registerPermanentEmployee(empData)
    // The live (temp) session still runs under its random selectedId — bridge
    // it to the permanent identity in agentPermanentIdMap so AgentPanel's
    // offline filter and the "← Sessions" header treat this character as a
    // permanent employee. Future sessions will spawn directly under folderId.
    setAgentPermanentIdMap(prev => {
      if (prev.get(selectedId) === folderId) return prev
      return new Map(prev).set(selectedId, folderId)
    })

    window.dispatchEvent(new CustomEvent('pixelcity:employees-updated'))

    // Inject hire wake-up message into the live session. Non-blocking.
    void (async () => {
      try {
        const wakeUpParts: string[] = []
        if (projectCwd) {
          const mp = await platform().config.readMempalace(projectCwd, handle)
          if (mp.success) {
            if (mp.status) {
              const wingList = Object.entries(mp.status.wings)
                .map(([w, c]) => `${w}: ${c} drawers`)
                .join(', ')
              wakeUpParts.push(`**Palace:** ${mp.status.total_drawers} total drawers. Wings: ${wingList || 'empty'}`)
            }
            if (mp.diary && mp.diary.length > 0) {
              const diaryLines = mp.diary.map((d: any) => `- [${d.date}] (${d.topic}): ${d.content}`)
              wakeUpParts.push(`**Your recent diary entries:**\n${diaryLines.join('\n')}`)
            }
            if (mp.recent_drawers && mp.recent_drawers.length > 0) {
              const drawerLines = mp.recent_drawers.map((d: any) => `- [${d.room}]: ${d.content}`)
              wakeUpParts.push(`**Your recent stored knowledge:**\n${drawerLines.join('\n')}`)
            }
          }
        }

        const header = `[PIXEL CITY] You have just been hired as a permanent employee — welcome, ${name}! Your handle is "${handle}" and your MemPalace wing is **${buildWingName(handle)}**. Pass "${handle}" as \`agent_id\` to mempalace_diary_* tools. These rules now apply to you for the rest of this session and all future sessions — read them carefully and follow them strictly.\n\n---\n\n${permanentEmployeeInstructions}\n\n---`
        const wakeUp = wakeUpParts.length > 0
          ? `\n\n# MemPalace Wake-Up (Auto-Loaded)\n\nThis context was loaded from your memory palace. You do NOT need to call mempalace_status or mempalace_diary_read — it's already here.\n\n${wakeUpParts.join('\n\n')}`
          : '\n\n# MemPalace Wake-Up\n\nYour wing is empty — start filing drawers and diary entries immediately so future-you has context.'
        const BRACKETED_PASTE_START = '\x1b[200~'
        const BRACKETED_PASTE_END = '\x1b[201~'
        const pasteBody = BRACKETED_PASTE_START + header + wakeUp + BRACKETED_PASTE_END
        sendPtyInput(selectedId, pasteBody)
        setTimeout(() => { sendPtyInput(selectedId, '') }, 150)
      } catch (err) {
        console.warn('[usePermanentEmployees] Failed to send hire wake-up:', err)
      }
    })()

    setShowMakePermanentModal(false)
    onTick()
    return { ok: true }
  }, [buildingId, projectCwd, activeFloorIdRef, viewRef, sendPtyInput, setAgentPermanentIdMap, onTick])

  // ── Fire ──────────────────────────────────────────────────────────────────

  const firePermanent = useCallback(async () => {
    const selectedId = viewRef.current?.selectedId ?? null
    if (selectedId === null) return
    const os = getOfficeState()
    const ch = os.characters.get(selectedId)
    if (!ch?.isPermanent || !ch.permanentId) return

    try {
      await deleteEmployeeFromRtdb(ch.permanentId)
    } catch (err) {
      console.warn('Failed to delete permanent employee:', err)
    }

    officeRegistry.removeAgent(selectedId)
    window.dispatchEvent(new CustomEvent('pixelcity:employees-updated'))

    os.removeAgent(selectedId)
    onRemoveAgent?.(selectedId)
    os.selectedAgentId = null
    os.cameraFollowId = null

    setShowFireConfirmModal(false)
    viewRef.current?.setSelectedId(null)
    onTick()
  }, [viewRef, onRemoveAgent, projectCwd, onTick])

  return {
    showMakePermanentModal, setShowMakePermanentModal,
    showFireConfirmModal, setShowFireConfirmModal,
    makePermanent,
    firePermanent,
  }
}
