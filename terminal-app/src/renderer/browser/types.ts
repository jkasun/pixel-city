export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug'
  message: string
  source: string
  line: number
  timestamp: number
}

// Per-tab bridge interface
export interface BrowserTabBridge {
  getUrl: () => string
  getTitle: () => string
  getConsoleLogs: (level?: string) => ConsoleEntry[]
  clearConsoleLogs: () => void
  executeJs: (code: string) => Promise<unknown>
  isLoading: () => boolean
  canGoBack: () => boolean
  canGoForward: () => boolean
  click: (opts: { selector?: string; x?: number; y?: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }) => Promise<{ success: boolean; error?: string; tag?: string; text?: string }>
  scroll: (opts: { x: number; y: number; deltaX?: number; deltaY?: number }) => Promise<{ success: boolean }>
  rightClick: (opts: { x: number; y: number }) => Promise<{ success: boolean }>
  hover: (opts: { x: number; y: number }) => Promise<{ success: boolean }>
  doubleClick: (opts: { x: number; y: number }) => Promise<{ success: boolean }>
  drag: (opts: { fromX: number; fromY: number; toX: number; toY: number; steps?: number }) => Promise<{ success: boolean }>
  type: (text: string) => Promise<void>
  keyPress: (key: string, modifiers?: string[]) => Promise<void>
  screenshot: () => Promise<{ dataUrl: string; imageWidth: number; imageHeight: number; cssWidth: number; cssHeight: number; devicePixelRatio: number }>
  startRecording: (options?: { fps?: number; maxWidth?: number }) => Promise<void>
  stopRecording: () => Promise<{ dataUrl: string; frames: number; duration: number }>
  isRecording: () => boolean
  navigate: (url: string) => void
  goBack: () => void
  goForward: () => void
  reload: () => void
  formInput: (selector: string, value: string, options?: { clear?: boolean; pressEnter?: boolean }) => Promise<{ success: boolean; error?: string }>
  queryElements: (selector?: string, limit?: number) => Promise<Array<{ index: number; tag: string; text: string; attributes: Record<string, string>; rect: { x: number; y: number; width: number; height: number }; selector: string | null }>>
}

// Global bridge for MCP access
declare global {
  interface Window {
    __pixelCityBrowser?: BrowserTabBridge
    __pixelCityBrowserTabs?: Map<string, BrowserTabBridge>
    __pixelCityBrowserTabReady?: Map<string, Promise<void>>
    __pixelCityWebContentsToTab?: Map<number, string>
  }
}

export interface BrowserTab {
  id: string
  ownerType: 'user' | 'agent'
  agentId?: string
  agentName?: string
  url: string
  inputUrl: string
  pageTitle: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  consoleLogs: ConsoleEntry[]
  consoleFilter: ConsoleEntry['level'] | 'all'
  consoleOpen: boolean
  crashed: boolean
  crashReason?: string
  crashCount: number
}

export type TabAction =
  | { type: 'CREATE_TAB'; tab: BrowserTab }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SET_ACTIVE'; tabId: string }
  | { type: 'UPDATE_TAB'; tabId: string; updates: Partial<BrowserTab> }
  | { type: 'ADD_CONSOLE_LOG'; tabId: string; entry: ConsoleEntry }
  | { type: 'CLEAR_CONSOLE'; tabId: string }
  | { type: 'SET_CRASHED'; tabId: string; crashed: boolean; reason?: string }
  | { type: 'INCREMENT_CRASH_COUNT'; tabId: string }

export interface TabState {
  tabs: Map<string, BrowserTab>
  tabOrder: string[]
  activeTabId: string
}

export interface DownloadInfo {
  id: string
  filename: string
  url: string
  savePath: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  webContentsId: number
}

export interface BrowserViewProps {
  agentNames?: Map<string, string>
  agentPalettes?: Map<string, number>
  projectCwd?: string | null
  activeAgentId?: string | null
}
