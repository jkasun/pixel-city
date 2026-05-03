import { useReducer } from 'react'
import type { BrowserTab, TabAction, TabState } from './types.js'
import { DEFAULT_URL, resolveUrl } from './helpers.js'

function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case 'CREATE_TAB': {
      const tabs = new Map(state.tabs)
      tabs.set(action.tab.id, action.tab)
      return { ...state, tabs, tabOrder: [...state.tabOrder, action.tab.id] }
    }
    case 'CLOSE_TAB': {
      if (state.tabs.size <= 1) return state
      const tabs = new Map(state.tabs)
      tabs.delete(action.tabId)
      const tabOrder = state.tabOrder.filter(id => id !== action.tabId)
      let activeTabId = state.activeTabId
      if (activeTabId === action.tabId) {
        const closedIdx = state.tabOrder.indexOf(action.tabId)
        activeTabId = tabOrder[Math.min(closedIdx, tabOrder.length - 1)]
      }
      return { ...state, tabs, tabOrder, activeTabId }
    }
    case 'SET_ACTIVE': {
      if (!state.tabs.has(action.tabId)) return state
      return { ...state, activeTabId: action.tabId }
    }
    case 'UPDATE_TAB': {
      const tab = state.tabs.get(action.tabId)
      if (!tab) return state
      const tabs = new Map(state.tabs)
      tabs.set(action.tabId, { ...tab, ...action.updates })
      return { ...state, tabs }
    }
    case 'ADD_CONSOLE_LOG': {
      const tab = state.tabs.get(action.tabId)
      if (!tab) return state
      const tabs = new Map(state.tabs)
      tabs.set(action.tabId, { ...tab, consoleLogs: [...tab.consoleLogs, action.entry] })
      return { ...state, tabs }
    }
    case 'CLEAR_CONSOLE': {
      const tab = state.tabs.get(action.tabId)
      if (!tab) return state
      const tabs = new Map(state.tabs)
      tabs.set(action.tabId, { ...tab, consoleLogs: [] })
      return { ...state, tabs }
    }
    case 'SET_CRASHED': {
      const tab = state.tabs.get(action.tabId)
      if (!tab) return state
      const tabs = new Map(state.tabs)
      tabs.set(action.tabId, { ...tab, crashed: action.crashed, crashReason: action.reason })
      return { ...state, tabs }
    }
    case 'INCREMENT_CRASH_COUNT': {
      const tab = state.tabs.get(action.tabId)
      if (!tab) return state
      const tabs = new Map(state.tabs)
      tabs.set(action.tabId, { ...tab, crashCount: tab.crashCount + 1 })
      return { ...state, tabs }
    }
    default:
      return state
  }
}

export function makeTab(id: string, ownerType: 'user' | 'agent', opts?: { agentId?: string; agentName?: string; url?: string }): BrowserTab {
  const resolvedUrl = opts?.url ? resolveUrl(opts.url) : DEFAULT_URL
  return {
    id,
    ownerType,
    agentId: opts?.agentId,
    agentName: opts?.agentName,
    url: resolvedUrl,
    inputUrl: resolvedUrl,
    pageTitle: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    consoleLogs: [],
    consoleFilter: 'all',
    consoleOpen: false,
    crashed: false,
    crashCount: 0,
  }
}

const defaultTab = makeTab('user-0', 'user')
const initialState: TabState = {
  tabs: new Map([['user-0', defaultTab]]),
  tabOrder: ['user-0'],
  activeTabId: 'user-0',
}

export function useBrowserTabs() {
  return useReducer(tabReducer, initialState)
}
