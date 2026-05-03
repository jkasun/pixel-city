/**
 * Sound effects using the Web Audio API.
 * No external audio files needed — sounds are synthesized at runtime.
 */

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

/**
 * Play a short two-tone ascending chime to signal that an agent has finished
 * working and is now idle.
 */
export function playIdleChime(): void {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    // Two-note ascending chime (C5 → E5)
    const notes = [523.25, 659.25]
    const noteDuration = 0.12
    const gap = 0.08

    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.value = notes[i]

      const start = now + i * (noteDuration + gap)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.15, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteDuration)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(start)
      osc.stop(start + noteDuration)
    }
  } catch {
    // Silently ignore audio errors (e.g. no audio device)
  }
}
