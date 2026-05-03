// Configure Monaco workers before any monaco import (required for Vite)
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'

;(window as Window & { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark-dimmed.css'
import type { OpenTab, MediaType } from './fileTypes'
import { getLanguage } from './fileTypes'
import { readMediaFile } from './fileOperations'
const pathModule = window.require('path') as typeof import('path')
const fs = window.require('fs') as typeof import('fs')
import { IGNORED } from './fileTypes'
import { FilesContextMenu } from './FileTreePanel'
import { EmptyFileIcon, FolderLargeIcon, FileIcon, ChevronRightIcon } from '../icons/index.js'
import { loadPixelCitySettings } from '../settings.js'
import type { ThemeName } from '../settings.js'

function monacoTheme(t: ThemeName): string {
  if (t === 'dark') return 'vs-dark'
  if (t === 'creme') return 'pixelcity-creme'
  if (t === 'nord') return 'pixelcity-nord'
  if (t === 'monokai') return 'pixelcity-monokai'
  return 'vs'
}

// Register custom creme theme for Monaco
monaco.editor.defineTheme('pixelcity-creme', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '7a6a4a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'a04030' },
    { token: 'string', foreground: '5a7a2e' },
    { token: 'number', foreground: '3a6a8a' },
    { token: 'type', foreground: '7a4a6a' },
    { token: 'variable', foreground: 'a07030' },
    { token: 'function', foreground: '3a6a8a' },
  ],
  colors: {
    'editor.background': '#FFF7D0',
    'editor.foreground': '#5a4a30',
    'editor.lineHighlightBackground': '#FFE6B820',
    'editorLineNumber.foreground': '#c0a870',
    'editorLineNumber.activeForeground': '#8a7040',
    'editor.selectionBackground': '#FFCCA650',
    'editor.inactiveSelectionBackground': '#FFE6B830',
    'editorIndentGuide.background': '#FFD8B440',
    'editorIndentGuide.activeBackground': '#FFCCA680',
    'editorCursor.foreground': '#c08a40',
    'editorWhitespace.foreground': '#FFD8B440',
    'editorWidget.background': '#FFFAEB',
    'editorWidget.border': '#FFCCA6',
    'editorSuggestWidget.background': '#FFFAEB',
    'editorSuggestWidget.border': '#FFCCA6',
    'editorSuggestWidget.selectedBackground': '#FFE6B8',
    'minimap.background': '#FFF9E0',
    'scrollbarSlider.background': '#FFCCA640',
    'scrollbarSlider.hoverBackground': '#FFCCA680',
    'scrollbarSlider.activeBackground': '#c08a4060',
  },
})

monaco.editor.defineTheme('pixelcity-nord', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
    { token: 'keyword', foreground: '81a1c1' },
    { token: 'string', foreground: 'a3be8c' },
    { token: 'number', foreground: 'b48ead' },
    { token: 'type', foreground: '8fbcbb' },
    { token: 'variable', foreground: 'd8dee9' },
    { token: 'function', foreground: '88c0d0' },
  ],
  colors: {
    'editor.background': '#2e3440',
    'editor.foreground': '#d8dee9',
    'editor.lineHighlightBackground': '#3b425220',
    'editorLineNumber.foreground': '#4c566a',
    'editorLineNumber.activeForeground': '#d8dee9',
    'editor.selectionBackground': '#434c5e80',
    'editor.inactiveSelectionBackground': '#434c5e40',
    'editorIndentGuide.background': '#434c5e40',
    'editorIndentGuide.activeBackground': '#4c566a80',
    'editorCursor.foreground': '#88c0d0',
    'editorWhitespace.foreground': '#434c5e40',
    'editorWidget.background': '#3b4252',
    'editorWidget.border': '#434c5e',
    'editorSuggestWidget.background': '#3b4252',
    'editorSuggestWidget.border': '#434c5e',
    'editorSuggestWidget.selectedBackground': '#434c5e',
    'minimap.background': '#2e3440',
    'scrollbarSlider.background': '#4c566a40',
    'scrollbarSlider.hoverBackground': '#4c566a80',
    'scrollbarSlider.activeBackground': '#4c566aa0',
  },
})

monaco.editor.defineTheme('pixelcity-monokai', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'function', foreground: 'a6e22e' },
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editor.lineHighlightBackground': '#3e3d3220',
    'editorLineNumber.foreground': '#90908a',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editor.selectionBackground': '#49483e80',
    'editor.inactiveSelectionBackground': '#49483e40',
    'editorIndentGuide.background': '#49483e40',
    'editorIndentGuide.activeBackground': '#75715e60',
    'editorCursor.foreground': '#f8f8f0',
    'editorWhitespace.foreground': '#49483e40',
    'editorWidget.background': '#3e3d32',
    'editorWidget.border': '#49483e',
    'editorSuggestWidget.background': '#3e3d32',
    'editorSuggestWidget.border': '#49483e',
    'editorSuggestWidget.selectedBackground': '#49483e',
    'minimap.background': '#272822',
    'scrollbarSlider.background': '#49483e60',
    'scrollbarSlider.hoverBackground': '#49483e90',
    'scrollbarSlider.activeBackground': '#49483eb0',
  },
})

import type { EditorSettings } from '../settings.js'

// Use locally bundled Monaco instead of CDN (for Electron offline support)
loader.config({ monaco })

// Enable JSX syntax highlighting for .tsx / .jsx files
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
  jsx: monaco.languages.typescript.JsxEmit.React,
  jsxFactory: 'React.createElement',
})
monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
  ...monaco.languages.typescript.javascriptDefaults.getCompilerOptions(),
  jsx: monaco.languages.typescript.JsxEmit.React,
  jsxFactory: 'React.createElement',
})


// ── Go-to-definition: resolve import paths to real files ───────

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs']

function resolveImportPath(importPath: string, currentFilePath: string, projectCwd?: string): string | null {
  const currentDir = pathModule.dirname(currentFilePath)

  // Relative or absolute path
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    const base = importPath.startsWith('/') ? importPath : pathModule.resolve(currentDir, importPath)
    return resolveFilePath(base)
  }

  // Try tsconfig/jsconfig paths aliases (e.g. @/ or ~/)
  // Walk up from the current file's directory to find the nearest tsconfig
  const alias = resolveAliasPath(importPath, currentDir)
  if (alias) return alias

  // Try monorepo workspace package resolution (e.g. @gridvision/dashboard/src/models/foo)
  const workspace = resolveWorkspacePackage(importPath, currentDir)
  if (workspace) return workspace

  return null
}

function resolveFilePath(base: string): string | null {
  // Exact file exists
  try { if (fs.statSync(base).isFile()) return base } catch {}

  // Try with extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    try { if (fs.statSync(base + ext).isFile()) return base + ext } catch {}
  }

  // Try as directory with index file
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = pathModule.join(base, 'index' + ext)
    try { if (fs.statSync(indexPath).isFile()) return indexPath } catch {}
  }

  return null
}

function resolveAliasPath(importPath: string, projectCwd: string): string | null {
  // Walk up from projectCwd to find tsconfig.json / jsconfig.json with path aliases
  // This handles monorepos where tsconfig may be in a sub-package
  let dir = projectCwd
  const root = pathModule.parse(dir).root
  while (dir && dir !== root) {
    for (const configName of ['tsconfig.json', 'jsconfig.json']) {
      const configPath = pathModule.join(dir, configName)
      try {
        const raw = fs.readFileSync(configPath, 'utf-8')
        const config = JSON.parse(raw)
        const paths = config?.compilerOptions?.paths as Record<string, string[]> | undefined
        const baseUrl = config?.compilerOptions?.baseUrl as string | undefined
        if (!paths) continue
        const resolveBase = baseUrl ? pathModule.resolve(dir, baseUrl) : dir

        for (const [pattern, targets] of Object.entries(paths)) {
          // Handle patterns like "@/*" -> ["./src/*"]
          if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2)
            if (importPath.startsWith(prefix + '/') || importPath === prefix) {
              const rest = importPath.slice(prefix.length + 1)
              for (const target of targets) {
                const targetBase = target.endsWith('/*') ? target.slice(0, -2) : target
                const resolved = pathModule.resolve(resolveBase, targetBase, rest)
                const result = resolveFilePath(resolved)
                if (result) return result
              }
            }
          } else if (pattern === importPath) {
            for (const target of targets) {
              const resolved = pathModule.resolve(resolveBase, target)
              const result = resolveFilePath(resolved)
              if (result) return result
            }
          }
        }
      } catch {}
    }
    dir = pathModule.dirname(dir)
  }
  return null
}

/** Cache for workspace package locations to avoid re-scanning on every hover */
const workspacePackageCache = new Map<string, Map<string, string>>()

/** Recursively find all package.json files under a directory (up to depth limit) */
function findPackageJsons(dir: string, pkgMap: Map<string, string>, depth = 0): void {
  if (depth > 5) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const childDir = pathModule.join(dir, entry.name)
      const childPkgPath = pathModule.join(childDir, 'package.json')
      try {
        const raw = fs.readFileSync(childPkgPath, 'utf-8')
        const pkg = JSON.parse(raw)
        if (pkg.name) pkgMap.set(pkg.name, childDir)
      } catch {}
      // Recurse into subdirectories for nested workspace patterns like libs/**/*
      findPackageJsons(childDir, pkgMap, depth + 1)
    }
  } catch {}
}

/** Resolve a monorepo workspace package import like @gridvision/dashboard/src/models/foo.
 *  Walks up to find the nearest package.json with workspaces, then scans workspace dirs
 *  to find a package whose name matches the import prefix. */
function resolveWorkspacePackage(importPath: string, fromDir: string): string | null {
  // Determine package name: scoped (@scope/pkg) or bare (pkg)
  let pkgName: string
  let subPath: string
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/')
    if (parts.length < 2) return null
    pkgName = parts[0] + '/' + parts[1]
    subPath = parts.slice(2).join('/')
  } else {
    const slashIdx = importPath.indexOf('/')
    if (slashIdx === -1) {
      pkgName = importPath
      subPath = ''
    } else {
      pkgName = importPath.slice(0, slashIdx)
      subPath = importPath.slice(slashIdx + 1)
    }
  }

  // Walk up to find a root package.json with "workspaces"
  let dir = fromDir
  const root = pathModule.parse(dir).root
  while (dir && dir !== root) {
    const pkgJsonPath = pathModule.join(dir, 'package.json')
    try {
      const raw = fs.readFileSync(pkgJsonPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const workspaces: string[] | undefined = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces?.packages)
          ? pkg.workspaces.packages
          : undefined
      if (!workspaces) { dir = pathModule.dirname(dir); continue }

      // Build or retrieve cached package map
      if (!workspacePackageCache.has(dir)) {
        const pkgMap = new Map<string, string>()
        for (const pattern of workspaces) {
          // Strip glob suffixes: "libs/**/*" → "libs", "apps/*" → "apps"
          const globBase = pattern.replace(/\/?\*\*?\/?\*?$/, '')
          const wsDir = pathModule.resolve(dir, globBase || '.')
          findPackageJsons(wsDir, pkgMap)
        }
        workspacePackageCache.set(dir, pkgMap)
      }

      const pkgMap = workspacePackageCache.get(dir)!
      const pkgDir = pkgMap.get(pkgName)
      if (pkgDir) {
        if (subPath) {
          const result = resolveFilePath(pathModule.join(pkgDir, subPath))
          if (result) return result
        }
        // Try package main/exports
        try {
          const mainRaw = fs.readFileSync(pathModule.join(pkgDir, 'package.json'), 'utf-8')
          const mainPkg = JSON.parse(mainRaw)
          const mainFile = mainPkg.main || mainPkg.module || 'index'
          const result = resolveFilePath(pathModule.join(pkgDir, mainFile))
          if (result) return result
        } catch {}
        return resolveFilePath(pathModule.join(pkgDir, 'index'))
      }
    } catch {}
    dir = pathModule.dirname(dir)
  }
  return null
}

/** Parse import statements and return a map of symbol -> import source path */
function parseImports(text: string): Map<string, string> {
  const map = new Map<string, string>()
  // Match: import { Foo, Bar as Baz } from 'path'
  // Match: import Foo from 'path'
  // Match: import * as Foo from 'path'
  // Match: import type { Foo } from 'path'
  const importRegex = /import\s+(?:type\s+)?(?:(\w+)|(\*\s+as\s+(\w+))|\{([^}]+)\})\s*(?:,\s*\{([^}]+)\})?\s*from\s*['"]([^'"]+)['"]/g
  let match
  while ((match = importRegex.exec(text)) !== null) {
    const source = match[6]
    // Default import
    if (match[1]) map.set(match[1], source)
    // Namespace import (* as X)
    if (match[3]) map.set(match[3], source)
    // Named imports in first position
    if (match[4]) {
      for (const part of match[4].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) map.set(name, source)
      }
    }
    // Named imports after default
    if (match[5]) {
      for (const part of match[5].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) map.set(name, source)
      }
    }
  }
  return map
}

// Register definition providers for TS/JS languages (once globally)
const GO_TO_DEF_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']
let definitionProvidersRegistered = false

/** Resolve a definition location for a position in the editor.
 *  This is called by Monaco on Cmd+hover (for underline) AND on Cmd+click (for navigation).
 *  It must NOT have side effects — file opening is handled separately via editorService override. */
function resolveDefinitionAt(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  currentFile: string,
  cwd?: string,
): { filePath: string; line: number } | null {
  const lineText = model.getLineContent(position.lineNumber)
  const word = model.getWordAtPosition(position)

  // 1. Check if hovering/clicking on an import path string
  const importPathMatch = lineText.match(/from\s+['"]([^'"]+)['"]/)
  if (importPathMatch) {
    const pathStr = importPathMatch[1]
    const pathStart = lineText.indexOf(pathStr, importPathMatch.index!)
    const pathEnd = pathStart + pathStr.length
    if (position.column >= pathStart + 1 && position.column <= pathEnd + 1) {
      const resolved = resolveImportPath(pathStr, currentFile, cwd)
      if (resolved) return { filePath: resolved, line: 1 }
    }
  }

  // Also match: require('path') and dynamic import('path')
  const requireMatch = lineText.match(/(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (requireMatch) {
    const pathStr = requireMatch[1]
    const pathStart = lineText.indexOf(pathStr, requireMatch.index!)
    const pathEnd = pathStart + pathStr.length
    if (position.column >= pathStart + 1 && position.column <= pathEnd + 1) {
      const resolved = resolveImportPath(pathStr, currentFile, cwd)
      if (resolved) return { filePath: resolved, line: 1 }
    }
  }

  // 2. Check if hovering/clicking on an imported symbol name
  if (word) {
    const imports = parseImports(model.getValue())
    const source = imports.get(word.word)
    if (source) {
      const resolved = resolveImportPath(source, currentFile, cwd)
      if (resolved) {
        const targetLine = findExportLine(resolved, word.word)
        return { filePath: resolved, line: targetLine }
      }
    }
  }

  return null
}

function registerDefinitionProviders(
  getFilePath: () => string | null,
  getProjectCwd: () => string | undefined,
) {
  if (definitionProvidersRegistered) return
  definitionProvidersRegistered = true

  for (const lang of GO_TO_DEF_LANGUAGES) {
    monaco.languages.registerDefinitionProvider(lang, {
      provideDefinition(model, position) {
        const currentFile = getFilePath()
        if (!currentFile) return null
        const cwd = getProjectCwd()

        const result = resolveDefinitionAt(model, position, currentFile, cwd)
        if (!result) return null

        // Return the location — Monaco uses this to show the underline on Cmd+hover
        // and to navigate on Cmd+click. We do NOT open files here (no side effects).
        return {
          uri: monaco.Uri.file(result.filePath),
          range: new monaco.Range(result.line, 1, result.line, 1),
        }
      },
    })
  }
}

/** Search a file for where a symbol is exported/defined and return the line number */
function findExportLine(filePath: string, symbol: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    // Look for: export function/const/class/type/interface/enum <symbol>
    // Or: export default function/class <symbol>
    // Or: export { symbol }
    const patterns = [
      new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:function|const|let|var|class|type|interface|enum|abstract\\s+class)\\s+${escapeRegex(symbol)}\\b`),
      new RegExp(`^\\s*(?:function|const|let|var|class|type|interface|enum|abstract\\s+class)\\s+${escapeRegex(symbol)}\\b`),
      new RegExp(`^\\s*export\\s*\\{[^}]*\\b${escapeRegex(symbol)}\\b`),
    ]
    for (let i = 0; i < lines.length; i++) {
      for (const pat of patterns) {
        if (pat.test(lines[i])) return i + 1
      }
    }
  } catch {}
  return 1
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Find the start/end (0-based) of a quoted string surrounding the given column */
function findQuotedStringRange(lineText: string, col: number): { start: number; end: number } | null {
  // Find all quoted strings in the line and check if col falls inside one
  const regex = /(['"`])([^'"`]*?)\1/g
  let m
  while ((m = regex.exec(lineText)) !== null) {
    const contentStart = m.index + 1 // after the opening quote
    const contentEnd = m.index + m[0].length - 1 // before the closing quote
    if (col >= contentStart && col < contentEnd) {
      return { start: contentStart, end: contentEnd }
    }
  }
  return null
}

// Configure marked with highlight.js for syntax highlighting
marked.setOptions({
  breaks: true,
  gfm: true,
})

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
}: EditorPanelProps) {
  const activeTab = openTabs.find(t => t.path === activeTabPath)
  const language = activeTab ? getLanguage(activeTab.name) : 'plaintext'
  const isMarkdown = activeTab?.name.endsWith('.md') ?? false

  const [editorTheme, setEditorTheme] = useState(() => monacoTheme(loadPixelCitySettings().theme ?? 'dark'))
  useEffect(() => {
    const handler = (e: Event) => setEditorTheme(monacoTheme((e as CustomEvent).detail?.theme ?? 'dark'))
    window.addEventListener('pixelcity:theme-changed', handler)
    return () => window.removeEventListener('pixelcity:theme-changed', handler)
  }, [])

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

  // Track editor instance for programmatic navigation
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  // Keep a stable ref to onSave so Monaco commands (registered once at mount) always call the latest callback
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  // Refs for go-to-definition (need stable references for the provider)
  const activeTabPathRef = useRef(activeTabPath)
  activeTabPathRef.current = activeTabPath
  const projectCwdRef = useRef(projectCwd)
  projectCwdRef.current = projectCwd
  const onOpenFileRef = useRef(onOpenFile)
  onOpenFileRef.current = onOpenFile
  const onOpenFileAtLineRef = useRef(onOpenFileAtLine)
  onOpenFileAtLineRef.current = onOpenFileAtLine

  // Register go-to-definition providers (once globally — no side effects, just returns locations)
  useEffect(() => {
    registerDefinitionProviders(
      () => activeTabPathRef.current,
      () => projectCwdRef.current,
    )
  }, [])

  // Override Monaco's broken clipboard paste action (standalone Monaco lacks
  // VS Code's productService, so the built-in paste command crashes)
  const handleMount: OnMount = useCallback((editor) => {
    // pnpm resolves two monaco-editor versions (one via @monaco-editor/react,
    // one via our direct `monaco-editor` import). They're API-compatible at
    // runtime, so cast across the version boundary.
    editorRef.current = editor as unknown as monaco.editor.IStandaloneCodeEditor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text) editor.trigger('keyboard', 'type', { text })
      } catch {}
    })
    // Cmd+S / Ctrl+S to save — Monaco intercepts this keybinding internally,
    // so we must handle it here instead of relying on window-level keydown
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })

    // ── Cmd+hover underline + Cmd+click go-to-definition ──────────
    // Monaco standalone's built-in GotoDefinitionAtPosition contribution may not
    // show underlines because the TS worker can't resolve our file-system paths.
    // We implement the full UX manually: underline on Cmd+hover, navigate on Cmd+click.

    let linkDecorations = editor.createDecorationsCollection([])
    let lastResolvedDef: { filePath: string; line: number } | null = null

    // Show underline when Cmd+hovering over a linkable token
    editor.onMouseMove((e) => {
      if (!e.event.metaKey && !e.event.ctrlKey) {
        linkDecorations.clear()
        lastResolvedDef = null
        return
      }
      if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !e.target.position) {
        linkDecorations.clear()
        lastResolvedDef = null
        return
      }

      const model = editor.getModel()
      const currentFile = activeTabPathRef.current
      if (!model || !currentFile) return

      const result = resolveDefinitionAt(model, e.target.position, currentFile, projectCwdRef.current)
      if (!result) {
        linkDecorations.clear()
        lastResolvedDef = null
        return
      }

      lastResolvedDef = result

      // Find the range to underline — full string content for import paths, word for symbols
      const lineNum = e.target.position.lineNumber
      const lineText = model.getLineContent(lineNum)
      const col = e.target.position.column - 1 // 0-based

      let range: monaco.Range
      // Check if cursor is inside a quoted string — underline the full path
      const stringRange = findQuotedStringRange(lineText, col)
      if (stringRange) {
        range = new monaco.Range(lineNum, stringRange.start + 1, lineNum, stringRange.end + 1)
      } else {
        // Cursor is on a symbol name (e.g. an imported identifier)
        const word = model.getWordAtPosition(e.target.position)
        if (word) {
          range = new monaco.Range(lineNum, word.startColumn, lineNum, word.endColumn)
        } else {
          linkDecorations.clear()
          lastResolvedDef = null
          return
        }
      }

      linkDecorations.set([{
        range,
        options: {
          inlineClassName: 'goto-definition-link',
        },
      }])
    })

    // Clear underlines when Cmd/Ctrl key is released
    const clearOnKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') {
        linkDecorations.clear()
        lastResolvedDef = null
      }
    }
    window.addEventListener('keyup', clearOnKeyUp)
    editor.onDidDispose(() => window.removeEventListener('keyup', clearOnKeyUp))

    // Navigate on Cmd+Click
    editor.onMouseDown((e) => {
      if (!e.event.metaKey && !e.event.ctrlKey) return
      if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return
      if (!lastResolvedDef) return

      e.event.preventDefault()
      e.event.stopPropagation()

      const { filePath, line } = lastResolvedDef
      linkDecorations.clear()
      lastResolvedDef = null

      if (line > 1 && onOpenFileAtLineRef.current) {
        onOpenFileAtLineRef.current(filePath, line, 1)
      } else if (onOpenFileRef.current) {
        onOpenFileRef.current(filePath)
      }
    })

    // Fallback: override internal editor service for F12 "Go to Definition"
    const editorService = (editor as any)._codeEditorService
    if (editorService) {
      editorService.openCodeEditor = async (input: any, _source: any) => {
        const uri = input?.resource as monaco.Uri | undefined
        if (uri && uri.scheme === 'file') {
          const filePath = uri.fsPath || uri.path
          const line = input?.options?.selection?.startLineNumber ?? 1
          if (onOpenFileAtLineRef.current && line > 1) {
            onOpenFileAtLineRef.current(filePath, line, 1)
          } else if (onOpenFileRef.current) {
            onOpenFileRef.current(filePath)
          }
        }
        return null
      }
    }
  }, [])

  // Handle pending reveal (jump to line/column from search)
  useEffect(() => {
    if (!pendingReveal || !editorRef.current) return
    const { line, column } = pendingReveal
    const editor = editorRef.current
    // Small delay to let Monaco render the new file content
    const timer = setTimeout(() => {
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column })
      editor.focus()
      // Highlight the line briefly
      const decorations = editor.createDecorationsCollection([{
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'search-highlight-line',
          overviewRuler: { color: '#c08a40', position: monaco.editor.OverviewRulerLane.Full },
        },
      }])
      setTimeout(() => decorations.clear(), 1500)
      onRevealComplete?.()
    }, 50)
    return () => clearTimeout(timer)
  }, [pendingReveal, activeTabPath, onRevealComplete])

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
    // Resolve image paths relative to the markdown file's directory and convert to data URIs
    // (file:// is blocked by Electron's renderer security policy)
    const fileDir = pathModule.dirname(activeTab.path)
    renderer.image = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
      let src = href
      if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
        const absPath = pathModule.isAbsolute(src) ? src : pathModule.resolve(fileDir, src)
        const media = readMediaFile(absPath)
        if (media) src = media.dataUrl
      }
      const titleAttr = title ? ` title="${title}"` : ''
      return `<img src="${src}" alt="${text}"${titleAttr} />`
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
    const { path } = tabCtx
    const tabIdx = openTabs.findIndex(t => t.path === path)
    const hasTabsToRight = tabIdx < openTabs.length - 1

    const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text) }
    const relativePath = projectCwd ? path.replace(projectCwd + '/', '') : path
    const breadcrumbs = relativePath.replace(/\//g, ' › ')

    return [
      { label: 'Close', shortcut: '⌘W', onClick: () => onTabClose(path) },
      { label: 'Close Others', shortcut: '⌥⌘T', onClick: () => onCloseOthers(path) },
      { label: 'Close to the Right', disabled: !hasTabsToRight, onClick: () => onCloseToRight(path) },
      { label: 'Close Saved', shortcut: '⌘K U', onClick: () => onCloseSaved() },
      { label: 'Close All', shortcut: '⌘K W', onClick: () => onCloseAll() },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Copy Path', shortcut: '⌥⌘C', onClick: () => copyToClipboard(path) },
      { label: 'Copy Relative Path', shortcut: '⌥⇧⌘C', onClick: () => copyToClipboard(relativePath) },
      { label: 'Copy Breadcrumbs Path', onClick: () => copyToClipboard(breadcrumbs) },
    ]
  }, [tabCtx, openTabs, projectCwd, onTabClose, onCloseOthers, onCloseToRight, onCloseSaved, onCloseAll])

  // Compute breadcrumb segments for the active tab
  const breadcrumbSegments = useMemo(() => {
    if (!activeTab || !projectCwd) return []
    const rel = activeTab.path.startsWith(projectCwd + '/')
      ? activeTab.path.slice(projectCwd.length + 1)
      : activeTab.path
    return rel.split('/')
  }, [activeTab, projectCwd])

  // Breadcrumb folder picker — multi-level cascading panels
  type BcEntry = { name: string; isFolder: boolean; fullPath: string }
  type BcPanel = { entries: BcEntry[]; x: number; y: number }
  const [bcDropdown, setBcDropdown] = useState<{
    segmentIndex: number
    panels: BcPanel[]  // panels[0] = root, panels[n] = nth sub-panel
  } | null>(null)
  const breadcrumbBarRef = useRef<HTMLDivElement>(null)
  const bcHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-scroll breadcrumb bar to the right to show the current file
  useEffect(() => {
    const el = breadcrumbBarRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [breadcrumbSegments])

  useEffect(() => {
    if (!bcDropdown) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-bc-panel]')) setBcDropdown(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [!!bcDropdown])

  const readDirEntries = useCallback((dirPath: string): BcEntry[] => {
    try {
      return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(d => !IGNORED.has(d.name) && d.name !== '.DS_Store')
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .map(d => ({ name: d.name, isFolder: d.isDirectory(), fullPath: pathModule.join(dirPath, d.name) }))
    } catch { return [] }
  }, [])

  const handleBreadcrumbClick = useCallback((segmentIndex: number, e: React.MouseEvent) => {
    if (!activeTab || !projectCwd) return
    const rel = activeTab.path.startsWith(projectCwd + '/')
      ? activeTab.path.slice(projectCwd.length + 1)
      : activeTab.path
    const parts = rel.split('/')
    const dirPath = pathModule.join(projectCwd, ...parts.slice(0, segmentIndex + 1))
    const entries = readDirEntries(dirPath)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setBcDropdown(prev =>
      prev?.segmentIndex === segmentIndex
        ? null
        : { segmentIndex, panels: [{ entries, x: rect.left, y: rect.bottom + 2 }] }
    )
  }, [activeTab, projectCwd, readDirEntries])

  // panelIndex: index of the panel the folder lives in
  const handleBcFolderHover = useCallback((entry: BcEntry, panelIndex: number, e: React.MouseEvent) => {
    if (bcHoverTimerRef.current) clearTimeout(bcHoverTimerRef.current)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    bcHoverTimerRef.current = setTimeout(() => {
      const subEntries = readDirEntries(entry.fullPath)
      setBcDropdown(prev => {
        if (!prev) return null
        const parentPanel = prev.panels[panelIndex]
        if (!parentPanel) return prev
        const newPanel: BcPanel = { entries: subEntries, x: parentPanel.x + 228, y: rect.top }
        return { ...prev, panels: [...prev.panels.slice(0, panelIndex + 1), newPanel] }
      })
    }, 120)
  }, [readDirEntries])

  const handleBcFolderLeave = useCallback((panelIndex: number) => {
    if (bcHoverTimerRef.current) clearTimeout(bcHoverTimerRef.current)
    // Trim panels after this level only if cursor isn't in a deeper panel
    setBcDropdown(prev => prev ? { ...prev, panels: prev.panels.slice(0, panelIndex + 1) } : null)
  }, [])

  const handleBcFileClick = useCallback((filePath: string) => {
    setBcDropdown(null)
    if (onOpenFile) onOpenFile(filePath)
    else onTabSelect(filePath)
  }, [onOpenFile, onTabSelect])

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Tabs */}
      {openTabs.length > 0 && (
        <div className="flex items-center h-8 bg-bg-card border-b border-border overflow-x-auto shrink-0 [&::-webkit-scrollbar]:h-0">
          {openTabs.map(tab => (
            <div
              key={tab.path}
              className={`flex items-center gap-[6px] px-3 h-8 text-[11px] font-ui cursor-pointer border-r border-border whitespace-nowrap shrink-0 transition-[color,background] duration-100${tab.path === activeTabPath ? ' text-text-bright bg-bg border-b-2 border-b-accent' : ' text-text-dim hover:text-text hover:bg-white/[0.03]'}`}
              onClick={() => onTabSelect(tab.path)}
              onContextMenu={(e) => { e.preventDefault(); setTabCtx({ x: e.clientX, y: e.clientY, path: tab.path }) }}
            >
              <span className="flex items-center gap-1">
                {tab.modified && <span className="w-[6px] h-[6px] rounded-full bg-accent shrink-0" />}
                {tab.name}
              </span>
              <span
                className="text-[14px] leading-none text-text-dim px-[2px] rounded-[3px] transition-[color,background] duration-100 hover:text-text-bright hover:bg-white/10"
                onClick={(e) => onTabClose(tab.path, e)}
              >×</span>
            </div>
          ))}

        </div>
      )}

      {/* Breadcrumb bar */}
      {activeTab && breadcrumbSegments.length > 0 && (
        <div ref={breadcrumbBarRef} className="flex items-center h-[22px] px-3 bg-bg border-b border-border shrink-0 overflow-x-auto [&::-webkit-scrollbar]:h-0">
          {breadcrumbSegments.map((seg, i) => {
            const isLast = i === breadcrumbSegments.length - 1
            const isOpen = bcDropdown?.segmentIndex === i
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="mx-[5px] text-[10px] text-text-dim select-none">›</span>
                )}
                <span
                  className={`text-[11px] font-ui whitespace-nowrap px-[4px] py-[1px] rounded-[3px] transition-colors duration-100 select-none
                    ${isLast
                      ? 'text-text-bright'
                      : `cursor-pointer ${isOpen ? 'text-text-bright bg-accent/20' : 'text-text-dim hover:text-text hover:bg-bg-hover'}`
                    }`}
                  onClick={isLast ? undefined : (e) => handleBreadcrumbClick(i, e)}
                >
                  {seg}
                </span>
              </React.Fragment>
            )
          })}
        </div>
      )}

      {/* Breadcrumb cascading panels */}
      {bcDropdown && bcDropdown.panels.map((panel, panelIndex) => (
        <div
          key={panelIndex}
          data-bc-panel="1"
          className="fixed bg-bg-popup border border-border rounded-[6px] shadow-[0_6px_24px_rgba(0,0,0,0.5)] w-[220px] max-h-[320px] overflow-y-auto py-[3px] [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px]"
          style={{ left: panel.x, top: panel.y, zIndex: 9990 + panelIndex }}
          onMouseEnter={() => { if (bcHoverTimerRef.current) clearTimeout(bcHoverTimerRef.current) }}
        >
          {panel.entries.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-text-dim font-ui">Empty folder</div>
          ) : panel.entries.map(entry => (
            <div
              key={entry.fullPath}
              className="flex items-center gap-[7px] px-3 py-[4px] text-[11px] font-ui cursor-pointer text-text-dim transition-colors duration-100 hover:bg-accent/15 hover:text-text-bright"
              onMouseEnter={entry.isFolder ? (e) => handleBcFolderHover(entry, panelIndex, e) : () => handleBcFolderLeave(panelIndex)}
              onMouseLeave={entry.isFolder ? undefined : () => {}}
              onClick={() => { if (!entry.isFolder) handleBcFileClick(entry.fullPath) }}
            >
              {entry.isFolder ? (
                <FolderLargeIcon size={13} className="text-text-dim shrink-0" />
              ) : (
                <FileIcon className="text-text-dim shrink-0" />
              )}
              <span className="truncate flex-1">{entry.name}</span>
              {entry.isFolder && (
                <ChevronRightIcon className="text-text-dim shrink-0" />
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Editor / Preview / Media */}
      {activeTab ? (
        <div className="relative flex-1 flex flex-col overflow-hidden">
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
              theme={editorTheme}
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
                gotoLocation: { multiple: 'goto', multipleDefinitions: 'goto' },
                definitionLinkOpensInPeek: false,
                links: true,
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
