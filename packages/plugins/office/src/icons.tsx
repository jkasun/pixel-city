import type { CSSProperties } from 'react'

interface IconProps {
  size?: number
  className?: string
  style?: CSSProperties
}

export function OfficeBuildingIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="M6 21V5a2 2 0 012-2h8a2 2 0 012 2v16" />
      <path d="M6 10H4a2 2 0 00-2 2v7a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-2" />
      <path d="M14 21v-3a2 2 0 00-4 0v3" />
      <path d="M10 8h4" /><path d="M10 12h4" />
    </svg>
  )
}
