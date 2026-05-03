/**
 * ElectronGitAdapter — implements GitAdapter for the Electron desktop app.
 *
 * Wraps the existing sync gitClient.ts functions in async wrappers.
 */

import type { GitAdapter } from '@pixel-city/plugin-git/adapter'
import type { ChangedFile } from '@pixel-city/plugin-git'
import {
  isGitRepo, getGitRoot, getBranchInfo, getChangedFiles,
  getOriginalContent, getModifiedContent, getLanguage,
  stageFiles, unstageFiles, discardMultiple,
  listBranches, checkoutBranch, createBranch,
  getCommitLog, getCommitFiles, getCommitFileContent, getCommitParentFileContent,
} from './gitClient.js'
import { discoverReposWithAssets } from './repoDiscovery.js'
import { readMediaFile } from '../files/fileOperations.js'

const pathModule = window.require('path') as typeof import('path')
const fs = window.require('fs') as typeof import('fs')

export const electronGitAdapter: GitAdapter = {
  // ── Queries ──

  async isGitRepo(cwd) {
    return isGitRepo(cwd)
  },

  async getGitRoot(cwd) {
    return getGitRoot(cwd)
  },

  async getBranchInfo(cwd) {
    return getBranchInfo(cwd)
  },

  async getChangedFiles(cwd) {
    return getChangedFiles(cwd)
  },

  async getCommitLog(cwd, count = 20) {
    return getCommitLog(cwd, count)
  },

  async getCommitFiles(cwd, commitHash) {
    return getCommitFiles(cwd, commitHash)
  },

  // ── Diff content ──

  async getOriginalContent(cwd, filePath, staged) {
    return getOriginalContent(cwd, filePath, staged)
  },

  async getModifiedContent(cwd, filePath, staged) {
    return getModifiedContent(cwd, filePath, staged)
  },

  async getCommitFileContent(cwd, commitHash, filePath) {
    return getCommitFileContent(cwd, commitHash, filePath)
  },

  async getCommitParentFileContent(cwd, commitHash, filePath) {
    return getCommitParentFileContent(cwd, commitHash, filePath)
  },

  // ── Write operations ──

  async stageFiles(cwd, filePaths) {
    stageFiles(cwd, filePaths)
  },

  async unstageFiles(cwd, filePaths) {
    unstageFiles(cwd, filePaths)
  },

  async discardChanges(cwd, files) {
    discardMultiple(cwd, files)
  },

  // ── Branches ──

  async listBranches(cwd) {
    return listBranches(cwd)
  },

  async checkoutBranch(cwd, branchName) {
    return checkoutBranch(cwd, branchName)
  },

  async createBranch(cwd, branchName) {
    return createBranch(cwd, branchName)
  },

  // ── Discovery ──

  async discoverRepos(projectCwd) {
    return discoverReposWithAssets(projectCwd)
  },

  // ── Optional capabilities ──

  async readMediaFile(filePath) {
    const result = readMediaFile(filePath)
    if (!result) return null
    // Detect media type from extension
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    return { type: ext, dataUrl: result.dataUrl }
  },

  async saveFileContent(cwd, filePath, content) {
    const gitRoot = getGitRoot(cwd)
    const absPath = pathModule.resolve(gitRoot, filePath)
    fs.writeFileSync(absPath, content, 'utf8')
  },
}
