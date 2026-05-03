import React, { useRef, useCallback, useState, useEffect } from 'react'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { ChangedFile } from '../types.js'
import { STATUS_COLORS } from '../types.js'
import { getGitAdapter } from '../adapter/index.js'
import type { EditorSettings } from '@pixel-city/plugin-files'
import { DiffIcon } from '@pixel-city/ui'

export type MediaType = 'image' | 'pdf' | 'video' | 'audio' | null

export type ThemeName = 'dark' | 'creme' | 'nord' | 'monokai' | 'light'

function monacoTheme(t: ThemeName): string {
  if (t === 'dark') return 'vs-dark'
  if (t === 'creme') return 'pixelcity-creme'
  if (t === 'nord') return 'pixelcity-nord'
  if (t === 'monokai') return 'pixelcity-monokai'
  return 'vs'
}

loader.config({ monaco })

// Disable all diagnostic markers globally (no error/warning squiggles)
;(monaco.languages as any).typescript?.typescriptDefaults?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true })
;(monaco.languages as any).typescript?.javascriptDefaults?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true })

// ── DiffViewer component ─────────────────────────────────────────

export interface DiffViewerProps {
  activeFile: ChangedFile | null
  diffContent: { original: string; modified: string; language: string } | null
  mediaPreview?: { type: MediaType; dataUrl: string } | null
  onClose: () => void
  editorSettings?: EditorSettings
  projectCwd?: string
  onFileEdited?: () => void
  theme?: ThemeName
}

export function DiffViewer({ activeFile, diffContent, mediaPreview, onClose, editorSettings, projectCwd, onFileEdited, theme = 'dark' }: DiffViewerProps) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Manual monaco diff-editor management — avoids @monaco-editor/react's
  // unmount race ("TextModel got disposed before DiffEditorWidget model got
  // reset"), which fires because its cleanup disposes models before resetting
  // the widget's model reference.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [dirty, setDirty] = useState(false)

  const [editorTheme, setEditorTheme] = useState(() => monacoTheme(theme))
  useEffect(() => {
    const handler = (e: Event) => setEditorTheme(monacoTheme((e as CustomEvent).detail?.theme ?? 'dark'))
    window.addEventListener('pixelcity:theme-changed', handler)
    return () => window.removeEventListener('pixelcity:theme-changed', handler)
  }, [])
  useEffect(() => { setEditorTheme(monacoTheme(theme)) }, [theme])

  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const lastSavedContentRef = useRef<string | null>(null)

  const isEditable = activeFile != null && !activeFile.staged && activeFile.status !== 'D'
  const adapter = getGitAdapter()

  const saveNow = useCallback(async () => {
    if (!editorRef.current || !activeFile || !projectCwd) return
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (!adapter.saveFileContent) return
    const modifiedEditor = editorRef.current.getModifiedEditor()
    const content = modifiedEditor.getValue()
    try {
      await adapter.saveFileContent(projectCwd, activeFile.path, content)
      lastSavedContentRef.current = content
      setDirty(false)
      onFileEdited?.()
    } catch { /* ignore write errors */ }
  }, [activeFile, projectCwd, onFileEdited, adapter])

  // ── Manual diff editor lifecycle ───────────────────────────────
  // Recreates the editor whenever activeFile/diffContent changes.
  // Cleanup order is critical: setModel({null,null}) BEFORE model.dispose()
  // BEFORE editor.dispose() — anything else trips Monaco's
  // "TextModel got disposed before DiffEditorWidget model got reset" guard.
  const editorOptionsRef = useRef(editorSettings)
  editorOptionsRef.current = editorSettings
  const isEditableRef = useRef(isEditable)
  isEditableRef.current = isEditable
  const saveNowRef = useRef(saveNow)
  saveNowRef.current = saveNow

  useEffect(() => {
    if (!containerRef.current || !diffContent || !activeFile) return
    if (mediaPreview) return // media preview branch handles its own rendering

    const s = editorOptionsRef.current
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: editorTheme,
      fontSize: s?.fontSize ?? 13,
      fontFamily: s?.fontFamily ?? "'JetBrains Mono', 'Fira Code', monospace",
      readOnly: !isEditableRef.current,
      originalEditable: false,
      renderSideBySide: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      folding: true,
      lineNumbers: s?.lineNumbers ?? 'on',
      smoothScrolling: true,
      padding: { top: 8 },
      automaticLayout: true,
      renderOverviewRuler: true,
      diffWordWrap: s?.wordWrap === 'wordWrapColumn' || s?.wordWrap === 'bounded' ? 'on' : (s?.wordWrap === 'on' ? 'on' : 'off'),
    })

    const originalModel = monaco.editor.createModel(diffContent.original, diffContent.language)
    const modifiedModel = monaco.editor.createModel(diffContent.modified, diffContent.language)
    editor.setModel({ original: originalModel, modified: modifiedModel })
    editorRef.current = editor

    // Clear diagnostic markers (no error/warning squiggles)
    const clearMarkers = () => {
      monaco.editor.setModelMarkers(originalModel, 'javascript', [])
      monaco.editor.setModelMarkers(modifiedModel, 'javascript', [])
    }
    clearMarkers()
    const markerTimer = setTimeout(clearMarkers, 500)

    // Override broken Cmd/Ctrl+V (standalone monaco lacks productService)
    for (const ed of [editor.getOriginalEditor(), editor.getModifiedEditor()]) {
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
        try {
          const text = await navigator.clipboard.readText()
          if (text) ed.trigger('keyboard', 'type', { text })
        } catch {}
      })
    }

    let changeListener: monaco.IDisposable | null = null
    if (isEditableRef.current && projectCwd && adapter.saveFileContent) {
      const modifiedEditor = editor.getModifiedEditor()
      modifiedEditor.updateOptions({ readOnly: false })
      lastSavedContentRef.current = modifiedEditor.getValue()
      modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveNowRef.current()
      })
      changeListener = modifiedEditor.onDidChangeModelContent(() => {
        setDirty(modifiedEditor.getValue() !== lastSavedContentRef.current)
      })
    }

    return () => {
      clearTimeout(markerTimer)
      changeListener?.dispose()
      // Order matters — reset widget's model reference BEFORE disposing the
      // underlying TextModels, otherwise the widget's _modelDisposeListener
      // throws "TextModel got disposed before DiffEditorWidget model got reset".
      try { editor.setModel(null) } catch { /* ignore */ }
      try { originalModel.dispose() } catch { /* ignore */ }
      try { modifiedModel.dispose() } catch { /* ignore */ }
      try { editor.dispose() } catch { /* ignore */ }
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.path, activeFile?.staged, diffContent, mediaPreview, projectCwd, adapter])

  // Apply theme changes to live editor
  useEffect(() => {
    if (editorRef.current) {
      monaco.editor.setTheme(editorTheme)
    }
  }, [editorTheme])

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedDialog(true)
    } else {
      editorRef.current = null
      onClose()
    }
  }, [dirty, onClose])

  const handleSaveAndClose = useCallback(() => {
    saveNow()
    setShowUnsavedDialog(false)
    editorRef.current = null
    onClose()
  }, [saveNow, onClose])

  const handleDiscardAndClose = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    setDirty(false)
    setShowUnsavedDialog(false)
    editorRef.current = null
    onClose()
  }, [onClose])

  if (!activeFile || (!diffContent && !mediaPreview)) {
    return (
      <div data-testid="git-diff-viewer" className="flex-1 flex flex-col items-center justify-center gap-2 text-text-dim">
        <DiffIcon style={{ opacity: 0.3 }} />
        <p className="text-[14px] font-ui text-text-dim m-0">Select a file to view diff</p>
        <p className="text-[11px] text-[rgba(200,197,190,0.3)] m-0">Click on a changed file in the sidebar</p>
      </div>
    )
  }

  // ── Media preview (images, PDFs, video, audio) ──
  if (activeFile && mediaPreview) {
    return (
      <>
        {/* Tab bar */}
        <div data-testid="git-diff-viewer" className="flex items-center h-8 bg-bg-card border-b border-border overflow-x-auto shrink-0 [&::-webkit-scrollbar]:h-0">
          <div className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-ui text-text-bright bg-bg border-r border-border border-b-2 border-b-accent whitespace-nowrap shrink-0">
            <span className="text-[11px]" style={{ color: STATUS_COLORS[activeFile.status] }}>
              {activeFile.path}
            </span>
            <span className="text-[10px] text-text-dim opacity-70">{activeFile.staged ? '(Staged)' : '(Working Tree)'}</span>
            <span data-testid="git-diff-close" className="text-[14px] leading-none text-text-dim px-0.5 rounded-[3px] cursor-pointer transition-[color,background] duration-100 hover:text-text-bright hover:bg-white/10" onClick={onClose}>&times;</span>
          </div>
        </div>
        {/* Media preview */}
        <div className="flex-1 flex items-center justify-center overflow-auto bg-bg p-4">
          {mediaPreview.type === 'image' && (
            <img src={mediaPreview.dataUrl} alt={activeFile.name} draggable={false} className="max-w-full max-h-full object-contain rounded [background:repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)_0_0_/_16px_16px]" />
          )}
          {mediaPreview.type === 'pdf' && (
            <iframe src={mediaPreview.dataUrl} title={activeFile.name} className="w-full h-full border-none rounded" />
          )}
          {mediaPreview.type === 'video' && (
            <video src={mediaPreview.dataUrl} controls className="max-w-full max-h-full rounded" />
          )}
          {mediaPreview.type === 'audio' && (
            <div className="flex flex-col items-center gap-3 text-text-dim">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              <p className="m-0 text-[13px] font-ui">{activeFile.name}</p>
              <audio src={mediaPreview.dataUrl} controls className="w-[320px]" />
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {/* Tab bar */}
      <div data-testid="git-diff-viewer" className="flex items-center h-8 bg-bg-card border-b border-border overflow-x-auto shrink-0 [&::-webkit-scrollbar]:h-0">
        <div className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-ui text-text-bright bg-bg border-r border-border border-b-2 border-b-accent whitespace-nowrap shrink-0">
          <span className="text-[11px]" style={{ color: STATUS_COLORS[activeFile.status] }}>
            {activeFile.path}
          </span>
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-text-dim shrink-0" />}
          <span className="text-[10px] text-text-dim opacity-70">{activeFile.staged ? '(Staged)' : '(Working Tree)'}</span>
          <span data-testid="git-diff-close" className="text-[14px] leading-none text-text-dim px-0.5 rounded-[3px] cursor-pointer transition-[color,background] duration-100 hover:text-text-bright hover:bg-white/10" onClick={handleClose}>&times;</span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 w-full" />

      {showUnsavedDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-[300]">
          <div className="bg-bg-card border border-border rounded-lg px-6 py-5 max-w-[380px] w-[90%] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <p className="text-[14px] font-semibold text-text m-0 mb-2">Unsaved Changes</p>
            <p className="text-[12px] text-text-dim m-0 mb-4 leading-[1.4]">Do you want to save changes to <strong>{activeFile.name}</strong> before closing?</p>
            <div className="flex gap-2 justify-end">
              <button className="py-[5px] px-[14px] border border-border rounded bg-accent border-accent text-white text-[12px] cursor-pointer hover:bg-[#4a8abf]" onClick={handleSaveAndClose}>Save</button>
              <button className="py-[5px] px-[14px] border border-[rgba(199,78,57,0.4)] rounded bg-transparent text-[#c74e39] text-[12px] cursor-pointer hover:bg-[rgba(199,78,57,0.1)]" onClick={handleDiscardAndClose}>Don't Save</button>
              <button className="py-[5px] px-[14px] border border-border rounded bg-transparent text-text text-[12px] cursor-pointer hover:bg-white/[0.06]" onClick={() => setShowUnsavedDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
