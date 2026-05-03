import React, { useState } from 'react'
import type { ModelPickerEntry } from '@pixel-city/core/session'

interface AgentSettingsPanelProps {
  agentId: string | null
  agentName: string
  currentModel: string
  availableModels: ModelPickerEntry[]
  onChangeModel: (agentId: string, modelId: string) => void
}

const MODEL_COLORS: Record<string, string> = {
  opus: '#c87aff',
  sonnet: '#5ac8e8',
  haiku: '#e8b85a',
}

function getModelColor(modelId: string): string {
  if (modelId.includes('opus')) return MODEL_COLORS.opus
  if (modelId.includes('sonnet')) return MODEL_COLORS.sonnet
  if (modelId.includes('haiku')) return MODEL_COLORS.haiku
  return '#e8b85a'
}

export function AgentSettingsPanel({ agentId, agentName, currentModel, availableModels, onChangeModel }: AgentSettingsPanelProps) {
  const [expanded, setExpanded] = useState(true)

  if (!agentId) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-[0.75rem]">
        No agent selected
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3" style={{ fontFamily: 'var(--font-ui)' }}>
      <div className="text-[0.78rem] font-semibold text-text-bright mb-3 tracking-[0.01em]">
        {agentName}
      </div>

      {/* Model Section */}
      <div className="mb-4">
        <button
          className="flex items-center gap-1.5 text-[0.7rem] font-medium text-text-muted mb-2 bg-transparent border-0 cursor-pointer p-0 tracking-[0.03em] uppercase hover:text-text"
          onClick={() => setExpanded(v => !v)}
        >
          <span style={{ fontSize: '8px', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 120ms' }}>
            ▶
          </span>
          Model
        </button>

        {expanded && (
          <div className="flex flex-col gap-0.5">
            {availableModels.map(({ providerId, providerDisplayName, models }) => (
              <React.Fragment key={providerId}>
                <div className="text-[0.6rem] text-text-dim uppercase tracking-[0.06em] mt-1.5 mb-0.5 px-1 opacity-50">
                  {providerDisplayName}
                </div>
                {models.map(m => {
                  const isActive = currentModel === m.id ||
                    (currentModel === 'sonnet' && m.id.includes('sonnet') && providerId === 'claude-code') ||
                    (currentModel === 'opus' && m.id.includes('opus') && providerId === 'claude-code') ||
                    (currentModel === 'api:sonnet' && m.id === 'api:claude-sonnet-4-6') ||
                    (currentModel === 'api:opus' && m.id === 'api:claude-opus-4-6') ||
                    (currentModel === 'api:haiku' && m.id === 'api:claude-haiku-4-5')
                  return (
                    <button
                      key={m.id}
                      onClick={() => { if (!isActive) onChangeModel(agentId, m.id) }}
                      className="flex items-center gap-2 px-2.5 py-[6px] rounded text-left text-[0.72rem] border-0 cursor-pointer transition-all duration-100"
                      style={{
                        background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                        color: m.color,
                        outline: isActive ? `1px solid ${m.color}33` : '1px solid transparent',
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span
                        className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                        style={{ background: isActive ? m.color : 'transparent', border: `1.5px solid ${m.color}` }}
                      />
                      <span className="flex-1">{m.label}</span>
                      {isActive && (
                        <span className="text-[0.6rem] opacity-50 tracking-[0.03em]">current</span>
                      )}
                    </button>
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="text-[0.62rem] text-text-dim mt-2 leading-[1.5] opacity-60">
        Model change takes effect immediately — no restart needed.
      </div>
    </div>
  )
}
