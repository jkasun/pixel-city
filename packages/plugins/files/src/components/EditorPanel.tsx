/**
 * EditorPanel — shared Monaco editor + media preview + markdown preview.
 *
 * Platform-specific Monaco worker setup and theme registration must happen
 * BEFORE this component mounts. Use MonacoConfigProvider to pass the current theme.
 *
 * Go-to-definition and import resolution are optional — only available when
 * the adapter provides the necessary capabilities (terminal-app only for now).
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import type * as monacoNs from 'monaco-editor'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark-dimmed.css'
import type { OpenTab, MediaType, EditorSettings } from '../types.js'
import { getLanguage } from '../utils.js'
import { useMonacoConfig } from './MonacoContext.js'
import { getFilesAdapter } from '../adapter/index.js'
import { FileIcon, FilesContextMenu } from './FileTreePanel.js'
import { EmptyFileIcon, FolderLargeIcon, FileIconSmall, ChevronRightIcon } from '../icons.js'
import * as path from '../path.js'

// Re-export getLanguage from utils (avoid circular)
export { getLanguage }

// ── MediaPreview component ──────────────────────────────────────

function MediaPreview({ type, src, name }: { type: MediaType; src: string; name: string }) {
  if (type === 'image') {
    return (
      <div className="flex-1 flex items-center justify-center overflow-auto bg-bg p-4">
        <img
          src={src}
          alt={name}
          draggable={false}
          className="max-w-full max-h-full object-contain rounded-[4px] [background:repeating-conic-gradient(var(--bg-hover)_0%_25%,var(--bg-card)_0%_50%)_0_0_/_16px_16px]"
        />
      </div>
    )
  }
  if (type === 'pdf') {
    return (
      <div className="flex-1 flex items-center justify-center overflow-auto bg-bg">
        <iframe src={src} title={name} className="w-full h-full border-none bg-white" />
      </div>
    )
  }
  if (type === 'video') {
    return (
      <div className="flex-1 flex items-center justify-center overflow-auto bg-bg p-4">
        <video src={src} controls className="max-w-full max-h-full rounded-[6px] outline-none" />
      </div>
    )
  }
  if (type === 'audio') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center overflow-auto bg-bg p-4 gap-4">
        <div className="text-white/20">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <p className="text-white/50 text-[13px] font-ui m-0">{name}</p>
        <audio src={src} controls className="w-[320px] max-w-full outline-none" />
      </div>
    )
  }
  return null
}

// Configure marked with highlight.js for syntax highlighting
marked.setOptions({
  breaks: true,
  gfm: true,
})

// ── EditorPanel component ───────────────────────────────────────

export interface EditorPanelProps {
  openTabs: OpenTab[]
  activeTabPath: string | null
  onTabSelect: (path: string) => void
  onTabClose: (path: string, e?: React.MouseEvent) => void
  onCloseOthers: (path: string) => void
  onCloseToRight: (path: string) => void
  onCloseSaved: () => void
  onCloseAll: () => void
  onEditorChange: (value: string | undefined) => void
  onSave?: () => void
  onOpenFile?: (path: string) => void
  onOpenFileAtLine?: (path: string, line: number, column?: number) => void
  editorSettings?: EditorSettings
  projectCwd?: string
  pendingReveal?: { line: number; column: number } | null
  onRevealComplete?: () => void
  /** Ref populated with the live Monaco editor — lets the parent read the
   *  latest text without waiting for React state to commit. Cleared on dispose. */
  editorInstanceRef?: React.MutableRefObject<monacoNs.editor.IStandaloneCodeEditor | null>
}

export function EditorPanel({
  openTabs,
  activeTabPath,
  onTabSelect,
  onTabClose,
  onCloseOthers,
  onCloseToRight,
  onCloseSaved,
  onCloseAll,
  onEditorChange,
  onSave,
  onOpenFile,
  onOpenFileAtLine,
  editorSettings,
  projectCwd,
  pendingReveal,
  onRevealComplete,
  editorInstanceRef,
}: EditorPanelProps) {
  const monacoConfig = useMonacoConfig()
  const activeTab = openTabs.find(t => t.path === activeTabPath)
  const language = activeTab ? getLanguage(activeTab.name) : 'plaintext'
  const isMarkdown = activeTab?.name.endsWith('.md') ?? false

  // Track view mode per tab path
  const [viewModes, setViewModes] = useState<Record<string, 'edit' | 'preview'>>({})
  const viewMode = activeTabPath
    ? (viewModes[activeTabPath] ?? (isMarkdown ? 'preview' : 'edit'))
    : 'edit'

  const setViewMode = useCallback((mode: 'edit' | 'preview') => {
    if (activeTabPath) {
      setViewModes(prev => ({ ...prev, [activeTabPath]: mode }))
    }
  }, [activeTabPath])

  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  // Handle pending reveal (jump to line/column from search)
  useEffect(() => {
    if (!pendingReveal || !editorRef.current) return
    const { line, column } = pendingReveal
    const editor = editorRef.current
    const timer = setTimeout(() => {
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column })
      editor.focus()
      onRevealComplete?.()
    }, 50)
    return () => clearTimeout(timer)
  }, [pendingReveal, activeTabPath, onRevealComplete])

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    if (editorInstanceRef) editorInstanceRef.current = editor
    editor.onDidDispose(() => {
      if (editorInstanceRef && editorInstanceRef.current === editor) {
        editorInstanceRef.current = null
      }
    })

    // Cmd+V paste fix for standalone Monaco
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text) editor.trigger('keyboard', 'type', { text })
      } catch {}
    })

    // Cmd+S save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })
  }, [editorInstanceRef])

  // Markdown preview
  const previewHtml = useMemo(() => {
    if (!isMarkdown || viewMode !== 'preview' || !activeTab) return ''
    const renderer = new marked.Renderer()
    renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`
      }
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<pre><code class="hljs">${escaped}</code></pre>`
    }
    const raw = marked.parse(activeTab.content || '', { renderer }) as string
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['img'],
      ADD_ATTR: ['src', 'alt', 'title'],
    })
  }, [isMarkdown, viewMode, activeTab?.content, activeTab?.path])

  // Tab context menu
  const [tabCtx, setTabCtx] = useState<{ x: number; y: number; path: string } | null>(null)

  const tabCtxItems = useMemo(() => {
    if (!tabCtx) return []
    const { path: tabPath } = tabCtx
    const tabIdx = openTabs.findIndex(t => t.path === tabPath)
    const hasTabsToRight = tabIdx < openTabs.length - 1

    const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text) }
    const relativePath = projectCwd ? tabPath.replace(projectCwd + '/', '') : tabPath
    const breadcrumbs = relativePath.replace(/\//g, ' › ')

    return [
      { label: 'Close', shortcut: '⌘W', onClick: () => onTabClose(tabPath) },
      { label: 'Close Others', shortcut: '⌥⌘T', onClick: () => onCloseOthers(tabPath) },
      { label: 'Close to the Right', disabled: !hasTabsToRight, onClick: () => onCloseToRight(tabPath) },
      { label: 'Close Saved', shortcut: '⌘K U', onClick: () => onCloseSaved() },
      { label: 'Close All', shortcut: '⌘K W', onClick: () => onCloseAll() },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Copy Path', shortcut: '⌥⌘C', onClick: () => copyToClipboard(tabPath) },
      { label: 'Copy Relative Path', shortcut: '⌥⇧⌘C', onClick: () => copyToClipboard(relativePath) },
      { label: 'Copy Breadcrumbs Path', onClick: () => copyToClipboard(breadcrumbs) },
    ]
  }, [tabCtx, openTabs, projectCwd, onTabClose, onCloseOthers, onCloseToRight, onCloseSaved, onCloseAll])

  // Breadcrumbs
  const breadcrumbSegments = useMemo(() => {
    if (!activeTab || !projectCwd) return []
    const rel = activeTab.path.startsWith(projectCwd + '/')
      ? activeTab.path.slice(projectCwd.length + 1)
      : activeTab.path
    return rel.split('/')
  }, [activeTab, projectCwd])

  const breadcrumbBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = breadcrumbBarRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [breadcrumbSegments])

  return (
    <div data-testid="files-editor" className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Tabs */}
      {openTabs.length > 0 && (
        <div data-testid="files-editor-tabs" className="flex items-center h-8 bg-bg-card border-b border-border overflow-x-auto shrink-0 [&::-webkit-scrollbar]:h-0">
          {openTabs.map(tab => (
            <div
              key={tab.path}
              data-testid={`files-editor-tab-${tab.name}`}
              className={`flex items-center gap-[6px] px-3 h-8 text-[11px] font-ui cursor-pointer border-r border-border whitespace-nowrap shrink-0 transition-[color,background] duration-100${tab.path === activeTabPath ? ' text-text-bright bg-bg border-b-2 border-b-accent' : ' text-text-dim hover:text-text hover:bg-white/[0.03]'}`}
              onClick={() => onTabSelect(tab.path)}
              onContextMenu={(e) => { e.preventDefault(); setTabCtx({ x: e.clientX, y: e.clientY, path: tab.path }) }}
            >
              <span className="flex items-center gap-1">
                {tab.modified && <span className="w-[6px] h-[6px] rounded-full bg-accent shrink-0" />}
                {tab.name}
              </span>
              <span
                data-testid={`files-editor-close-tab-${tab.name}`}
                className="text-[14px] leading-none text-text-dim px-[2px] rounded-[3px] transition-[color,background] duration-100 hover:text-text-bright hover:bg-white/10"
                onClick={(e) => onTabClose(tab.path, e)}
              >×</span>
            </div>
          ))}
        </div>
      )}

      {/* Breadcrumb bar */}
      {activeTab && breadcrumbSegments.length > 0 && (
        <div data-testid="files-breadcrumb" ref={breadcrumbBarRef} className="flex items-center h-[22px] px-3 bg-bg border-b border-border shrink-0 overflow-x-auto [&::-webkit-scrollbar]:h-0">
          {breadcrumbSegments.map((seg, i) => {
            const isLast = i === breadcrumbSegments.length - 1
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="mx-[5px] text-[10px] text-text-dim select-none">›</span>
                )}
                <span
                  className={`text-[11px] font-ui whitespace-nowrap px-[4px] py-[1px] rounded-[3px] transition-colors duration-100 select-none
                    ${isLast ? 'text-text-bright' : 'text-text-dim'}`}
                >
                  {seg}
                </span>
              </React.Fragment>
            )
          })}
        </div>
      )}

      {/* Editor / Preview / Media */}
      {activeTab ? (
        <div data-testid="files-editor-content" className="relative flex-1 flex flex-col overflow-hidden">
          {/* Markdown view toggle */}
          {isMarkdown && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-[1px] px-[2px] bg-bg-card/90 backdrop-blur-sm border border-border rounded overflow-hidden">
              <button
                className={`border-none text-[10px] px-[10px] py-[3px] cursor-pointer rounded-[3px] transition-all duration-150 font-[inherit]${viewMode === 'edit' ? ' text-text-bright bg-bg-hover' : ' bg-none text-text-muted hover:text-text hover:bg-bg-hover'}`}
                onClick={() => setViewMode('edit')}
              >
                Edit
              </button>
              <button
                className={`border-none text-[10px] px-[10px] py-[3px] cursor-pointer rounded-[3px] transition-all duration-150 font-[inherit]${viewMode === 'preview' ? ' text-text-bright bg-bg-hover' : ' bg-none text-text-muted hover:text-text hover:bg-bg-hover'}`}
                onClick={() => setViewMode('preview')}
              >
                Preview
              </button>
            </div>
          )}
          {activeTab.mediaType ? (
            <MediaPreview type={activeTab.mediaType} src={activeTab.content} name={activeTab.name} />
          ) : isMarkdown && viewMode === 'preview' ? (
            <div
              className="md-preview flex-1 overflow-y-auto px-7 py-5 text-[12px] leading-[1.65] text-text max-w-[800px] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[3px]"
              style={{
                fontSize: editorSettings?.fontSize ? `${editorSettings.fontSize - 1}px` : undefined,
                fontFamily: editorSettings?.fontFamily,
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <Editor
              key={activeTabPath}
              height="100%"
              language={language}
              value={activeTab.content}
              onChange={onEditorChange}
              onMount={handleMount}
              theme={monacoConfig.currentTheme}
              options={{
                fontSize: editorSettings?.fontSize ?? 13,
                fontFamily: editorSettings?.fontFamily ?? "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: editorSettings?.minimap ?? true, maxColumn: 80 },
                scrollBeyondLastLine: false,
                renderWhitespace: editorSettings?.renderWhitespace ?? 'selection',
                tabSize: editorSettings?.tabSize ?? 2,
                wordWrap: editorSettings?.wordWrap ?? 'off',
                lineNumbers: editorSettings?.lineNumbers ?? 'on',
                folding: true,
                bracketPairColorization: { enabled: editorSettings?.bracketPairColorization ?? true },
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                padding: { top: 8 },
                automaticLayout: true,
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-dim">
          <div className="mb-2">
            <EmptyFileIcon size={48} style={{ opacity: 0.3 }} />
          </div>
          <p className="text-[14px] font-ui text-text-dim m-0">Select a file to open</p>
          <p className="text-[11px] text-[rgba(200,197,190,0.3)] m-0">Browse the explorer on the left</p>
        </div>
      )}

      {/* Tab context menu */}
      {tabCtx && (
        <FilesContextMenu
          x={tabCtx.x}
          y={tabCtx.y}
          items={tabCtxItems}
          onClose={() => setTabCtx(null)}
        />
      )}
    </div>
  )
}
