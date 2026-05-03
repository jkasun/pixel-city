// ── Web Worker for fuzzy search scoring ─────────────────────────
// Runs fuzzy matching off the main thread so the UI never freezes
// during search. Receives lightweight item data, returns scored results.

// ── Types (serializable, no React) ─────────────────────────────

interface WorkerItem {
  id: string
  label: string
  description?: string
}

interface WorkerScoredItem {
  id: string
  score: number
  labelIndices: number[]
  descriptionIndices: number[]
}

interface SetItemsMessage {
  type: 'setItems'
  items: WorkerItem[]
  maxResults: number
}

interface SearchMessage {
  type: 'search'
  requestId: number
  query: string
}

type WorkerMessage = SetItemsMessage | SearchMessage

interface SearchResponse {
  type: 'results'
  requestId: number
  results: WorkerScoredItem[]
}

// ── Inline fuzzy scorer (same algorithm as fuzzyScorer.ts) ──────
// Inlined to avoid import issues with the worker bundle.
// Must be kept in sync with fuzzyScorer.ts.

const SCORE_MATCH = 16
const BONUS_CONSECUTIVE = 8
const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 7
const BONUS_FIRST_CHAR = 10
const BONUS_EXACT_CASE = 1

const SEPARATORS = new Set(['/', '\\', '.', '-', '_', ' '])

function isBoundary(prev: string): boolean {
  return SEPARATORS.has(prev)
}

function isCamelBoundary(prev: string, curr: string): boolean {
  return prev === prev.toLowerCase() && curr !== curr.toLowerCase()
}

interface FuzzyResult {
  score: number
  indices: number[]
}

function fuzzyMatch(query: string, target: string): FuzzyResult | null {
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

  const consecutive: boolean[][] = Array.from({ length: qLen }, () => new Array(tLen).fill(false))

  let prevH = new Float64Array(tLen)
  let currH = new Float64Array(tLen)
  let prevD = new Float64Array(tLen)
  let currD = new Float64Array(tLen)

  const NEG_INF = -1e9
  const matchScore: Float64Array[] = Array.from({ length: qLen }, () => new Float64Array(tLen))

  for (let i = 0; i < qLen; i++) {
    currH.fill(NEG_INF)
    currD.fill(NEG_INF)
    let maxH = NEG_INF

    for (let j = i; j < tLen; j++) {
      if (qLower[i] === tLower[j]) {
        let score = SCORE_MATCH
        if (query[i] === target[j]) score += BONUS_EXACT_CASE
        if (j === 0) {
          score += BONUS_BOUNDARY
          if (i === 0) score += BONUS_FIRST_CHAR
        } else {
          if (isBoundary(target[j - 1])) score += BONUS_BOUNDARY
          else if (isCamelBoundary(target[j - 1], target[j])) score += BONUS_CAMEL
        }

        if (i === 0) {
          currD[j] = score
          consecutive[i][j] = false
        } else {
          const consScore = prevD[j - 1] + score + BONUS_CONSECUTIVE
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
        currH[j] = maxH
      }
      if (currH[j] > maxH) maxH = currH[j]
    }

    const tmpH = prevH; prevH = currH; currH = tmpH
    const tmpD = prevD; prevD = currD; currD = tmpD
  }

  let bestScore = NEG_INF
  let bestJ = -1
  for (let j = qLen - 1; j < tLen; j++) {
    if (matchScore[qLen - 1][j] > bestScore) {
      bestScore = matchScore[qLen - 1][j]
      bestJ = j
    }
  }

  if (bestScore <= 0 || bestJ === -1) return null

  const indices = new Array<number>(qLen)
  let j = bestJ
  for (let i = qLen - 1; i >= 0; i--) {
    indices[i] = j
    if (i > 0) {
      if (consecutive[i][j]) {
        j = j - 1
      } else {
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

function fuzzyMatchPath(query: string, relativePath: string): FuzzyResult | null {
  if (!query.includes('/') && !query.includes('\\')) return null

  const queryParts = query.split(/[/\\]/).filter(Boolean)
  if (queryParts.length === 0) return null

  const pathParts = relativePath.split(/[/\\]/)
  if (pathParts.length === 0) return null

  let pathIdx = 0
  let totalScore = 0
  const allIndices: number[] = []

  const segmentOffsets: number[] = []
  let offset = 0
  for (const part of pathParts) {
    segmentOffsets.push(offset)
    offset += part.length + 1
  }

  for (let qi = 0; qi < queryParts.length; qi++) {
    const qPart = queryParts[qi]
    const isLast = qi === queryParts.length - 1
    let bestMatch: FuzzyResult | null = null
    let bestPIdx = -1
    let bestScore = -Infinity

    for (let pi = pathIdx; pi < pathParts.length; pi++) {
      const result = fuzzyMatch(qPart, pathParts[pi])
      if (!result) continue

      let score = result.score
      if (pi === pathParts.length - 1 && isLast) score *= 1.5
      if (qPart.toLowerCase() === pathParts[pi].toLowerCase()) score += 20
      if (pi === pathIdx) score += 5

      if (score > bestScore) {
        bestScore = score
        bestMatch = result
        bestPIdx = pi
      }
    }

    if (!bestMatch || bestPIdx === -1) return null

    const segOffset = segmentOffsets[bestPIdx]
    for (const idx of bestMatch.indices) {
      allIndices.push(segOffset + idx)
    }
    totalScore += bestScore
    pathIdx = bestPIdx + 1
  }

  return { score: totalScore, indices: allIndices }
}

const LABEL_MULTIPLIER = 1.8

function scoreItem(query: string, item: WorkerItem): WorkerScoredItem | null {
  const labelResult = fuzzyMatch(query, item.label)
  const descResult = item.description ? fuzzyMatch(query, item.description) : null
  const pathResult = item.description ? fuzzyMatchPath(query, item.description) : null

  const labelScore = labelResult ? labelResult.score * LABEL_MULTIPLIER : 0
  const descScore = descResult ? descResult.score : 0
  const pathScore = pathResult ? pathResult.score * 1.5 : 0

  const bestScore = Math.max(labelScore, descScore, pathScore)
  if (bestScore <= 0) return null

  if (pathScore >= labelScore && pathScore >= descScore) {
    return { id: item.id, score: pathScore, labelIndices: [], descriptionIndices: pathResult?.indices ?? [] }
  } else if (labelScore >= descScore) {
    return { id: item.id, score: labelScore, labelIndices: labelResult?.indices ?? [], descriptionIndices: [] }
  } else {
    return { id: item.id, score: descScore, labelIndices: [], descriptionIndices: descResult?.indices ?? [] }
  }
}

// ── Message handler (split protocol) ───────────────────────────
// Items are cached — only sent once when they change.
// Search messages carry only the query string (near-zero cost per keystroke).

let cachedItems: WorkerItem[] = []
let cachedMaxResults = 200

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data

  if (msg.type === 'setItems') {
    cachedItems = msg.items
    cachedMaxResults = msg.maxResults
    return
  }

  if (msg.type === 'search') {
    const { requestId, query } = msg

    if (!query.trim()) {
      const results: WorkerScoredItem[] = cachedItems.map(item => ({
        id: item.id, score: 1, labelIndices: [], descriptionIndices: [],
      }))
      ;(self as unknown as Worker).postMessage({ type: 'results', requestId, results } satisfies SearchResponse)
      return
    }

    const scored: WorkerScoredItem[] = []
    for (const item of cachedItems) {
      const result = scoreItem(query, item)
      if (result) scored.push(result)
    }

    scored.sort((a, b) => b.score - a.score)
    const results = scored.slice(0, cachedMaxResults)

    ;(self as unknown as Worker).postMessage({ type: 'results', requestId, results } satisfies SearchResponse)
  }
}
