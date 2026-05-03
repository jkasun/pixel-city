import React, { useState, useMemo } from 'react'
import type { BrowserTab } from './types.js'
import { paletteColor } from './helpers.js'
import { ChevronRightSmallIcon, CloseSmallIcon, PlusLargeIcon } from '../icons/index.js'

interface TabGroup {
  key: string
  label: string
  color: string
  agentId?: string
  tabIds: string[]
}

interface BrowserTabBarProps {
  tabs: Map<string, BrowserTab>
  tabOrder: string[]
  activeTabId: string
  agentPalettes: Map<string, number>
  highlightedAgentId?: string | null
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewTab: () => void
}

export function BrowserTabBar({ tabs, tabOrder, activeTabId, agentPalettes, highlightedAgentId, onSelectTab, onCloseTab, onNewTab }: BrowserTabBarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Group tabs by owner: each agent gets a group, user tabs get one group
  const groups = useMemo(() => {
    const groupMap = new Map<string, TabGroup>()
    const order: string[] = []

    for (const tabId of tabOrder) {
      const tab = tabs.get(tabId)
      if (!tab) continue

      let groupKey: string
      if (tab.ownerType === 'agent' && tab.agentId != null) {
        groupKey = `agent:${tab.agentId}`
      } else {
        groupKey = 'user'
      }

      if (!groupMap.has(groupKey)) {
        const color = tab.ownerType === 'agent' && tab.agentId != null
          ? paletteColor(agentPalettes.get(tab.agentId) ?? 0)
          : 'var(--accent)'
        const label = tab.ownerType === 'agent'
          ? (tab.agentName || `Agent ${tab.agentId}`)
          : 'You'
        groupMap.set(groupKey, { key: groupKey, label, color, agentId: tab.agentId, tabIds: [] })
        order.push(groupKey)
      }
      groupMap.get(groupKey)!.tabIds.push(tabId)
    }

    return order.map(k => groupMap.get(k)!)
  }, [tabs, tabOrder, agentPalettes])

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const hasMultipleGroups = groups.length > 1

  return (
    <div className="flex items-center bg-bg-deep border-b border-border min-h-[30px] overflow-x-auto shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="browser-tab-bar">
      {groups.map(group => {
        const isCollapsed = collapsedGroups.has(group.key)
        const isHighlighted = highlightedAgentId != null && group.agentId === highlightedAgentId
        const hasActiveTab = group.tabIds.includes(activeTabId)
        const tabCount = group.tabIds.length

        // Only show group header when there are multiple groups (multiple owners)
        const showGroupHeader = hasMultipleGroups

        return (
          <React.Fragment key={group.key}>
            {showGroupHeader && (
              <div
                className="flex items-center gap-[4px] px-[8px] h-[30px] cursor-pointer shrink-0 select-none transition-all duration-150 border-r border-border-subtle"
                style={{
                  background: isHighlighted
                    ? `color-mix(in srgb, ${group.color} 18%, transparent)`
                    : isCollapsed
                      ? `color-mix(in srgb, ${group.color} 8%, transparent)`
                      : undefined,
                  borderBottom: isHighlighted ? `2px solid ${group.color}` : undefined,
                  boxShadow: isHighlighted ? `inset 0 0 0 1px color-mix(in srgb, ${group.color} 40%, transparent)` : undefined,
                }}
                onClick={() => toggleGroup(group.key)}
                title={`${group.label} — ${tabCount} tab${tabCount !== 1 ? 's' : ''}${isCollapsed ? ' (click to expand)' : ' (click to collapse)'}`}
              >
                {/* Colored pill indicator */}
                <span
                  className="rounded-[3px] px-[5px] py-[1px] text-[10px] font-medium whitespace-nowrap"
                  style={{
                    background: `color-mix(in srgb, ${group.color} 25%, transparent)`,
                    color: group.color,
                  }}
                >
                  {group.label}
                </span>
                {/* Tab count badge when collapsed */}
                {isCollapsed && (
                  <span className="text-[10px] text-text-dim opacity-70">{tabCount}</span>
                )}
                {/* Chevron */}
                <ChevronRightSmallIcon className={`text-text-dim opacity-60 transition-transform duration-150${isCollapsed ? '' : ' rotate-90'}`} />
              </div>
            )}
            {/* Tabs within group */}
            {!isCollapsed && group.tabIds.map(tabId => {
              const tab = tabs.get(tabId)
              if (!tab) return null
              const isActive = tabId === activeTabId
              const label = tab.pageTitle || (tab.ownerType === 'agent' ? (tab.agentName || `Agent ${tab.agentId}`) : 'New tab')
              const title = tab.pageTitle || tab.url
              return (
                <div
                  key={tabId}
                  className={`group flex items-center gap-[6px] px-[10px] h-[30px] cursor-pointer border-r border-border-subtle max-w-[200px] min-w-0 shrink-0 transition-[background] duration-[120ms] ease relative hover:bg-bg-hover${isActive ? ' bg-bg-card shadow-[inset_0_-2px_0_var(--accent)]' : ''}`}
                  data-testid={`browser-tab-${tabId}`}
                  style={
                    showGroupHeader && isHighlighted && !isActive
                      ? { background: `color-mix(in srgb, ${group.color} 6%, transparent)` }
                      : undefined
                  }
                  onClick={() => onSelectTab(tabId)}
                  title={title}
                >
                  {!showGroupHeader && (
                    <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: group.color }} />
                  )}
                  <span className={`text-[11px] whitespace-nowrap overflow-hidden text-ellipsis font-ui${isActive ? ' text-text' : ' text-text-dim'}`}>{label}</span>
                  {tab.isLoading && <span className="w-[8px] h-[8px] border-[1.5px] border-text-dim border-t-transparent rounded-full animate-[browser-spin_0.6s_linear_infinite] shrink-0" />}
                  <button
                    className="hidden group-hover:inline-flex items-center justify-center w-[16px] h-[16px] border-none bg-transparent text-text-dim cursor-pointer rounded-[3px] shrink-0 p-0 hover:bg-bg-hover hover:text-text"
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tabId) }}
                    title="Close tab"
                  >
                    <CloseSmallIcon />
                  </button>
                </div>
              )
            })}
          </React.Fragment>
        )
      })}
      <button className="inline-flex items-center justify-center w-[28px] h-[28px] border-none bg-transparent text-text-dim cursor-pointer rounded-[5px] shrink-0 ml-[2px] hover:bg-bg-hover hover:text-text" onClick={onNewTab} title="New tab">
        <PlusLargeIcon />
      </button>
    </div>
  )
}
