// Re-export CharacterAvatar as AgentIcon for terminal tabs
import React from 'react'
import { CharacterAvatar } from '../CharacterAvatar.js'

export function AgentIcon({ palette }: { palette: number }) {
  return <CharacterAvatar palette={palette} size={24} />
}
