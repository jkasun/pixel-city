import React from 'react'
import { useOnlineStatus } from './hooks/useOnlineStatus.js'

export function OfflineOverlay() {
  const online = useOnlineStatus()

  if (online) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(10,10,20,0.82)] backdrop-blur-[4px] animate-[offline-fade-in_0.25s_ease-out]">
      <div className="flex flex-col items-center gap-2 max-w-[320px] px-8 py-7 bg-bg-popup border border-[rgba(200,120,100,0.3)] rounded-[10px] shadow-[0_4px_32px_rgba(0,0,0,0.5)] text-center">
        <svg
          className="text-[#c87864] mb-1"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
        <span className="text-[14px] font-semibold text-[#c87864] tracking-[0.02em]">You are offline</span>
        <span className="text-[11px] text-[rgba(255,255,255,0.55)] leading-[1.5]">
          Please check your internet connection. The app will resume once you're back online.
        </span>
      </div>
    </div>
  )
}
