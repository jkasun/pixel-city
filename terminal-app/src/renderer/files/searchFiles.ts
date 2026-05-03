import { IGNORED } from './fileTypes'

const { execFile } = window.require('child_process') as typeof import('child_process')
const pathModule = window.require('path') as typeof import('path')

// ── Types ────────────────────────────────────────────────────────

export interface SearchMatch {
  line: number
  column: number
  length: number
  text: string        // full line text
  beforeText: string  // text before match (for highlight)
  matchText: string   // the matched text
  afterText: string   // text after match
}

export interface SearchFileResult {
  filePath: string
  relativePath: string
  matches: SearchMatch[]
}

export interface SearchOptions {
  query: string
  cwd: string
  isRegex?: boolean
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  includeGlob?: string   // e.g. "*.ts,*.tsx"
  excludeGlob?: string   // e.g. "*.test.ts"
}

export interface SearchResult {
  files: SearchFileResult[]
  totalMatches: number
  truncated: boolean
}

// ── Constants ────────────────────────────────────────────────────

const MAX_RESULTS = 10000
const SEARCH_TIMEOUT = 15000

// ── Search engine ────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Search across files using `grep` (universally available on macOS/Linux).
 * Returns a promise with structured results grouped by file.
 */
export function searchFiles(opts: SearchOptions): Promise<SearchResult> {
  const { query, cwd, isRegex, isCaseSensitive, isWholeWord, includeGlob, excludeGlob } = opts

  if (!query) return Promise.resolve({ files: [], totalMatches: 0, truncated: false })

  return new Promise((resolve) => {
    // Build the pattern
    let pattern = isRegex ? query : escapeRegex(query)
    if (isWholeWord) pattern = `\\b${pattern}\\b`

    // Build grep args
    const args: string[] = [
      '-r',           // recursive
      '-n',           // line numbers
      '-H',           // show filename
      '--byte-offset', // byte offset for column info
    ]

    if (!isCaseSensitive) args.push('-i')
    args.push('-E') // extended regex

    // Exclude common directories
    for (const dir of IGNORED) {
      args.push(`--exclude-dir=${dir}`)
    }

    // Exclude patterns
    if (excludeGlob) {
      for (const glob of excludeGlob.split(',').map(g => g.trim()).filter(Boolean)) {
        args.push(`--exclude=${glob}`)
      }
    }

    // Include patterns
    if (includeGlob) {
      for (const glob of includeGlob.split(',').map(g => g.trim()).filter(Boolean)) {
        args.push(`--include=${glob}`)
      }
    }

    // Skip binary files
    args.push('-I')

    // Limit output
    args.push(`-m`, `${MAX_RESULTS}`)

    args.push('--', pattern, '.')

    execFile('grep', args, {
      cwd,
      encoding: 'utf8',
      timeout: SEARCH_TIMEOUT,
      maxBuffer: 20 * 1024 * 1024,
    }, (err, stdout) => {
      // grep returns exit code 1 for no matches — that's fine
      if (err && (err as any).code !== 1 && !stdout) {
        resolve({ files: [], totalMatches: 0, truncated: false })
        return
      }

      const lines = (stdout || '').split('\n').filter(Boolean)
      const fileMap = new Map<string, SearchMatch[]>()
      let totalMatches = 0
      const truncated = lines.length >= MAX_RESULTS

      const searchLower = isCaseSensitive ? query : query.toLowerCase()

      for (const line of lines) {
        // Format: ./path/to/file:lineNum:byteOffset:matched line text
        // With -b (byte-offset) format: ./relative:lineNum:byteOffset:text
        const match = line.match(/^\.\/(.+?):(\d+):\d+:(.*)$/)
        if (!match) continue

        const [, relPath, lineNumStr, text] = match
        const lineNum = parseInt(lineNumStr, 10)
        const absPath = pathModule.resolve(cwd, relPath)

        // Find match position in the line
        let matchIndex: number
        let matchLength: number

        if (isRegex) {
          try {
            const flags = isCaseSensitive ? '' : 'i'
            const re = new RegExp(pattern, flags)
            const m = re.exec(text)
            matchIndex = m ? m.index : 0
            matchLength = m ? m[0].length : query.length
          } catch {
            matchIndex = 0
            matchLength = query.length
          }
        } else {
          const searchIn = isCaseSensitive ? text : text.toLowerCase()
          matchIndex = searchIn.indexOf(searchLower)
          if (matchIndex === -1) matchIndex = 0
          matchLength = query.length
        }

        const beforeText = text.substring(0, matchIndex)
        const matchText = text.substring(matchIndex, matchIndex + matchLength)
        const afterText = text.substring(matchIndex + matchLength)

        if (!fileMap.has(absPath)) fileMap.set(absPath, [])
        fileMap.get(absPath)!.push({
          line: lineNum,
          column: matchIndex + 1,
          length: matchLength,
          text,
          beforeText,
          matchText,
          afterText,
        })
        totalMatches++
      }

      const files: SearchFileResult[] = []
      for (const [filePath, matches] of fileMap) {
        files.push({
          filePath,
          relativePath: pathModule.relative(cwd, filePath),
          matches,
        })
      }

      // Sort by number of matches (most first)
      files.sort((a, b) => b.matches.length - a.matches.length)

      resolve({ files, totalMatches, truncated })
    })
  })
}

/**
 * Replace a single match in a file.
 */
export function replaceInFile(
  filePath: string,
  line: number,
  column: number,
  matchLength: number,
  replacement: string
): boolean {
  const fs = window.require('fs') as typeof import('fs')
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n')
    const lineIdx = line - 1
    if (lineIdx < 0 || lineIdx >= lines.length) return false

    const lineText = lines[lineIdx]
    const colIdx = column - 1
    lines[lineIdx] = lineText.substring(0, colIdx) + replacement + lineText.substring(colIdx + matchLength)
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Replace all matches in a single file.
 */
export function replaceAllInFile(
  filePath: string,
  query: string,
  replacement: string,
  isRegex: boolean,
  isCaseSensitive: boolean,
  isWholeWord: boolean
): number {
  const fs = window.require('fs') as typeof import('fs')
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    let pattern = isRegex ? query : escapeRegex(query)
    if (isWholeWord) pattern = `\\b${pattern}\\b`
    const flags = isCaseSensitive ? 'g' : 'gi'
    const re = new RegExp(pattern, flags)
    let count = 0
    const newContent = content.replace(re, () => { count++; return replacement })
    if (count > 0) fs.writeFileSync(filePath, newContent, 'utf8')
    return count
  } catch {
    return 0
  }
}
