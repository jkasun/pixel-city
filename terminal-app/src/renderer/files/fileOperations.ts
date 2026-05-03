import type { GitStatus } from './fileTypes'

const fs = window.require('fs') as typeof import('fs')
const pathModule = window.require('path') as typeof import('path')
const { execSync, execFile } = window.require('child_process') as typeof import('child_process')
const os = window.require('os') as typeof import('os')
const { shell, clipboard } = window.require('electron') as typeof import('electron')

export const platform = os.platform()

export function revealInFileManager(filePath: string): void {
  shell.showItemInFolder(filePath)
}

// ── Clipboard helpers ──────────────────────────────────────────

export function copyToClipboard(text: string): void {
  clipboard.writeText(text)
}

// ── Git remote URL helpers ─────────────────────────────────────

export function getGitRoot(cwd: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', timeout: 3000 }).trim()
  } catch { return null }
}

export function getGitRemotes(cwd: string): string[] {
  try {
    const output = execSync('git remote', { cwd, encoding: 'utf8', timeout: 3000 }).trim()
    return output ? output.split('\n') : []
  } catch { return [] }
}

export function getGitBranch(cwd: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', timeout: 3000 }).trim()
  } catch { return null }
}

function remoteUrlToHttps(remoteUrl: string): string | null {
  // SSH format: git@github.com:user/repo.git
  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`
  // HTTPS format: https://github.com/user/repo.git
  const httpsMatch = remoteUrl.match(/^https?:\/\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return `https://${httpsMatch[1]}`
  return null
}

export function buildRemoteFileUrl(cwd: string, filePath: string, remoteName?: string): string | null {
  const gitRoot = getGitRoot(cwd)
  if (!gitRoot) return null
  const remote = remoteName || 'origin'
  const branch = getGitBranch(cwd)
  if (!branch) return null
  try {
    const remoteUrl = execSync(`git remote get-url ${remote}`, { cwd, encoding: 'utf8', timeout: 3000 }).trim()
    const baseUrl = remoteUrlToHttps(remoteUrl)
    if (!baseUrl) return null
    const relativePath = pathModule.relative(gitRoot, filePath)
    return `${baseUrl}/blob/${branch}/${relativePath}`
  } catch { return null }
}

// ── Git status helpers ──────────────────────────────────────────

export function parseGitStatus(cwd: string): Map<string, GitStatus> {
  const statusMap = new Map<string, GitStatus>()
  try {
    const output = execSync('git status --porcelain -u', { cwd, encoding: 'utf8', timeout: 5000 })
    for (const line of output.split('\n')) {
      if (line.length < 4) continue
      const xy = line.substring(0, 2)
      const filePath = line.substring(3).split(' -> ').pop()!.trim()
      const absPath = pathModule.resolve(cwd, filePath)

      let status: GitStatus = null
      if (xy === '??') status = 'untracked'
      else if (xy[0] === 'A' || xy[1] === 'A') status = 'added'
      else if (xy[0] === 'D' || xy[1] === 'D') status = 'deleted'
      else if (xy[0] === 'R' || xy[1] === 'R') status = 'renamed'
      else if (xy[0] === 'M' || xy[1] === 'M') status = 'modified'

      if (status) statusMap.set(absPath, status)
    }
  } catch { /* not a git repo or git not available */ }
  return statusMap
}

export function parseGitStatusAsync(cwd: string): Promise<Map<string, GitStatus>> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain', '-u'], {
      cwd, encoding: 'utf8', timeout: 5000,
    }, (err, stdout) => {
      const statusMap = new Map<string, GitStatus>()
      if (err || !stdout) { resolve(statusMap); return }
      for (const line of stdout.split('\n')) {
        if (line.length < 4) continue
        const xy = line.substring(0, 2)
        const filePath = line.substring(3).split(' -> ').pop()!.trim()
        const absPath = pathModule.resolve(cwd, filePath)
        let status: GitStatus = null
        if (xy === '??') status = 'untracked'
        else if (xy[0] === 'A' || xy[1] === 'A') status = 'added'
        else if (xy[0] === 'D' || xy[1] === 'D') status = 'deleted'
        else if (xy[0] === 'R' || xy[1] === 'R') status = 'renamed'
        else if (xy[0] === 'M' || xy[1] === 'M') status = 'modified'
        if (status) statusMap.set(absPath, status)
      }
      resolve(statusMap)
    })
  })
}

export function getGitStatusForPath(path: string, isFolder: boolean, gitStatus: Map<string, GitStatus>): GitStatus {
  if (!isFolder) return gitStatus.get(path) ?? null
  // Folders: propagate the "highest priority" status from children
  // Priority: added/untracked > modified > renamed > deleted
  let folderStatus: GitStatus = null
  for (const [filePath, status] of gitStatus) {
    if (filePath.startsWith(path + pathModule.sep)) {
      if (status === 'added' || status === 'untracked') return status // highest, return early
      if (status === 'modified') folderStatus = 'modified'
      else if (!folderStatus) folderStatus = status
    }
  }
  return folderStatus
}

// ── File CRUD operations ────────────────────────────────────────

export function readFileContent(filePath: string): { content: string; name: string } | null {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > 2 * 1024 * 1024) return null // Skip files > 2MB
    const content = fs.readFileSync(filePath, 'utf8')
    const name = pathModule.basename(filePath)
    return { content, name }
  } catch {
    return null
  }
}

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff',
  pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
  m4a: 'audio/mp4', wma: 'audio/x-ms-wma', opus: 'audio/opus',
}

export function readMediaFile(filePath: string): { name: string; dataUrl: string } | null {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > 100 * 1024 * 1024) return null // Skip files > 100MB
    const name = pathModule.basename(filePath)
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const mime = MIME_MAP[ext] || 'application/octet-stream'
    const buffer = fs.readFileSync(filePath)
    const base64 = (buffer as Buffer).toString('base64')
    const dataUrl = `data:${mime};base64,${base64}`
    return { name, dataUrl }
  } catch {
    return null
  }
}

export function writeFile(filePath: string, content: string): boolean {
  try {
    fs.writeFileSync(filePath, content, 'utf8')
    return true
  } catch {
    return false
  }
}

export function createFileOrFolder(fullPath: string, isFolder: boolean): boolean {
  try {
    if (fs.existsSync(fullPath)) return false // already exists
    if (isFolder) {
      fs.mkdirSync(fullPath, { recursive: true })
    } else {
      // Ensure parent dir exists
      const dir = pathModule.dirname(fullPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(fullPath, '', 'utf8')
    }
    return true
  } catch {
    return false
  }
}

export function deleteFileOrFolder(targetPath: string): boolean {
  try {
    const stat = fs.statSync(targetPath)
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(targetPath)
    }
    return true
  } catch {
    return false
  }
}

export function renameFileOrFolder(oldPath: string, newName: string): string | null {
  if (!newName.trim()) return null
  const dir = pathModule.dirname(oldPath)
  const newPath = pathModule.join(dir, newName.trim())
  try {
    if (fs.existsSync(newPath)) return null
    fs.renameSync(oldPath, newPath)
    return newPath
  } catch {
    return null
  }
}

export function moveFileOrFolder(sourcePath: string, destDir: string): string | null {
  const name = pathModule.basename(sourcePath)
  const destPath = pathModule.join(destDir, name)
  try {
    if (sourcePath === destPath) return null
    // Don't move a folder into itself
    if (destPath.startsWith(sourcePath + pathModule.sep)) return null
    if (fs.existsSync(destPath)) return null
    // Ensure dest dir exists
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    fs.renameSync(sourcePath, destPath)
    return destPath
  } catch {
    return null
  }
}

export function copyFileOrFolder(sourcePath: string, destDir: string): string | null {
  const name = pathModule.basename(sourcePath)
  let destPath = pathModule.join(destDir, name)
  try {
    // If destination already exists, add a suffix
    if (fs.existsSync(destPath)) {
      const ext = pathModule.extname(name)
      const base = ext ? name.slice(0, -ext.length) : name
      let i = 1
      do {
        destPath = pathModule.join(destDir, `${base} (${i})${ext}`)
        i++
      } while (fs.existsSync(destPath))
    }
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const stat = fs.statSync(sourcePath)
    if (stat.isDirectory()) {
      fs.cpSync(sourcePath, destPath, { recursive: true })
    } else {
      fs.copyFileSync(sourcePath, destPath)
    }
    return destPath
  } catch {
    return null
  }
}

export { fs, pathModule }
