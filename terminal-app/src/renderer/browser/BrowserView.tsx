import React, { useState, useRef, useCallback, useEffect } from 'react'
import type { ConsoleEntry, BrowserViewProps, DownloadInfo } from './types.js'
import { DEFAULT_URL, resolveUrl } from './helpers.js'
import { useBrowserTabs, makeTab } from './useBrowserTabs.js'
import { BrowserWebview } from './BrowserWebview.js'
import { BrowserTabBar } from './BrowserTabBar.js'
import { BrowserToolbar } from './BrowserToolbar.js'
import { BrowserConsole } from './BrowserConsole.js'

export type { BrowserTabBridge } from './types.js'

const { ipcRenderer } = window.require('electron')

export function BrowserView({ agentNames, agentPalettes, projectCwd, activeAgentId }: BrowserViewProps) {
  const [state, dispatch] = useBrowserTabs()
  const consoleEndRef = useRef<HTMLDivElement>(null)
  const userTabCounter = useRef(1)
  const stateRef = useRef(state)
  stateRef.current = state

  // Browser zoom state (shared across all tabs in this browser instance)
  const [browserZoom, setBrowserZoom] = useState(0)

  // Cmd+/- to zoom the browser when this panel is visible
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Check if browser panel is actually visible (not hidden via display:none)
      const browserPanel = document.querySelector('.browser-view')
      if (!browserPanel || (browserPanel as HTMLElement).offsetParent === null) return

      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setBrowserZoom(z => Math.min(z + 0.5, 5))
      } else if (e.key === '-') {
        e.preventDefault()
        setBrowserZoom(z => Math.max(z - 0.5, -3))
      } else if (e.key === '0') {
        e.preventDefault()
        setBrowserZoom(0)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // GIF recording state (per-tab tracking)
  const [recordingTabs, setRecordingTabs] = useState<Set<string>>(new Set())

  useEffect(() => {
    const onRecording = (e: Event) => {
      const { tabId: recTabId, recording } = (e as CustomEvent).detail
      setRecordingTabs(prev => {
        const next = new Set(prev)
        if (recording) next.add(recTabId)
        else next.delete(recTabId)
        return next
      })
    }
    window.addEventListener('pixelcity:browser-gif-recording', onRecording)
    return () => window.removeEventListener('pixelcity:browser-gif-recording', onRecording)
  }, [])

  // Console resize state
  const [consoleHeight, setConsoleHeight] = useState(200)
  const [consoleResizing, setConsoleResizing] = useState(false)
  const consoleStartY = useRef(0)
  const consoleStartH = useRef(0)

  const startConsoleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setConsoleResizing(true)
    consoleStartY.current = e.clientY
    consoleStartH.current = consoleHeight

    const onMouseMove = (ev: MouseEvent) => {
      const delta = consoleStartY.current - ev.clientY
      const newHeight = Math.max(80, Math.min(600, consoleStartH.current + delta))
      setConsoleHeight(newHeight)
    }
    const onMouseUp = () => {
      setConsoleResizing(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [consoleHeight])

  // Per-office partition: all tabs in the same office share cookies/session,
  // but different offices (projects) are isolated from each other.
  const officePartition = projectCwd
    ? `persist:browser-${projectCwd.replace(/[^a-zA-Z0-9]/g, '_')}`
    : 'persist:browser-default'

  // Send project cwd to main process for default agent download paths
  useEffect(() => {
    if (projectCwd) ipcRenderer.send('set-download-project-cwd', projectCwd)
  }, [projectCwd])

  const activeTab = state.tabs.get(state.activeTabId)

  // Toolbar state from active tab
  const [inputUrl, setInputUrl] = useState(DEFAULT_URL)
  useEffect(() => {
    if (activeTab) setInputUrl(activeTab.inputUrl)
  }, [state.activeTabId, activeTab?.inputUrl])

  // Keep backward-compat global bridge pointing to active tab
  useEffect(() => {
    const updateBridge = () => {
      const activeId = stateRef.current.activeTabId
      const bridge = window.__pixelCityBrowserTabs?.get(activeId)
      if (bridge) {
        window.__pixelCityBrowser = bridge
      }
    }
    updateBridge()
  }, [state.activeTabId])

  // Webview callbacks
  const handleNavigate = useCallback((tabId: string, url: string) => {
    dispatch({ type: 'UPDATE_TAB', tabId, updates: { url, inputUrl: url } })
  }, [])

  const handleTitleUpdate = useCallback((tabId: string, title: string) => {
    dispatch({ type: 'UPDATE_TAB', tabId, updates: { pageTitle: title } })
  }, [])

  const handleLoadingChange = useCallback((tabId: string, loading: boolean) => {
    dispatch({ type: 'UPDATE_TAB', tabId, updates: { isLoading: loading } })
  }, [])

  const handleNavStateChange = useCallback((tabId: string, canBack: boolean, canForward: boolean) => {
    dispatch({ type: 'UPDATE_TAB', tabId, updates: { canGoBack: canBack, canGoForward: canForward } })
  }, [])

  const handleConsoleLog = useCallback((tabId: string, entry: ConsoleEntry) => {
    dispatch({ type: 'ADD_CONSOLE_LOG', tabId, entry })
  }, [])

  const handleCrash = useCallback((tabId: string, reason: string) => {
    dispatch({ type: 'SET_CRASHED', tabId, crashed: true, reason })
  }, [])

  // Listen for new-window IPC from main process (non-OAuth URLs open as new tabs)
  // Attributes new tabs to the source agent when applicable
  useEffect(() => {
    const handler = (_event: any, url: string, sourceWebContentsId?: number) => {
      // Look up which tab triggered this new-window request
      const sourceTabId = sourceWebContentsId
        ? window.__pixelCityWebContentsToTab?.get(sourceWebContentsId)
        : undefined
      const sourceTab = sourceTabId ? stateRef.current.tabs.get(sourceTabId) : undefined

      let newTabId: string
      if (sourceTab?.ownerType === 'agent' && sourceTab.agentId !== undefined) {
        // Create in the agent's namespace so MCP can discover it
        let idx = 0
        while (stateRef.current.tabs.has(`agent-${sourceTab.agentId}-${idx}`)) idx++
        newTabId = `agent-${sourceTab.agentId}-${idx}`
        dispatch({ type: 'CREATE_TAB', tab: makeTab(newTabId, 'agent', {
          agentId: sourceTab.agentId,
          agentName: sourceTab.agentName,
          url,
        })})
      } else {
        newTabId = `user-${userTabCounter.current++}`
        dispatch({ type: 'CREATE_TAB', tab: makeTab(newTabId, 'user', { url }) })
      }
      dispatch({ type: 'SET_ACTIVE', tabId: newTabId })

      // Notify MCP bridge about the new tab
      window.dispatchEvent(new CustomEvent('pixelcity:browser-tab-opened', {
        detail: {
          tabId: newTabId,
          url,
          sourceTabId,
          agentId: sourceTab?.agentId,
        }
      }))
    }
    ipcRenderer.on('webview-new-window', handler)
    return () => { ipcRenderer.removeListener('webview-new-window', handler) }
  }, [])

  // Tab management
  const createUserTab = useCallback(() => {
    const id = `user-${userTabCounter.current++}`
    dispatch({ type: 'CREATE_TAB', tab: makeTab(id, 'user') })
    dispatch({ type: 'SET_ACTIVE', tabId: id })
  }, [])

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: 'CLOSE_TAB', tabId })
  }, [])

  const selectTab = useCallback((tabId: string) => {
    dispatch({ type: 'SET_ACTIVE', tabId })
  }, [])

  // --- Download tracking ---
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])
  const downloadTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const handler = (_event: any, dl: DownloadInfo) => {
      setDownloads(prev => {
        const idx = prev.findIndex(d => d.id === dl.id)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = dl
          return updated
        }
        return [...prev, dl]
      })
      // Auto-dismiss completed/cancelled downloads after 5s
      if (dl.state === 'completed' || dl.state === 'cancelled') {
        const existing = downloadTimers.current.get(dl.id)
        if (existing) clearTimeout(existing)
        downloadTimers.current.set(dl.id, setTimeout(() => {
          setDownloads(prev => prev.filter(d => d.id !== dl.id))
          downloadTimers.current.delete(dl.id)
        }, 5000))
      }
    }
    ipcRenderer.on('download-progress', handler)
    return () => {
      ipcRenderer.removeListener('download-progress', handler)
      downloadTimers.current.forEach(t => clearTimeout(t))
    }
  }, [])

  // Expose downloads for MCP bridge
  useEffect(() => {
    (window as any).__pixelCityDownloads = downloads
  }, [downloads])

  // MCP custom event listeners for tab creation and navigation
  useEffect(() => {
    const onCreateTab = (e: Event) => {
      const { agentId, agentName, initialUrl, tabId: explicitTabId } = (e as CustomEvent).detail
      // Use explicit tabId if provided, otherwise default to agent-{id}-0
      const tabId = explicitTabId || `agent-${agentId}-0`
      if (stateRef.current.tabs.has(tabId)) {
        // Tab exists, just navigate if initialUrl provided
        if (initialUrl) {
          const bridge = window.__pixelCityBrowserTabs?.get(tabId)
          if (bridge) bridge.navigate(initialUrl)
          else dispatch({ type: 'UPDATE_TAB', tabId, updates: { url: initialUrl, inputUrl: initialUrl } })
        }
        return
      }
      // Resolve agent name from props or event
      const name = agentName || agentNames?.get(agentId) || `Agent ${agentId}`
      dispatch({ type: 'CREATE_TAB', tab: makeTab(tabId, 'agent', { agentId, agentName: name, url: initialUrl }) })
    }

    const onBrowserNavigate = (e: Event) => {
      const { url: targetUrl, tabId } = (e as CustomEvent).detail
      if (!targetUrl) return
      if (tabId) {
        // Route to specific tab
        const bridge = window.__pixelCityBrowserTabs?.get(tabId)
        if (bridge) {
          bridge.navigate(targetUrl)
        } else {
          dispatch({ type: 'UPDATE_TAB', tabId, updates: { url: resolveUrl(targetUrl), inputUrl: resolveUrl(targetUrl) } })
        }
      } else {
        // Route to active tab
        const bridge = window.__pixelCityBrowserTabs?.get(stateRef.current.activeTabId)
        if (bridge) bridge.navigate(targetUrl)
      }
    }

    const onBrowserBack = (e: Event) => {
      const tabId = (e as CustomEvent).detail?.tabId || stateRef.current.activeTabId
      window.__pixelCityBrowserTabs?.get(tabId)?.goBack()
    }

    const onBrowserForward = (e: Event) => {
      const tabId = (e as CustomEvent).detail?.tabId || stateRef.current.activeTabId
      window.__pixelCityBrowserTabs?.get(tabId)?.goForward()
    }

    const onBrowserReload = (e: Event) => {
      const tabId = (e as CustomEvent).detail?.tabId || stateRef.current.activeTabId
      window.__pixelCityBrowserTabs?.get(tabId)?.reload()
    }

    const onSelectTab = (e: Event) => {
      const { tabId } = (e as CustomEvent).detail
      if (tabId && stateRef.current.tabs.has(tabId)) {
        dispatch({ type: 'SET_ACTIVE', tabId })
      }
    }

    window.addEventListener('pixelcity:browser-create-tab', onCreateTab)
    window.addEventListener('pixelcity:browser-navigate', onBrowserNavigate)
    window.addEventListener('pixelcity:browser-back', onBrowserBack)
    window.addEventListener('pixelcity:browser-forward', onBrowserForward)
    window.addEventListener('pixelcity:browser-reload', onBrowserReload)
    window.addEventListener('pixelcity:browser-select-tab', onSelectTab)

    return () => {
      window.removeEventListener('pixelcity:browser-create-tab', onCreateTab)
      window.removeEventListener('pixelcity:browser-navigate', onBrowserNavigate)
      window.removeEventListener('pixelcity:browser-back', onBrowserBack)
      window.removeEventListener('pixelcity:browser-forward', onBrowserForward)
      window.removeEventListener('pixelcity:browser-reload', onBrowserReload)
      window.removeEventListener('pixelcity:browser-select-tab', onSelectTab)
    }
  }, [agentNames])

  // Auto-scroll console
  useEffect(() => {
    if (activeTab?.consoleOpen) consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeTab?.consoleLogs, activeTab?.consoleOpen])

  // Active tab toolbar actions
  const navigateActive = useCallback((targetUrl: string) => {
    const finalUrl = resolveUrl(targetUrl)
    if (!finalUrl) return
    const bridge = window.__pixelCityBrowserTabs?.get(stateRef.current.activeTabId)
    if (bridge) bridge.navigate(finalUrl)
    dispatch({ type: 'UPDATE_TAB', tabId: stateRef.current.activeTabId, updates: { url: finalUrl, inputUrl: finalUrl } })
  }, [])

  const goBack = useCallback(() => {
    window.__pixelCityBrowserTabs?.get(stateRef.current.activeTabId)?.goBack()
  }, [])

  const goForward = useCallback(() => {
    window.__pixelCityBrowserTabs?.get(stateRef.current.activeTabId)?.goForward()
  }, [])

  const reloadActive = useCallback(() => {
    window.__pixelCityBrowserTabs?.get(stateRef.current.activeTabId)?.reload()
  }, [])

  const goHome = useCallback(() => {
    dispatch({ type: 'UPDATE_TAB', tabId: stateRef.current.activeTabId, updates: { url: DEFAULT_URL, inputUrl: DEFAULT_URL } })
  }, [])

  const clearConsole = useCallback(() => {
    dispatch({ type: 'CLEAR_CONSOLE', tabId: stateRef.current.activeTabId })
  }, [])

  const toggleConsole = useCallback(() => {
    const tab = stateRef.current.tabs.get(stateRef.current.activeTabId)
    if (tab) dispatch({ type: 'UPDATE_TAB', tabId: tab.id, updates: { consoleOpen: !tab.consoleOpen } })
  }, [])

  const setConsoleFilter = useCallback((filter: ConsoleEntry['level'] | 'all') => {
    dispatch({ type: 'UPDATE_TAB', tabId: stateRef.current.activeTabId, updates: { consoleFilter: filter } })
  }, [])

  if (!activeTab) return null

  const filteredLogs = activeTab.consoleFilter === 'all'
    ? activeTab.consoleLogs
    : activeTab.consoleLogs.filter(l => l.level === activeTab.consoleFilter)

  const errorCount = activeTab.consoleLogs.filter(l => l.level === 'error').length
  const warnCount = activeTab.consoleLogs.filter(l => l.level === 'warn').length

  return (
    <div className="browser-view flex flex-col w-full h-full bg-bg" data-testid="browser-view">
      <BrowserTabBar
        tabs={state.tabs}
        tabOrder={state.tabOrder}
        activeTabId={state.activeTabId}
        agentPalettes={agentPalettes || new Map()}
        highlightedAgentId={activeAgentId}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewTab={createUserTab}
      />
      <BrowserToolbar
        activeTab={activeTab}
        inputUrl={inputUrl}
        setInputUrl={setInputUrl}
        goBack={goBack}
        goForward={goForward}
        reloadActive={reloadActive}
        goHome={goHome}
        navigateActive={navigateActive}
        toggleConsole={toggleConsole}
        errorCount={errorCount}
        warnCount={warnCount}
        zoomLevel={browserZoom}
        onZoomIn={() => setBrowserZoom(z => Math.min(z + 0.5, 5))}
        onZoomOut={() => setBrowserZoom(z => Math.max(z - 0.5, -3))}
        onZoomReset={() => setBrowserZoom(0)}
        isRecording={recordingTabs.has(state.activeTabId)}
      />
      {activeTab.pageTitle && (
        <div className="px-[12px] py-[2px] text-[10px] text-text-dim bg-bg border-b border-border whitespace-nowrap overflow-hidden text-ellipsis shrink-0 tracking-[0.02em]">{activeTab.pageTitle}</div>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {consoleResizing && <div style={{ position: 'absolute', inset: 0, zIndex: 20, cursor: 'row-resize' }} />}
        {state.tabOrder.map(tabId => {
          const tab = state.tabs.get(tabId)
          if (!tab) return null
          return (
            <React.Fragment key={tabId}>
              <BrowserWebview
                key={`${tabId}-${tab.crashCount}`}
                tabId={tabId}
                url={tab.url}
                visible={tabId === state.activeTabId}
                partition={officePartition}
                zoomLevel={browserZoom}
                ownerType={tab.ownerType}
                agentName={tab.agentName}
                onNavigate={handleNavigate}
                onTitleUpdate={handleTitleUpdate}
                onLoadingChange={handleLoadingChange}
                onNavStateChange={handleNavStateChange}
                onConsoleLog={handleConsoleLog}
                onCrash={handleCrash}
              />
              {tab.crashed && tabId === state.activeTabId && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(10,10,12,0.9)]">
                  <div className="text-center text-[#aaa] text-[14px]">
                    <div className="text-[32px] font-bold text-[#e55] mb-[8px]">!</div>
                    <div>This page crashed</div>
                    <div className="text-[12px] text-[#666] mt-[4px]">{tab.crashReason}</div>
                    <button
                      className="mt-[14px] px-[18px] py-[6px] bg-bg-input text-text border-border rounded-[4px] cursor-pointer text-[13px] hover:bg-bg-hover hover:border-border"
                      onClick={() => {
                        dispatch({ type: 'SET_CRASHED', tabId, crashed: false })
                        dispatch({ type: 'INCREMENT_CRASH_COUNT', tabId })
                        // Do NOT call reload() on crashed webview (Electron #15366 — can crash entire app)
                        // Instead, INCREMENT_CRASH_COUNT changes the React key, causing unmount/remount
                      }}>Reload</button>
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}
        </div>
        {downloads.length > 0 && (
          <div className="flex flex-wrap gap-[6px] px-[10px] py-[6px] bg-bg border-t border-border shrink-0">
            {downloads.map(dl => {
              const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0
              const isDone = dl.state === 'completed'
              const isFailed = dl.state === 'cancelled' || dl.state === 'interrupted'
              return (
                <div key={dl.id} className={`flex items-center gap-[8px] px-[10px] py-[4px] bg-[rgba(255,255,255,0.04)] rounded-[4px] text-[11px] min-w-0 max-w-[280px]${isDone ? ' text-[#4ade80]' : isFailed ? ' text-[#f87171]' : ' text-text-dim'}`}>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap shrink min-w-0" title={dl.filename}>{dl.filename}</span>
                  {!isDone && !isFailed && (
                    <div className="w-[60px] h-[4px] bg-[rgba(255,255,255,0.1)] rounded-[2px] overflow-hidden shrink-0">
                      <div className="h-full bg-accent rounded-[2px] transition-[width] duration-300 ease" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <span className="text-[10px] shrink-0 opacity-70">
                    {isDone ? 'Done' : isFailed ? dl.state : `${pct}%`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {activeTab.consoleOpen && (
          <>
            <div className="h-[3px] cursor-row-resize bg-transparent shrink-0 transition-[background] duration-150 hover:bg-accent active:bg-accent" onMouseDown={startConsoleResize} />
            <BrowserConsole
              activeTab={activeTab}
              filteredLogs={filteredLogs}
              setConsoleFilter={setConsoleFilter}
              clearConsole={clearConsole}
              consoleEndRef={consoleEndRef}
              height={consoleHeight}
            />
          </>
        )}
      </div>
    </div>
  )
}
