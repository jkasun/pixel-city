import React, { useMemo, useState, useEffect, useRef } from 'react'
import { getCharacterSprites } from '@pixel-city/shared/office/sprites/spriteData'
import { Direction } from '@pixel-city/shared/office/types'

const CHAR_COUNT = 7

function spriteToDataUrl(sprite: string[][], scale: number): string {
  const h = sprite.length
  const w = sprite[0]?.length ?? 0
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = sprite[y][x]
      if (color) { ctx.fillStyle = color; ctx.fillRect(x * scale, y * scale, scale, scale) }
    }
  }
  return canvas.toDataURL()
}

function getSpriteFallback(palette: number, hueShift = 0): string | null {
  try {
    const sprites = getCharacterSprites(palette, hueShift)
    return spriteToDataUrl(sprites.walk[Direction.DOWN][0], 1)
  } catch { return null }
}

function getTypingFrames(palette: number, hueShift = 0): string[] | null {
  try {
    const sprites = getCharacterSprites(palette, hueShift)
    const frames = sprites.typing[Direction.DOWN]
    return frames.map(f => spriteToDataUrl(f, 1))
  } catch { return null }
}

export interface CharacterAvatarProps {
  palette: number
  hueShift?: number
  size?: number
  className?: string
  style?: React.CSSProperties
  workerStatus?: 'idle' | 'working' | 'tool'
  /** Optional: resolve a custom avatar URL for a character. */
  resolveAvatarUrl?: (charIndex: number) => Promise<string>
}

export function CharacterAvatar({ palette, hueShift = 0, size = 24, className, style, workerStatus, resolveAvatarUrl }: CharacterAvatarProps) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const charIndex = palette % CHAR_COUNT
  const isAnimating = workerStatus === 'working' || workerStatus === 'tool'

  useEffect(() => {
    if (!resolveAvatarUrl) { setAvatarFailed(true); return }
    let cancelled = false
    resolveAvatarUrl(charIndex)
      .then((url) => { if (!cancelled) setAvatarUrl(url) })
      .catch(() => { if (!cancelled) setAvatarFailed(true) })
    return () => { cancelled = true }
  }, [charIndex, resolveAvatarUrl])

  const fallbackSrc = useMemo(() => {
    if (!avatarFailed) return null
    return getSpriteFallback(palette, hueShift)
  }, [palette, hueShift, avatarFailed])

  const typingFrames = useMemo(() => {
    if (!isAnimating) return null
    return getTypingFrames(palette, hueShift)
  }, [palette, hueShift, isAnimating])

  // Animate typing frames
  useEffect(() => {
    if (!isAnimating || !typingFrames || typingFrames.length === 0) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      setFrameIndex(0)
      return
    }
    intervalRef.current = setInterval(() => {
      setFrameIndex(prev => (prev + 1) % typingFrames.length)
    }, 400)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isAnimating, typingFrames])

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    background: 'var(--bg-hover)',
    ...style,
  }

  const imgStyle: React.CSSProperties = {
    height: size,
    width: 'auto',
    imageRendering: 'pixelated',
  }

  // Show animated typing sprite when working
  if (isAnimating && typingFrames && typingFrames.length > 0) {
    return (
      <span className={`character-avatar${className ? ` ${className}` : ''}`} style={containerStyle}>
        <img src={typingFrames[frameIndex]} style={imgStyle} />
      </span>
    )
  }

  if (!avatarFailed && avatarUrl) {
    return (
      <span className={`character-avatar${className ? ` ${className}` : ''}`} style={containerStyle}>
        <img src={avatarUrl} style={imgStyle} onError={() => setAvatarFailed(true)} />
      </span>
    )
  }

  if (!fallbackSrc) return null
  return (
    <span className={`character-avatar${className ? ` ${className}` : ''}`} style={containerStyle}>
      <img src={fallbackSrc} style={imgStyle} />
    </span>
  )
}
