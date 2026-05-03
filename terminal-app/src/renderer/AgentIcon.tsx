// Re-export CharacterAvatar as AgentIcon for backward compatibility
import React from 'react'
import { CharacterAvatar } from './CharacterAvatar.js'

export function AgentIcon({ palette, style, className }: { palette: number; style?: React.CSSProperties; className?: string }) {
  return <CharacterAvatar palette={palette} size={24} className={className} style={style} />
}
