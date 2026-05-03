// CanvasIframe — L4 Component
// Sandboxed iframe renderer with detach-to-window support.
// Extracted from the old CanvasPanel.tsx.

import { useState, useEffect, useRef } from 'react'
import type { CanvasContent } from '../store.js'
import type { PluginHost } from '@pixel-city/core'

// Inject a bridge so link clicks/contextmenu inside the sandboxed iframe
// are forwarded to the parent (which opens via Electron shell or shows a menu).
function withLinkBridge(html: string): string {
  const script = `<script>(function(){
  function findLink(e){ return e.target && e.target.closest && e.target.closest('a[href]'); }
  document.addEventListener('click', function(e){
    var a = findLink(e); if (!a) return;
    var href = a.getAttribute('href'); if (!href) return;
    if (href.charAt(0) === '#') return;
    e.preventDefault();
    try { parent.postMessage({ type: 'pc-canvas:open-link', url: a.href }, '*'); } catch(_) {}
  }, true);
  document.addEventListener('contextmenu', function(e){
    var a = findLink(e); if (!a) return;
    e.preventDefault();
    try { parent.postMessage({ type: 'pc-canvas:link-menu', url: a.href, x: e.clientX, y: e.clientY }, '*'); } catch(_) {}
  }, true);
})();</script>`
  return html.includes('</body>') ? html.replace('</body>', script + '</body>') : html + script
}

interface CanvasIframeProps {
  agentId: string
  content: CanvasContent
  agentName: string
  host: PluginHost
  onToggleHistory: () => void
  isHistoryOpen: boolean
}

// Track detached windows per agent — module-level so they survive re-renders
const detachedWindows = new Map<string, Window>()

function DetachIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1h4v4" />
      <path d="M11 1L6 6" />
      <rect x="1" y="3" width="8" height="8" rx="1" />
    </svg>
  )
}

function CloseIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 2l6 6M8 2l-6 6" />
    </svg>
  )
}

function HistoryIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="5" />
      <path d="M6 3v3l2 1" />
    </svg>
  )
}

export function CanvasIframe({ agentId, content, agentName, host, onToggleHistory, isHistoryOpen }: CanvasIframeProps) {
  const [isDetached, setIsDetached] = useState(() => {
    const existing = detachedWindows.get(agentId)
    return existing ? !existing.closed : false
  })
  const [linkMenu, setLinkMenu] = useState<{ url: string; x: number; y: number } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const detachCanvas = () => {
    if (!content) return

    const detachedWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes')
    if (!detachedWindow) {
      console.warn('Failed to open detached window - popup may be blocked')
      return
    }

    detachedWindows.set(agentId, detachedWindow)
    setIsDetached(true)

    const windowContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Canvas - ${agentName}</title>
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; background: #1e1e1e; color: #e5e5e5; }
    .header { background: #2a2a2a; border-bottom: 1px solid #404040; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; height: 32px; box-sizing: border-box; }
    .title { font-size: 14px; font-weight: 600; color: #b0b0b0; }
    .canvas-content { width: 100%; height: calc(100vh - 32px); border: none; background: #fff; }
  </style>
</head>
<body>
  <div class="header">
    <span class="title">${content.title || 'Canvas'} - ${agentName}</span>
    <span style="font-size: 12px; color: #888;">Detached Canvas</span>
  </div>
  <iframe id="canvas-frame" class="canvas-content" sandbox="allow-scripts" srcdoc="${withLinkBridge(content.html).replace(/"/g, '&quot;')}"></iframe>
  <script>
    window.addEventListener('message', (event) => {
      if (event.data.type === 'canvas-update' && event.data.agentId === '${agentId}') {
        const frame = document.getElementById('canvas-frame');
        if (frame && event.data.html) {
          frame.srcdoc = event.data.html;
          document.querySelector('.title').textContent = (event.data.title || 'Canvas') + ' - ${agentName}';
        }
      }
      // Forward link events from the inner iframe to the main window.
      if (event.data && (event.data.type === 'pc-canvas:open-link' || event.data.type === 'pc-canvas:link-menu')) {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(event.data, '*');
        }
      }
    });
    window.addEventListener('beforeunload', () => {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'detached-window-closed', agentId: '${agentId}' }, '*');
      }
    });
  </script>
</body>
</html>`

    detachedWindow.document.write(windowContent)
    detachedWindow.document.close()

    const checkClosed = setInterval(() => {
      if (detachedWindow.closed) {
        detachedWindows.delete(agentId)
        setIsDetached(false)
        clearInterval(checkClosed)
      }
    }, 1000)

    detachedWindow.focus()
  }

  // Forward content updates to detached window
  useEffect(() => {
    const detachedWindow = detachedWindows.get(agentId)
    if (detachedWindow && !detachedWindow.closed) {
      detachedWindow.postMessage(
        { type: 'canvas-update', agentId, html: withLinkBridge(content.html), title: content.title },
        '*',
      )
    }
  }, [agentId, content.html, content.title])

  // Listen for detached window close messages + canvas link bridge events.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'detached-window-closed' && data.agentId === agentId) {
        detachedWindows.delete(agentId)
        setIsDetached(false)
        return
      }

      if (data.type === 'pc-canvas:open-link' && typeof data.url === 'string') {
        void host.ipcInvoke('open-external', data.url)
        return
      }

      if (data.type === 'pc-canvas:link-menu' && typeof data.url === 'string') {
        const rect = iframeRef.current?.getBoundingClientRect()
        const localX = typeof data.x === 'number' ? data.x : 0
        const localY = typeof data.y === 'number' ? data.y : 0
        const x = (rect?.left ?? 0) + localX
        const y = (rect?.top ?? 0) + localY
        setLinkMenu({ url: data.url, x, y })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [agentId, host])

  // Dismiss the link menu on any outside click or Escape.
  useEffect(() => {
    if (!linkMenu) return
    const dismiss = () => setLinkMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [linkMenu])

  // Check if detached window already exists on mount / agentId change
  useEffect(() => {
    const existing = detachedWindows.get(agentId)
    if (existing && existing.closed) {
      detachedWindows.delete(agentId)
      setIsDetached(false)
    } else {
      setIsDetached(existing ? !existing.closed : false)
    }
  }, [agentId])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center px-[10px] py-1 gap-[6px] border-b border-border bg-bg-card shrink-0 h-7">
        <span className="text-[11px] font-semibold text-text-dim flex-1">
          {content.title ?? 'Canvas'}
          {isDetached && <span className="text-[10px] text-[#4CAF50] font-normal ml-[6px]">• Detached</span>}
        </span>
        <button
          className={[
            'bg-none border-none cursor-pointer px-1 py-0.5 rounded-[3px] flex items-center hover:bg-bg-hover',
            isHistoryOpen ? 'text-accent' : 'text-text-dim hover:text-text',
          ].join(' ')}
          onClick={onToggleHistory}
          title={isHistoryOpen ? 'Hide version history' : 'Show version history'}
        >
          <HistoryIcon size={14} />
        </button>
        <button
          className="bg-none border-none text-text-dim cursor-pointer px-1 py-0.5 rounded-[3px] flex items-center disabled:opacity-40 disabled:cursor-not-allowed hover:not-disabled:text-text hover:not-disabled:bg-bg-hover"
          onClick={detachCanvas}
          disabled={isDetached}
          title="Detach canvas to new window"
        >
          <DetachIcon size={14} />
        </button>
      </div>
      <iframe
        ref={iframeRef}
        srcDoc={withLinkBridge(content.html)}
        sandbox="allow-scripts"
        className="flex-1 border-none bg-white w-full"
        title={`Canvas - ${agentName}`}
      />
      {linkMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[180px] rounded-md border border-border bg-bg-card shadow-lg py-1 text-[12px] text-text"
          style={{ left: linkMenu.x, top: linkMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            className="block w-full text-left px-3 py-1.5 hover:bg-bg-hover"
            onClick={() => {
              void host.ipcInvoke('open-external', linkMenu.url)
              setLinkMenu(null)
            }}
          >
            Open link in browser
          </button>
          <button
            role="menuitem"
            className="block w-full text-left px-3 py-1.5 hover:bg-bg-hover"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(linkMenu.url)
                host.showNotification('Link copied', 'info')
              } catch {
                host.showNotification('Failed to copy link', 'error')
              }
              setLinkMenu(null)
            }}
          >
            Copy link
          </button>
          <div className="px-3 pt-1 pb-1 text-[10px] text-text-dim truncate border-t border-border mt-1">
            {linkMenu.url}
          </div>
        </div>
      )}
    </div>
  )
}

// Export for cleanup
export { detachedWindows }
