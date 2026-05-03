import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ChangedFile, BranchInfo, CommitEntry } from './git/gitTypes'
import { isGitRepo, getBranchInfo, getChangedFiles, getOriginalContent, getModifiedContent, getLanguage, stageFiles, unstageFiles, discardMultiple, listBranches, checkoutBranch, createBranch, getGitRoot, getCommitLog, getCommitFiles, getCommitFileContent, getCommitParentFileContent } from './git/gitClient'
import type { BranchEntry } from './git/gitClient'
import { DiffViewer } from './git/DiffViewer'
import { GitFileList } from './git/GitFileList'
import { GitInstructionsDialog } from './git/GitInstructionsDialog'
import { discoverReposWithAssets, type DiscoveredRepo } from './git/repoDiscovery'
import { useWorldContext } from './contexts/WorldContext.js'
import { useOfficeContext } from './contexts/OfficeContext.js'
import { loadSessionState, saveSessionState, computeProjectHash } from './settings.js'
import { generateAgentId } from '@pixel-city/shared/utils/agentId'
import { getMediaType } from './files/fileTypes'
import { readMediaFile } from './files/fileOperations'
import { GitBranchLargeIcon, GitBranchLocalIcon, GitBranchRemoteIcon, GitBranchSmallIcon, CheckmarkIcon, TriangleDownIcon, TriangleLeftIcon, PlusIcon, RefreshAltIcon, SettingsGearIcon } from './icons'
import { platform } from './platform/index.js'

// ── Main Component ───────────────────────────────────────────────

interface GitViewProps {
  projectCwd: string
}

export function GitView({ projectCwd }: GitViewProps) {
  const { editorSettings } = useWorldContext()
  const { handleAddAgent } = useOfficeContext()

  const [repo, setRepo] = useState(false)
  const [branch, setBranch] = useState<BranchInfo>({ current: '', ahead: 0, behind: 0 })
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null)
  const [commitInstruction, setCommitInstruction] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [gitInstructions, setGitInstructions] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [loading, setLoading] = useState(false)
  const [showBranchPicker, setShowBranchPicker] = useState(false)
  const [branches, setBranches] = useState<BranchEntry[]>([])
  const [branchFilter, setBranchFilter] = useState('')
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const branchPickerRef = useRef<HTMLDivElement>(null)
  const branchFilterRef = useRef<HTMLInputElement>(null)
  const resizingRef = useRef(false)
  const [showRepoSwitcher, setShowRepoSwitcher] = useState(false)
  const repoSwitcherRef = useRef<HTMLDivElement>(null)
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [commitsCollapsed, setCommitsCollapsed] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<CommitEntry | null>(null)
  const [commitFiles, setCommitFiles] = useState<ChangedFile[]>([])

  // Multi-repo discovery
  const [repos, setRepos] = useState<DiscoveredRepo[]>([])
  const [activeRepo, setActiveRepo] = useState<string>(() => {
    const hash = computeProjectHash(projectCwd)
    return loadSessionState().activeGitRepo?.[hash] ?? projectCwd
  })

  // Persist active repo selection (skip initial mount — wait for discovery)
  const repoInitializedRef = useRef(false)
  useEffect(() => {
    if (!repoInitializedRef.current) return
    const hash = computeProjectHash(projectCwd)
    const prev = loadSessionState()
    saveSessionState({ activeGitRepo: { ...prev.activeGitRepo, [hash]: activeRepo } })
  }, [activeRepo, projectCwd])

  const prevCwdRef = useRef(projectCwd)
  useEffect(() => {
    const projectChanged = prevCwdRef.current !== projectCwd
    prevCwdRef.current = projectCwd
    if (projectChanged) setActiveRepo(projectCwd) // only reset on actual project change
    discoverReposWithAssets(projectCwd).then(discovered => {
      setRepos(discovered)
      const hash = computeProjectHash(projectCwd)
      const savedRepo = loadSessionState().activeGitRepo?.[hash]
      const match = savedRepo && discovered.find(r => r.path === savedRepo)
      if (match) setActiveRepo(match.path)
      else if (discovered.length > 0) setActiveRepo(discovered[0].path)
      repoInitializedRef.current = true
    })
  }, [projectCwd])

  // Refresh git state
  const refresh = useCallback(() => {
    setLoading(true)
    try {
      const isRepo_ = isGitRepo(activeRepo)
      setRepo(isRepo_)
      if (!isRepo_) return
      setBranch(getBranchInfo(activeRepo))
      setFiles(getChangedFiles(activeRepo))
      setCommits(getCommitLog(activeRepo, 20))
    } finally {
      setLoading(false)
    }
  }, [activeRepo])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  // Detect media type for selected file
  const selectedMediaType = useMemo(() => {
    if (!selectedFile) return null
    return getMediaType(selectedFile.name)
  }, [selectedFile])

  // Media preview data for selected file
  const mediaPreview = useMemo(() => {
    if (!selectedFile || !selectedMediaType || selectedFile.status === 'D') return null
    const gitRoot = getGitRoot(activeRepo)
    const pathModule = window.require('path') as typeof import('path')
    const absPath = pathModule.resolve(gitRoot, selectedFile.path)
    const result = readMediaFile(absPath)
    if (!result) return null
    return { type: selectedMediaType, dataUrl: result.dataUrl }
  }, [selectedFile, selectedMediaType, activeRepo])

  // Diff content for selected file (skip for media files)
  const diffContent = useMemo(() => {
    if (!selectedFile || selectedMediaType) return null
    if (selectedCommit) {
      const original = selectedFile.status === 'A' ? '' : getCommitParentFileContent(activeRepo, selectedCommit.hash, selectedFile.origPath || selectedFile.path)
      const modified = selectedFile.status === 'D' ? '' : getCommitFileContent(activeRepo, selectedCommit.hash, selectedFile.path)
      const language = getLanguage(selectedFile.name)
      return { original, modified, language }
    }
    const original = getOriginalContent(activeRepo, selectedFile.path, selectedFile.staged)
    const modified = getModifiedContent(activeRepo, selectedFile.path, selectedFile.staged)
    const language = getLanguage(selectedFile.name)
    return { original, modified, language }
  }, [selectedFile, selectedMediaType, activeRepo, selectedCommit])

  // Stage files
  const handleStage = useCallback((filesToStage: ChangedFile[]) => {
    stageFiles(activeRepo, filesToStage.map(f => f.path))
    refresh()
  }, [activeRepo, refresh])

  // Unstage files
  const handleUnstage = useCallback((filesToUnstage: ChangedFile[]) => {
    unstageFiles(activeRepo, filesToUnstage.map(f => f.path))
    if (filesToUnstage.some(f => f.path === selectedFile?.path)) setSelectedFile(null)
    refresh()
  }, [activeRepo, refresh, selectedFile])

  // Discard changes to files
  const handleDiscard = useCallback((filesToDiscard: ChangedFile[]) => {
    discardMultiple(activeRepo, filesToDiscard)
    if (filesToDiscard.some(f => f.path === selectedFile?.path)) setSelectedFile(null)
    refresh()
  }, [activeRepo, refresh, selectedFile])

  // Load git instructions from config
  useEffect(() => {
    platform().config.load(activeRepo).then((result: any) => {
      if (result.success && result.config?.gitInstructions) {
        setGitInstructions(result.config.gitInstructions)
      }
    })
  }, [activeRepo])

  // Save git instructions
  const handleSaveInstructions = useCallback((text: string) => {
    setGitInstructions(text)
    platform().config.load(activeRepo).then((result: any) => {
      const existing = result.success && result.config ? result.config : { cityInstructions: '', officeInstructions: {} }
      existing.gitInstructions = text
      platform().config.save(activeRepo, existing)
    })
    setShowInstructions(false)
  }, [activeRepo])

  // Spawn commit agent — message is optional
  const handleCommit = useCallback(() => {
    const agentId = generateAgentId()
    const palette = Date.now() % 8
    const fileList = files.map(f => `  ${f.staged ? '[staged]' : '[unstaged]'} ${f.status} ${f.path}`).join('\n')

    const userMsg = commitInstruction.trim()
    let prompt = `<git-commit-task>\n`
    if (userMsg) {
      prompt += `The user wants you to commit code changes. Here are their instructions:\n"${userMsg}"\n\n`
    } else {
      prompt += `The user wants you to commit the current code changes. Review the changed files and create an appropriate commit.\n\n`
    }
    prompt += `Changed files:\n${fileList}`
    if (gitInstructions.trim()) {
      prompt += `\n\n<git-guidelines>\n${gitInstructions.trim()}\n</git-guidelines>`
    }
    prompt += `\n\nStage the relevant files and commit with an appropriate message. Do NOT push unless explicitly asked.\n</git-commit-task>`

    handleAddAgent(agentId, palette, 'Git Commit', 'sonnet', null, prompt)
    setCommitInstruction('')
  }, [commitInstruction, files, gitInstructions, handleAddAgent])

  // Select a commit to view its files
  const handleSelectCommit = useCallback((commit: CommitEntry) => {
    if (selectedCommit?.hash === commit.hash) {
      // Deselect — go back to working tree
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      return
    }
    setSelectedCommit(commit)
    setCommitFiles(getCommitFiles(activeRepo, commit.hash))
    setSelectedFile(null)
  }, [activeRepo, selectedCommit])

  // Resize handler
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      setSidebarWidth(Math.max(200, Math.min(600, startWidth + (ev.clientX - startX))))
    }
    const onUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  // Branch picker
  const openBranchPicker = useCallback(() => {
    const branchList = listBranches(activeRepo)
    setBranches(branchList)
    setBranchFilter('')
    setCheckoutError(null)
    setShowBranchPicker(true)
    setTimeout(() => branchFilterRef.current?.focus(), 50)
  }, [activeRepo])

  const handleCheckout = useCallback((branchName: string) => {
    if (branchName === branch.current) {
      setShowBranchPicker(false)
      return
    }
    const result = checkoutBranch(activeRepo, branchName)
    if (result.success) {
      setShowBranchPicker(false)
      setSelectedFile(null)
      refresh()
    } else {
      setCheckoutError(result.error || 'Checkout failed')
    }
  }, [activeRepo, branch.current, refresh])

  const handleCreateBranch = useCallback(() => {
    const name = branchFilter.trim()
    if (!name) return
    const result = createBranch(activeRepo, name)
    if (result.success) {
      setShowBranchPicker(false)
      setSelectedFile(null)
      refresh()
    } else {
      setCheckoutError(result.error || 'Failed to create branch')
    }
  }, [branchFilter, activeRepo, refresh])

  // Close branch picker on outside click
  useEffect(() => {
    if (!showBranchPicker) return
    const handler = (e: MouseEvent) => {
      if (branchPickerRef.current && !branchPickerRef.current.contains(e.target as Node)) {
        setShowBranchPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showBranchPicker])

  // Close repo switcher on outside click
  useEffect(() => {
    if (!showRepoSwitcher) return
    const handler = (e: MouseEvent) => {
      if (repoSwitcherRef.current && !repoSwitcherRef.current.contains(e.target as Node)) {
        setShowRepoSwitcher(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRepoSwitcher])

  const activeRepoName = repos.find(r => r.path === activeRepo)?.name ?? ''

  const filteredBranches = useMemo(() => {
    const q = branchFilter.toLowerCase()
    const filtered = branches.filter(b => b.name.toLowerCase().includes(q))
    const local = filtered.filter(b => !b.isRemote)
    const remote = filtered.filter(b => b.isRemote)
    return { local, remote }
  }, [branches, branchFilter])

  if (!repo) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-bg font-ui text-[12px]">
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-dim">
          <GitBranchLargeIcon size={48} style={{ opacity: 0.3 }} />
          <p className="text-[13px] text-text">Not a git repository</p>
          <p className="text-[11px] text-text-dim">Open a project with git initialized</p>
        </div>
      </div>
    )
  }

  // Branch item renderer
  const renderBranchItem = (b: BranchEntry) => (
    <div
      key={b.name}
      className={`flex flex-col gap-px py-[5px] px-3 cursor-pointer transition-colors duration-100 hover:bg-bg-hover ${b.isCurrent ? '[&_.branch-main]:text-accent' : ''}`}
      onClick={() => handleCheckout(b.name)}
    >
      <div className="branch-main flex items-center gap-1.5 text-[13px] text-text min-w-0">
        {b.isRemote ? (
          <GitBranchRemoteIcon size={14} style={{ flexShrink: 0, opacity: 0.5 }} />
        ) : (
          <GitBranchLocalIcon size={14} style={{ flexShrink: 0, opacity: 0.5 }} />
        )}
        <span className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap shrink min-w-0">{b.name}</span>
        {b.isCurrent && (
          <CheckmarkIcon size={12} className="shrink-0 text-accent" />
        )}
        {(b.behind > 0 || b.ahead > 0) && (
          <span className="text-[11px] text-text-dim shrink-0 flex gap-[3px]">
            {b.behind > 0 && <span>{b.behind}↓</span>}
            {b.ahead > 0 && <span>{b.ahead}↑</span>}
          </span>
        )}
        {b.relativeDate && <span className="text-[11px] text-text-dim shrink-0 ml-auto">{b.relativeDate}</span>}
      </div>
      {b.commitHash && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-dim pl-5 min-w-0">
          {b.author && <span className="shrink-0">{b.author}</span>}
          <span className="shrink-0 font-mono before:content-['•'] before:mr-1.5 before:opacity-50">{b.commitHash}</span>
          {b.commitMessage && <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 before:content-['•'] before:mr-1.5 before:opacity-50">{b.commitMessage}</span>}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-bg font-ui text-[12px] flex-row" style={{ position: 'relative' }}>
      {/* Branch picker overlay */}
      {showBranchPicker && (
        <>
          <div className="absolute inset-0 z-[199]" onClick={() => setShowBranchPicker(false)} />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[min(95%,580px)] bg-bg-card border border-border border-t-0 rounded-b-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-[200] overflow-hidden" ref={branchPickerRef}>
            <input
              ref={branchFilterRef}
              className="w-full py-2 px-3 bg-bg border-none border-b border-border text-text text-[13px] outline-none box-border focus:border-accent placeholder:text-text-dim"
              placeholder="Select a branch or tag to checkout"
              value={branchFilter}
              onChange={e => { setBranchFilter(e.target.value); setCheckoutError(null) }}
              onKeyDown={e => {
                if (e.key === 'Escape') setShowBranchPicker(false)
                if (e.key === 'Enter') {
                  const allFiltered = [...filteredBranches.local, ...filteredBranches.remote]
                  if (allFiltered.length === 1) handleCheckout(allFiltered[0].name)
                  else if (allFiltered.length === 0 && branchFilter.trim()) handleCreateBranch()
                }
              }}
            />
            {checkoutError && (
              <div className="py-1.5 px-3 text-[11px] text-[#c74e39] bg-[rgba(199,78,57,0.1)] border-b border-border">{checkoutError}</div>
            )}
            <div className="max-h-[380px] overflow-y-auto">
              {branchFilter.trim() && (
                <div className="flex flex-row items-center gap-2 text-[13px] text-text border-b border-border flex-col gap-px py-[5px] px-3 cursor-pointer transition-colors duration-100 hover:bg-bg-hover" onClick={handleCreateBranch}>
                  <PlusIcon size={14} style={{ flexShrink: 0 }} />
                  <span>Create new branch "{branchFilter.trim()}"</span>
                </div>
              )}
              {filteredBranches.local.length > 0 && (
                <>
                  <div className="py-1.5 px-3 pt-[6px] pb-1 text-[11px] text-text-dim lowercase tracking-[0.02em] flex justify-end">branches</div>
                  {filteredBranches.local.map(renderBranchItem)}
                </>
              )}
              {filteredBranches.remote.length > 0 && (
                <>
                  <div className="py-1.5 px-3 pt-[6px] pb-1 text-[11px] text-text-dim lowercase tracking-[0.02em] flex justify-end">remote branches</div>
                  {filteredBranches.remote.map(renderBranchItem)}
                </>
              )}
              {filteredBranches.local.length === 0 && filteredBranches.remote.length === 0 && !branchFilter.trim() && (
                <div className="p-3 text-[12px] text-text-dim text-center">No branches found</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Left sidebar */}
      <div className="flex flex-col min-w-[200px] max-w-[600px] bg-bg-card border-r border-border overflow-hidden select-none" style={{ width: sidebarWidth }}>
        {/* Branch status bar */}
        <div className="flex items-center justify-between py-[3px] px-3 text-[11px] text-text-dim border-b border-border shrink-0 bg-bg-card">
          <div className="flex items-center gap-[5px] cursor-pointer rounded-[3px] py-0.5 px-1 -my-0.5 -mx-1 transition-colors duration-150 hover:bg-bg-hover hover:text-text" onClick={openBranchPicker} title="Switch branch">
            <GitBranchSmallIcon size={11} />
            <span>{branch.current}</span>
            <TriangleDownIcon size={8} style={{ opacity: 0.6 }} />
          </div>
          <div className="flex items-center gap-2">
            {files.length > 0 && <span className="text-[11px] text-text-dim opacity-70">{files.length} changed</span>}
            {branch.behind > 0 && <span>{branch.behind}↓</span>}
            {branch.ahead > 0 && <span>{branch.ahead}↑</span>}
          </div>
        </div>

        {/* Repo switcher */}
        {repos.length > 1 && (
          <div className="relative shrink-0 border-b border-border" ref={repoSwitcherRef}>
            <div
              className="flex items-center gap-1.5 py-1.5 px-3 cursor-pointer select-none text-[11px] text-text-dim hover:bg-bg-hover hover:text-text"
              onClick={() => setShowRepoSwitcher(!showRepoSwitcher)}
            >
              <span className="font-semibold tracking-[0.04em] shrink-0">REPO</span>
              <span className="font-medium text-text flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{activeRepoName}</span>
              <TriangleDownIcon size={8} className="shrink-0 opacity-40 transition-transform duration-150" style={{ transform: showRepoSwitcher ? 'rotate(180deg)' : 'none' }} />
            </div>
            {showRepoSwitcher && (
              <div className="absolute top-full left-0 right-0 z-50 bg-bg-card border border-border border-t-0 rounded-b-md shadow-[0_8px_24px_rgba(0,0,0,0.45)] py-1 max-h-[240px] overflow-y-auto">
                {repos.map(r => (
                  <div
                    key={r.path}
                    className={`flex items-center gap-2 py-[5px] px-3 cursor-pointer text-[11px] text-text-dim hover:bg-bg-hover hover:text-text ${r.path === activeRepo ? 'text-text' : ''}`}
                    onClick={() => {
                      setActiveRepo(r.path)
                      setSelectedFile(null)
                      setShowRepoSwitcher(false)
                    }}
                  >
                    <span
                      className={`w-[5px] h-[5px] rounded-full shrink-0 opacity-40 ${r.path === activeRepo ? '!bg-accent !opacity-100' : 'bg-current'}`}
                      data-source={r.source}
                    />
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{r.name}</span>
                    {r.path === activeRepo && (
                      <CheckmarkIcon size={12} className="shrink-0 text-accent ml-auto" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Header */}
        {selectedCommit ? (
          <div className="flex items-start gap-1.5 py-2 px-3 border-b border-border shrink-0 min-w-0">
            <button
              className="bg-transparent border-none text-text-dim cursor-pointer p-0.5 rounded-[3px] flex items-center hover:text-text hover:bg-bg-hover shrink-0 mt-px"
              onClick={() => { setSelectedCommit(null); setCommitFiles([]); setSelectedFile(null) }}
              title="Back to working changes"
            >
              <TriangleLeftIcon size={12} />
            </button>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="text-[12px] font-medium text-text whitespace-nowrap overflow-hidden text-ellipsis">{selectedCommit.message}</div>
              <div className="flex gap-2 text-[10px] text-[rgba(255,255,255,0.35)] mt-0.5">
                <span className="whitespace-nowrap font-mono text-[11px] text-[rgba(255,255,255,0.4)]">{selectedCommit.shortHash}</span>
                <span className="whitespace-nowrap">{selectedCommit.author}</span>
                <span className="whitespace-nowrap">{selectedCommit.relativeDate}</span>
                <span className="whitespace-nowrap">{commitFiles.length} file{commitFiles.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button className="bg-transparent border-none text-text-dim cursor-pointer p-0.5 rounded-[3px] flex items-center hover:text-text hover:bg-bg-hover" onClick={refresh} title="Refresh">
              <RefreshAltIcon size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between py-2 px-3 border-b border-border shrink-0">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-text-dim">CHANGES</span>
            <div className="flex gap-1">
              <button className="bg-transparent border-none text-text-dim cursor-pointer p-0.5 rounded-[3px] flex items-center hover:text-text hover:bg-bg-hover" onClick={() => setShowInstructions(true)} title="Git Instructions">
                <SettingsGearIcon size={14} />
              </button>
              <button className="bg-transparent border-none text-text-dim cursor-pointer p-0.5 rounded-[3px] flex items-center hover:text-text hover:bg-bg-hover" onClick={refresh} title="Refresh">
                <RefreshAltIcon size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-[3px]">
          {selectedCommit ? (
            <GitFileList
              files={commitFiles}
              selectedPath={selectedFile?.path ?? null}
              onSelect={setSelectedFile}
              flat
              repoRoot={activeRepo}
            />
          ) : (
            <GitFileList
              files={files}
              selectedPath={selectedFile?.path ?? null}
              onSelect={setSelectedFile}
              repoRoot={activeRepo}
              onStage={handleStage}
              onUnstage={handleUnstage}
              onDiscard={handleDiscard}
            />
          )}
        </div>

        {/* Commit history */}
        <div className="border-t border-white/[0.06] shrink-0 max-h-[220px] flex flex-col">
          <div className="flex items-center justify-between py-2 px-3 border-b border-border shrink-0 cursor-pointer select-none hover:bg-white/[0.03]" onClick={() => setCommitsCollapsed(!commitsCollapsed)}>
            <span className="text-[11px] font-semibold tracking-[0.06em] text-text-dim">
              <TriangleDownIcon size={8} style={{ transition: 'transform 0.15s', transform: commitsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', marginRight: 4 }} />
              COMMITS
            </span>
          </div>
          {!commitsCollapsed && (
            <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-[3px]">
              {commits.map(c => (
                <div
                  key={c.hash}
                  className={`py-[5px] px-3 cursor-pointer border-b border-white/[0.03] hover:bg-white/[0.03] ${selectedCommit?.hash === c.hash ? 'bg-white/[0.08] hover:bg-white/10' : ''}`}
                  title={`${c.author} — ${c.relativeDate}\n${c.hash}`}
                  onClick={() => handleSelectCommit(c)}
                >
                  <div className="flex items-center justify-between gap-2 mb-px">
                    <span className="font-mono text-[11px] text-white/40">{c.shortHash}</span>
                    <span className="text-[10px] text-white/30 whitespace-nowrap">{c.relativeDate}</span>
                  </div>
                  <div className="text-[12px] text-white/70 whitespace-nowrap overflow-hidden text-ellipsis">{c.message}</div>
                </div>
              ))}
              {commits.length === 0 && (
                <div className="p-3 text-center text-[11px] text-white/30">No commits yet</div>
              )}
            </div>
          )}
        </div>

        {/* Commit bar (hidden when viewing commit history) */}
        {!selectedCommit && (
          <div className="flex items-center gap-1.5 p-2 border-t border-white/[0.06] bg-white/[0.02]">
            <input
              className="flex-1 bg-white/[0.06] border border-white/10 rounded text-text text-[12px] font-ui py-1.5 px-2.5 outline-none transition-[border-color] duration-150 focus:border-white/25 placeholder:text-text-dim placeholder:opacity-50"
              placeholder="Instructions for commit agent (optional)..."
              value={commitInstruction}
              onChange={e => setCommitInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommit() } }}
            />
            <button
              className="bg-white/10 border border-white/15 rounded text-text text-[12px] font-ui font-medium py-1.5 px-3.5 cursor-pointer transition-all duration-100 hover:not-disabled:bg-white/15 disabled:opacity-30 disabled:cursor-default"
              onClick={handleCommit}
              disabled={files.length === 0}
              title="Spawn agent to commit"
            >
              Commit
            </button>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div className="w-[3px] cursor-col-resize bg-transparent shrink-0 transition-colors duration-150 hover:bg-accent active:bg-accent" onMouseDown={startResize} />

      {/* Right panel: Diff viewer */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <DiffViewer
          activeFile={selectedFile}
          diffContent={diffContent}
          mediaPreview={mediaPreview}
          onClose={() => setSelectedFile(null)}
          editorSettings={editorSettings}
          projectCwd={activeRepo}
          onFileEdited={refresh}
        />
      </div>

      {/* Git Instructions Dialog */}
      {showInstructions && (
        <GitInstructionsDialog
          instructions={gitInstructions}
          onSave={handleSaveInstructions}
          onClose={() => setShowInstructions(false)}
        />
      )}
    </div>
  )
}
