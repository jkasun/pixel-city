// ── DP-based fuzzy matching (fzf / VS Code style) ──────────────
//
// Uses a forward scoring pass with two rolling rows and a backward
// traceback to find optimal match positions. Returns both a score
// and the matched character indices for highlighting.

import type { QuickMenuItem } from '../QuickMenu.js'

// ── Score constants ─────────────────────────────────────────────

const SCORE_MATCH = 16
const BONUS_CONSECUTIVE = 8
const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 7
const BONUS_FIRST_CHAR = 10
const BONUS_EXACT_CASE = 1
const GAP_PENALTY_FIRST = -3
const GAP_PENALTY_EXTEND = -1

// ── Helpers ─────────────────────────────────────────────────────

const SEPARATORS = new Set(['/', '\\', '.', '-', '_', ' '])

function isBoundary(prev: string, _curr: string): boolean {
  return SEPARATORS.has(prev)
}

function isCamelBoundary(prev: string, curr: string): boolean {
  return prev === prev.toLowerCase() && curr !== curr.toLowerCase()
}

// ── Core fuzzy match ────────────────────────────────────────────

export interface FuzzyResult {
  score: number
  indices: number[]
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const qLen = query.length
  const tLen = target.length

  if (qLen === 0) return { score: 1, indices: [] }
  if (qLen > tLen) return null

  const qLower = query.toLowerCase()
  const tLower = target.toLowerCase()

  // Quick subsequence check
  let check = 0
  for (let i = 0; i < qLen; i++) {
    check = tLower.indexOf(qLower[i], check)
    if (check === -1) return null
    check++
  }

  // DP scoring — two matrices:
  //   H[i][j] = best score matching query[0..i] to some subsequence ending at target[j]
  //   D[i][j] = best score when query[i] matches target[j] (diagonal, i.e. a match cell)
  // We use rolling rows to save memory.

  // For traceback we need to know, for each (i,j) match cell, whether the
  // previous query char was matched at j-1 (consecutive) or earlier (gap).
  // We store this in a full matrix of booleans.

  const consecutive: boolean[][] = Array.from({ length: qLen }, () => new Array(tLen).fill(false))

  // H stores the best score so far for matching query[0..i] ending at or before target[j]
  // D stores score specifically when query[i] matches target[j]
  let prevH = new Float64Array(tLen) // H[i-1][j]
  let currH = new Float64Array(tLen) // H[i][j]
  let prevD = new Float64Array(tLen) // D[i-1][j]
  let currD = new Float64Array(tLen) // D[i][j]

  const NEG_INF = -1e9

  // Also track the score matrix for traceback
  const matchScore: Float64Array[] = Array.from({ length: qLen }, () => new Float64Array(tLen))

  for (let i = 0; i < qLen; i++) {
    currH.fill(NEG_INF)
    currD.fill(NEG_INF)

    let maxH = NEG_INF

    for (let j = i; j < tLen; j++) {
      if (qLower[i] === tLower[j]) {
        // This is a match — compute the score
        let score = SCORE_MATCH

        // Exact case bonus
        if (query[i] === target[j]) score += BONUS_EXACT_CASE

        // Position bonuses
        if (j === 0) {
          score += BONUS_BOUNDARY
          if (i === 0) score += BONUS_FIRST_CHAR
        } else {
          if (isBoundary(target[j - 1], target[j])) score += BONUS_BOUNDARY
          else if (isCamelBoundary(target[j - 1], target[j])) score += BONUS_CAMEL
        }

        if (i === 0) {
          // First query char — no previous row to look at
          currD[j] = score
          consecutive[i][j] = false
        } else {
          // Option 1: consecutive match (previous query char matched at j-1)
          const consScore = prevD[j - 1] + score + BONUS_CONSECUTIVE
          // Option 2: non-consecutive (best match of query[0..i-1] ending before j)
          const prevBest = j > 0 ? prevH[j - 1] : NEG_INF
          const gapScore = prevBest + score

          if (consScore >= gapScore) {
            currD[j] = consScore
            consecutive[i][j] = true
          } else {
            currD[j] = gapScore
            consecutive[i][j] = false
          }
        }

        matchScore[i][j] = currD[j]
        currH[j] = Math.max(maxH, currD[j])
      } else {
        // No match at this position
        currH[j] = maxH
      }

      if (currH[j] > maxH) maxH = currH[j]
    }

    // Swap rows
    const tmpH = prevH; prevH = currH; currH = tmpH
    const tmpD = prevD; prevD = currD; currD = tmpD
  }

  // Find best ending position for the last query char
  let bestScore = NEG_INF
  let bestJ = -1
  for (let j = qLen - 1; j < tLen; j++) {
    if (matchScore[qLen - 1][j] > bestScore) {
      bestScore = matchScore[qLen - 1][j]
      bestJ = j
    }
  }

  if (bestScore <= 0 || bestJ === -1) return null

  // Backward traceback to recover matched indices
  const indices = new Array<number>(qLen)
  let j = bestJ
  for (let i = qLen - 1; i >= 0; i--) {
    indices[i] = j
    if (i > 0) {
      if (consecutive[i][j]) {
        // Previous query char matched at j-1
        j = j - 1
      } else {
        // Find where query[i-1] was best matched before j
        j = j - 1
        let best = NEG_INF
        let bestK = -1
        for (let k = j; k >= i - 1; k--) {
          if (matchScore[i - 1][k] > best) {
            best = matchScore[i - 1][k]
            bestK = k
          }
        }
        j = bestK
      }
    }
  }

  return { score: bestScore, indices }
}

// ── Path-segment-aware matching ─────────────────────────────────

export function fuzzyMatchPath(query: string, relativePath: string): FuzzyResult | null {
  // Only use when query contains path separators
  if (!query.includes('/') && !query.includes('\\')) return null

  const queryParts = query.split(/[/\\]/).filter(Boolean)
  if (queryParts.length === 0) return null

  const pathParts = relativePath.split(/[/\\]/)
  if (pathParts.length === 0) return null

  // Greedily match each query segment to a path segment
  let pathIdx = 0
  let totalScore = 0
  const allIndices: number[] = []

  // Track character offset in the original relativePath string
  // so we can map indices back for highlighting
  const segmentOffsets: number[] = []
  let offset = 0
  for (const part of pathParts) {
    segmentOffsets.push(offset)
    offset += part.length + 1 // +1 for the separator
  }

  for (let qi = 0; qi < queryParts.length; qi++) {
    const qPart = queryParts[qi]
    const isLast = qi === queryParts.length - 1
    let bestMatch: FuzzyResult | null = null
    let bestPathIdx = -1
    let bestScore = -Infinity

    // Search from current position forward
    for (let pi = pathIdx; pi < pathParts.length; pi++) {
      const result = fuzzyMatch(qPart, pathParts[pi])
      if (!result) continue

      let score = result.score
      // Bonus for matching the filename (last segment)
      if (pi === pathParts.length - 1 && isLast) score *= 1.5
      // Bonus for exact segment match
      if (qPart.toLowerCase() === pathParts[pi].toLowerCase()) score += 20
      // Bonus for consecutive segment matches (no gaps between matched segments)
      if (pi === pathIdx) score += 5

      if (score > bestScore) {
        bestScore = score
        bestMatch = result
        bestPathIdx = pi
      }
    }

    if (!bestMatch || bestPathIdx === -1) return null // query segment didn't match anything

    // Map indices back to original string positions
    const segOffset = segmentOffsets[bestPathIdx]
    for (const idx of bestMatch.indices) {
      allIndices.push(segOffset + idx)
    }
    totalScore += bestScore
    pathIdx = bestPathIdx + 1
  }

  return { score: totalScore, indices: allIndices }
}

// ── Item scoring ────────────────────────────────────────────────

export interface ScoredItem {
  item: QuickMenuItem
  score: number
  labelIndices: number[]
  descriptionIndices: number[]
}

const LABEL_MULTIPLIER = 1.8

export function scoreQuickMenuItem(query: string, item: QuickMenuItem): ScoredItem | null {
  if (!query.trim()) return { item, score: 1, labelIndices: [], descriptionIndices: [] }

  const labelResult = fuzzyMatch(query, item.label)
  const descResult = item.description ? fuzzyMatch(query, item.description) : null
  const pathResult = item.description ? fuzzyMatchPath(query, item.description) : null

  const labelScore = labelResult ? labelResult.score * LABEL_MULTIPLIER : 0
  const descScore = descResult ? descResult.score : 0
  const pathScore = pathResult ? pathResult.score * 1.5 : 0

  const bestScore = Math.max(labelScore, descScore, pathScore)
  if (bestScore <= 0) return null

  if (pathScore >= labelScore && pathScore >= descScore) {
    return {
      item,
      score: pathScore,
      labelIndices: [],
      descriptionIndices: pathResult?.indices ?? [],
    }
  } else if (labelScore >= descScore) {
    return {
      item,
      score: labelScore,
      labelIndices: labelResult?.indices ?? [],
      descriptionIndices: [],
    }
  } else {
    return {
      item,
      score: descScore,
      labelIndices: [],
      descriptionIndices: descResult?.indices ?? [],
    }
  }
}
