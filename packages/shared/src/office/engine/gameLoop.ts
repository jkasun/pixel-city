import { MAX_DELTA_TIME_SEC } from '../../constants.js'

export interface GameLoopCallbacks {
  update: (dt: number) => void
  render: (ctx: CanvasRenderingContext2D) => void
  // Optional supervision hooks. Framework-agnostic — wired up by call sites
  // (e.g. the renderer can route these to `log.error` / `log.fatal`).
  onError?: (
    err: Error,
    ctx: { failCount: number; sampled: boolean; fatal: boolean },
  ) => void
  onCritical?: (err: Error) => void
}

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): () => void {
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  let lastTime = 0
  let rafId = 0
  let stopped = false
  let failCount = 0

  const frame = (time: number) => {
    if (stopped) return
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC)
    lastTime = time

    try {
      callbacks.update(dt)
      callbacks.render(ctx)
      failCount = 0
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      failCount++
      const fatal = failCount > 60
      const sampled = failCount <= 3 || failCount % 60 === 0
      try {
        callbacks.onError?.(error, { failCount, sampled, fatal })
      } catch { /* never let logging crash the loop */ }
      if (fatal) {
        try { callbacks.onCritical?.(error) } catch { /* swallow */ }
        stopped = true
        return
      }
    }

    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)

  return () => {
    stopped = true
    cancelAnimationFrame(rafId)
  }
}
