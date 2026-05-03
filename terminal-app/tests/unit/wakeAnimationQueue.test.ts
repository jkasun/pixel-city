import { describe, expect, it } from 'vitest'
import { WakeAnimationQueue, hashToUnit } from '@pixel-city/shared/office/engine/wakeAnimationQueue'

function makeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => { t += ms },
    set: (ms: number) => { t = ms },
  }
}

describe('WakeAnimationQueue', () => {
  it('dispatches one event per tick spaced by minStaggerMs', () => {
    const clock = makeClock(0)
    const q = new WakeAnimationQueue({ minStaggerMs: 250, now: clock.now })
    const fired: string[] = []
    q.enqueue({ kind: 'wake', permId: 'a', buildAtomic: () => fired.push('a') })
    q.enqueue({ kind: 'wake', permId: 'b', buildAtomic: () => fired.push('b') })
    q.enqueue({ kind: 'wake', permId: 'c', buildAtomic: () => fired.push('c') })

    q.tick()
    expect(fired).toEqual(['a'])

    // Not enough time — no dispatch.
    clock.advance(100)
    q.tick()
    expect(fired).toEqual(['a'])

    // Crossed 250ms threshold.
    clock.advance(200)
    q.tick()
    expect(fired).toEqual(['a', 'b'])

    clock.advance(250)
    q.tick()
    expect(fired).toEqual(['a', 'b', 'c'])
  })

  it('dedupes by permId, replacing the prior event in place', () => {
    const clock = makeClock(0)
    const q = new WakeAnimationQueue({ now: clock.now })
    const fired: string[] = []
    q.enqueue({ kind: 'wake', permId: 'a', buildAtomic: () => fired.push('a-1') })
    q.enqueue({ kind: 'wake', permId: 'b', buildAtomic: () => fired.push('b') })
    q.enqueue({ kind: 'sleep', permId: 'a', buildAtomic: () => fired.push('a-2') })

    expect(q.peekPermIds()).toEqual(['a', 'b'])

    q.drain()
    expect(fired).toEqual(['a-2', 'b'])
  })

  it('drains in FIFO order', () => {
    const q = new WakeAnimationQueue()
    const fired: string[] = []
    for (const id of ['x', 'y', 'z']) {
      q.enqueue({ kind: 'wake', permId: id, buildAtomic: () => fired.push(id) })
    }
    q.drain()
    expect(fired).toEqual(['x', 'y', 'z'])
  })

  it('reducedMotion flushes all pending on tick with zero stagger', () => {
    const clock = makeClock(0)
    const q = new WakeAnimationQueue({ minStaggerMs: 250, reducedMotion: true, now: clock.now })
    const fired: string[] = []
    q.enqueue({ kind: 'wake', permId: 'a', buildAtomic: () => fired.push('a') })
    q.enqueue({ kind: 'wake', permId: 'b', buildAtomic: () => fired.push('b') })
    q.tick()
    expect(fired).toEqual(['a', 'b'])
    expect(q.size()).toBe(0)
  })

  it('setReducedMotion flips behavior mid-flight', () => {
    const clock = makeClock(0)
    const q = new WakeAnimationQueue({ minStaggerMs: 250, now: clock.now })
    const fired: string[] = []
    q.enqueue({ kind: 'wake', permId: 'a', buildAtomic: () => fired.push('a') })
    q.enqueue({ kind: 'wake', permId: 'b', buildAtomic: () => fired.push('b') })
    q.tick()
    expect(fired).toEqual(['a'])
    q.setReducedMotion(true)
    q.tick()
    expect(fired).toEqual(['a', 'b'])
  })

  it('sleep events do not block wake events of different permIds', () => {
    const clock = makeClock(0)
    const q = new WakeAnimationQueue({ minStaggerMs: 250, now: clock.now })
    const fired: string[] = []
    q.enqueue({ kind: 'sleep', permId: 'a', buildAtomic: () => fired.push('sleep-a') })
    q.enqueue({ kind: 'wake', permId: 'b', buildAtomic: () => fired.push('wake-b') })

    q.tick()
    clock.advance(250)
    q.tick()

    expect(fired).toEqual(['sleep-a', 'wake-b'])
  })

  it('empty tick is a no-op', () => {
    const q = new WakeAnimationQueue()
    expect(() => q.tick()).not.toThrow()
    expect(q.size()).toBe(0)
  })
})

describe('hashToUnit', () => {
  it('is deterministic across calls', () => {
    expect(hashToUnit('synth-alex-chen')).toBe(hashToUnit('synth-alex-chen'))
  })

  it('returns a value in [0, 1)', () => {
    for (const s of ['a', 'synth-foo', 'synth-bar', '', '123']) {
      const v = hashToUnit(s)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('differs across different inputs (statistical — 100 random strings should spread)', () => {
    const values = new Set<number>()
    for (let i = 0; i < 100; i++) values.add(hashToUnit(`synth-${i}-x`))
    // 100 strings should produce at least 90 distinct buckets given 100k resolution.
    expect(values.size).toBeGreaterThan(90)
  })
})
