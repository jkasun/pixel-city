/**
 * TerminalArea — agent terminal header + terminal + panel tabs.
 * Shared between desktop and web.
 */

import React, { useState } from 'react'
import { TerminalView } from './TerminalView.js'
import type { AgentInfo } from '@pixel-city/core/session'

type PanelTab = 'message' | 'status'

export interface TerminalAreaProps {
  agent: AgentInfo | null
  agents: AgentInfo[]
}

function PanelTabBar({ activeTab, onTabChange }: {
  activeTab: PanelTab
  onTabChange: (tab: PanelTab) => void
}) {
  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'message', label: 'Message' },
    { id: 'status', label: 'Status' },
  ]

  return (
    <div data-testid="agent-tabs" style={{
      display: 'flex', flexShrink: 0, borderBottom: '1px solid var(--border)',
      padding: '0 8px', height: 34,
    }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          data-testid={`agent-tab-${tab.id}`}
          onClick={() => onTabChange(tab.id)}
          style={{
            background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
            fontFamily: 'var(--font-ui)', fontSize: '0.7rem', fontWeight: 500,
            padding: '7px 12px 5px', cursor: 'pointer',
            letterSpacing: '0.01em', whiteSpace: 'nowrap',
            color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
            transition: 'color 0.12s, border-color 0.12s',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function StatusHistoryView({ agents }: { agents: AgentInfo[] }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Agent Status History
      </div>
      {agents.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>No agents running</div>
      ) : (
        agents.map(agent => (
          <div key={agent.agentId} style={{
            padding: '8px 12px', marginBottom: 6, borderRadius: 6,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                background: agent.active ? 'var(--accent)' : '#444',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, color: '#fff', fontWeight: 600,
              }}>
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>{agent.name}</span>
              <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{agent.model}</span>
            </div>
            <div style={{ fontSize: 10, color: agent.status ? 'var(--accent)' : 'var(--text-dim)' }}>
              {agent.status || (agent.active ? 'Idle' : 'Exited')}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export function TerminalArea({ agent, agents }: TerminalAreaProps) {
  const [panelTab, setPanelTab] = useState<PanelTab>('message')

  if (!agent) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 8,
        color: 'var(--text-dim)', fontSize: 12,
      }}>
        <span style={{ fontSize: 32, opacity: 0.4 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <polyline points="7,9 10,12 7,15" />
            <line x1="13" y1="15" x2="17" y2="15" />
          </svg>
        </span>
        <span>Select an agent or spawn a new one</span>
      </div>
    )
  }

  return (
    <div data-testid="terminal-area" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PanelTabBar activeTab={panelTab} onTabChange={setPanelTab} />

      {panelTab === 'status' ? (
        <StatusHistoryView agents={agents} />
      ) : (
        <>
          {/* Terminal header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderBottom: '1px solid var(--border)',
            flexShrink: 0, height: 34,
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              background: agent.active ? 'var(--accent)' : '#444',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, color: '#fff', fontWeight: 600,
            }}>
              {agent.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-bright)' }}>
              {agent.name}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
              {agent.model}
            </span>
            {agent.status && (
              <span style={{
                fontSize: '0.72rem', color: 'var(--accent)',
                marginLeft: 'auto', maxWidth: 200,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {agent.status}
              </span>
            )}
          </div>

          {/* Terminal */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <TerminalView ptyId={agent.ptyId} />
          </div>
        </>
      )}
    </div>
  )
}
