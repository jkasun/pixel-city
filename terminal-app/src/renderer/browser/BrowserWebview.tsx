import React, { useRef, useEffect } from 'react'
import type { ConsoleEntry, BrowserTabBridge } from './types.js'
import { STEALTH_SCRIPT, STEALTH_USER_AGENT, SELECTOR_ENGINE_SCRIPT } from './stealthScripts.js'
import { LEVEL_MAP, resolveUrl } from './helpers.js'
import { createAnimatedWebP, type WebPFrame } from './webpMuxer.js'

const { ipcRenderer } = window.require('electron')

export interface BrowserWebviewProps {
  tabId: string
  url: string
  visible: boolean
  partition: string
  zoomLevel: number
  ownerType: 'user' | 'agent'
  agentName?: string
  onNavigate: (tabId: string, url: string) => void
  onTitleUpdate: (tabId: string, title: string) => void
  onLoadingChange: (tabId: string, loading: boolean) => void
  onNavStateChange: (tabId: string, canBack: boolean, canForward: boolean) => void
  onConsoleLog: (tabId: string, entry: ConsoleEntry) => void
  onCrash: (tabId: string, reason: string) => void
}

export function BrowserWebview({ tabId, url, visible, partition, zoomLevel, ownerType, agentName, onNavigate, onTitleUpdate, onLoadingChange, onNavStateChange, onConsoleLog, onCrash }: BrowserWebviewProps) {
  const webviewRef = useRef<any>(null)
  const urlRef = useRef(url)
  // Track the initial URL for the webview src attribute — never change src reactively
  // to prevent POST navigations (e.g. OAuth form submits) from being re-loaded as GET.
  const initialUrlRef = useRef(url)
  const titleRef = useRef('')
  const loadingRef = useRef(false)
  const canGoBackRef = useRef(false)
  const canGoForwardRef = useRef(false)
  const logsRef = useRef<ConsoleEntry[]>([])
  const readyResolveRef = useRef<(() => void) | null>(null)
  const domReadyRef = useRef(false)
  const zoomLevelRef = useRef(zoomLevel)

  // Recording state
  const recActiveRef = useRef(false)
  const recFramesRef = useRef<WebPFrame[]>([])
  const recStartTimeRef = useRef(0)
  const recTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  // Sync url ref (for getUrl bridge method) but do NOT change webview src
  useEffect(() => { urlRef.current = url }, [url])
  useEffect(() => { zoomLevelRef.current = zoomLevel }, [zoomLevel])

  // Blur the webview when it becomes hidden so Electron menu roles
  // (paste, copy, zoom) don't route to the guest webContents
  useEffect(() => {
    if (!visible && webviewRef.current) {
      webviewRef.current.blur?.()
    }
  }, [visible])

  // Sync zoom level to the webview's guest webContents (only after dom-ready)
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !domReadyRef.current) return
    try { wv.setZoomLevel(zoomLevel) } catch {}
  }, [zoomLevel])

  // Register bridge for this tab
  useEffect(() => {
    if (!window.__pixelCityBrowserTabs) window.__pixelCityBrowserTabs = new Map()
    if (!window.__pixelCityBrowserTabReady) window.__pixelCityBrowserTabReady = new Map()

    const readyPromise = new Promise<void>(resolve => { readyResolveRef.current = resolve })
    window.__pixelCityBrowserTabReady.set(tabId, readyPromise)

    const bridge: BrowserTabBridge = {
      getUrl: () => urlRef.current,
      getTitle: () => titleRef.current,
      getConsoleLogs: (level?: string) => {
        const logs = logsRef.current
        if (!level || level === 'all') return logs
        return logs.filter(l => l.level === level)
      },
      clearConsoleLogs: () => { logsRef.current = [] },
      executeJs: async (code: string) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        // Wait for page to finish loading before executing JS
        if (loadingRef.current) {
          await new Promise<void>(resolve => {
            const onStop = () => { wv.removeEventListener('did-stop-loading', onStop); resolve() }
            wv.addEventListener('did-stop-loading', onStop)
          })
        }
        return wv.executeJavaScript(code)
      },
      isLoading: () => loadingRef.current,
      canGoBack: () => canGoBackRef.current,
      canGoForward: () => canGoForwardRef.current,
      click: async (opts) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        if (opts.selector) {
          // Use the injected selector engine for robust element finding
          const info = await wv.executeJavaScript(`
            (() => {
              const el = window.__pcQuery ? window.__pcQuery(${JSON.stringify(opts.selector)}) : document.querySelector(${JSON.stringify(opts.selector)});
              if (!el) return { success: false, error: 'Element not found: ' + ${JSON.stringify(opts.selector)} };
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              const rect = el.getBoundingClientRect();
              return {
                success: true,
                x: Math.round(rect.x + rect.width / 2),
                y: Math.round(rect.y + rect.height / 2),
                width: rect.width,
                height: rect.height,
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().slice(0, 80),
              };
            })()
          `)
          if (!info.success) return info
          // Use native input events at element center for proper event handling (React, etc.)
          if (info.width > 0 && info.height > 0) {
            wv.sendInputEvent({ type: 'mouseDown', x: info.x, y: info.y, button: 'left', clickCount: 1 })
            wv.sendInputEvent({ type: 'mouseUp', x: info.x, y: info.y, button: 'left', clickCount: 1 })
          } else {
            // Zero-size element — fall back to JS click
            await wv.executeJavaScript(`(() => { const el = window.__pcQuery ? window.__pcQuery(${JSON.stringify(opts.selector)}) : document.querySelector(${JSON.stringify(opts.selector)}); if (el) el.click(); })()`)
          }
          return { success: true, tag: info.tag, text: info.text }
        } else if (opts.x !== undefined && opts.y !== undefined) {
          const button = opts.button ?? 'left'
          const clickCount = opts.clickCount ?? 1
          wv.sendInputEvent({ type: 'mouseDown', x: opts.x, y: opts.y, button, clickCount })
          wv.sendInputEvent({ type: 'mouseUp', x: opts.x, y: opts.y, button, clickCount })
          return { success: true }
        }
        return { success: false, error: 'Provide either selector or x/y coordinates' }
      },
      scroll: async (opts) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        wv.sendInputEvent({
          type: 'mouseWheel',
          x: opts.x,
          y: opts.y,
          deltaX: opts.deltaX ?? 0,
          deltaY: opts.deltaY ?? -120,
        })
        return { success: true }
      },
      rightClick: async (opts) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        wv.sendInputEvent({ type: 'mouseDown', x: opts.x, y: opts.y, button: 'right', clickCount: 1 })
        wv.sendInputEvent({ type: 'mouseUp', x: opts.x, y: opts.y, button: 'right', clickCount: 1 })
        return { success: true }
      },
      hover: async (opts) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        wv.sendInputEvent({ type: 'mouseMove', x: opts.x, y: opts.y })
        return { success: true }
      },
      doubleClick: async (opts) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        wv.sendInputEvent({ type: 'mouseDown', x: opts.x, y: opts.y, button: 'left', clickCount: 1 })
        wv.sendInputEvent({ type: 'mouseUp', x: opts.x, y: opts.y, button: 'left', clickCount: 1 })
        wv.sendInputEvent({ type: 'mouseDown', x: opts.x, y: opts.y, button: 'left', clickCount: 2 })
        wv.sendInputEvent({ type: 'mouseUp', x: opts.x, y: opts.y, button: 'left', clickCount: 2 })
        return { success: true }
      },
      drag: async (opts) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        const steps = opts.steps ?? 10
        wv.sendInputEvent({ type: 'mouseDown', x: opts.fromX, y: opts.fromY, button: 'left', clickCount: 1 })
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          const cx = Math.round(opts.fromX + (opts.toX - opts.fromX) * t)
          const cy = Math.round(opts.fromY + (opts.toY - opts.fromY) * t)
          wv.sendInputEvent({ type: 'mouseMove', x: cx, y: cy })
        }
        wv.sendInputEvent({ type: 'mouseUp', x: opts.toX, y: opts.toY, button: 'left', clickCount: 1 })
        return { success: true }
      },
      type: async (text) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        for (const char of text) {
          wv.sendInputEvent({ type: 'keyDown', keyCode: char })
          wv.sendInputEvent({ type: 'char', keyCode: char })
          wv.sendInputEvent({ type: 'keyUp', keyCode: char })
        }
      },
      keyPress: async (key, modifiers) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        const mods = modifiers || []
        wv.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods as any })
        wv.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods as any })
      },
      screenshot: async () => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        // capturePage() fails when the webview or its parent container is hidden.
        // Temporarily make everything visible for the capture.
        const wasHidden = wv.style.visibility === 'hidden'
        // The browser panel container uses display:none when another tab is active
        const browserPanel = wv.closest('.browser-view')?.parentElement as HTMLElement | null
        const panelWasHidden = browserPanel && browserPanel.style.display === 'none'
        if (wasHidden) wv.style.visibility = 'visible'
        if (panelWasHidden && browserPanel) browserPanel.style.display = 'flex'
        if (wasHidden || panelWasHidden) {
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        }
        try {
          const image = await wv.capturePage()
          const { width: imageWidth, height: imageHeight } = image.getSize()
          const dpr = window.devicePixelRatio || 1
          // CSS dimensions = what sendInputEvent() coordinate space uses
          const cssWidth = Math.round(imageWidth / dpr)
          const cssHeight = Math.round(imageHeight / dpr)
          return {
            dataUrl: image.toDataURL(),
            imageWidth,
            imageHeight,
            cssWidth,
            cssHeight,
            devicePixelRatio: dpr,
          }
        } finally {
          if (wasHidden) wv.style.visibility = 'hidden'
          if (panelWasHidden && browserPanel) browserPanel.style.display = 'none'
        }
      },
      startRecording: async (options) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        if (recActiveRef.current) throw new Error('Already recording')

        const fps = Math.min(options?.fps || 4, 10)
        const maxWidth = options?.maxWidth || 800
        const interval = Math.round(1000 / fps)
        const MIN_FRAME_DURATION = 1500 // minimum display time per frame (ms)
        const MAX_FRAME_DURATION = 5000 // cap still-frame duration at 5s

        recFramesRef.current = []
        recStartTimeRef.current = Date.now()
        recDimsRef.current = { w: 0, h: 0 }
        recActiveRef.current = true

        // Reusable canvas for frame rendering
        const canvas = document.createElement('canvas')
        let lastW = 0, lastH = 0

        // Deduplication: hash of the last unique frame's RGBA pixels
        let lastHash = ''
        let lastChangeTime = Date.now()

        // Quick hash of RGBA data — sample ~1000 pixels for speed
        const hashRgba = (rgba: Uint8ClampedArray): string => {
          let h = 0
          const step = Math.max(1, (rgba.length >> 2) > 1000 ? Math.floor(rgba.length / 1000) : 1) * 4
          for (let i = 0; i < rgba.length; i += step) {
            h = ((h << 5) - h + rgba[i]!) | 0
            h = ((h << 5) - h + rgba[i + 1]!) | 0
            h = ((h << 5) - h + rgba[i + 2]!) | 0
          }
          return h.toString(36)
        }

        // Convert canvas to WebP Uint8Array via toBlob
        const canvasToWebP = (): Promise<Uint8Array> => {
          return new Promise((resolve, reject) => {
            canvas.toBlob(
              (blob) => {
                if (!blob) return reject(new Error('toBlob returned null'))
                blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject)
              },
              'image/webp',
              0.75,
            )
          })
        }

        const captureFrame = async () => {
          if (!recActiveRef.current) return

          try {
            // Ensure webview is visible for capture
            const wasHidden = wv.style.visibility === 'hidden'
            const browserPanel = wv.closest('.browser-view')?.parentElement as HTMLElement | null
            const panelWasHidden = browserPanel && browserPanel.style.display === 'none'
            if (wasHidden) wv.style.visibility = 'visible'
            if (panelWasHidden && browserPanel) browserPanel.style.display = 'flex'
            if (wasHidden || panelWasHidden) {
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
            }

            const image = await wv.capturePage()

            if (wasHidden) wv.style.visibility = 'hidden'
            if (panelWasHidden && browserPanel) browserPanel.style.display = 'none'

            const { width, height } = image.getSize()
            if (width > 0 && height > 0) {
              const scale = Math.min(1, maxWidth / width)
              const finalW = Math.round(width * scale)
              const finalH = Math.round(height * scale)

              // Lock dimensions on first frame
              if (recDimsRef.current.w === 0) {
                recDimsRef.current = { w: finalW, h: finalH }
              }

              if (finalW !== lastW || finalH !== lastH) {
                canvas.width = finalW
                canvas.height = finalH
                lastW = finalW
                lastH = finalH
              }

              const dataUrl = image.toDataURL()
              const img = new Image()
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve()
                img.onerror = reject
                img.src = dataUrl
              })

              const ctx = canvas.getContext('2d')!
              ctx.drawImage(img, 0, 0, finalW, finalH)
              const rgba = ctx.getImageData(0, 0, finalW, finalH).data
              const frameHash = hashRgba(rgba)

              if (frameHash !== lastHash) {
                // Content changed — update previous frame's duration, then add new frame
                const now = Date.now()
                const frames = recFramesRef.current
                if (frames.length > 0) {
                  // Set previous frame duration to real elapsed time (clamped to min/max)
                  const elapsed = now - lastChangeTime
                  frames[frames.length - 1]!.duration = Math.max(MIN_FRAME_DURATION, Math.min(elapsed, MAX_FRAME_DURATION))
                }

                const webpData = await canvasToWebP()
                frames.push({ data: webpData, duration: interval }) // will be updated on next change
                lastHash = frameHash
                lastChangeTime = now
              }
            }
          } catch (err) {
            console.warn('[REC] Frame capture error:', err)
          }

          scheduleNext()
        }

        const scheduleNext = () => {
          if (!recActiveRef.current) return
          recTimeoutRef.current = setTimeout(captureFrame, interval)
        }

        console.log(`[REC] Recording started: ${fps}fps, maxWidth ${maxWidth}px (WebP, unlimited duration)`)
        window.dispatchEvent(new CustomEvent('pixelcity:browser-gif-recording', { detail: { tabId, recording: true } }))

        captureFrame()
      },

      stopRecording: async () => {
        if (!recActiveRef.current) throw new Error('Not recording')

        recActiveRef.current = false
        if (recTimeoutRef.current) {
          clearTimeout(recTimeoutRef.current)
          recTimeoutRef.current = null
        }

        const frames = recFramesRef.current
        recFramesRef.current = []

        if (frames.length === 0) throw new Error('No frames captured')

        // Finalize last frame — ensure it displays for at least 2 seconds
        const lastFrame = frames[frames.length - 1]!
        lastFrame.duration = Math.max(2000, lastFrame.duration)

        const { w, h } = recDimsRef.current
        const webpBytes = createAnimatedWebP(w, h, frames)

        // Build base64 data URL (chunked to avoid stack overflow)
        const chunks: string[] = []
        for (let i = 0; i < webpBytes.length; i += 8192) {
          chunks.push(String.fromCharCode.apply(null, webpBytes.subarray(i, i + 8192) as unknown as number[]))
        }
        const dataUrl = `data:image/webp;base64,${btoa(chunks.join(''))}`
        const duration = (Date.now() - recStartTimeRef.current) / 1000

        console.log(`[REC] Stopped: ${frames.length} unique frames, ${duration.toFixed(1)}s session`)
        window.dispatchEvent(new CustomEvent('pixelcity:browser-gif-recording', { detail: { tabId, recording: false } }))

        return { dataUrl, frames: frames.length, duration }
      },

      isRecording: () => recActiveRef.current,

      navigate: (targetUrl: string) => {
        const resolved = resolveUrl(targetUrl)
        const wv = webviewRef.current
        if (wv) {
          // Use loadURL directly so we don't rely on src prop changes
          // which would always produce GET requests
          wv.loadURL(resolved)
        }
        onNavigate(tabId, resolved)
      },
      goBack: () => webviewRef.current?.goBack(),
      goForward: () => webviewRef.current?.goForward(),
      reload: () => webviewRef.current?.reload(),
      formInput: async (selector, value, options = {}) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        const clear = options.clear !== false

        // Step 1: Find element, determine type, handle non-text inputs in JS
        const info = await wv.executeJavaScript(`
          (() => {
            const el = window.__pcQuery ? window.__pcQuery(${JSON.stringify(selector)}) : document.querySelector(${JSON.stringify(selector)});
            if (!el) return { success: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            const tag = el.tagName.toLowerCase();
            const type = (el.type || '').toLowerCase();
            const rect = el.getBoundingClientRect();

            // Select dropdowns
            if (tag === 'select') {
              const val = ${JSON.stringify(value)};
              const opt = Array.from(el.options).find(o => o.value === val || o.textContent.trim() === val);
              if (!opt) return { success: false, error: 'Option not found: ' + val };
              el.value = opt.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return { success: true, method: 'select' };
            }
            // Checkbox / radio
            if (type === 'checkbox' || type === 'radio') {
              const want = ${JSON.stringify(value)};
              if (type === 'checkbox') {
                const shouldCheck = want === 'true' || want === '1' || want === 'on';
                if (el.checked !== shouldCheck) el.click();
              } else {
                el.click();
              }
              return { success: true, method: 'toggle' };
            }
            // Contenteditable
            if (el.isContentEditable) {
              el.focus();
              if (${clear}) el.innerHTML = '';
              el.textContent = ${JSON.stringify(value)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return { success: true, method: 'contenteditable' };
            }
            // Text input / textarea — use React-compatible native setter + native events
            if (tag === 'input' || tag === 'textarea') {
              el.focus();
              if (${clear}) {
                // Use native setter to bypass React's synthetic value tracking
                const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (nativeSetter) {
                  nativeSetter.call(el, ${JSON.stringify(value)});
                } else {
                  el.value = ${JSON.stringify(value)};
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true, method: 'nativeSetter' };
              }
              return {
                success: true, method: 'type',
                x: Math.round(rect.x + rect.width / 2),
                y: Math.round(rect.y + rect.height / 2),
              };
            }
            // Fallback: try setting value
            el.focus();
            try { el.value = ${JSON.stringify(value)}; } catch {}
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true, method: 'fallback' };
          })()
        `)

        if (!info.success) return info

        // For type method (non-clear mode on text inputs), use native key events
        if (info.method === 'type') {
          wv.sendInputEvent({ type: 'mouseDown', x: info.x, y: info.y, button: 'left', clickCount: 1 })
          wv.sendInputEvent({ type: 'mouseUp', x: info.x, y: info.y, button: 'left', clickCount: 1 })
          for (const char of value) {
            wv.sendInputEvent({ type: 'keyDown', keyCode: char })
            wv.sendInputEvent({ type: 'char', keyCode: char })
            wv.sendInputEvent({ type: 'keyUp', keyCode: char })
          }
        }

        // Optional Enter key after filling
        if (options.pressEnter) {
          wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
          wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
        }

        return { success: true }
      },
      queryElements: async (selector?, limit?) => {
        const wv = webviewRef.current
        if (!wv) throw new Error('Browser webview not available')
        return wv.executeJavaScript(`
          window.__pcQueryAll ? window.__pcQueryAll(${JSON.stringify(selector || '')}, ${limit || 50}) : []
        `)
      },
    }

    window.__pixelCityBrowserTabs.set(tabId, bridge)

    return () => {
      window.__pixelCityBrowserTabs?.delete(tabId)
      window.__pixelCityBrowserTabReady?.delete(tabId)
      // Clean up webContentsId → tabId mapping
      if (window.__pixelCityWebContentsToTab) {
        for (const [wcId, tid] of window.__pixelCityWebContentsToTab) {
          if (tid === tabId) { window.__pixelCityWebContentsToTab.delete(wcId); break }
        }
      }
    }
  }, [tabId])

  // Webview event listeners
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const updateNavState = () => {
      const back = wv.canGoBack()
      const fwd = wv.canGoForward()
      canGoBackRef.current = back
      canGoForwardRef.current = fwd
      onNavStateChange(tabId, back, fwd)
    }

    const handleNavigate = (e: any) => {
      urlRef.current = e.url
      onNavigate(tabId, e.url)
      updateNavState()
    }

    const handleStartLoad = () => {
      loadingRef.current = true
      onLoadingChange(tabId, true)
    }
    const handleStopLoad = () => {
      loadingRef.current = false
      onLoadingChange(tabId, false)
      updateNavState()
    }
    const handleTitleUpdate = (e: any) => {
      titleRef.current = e.title || ''
      onTitleUpdate(tabId, e.title || '')
    }

    const handleConsoleMessage = (e: any) => {
      const entry: ConsoleEntry = {
        level: LEVEL_MAP[e.level] || 'log',
        message: e.message,
        source: e.sourceId || '',
        line: e.line || 0,
        timestamp: Date.now(),
      }
      logsRef.current = [...logsRef.current, entry]
      onConsoleLog(tabId, entry)
    }

    const handleCrash = (e: any) => {
      const reason = e?.reason || e?.details?.reason || 'unknown'
      const exitCode = e?.exitCode ?? e?.details?.exitCode ?? ''
      console.error(`[BrowserWebview] Renderer process gone for tab ${tabId}: reason=${reason} exitCode=${exitCode}`, JSON.stringify(e))
      onCrash(tabId, `${reason}${exitCode ? ` (exit ${exitCode})` : ''}`)
    }

    const handleFailLoad = (e: any) => {
      // Only log main-frame failures; errorCode -3 is "aborted" (normal during navigation)
      if (e.isMainFrame && e.errorCode !== -3) {
        console.warn(`[BrowserWebview] Failed to load in tab ${tabId}: ${e.errorDescription} (${e.errorCode})`)
      }
    }

    const handleDomReady = () => {
      domReadyRef.current = true
      // Map webContentsId → tabId so main-process IPC can be attributed to a tab
      try {
        const wcId = wv.getWebContentsId()
        if (wcId) {
          if (!window.__pixelCityWebContentsToTab) window.__pixelCityWebContentsToTab = new Map()
          window.__pixelCityWebContentsToTab.set(wcId, tabId)
          // Tell main process about tab ownership for download routing
          ipcRenderer.send('set-download-info', {
            webContentsId: wcId,
            isAgent: ownerType === 'agent',
            agentName,
          })
        }
      } catch {}
      // Inject stealth patches before page scripts can detect automation
      wv.executeJavaScript(STEALTH_SCRIPT).catch(() => {})
      // Inject selector engine for robust element queries
      wv.executeJavaScript(SELECTOR_ENGINE_SCRIPT).catch(() => {})
      // Apply current zoom level now that webview is ready
      if (zoomLevelRef.current !== 0) {
        try { wv.setZoomLevel(zoomLevelRef.current) } catch {}
      }
      readyResolveRef.current?.()
    }

    wv.addEventListener('did-navigate', handleNavigate)
    wv.addEventListener('did-navigate-in-page', handleNavigate)
    wv.addEventListener('did-start-loading', handleStartLoad)
    wv.addEventListener('did-stop-loading', handleStopLoad)
    wv.addEventListener('page-title-updated', handleTitleUpdate)
    wv.addEventListener('console-message', handleConsoleMessage)
    wv.addEventListener('dom-ready', handleDomReady)
    wv.addEventListener('render-process-gone', handleCrash)
    wv.addEventListener('did-fail-load', handleFailLoad)

    return () => {
      wv.removeEventListener('did-navigate', handleNavigate)
      wv.removeEventListener('did-navigate-in-page', handleNavigate)
      wv.removeEventListener('did-start-loading', handleStartLoad)
      wv.removeEventListener('did-stop-loading', handleStopLoad)
      wv.removeEventListener('page-title-updated', handleTitleUpdate)
      wv.removeEventListener('console-message', handleConsoleMessage)
      wv.removeEventListener('dom-ready', handleDomReady)
      wv.removeEventListener('render-process-gone', handleCrash)
      wv.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [tabId])

  return (
    <webview
      ref={webviewRef}
      src={initialUrlRef.current}
      partition={partition}
      useragent={STEALTH_USER_AGENT}
      webpreferences="allowRunningInsecureContent=yes, webSecurity=no"
      allowpopups={true}
      style={{
        position: 'absolute',
        top: 0, left: 0, width: '100%', height: '100%',
        border: 'none',
        zIndex: visible ? 2 : 1,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    />
  )
}
