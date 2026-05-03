import type { ChangedFile, BranchInfo, CommitEntry, BranchEntry, DiscoveredRepo } from '../types.js'

export interface GitAdapter {
  // Queries
  isGitRepo(cwd: string): Promise<boolean>
  getGitRoot(cwd: string): Promise<string>
  getBranchInfo(cwd: string): Promise<BranchInfo>
  getChangedFiles(cwd: string): Promise<ChangedFile[]>
  getCommitLog(cwd: string, count?: number): Promise<CommitEntry[]>
  getCommitFiles(cwd: string, commitHash: string): Promise<ChangedFile[]>

  // Diff content
  getOriginalContent(cwd: string, filePath: string, staged: boolean): Promise<string>
  getModifiedContent(cwd: string, filePath: string, staged: boolean): Promise<string>
  getCommitFileContent(cwd: string, commitHash: string, filePath: string): Promise<string>
  getCommitParentFileContent(cwd: string, commitHash: string, filePath: string): Promise<string>

  // Staging
  stageFiles(cwd: string, filePaths: string[]): Promise<void>
  unstageFiles(cwd: string, filePaths: string[]): Promise<void>
  discardChanges(cwd: string, files: ChangedFile[]): Promise<void>

  // Branches
  listBranches(cwd: string): Promise<BranchEntry[]>
  checkoutBranch(cwd: string, branchName: string): Promise<{ success: boolean; error?: string }>
  createBranch(cwd: string, branchName: string): Promise<{ success: boolean; error?: string }>

  // Repo discovery
  discoverRepos(projectCwd: string): Promise<DiscoveredRepo[]>

  // Optional capabilities
  readMediaFile?(filePath: string): Promise<{ type: string; dataUrl: string } | null>
  saveFileContent?(cwd: string, filePath: string, content: string): Promise<void>
}
