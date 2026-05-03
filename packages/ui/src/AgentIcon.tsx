import React from 'react'
import { CharacterAvatar } from './CharacterAvatar.js'
import type { CharacterAvatarProps } from './CharacterAvatar.js'

export function AgentIcon({ palette, hueShift, style, className, workerStatus, resolveAvatarUrl }: {
  palette: number
  hueShift?: number
  style?: React.CSSProperties
  className?: string
  workerStatus?: CharacterAvatarProps['workerStatus']
  resolveAvatarUrl?: CharacterAvatarProps['resolveAvatarUrl']
}) {
  return <CharacterAvatar palette={palette} hueShift={hueShift} size={24} className={className} style={style} workerStatus={workerStatus} resolveAvatarUrl={resolveAvatarUrl} />
}
