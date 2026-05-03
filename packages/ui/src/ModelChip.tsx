import React from 'react'
import type { ChipDescriptor } from '@pixel-city/core/llm'

export interface ModelChipProps {
  modelId: string | undefined
  /** Provider-supplied descriptor. Null → fallback (first-char of modelId + grey). */
  descriptor: ChipDescriptor | null
  /** Lower opacity for offline/inactive rows */
  muted?: boolean
}

const FALLBACK_COLOR = '#888894'

export function ModelChip({ modelId, descriptor, muted }: ModelChipProps) {
  if (!modelId) return null

  const desc: ChipDescriptor = descriptor ?? {
    letter: modelId.charAt(0).toUpperCase(),
    color: FALLBACK_COLOR,
    providerLabel: 'Unknown provider',
    modelLabel: modelId,
  }

  const text = desc.versionLabel ? `${desc.letter} ${desc.versionLabel}` : desc.letter
  const tooltip = `${desc.providerLabel} · ${desc.modelLabel}${desc.versionLabel ? ` · ${desc.versionLabel}` : ''}`

  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 16,
        height: 16,
        padding: '0 3px',
        borderRadius: 3,
        fontSize: '9px',
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '0.02em',
        color: desc.color,
        background: `${desc.color}18`,
        border: `1px solid ${desc.color}30`,
        flexShrink: 0,
        opacity: muted ? 0.7 : 1,
      }}
    >
      {text}
    </span>
  )
}
