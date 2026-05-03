// ── Hook: offload fuzzy search scoring to a Web Worker ─────────
// Split protocol: items sent once (on change), query sent per keystroke.
// Falls back to main-thread scoring if worker fails to initialize.

import { useState, useEffect, useRef } from 'react'
import type { QuickMenuItem } from '../QuickMenu.js'
import { scoreQuickMenuItem, type ScoredItem } from '../files/fuzzyScorer.js'

const MAX_RESULTS = 200

interface WorkerScoredItem {
  id: string
  score: number
  labelIndices: number[]
  descriptionIndices: number[]
}

export function useSearchWorker(items: QuickMenuItem[], query: string) {
  const [results, setResults] = useState<ScoredItem[]>([])
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const itemMapRef = useRef<Map<string, QuickMenuItem>>(new Map())
  const fallbackRef = useRef(false)
  const itemsFingerprintRef = useRef('')

  // Initialize worker once
  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('../files/searchWorker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker

      worker.onmessage = (e: MessageEvent) => {
        const { type, requestId, results: workerResults } = e.data
        if (type !== 'results') return
        if (requestId !== requestIdRef.current) return

        const map = itemMapRef.current
        const scored: ScoredItem[] = []
        for (const wr of workerResults as WorkerScoredItem[]) {
          const item = map.get(wr.id)
          if (item) {
            scored.push({
              item,
              score: wr.score,
              labelIndices: wr.labelIndices,
              descriptionIndices: wr.descriptionIndices,
            })
          }
        }
        setResults(scored)
      }

      worker.onerror = () => { fallbackRef.current = true }
    } catch {
      fallbackRef.current = true
    }

    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  // Effect 1: Send items to worker only when they actually change (fingerprint check)
  useEffect(() => {
    // Build lookup map
    const map = new Map<string, QuickMenuItem>()
    for (const item of items) map.set(item.id, item)
    itemMapRef.current = map

    // Fingerprint: item count + first/last IDs (fast, catches all real changes)
    const fp = items.length === 0
      ? ''
      : `${items.length}:${items[0].id}:${items[items.length - 1].id}`

    if (fp === itemsFingerprintRef.current) return // no actual change
    itemsFingerprintRef.current = fp

    if (!workerRef.current || fallbackRef.current) return

    // Send items to worker (only when they actually changed)
    const workerItems = items.map(item => ({
      id: item.id,
      label: item.label,
      description: item.description,
    }))

    workerRef.current.postMessage({
      type: 'setItems',
      items: workerItems,
      maxResults: MAX_RESULTS,
    })
  }, [items])

  // Effect 2: Send query to worker (just a string — near-zero cost)
  useEffect(() => {
    const id = ++requestIdRef.current

    // Empty query — return all items synchronously (avoids async gap on first open)
    if (!query.trim()) {
      setResults(items.map(item => ({ item, score: 1, labelIndices: [], descriptionIndices: [] })))
      return
    }

    if (fallbackRef.current || !workerRef.current) {
      // Main-thread fallback
      const scored: ScoredItem[] = []
      for (const item of items) {
        const result = scoreQuickMenuItem(query, item)
        if (result) scored.push(result)
      }
      scored.sort((a, b) => b.score - a.score)
      setResults(scored.slice(0, MAX_RESULTS))
      return
    }

    workerRef.current.postMessage({
      type: 'search',
      requestId: id,
      query,
    })
  }, [query, items]) // Depends on both query and items

  return results
}
