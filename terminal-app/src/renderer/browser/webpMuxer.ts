/**
 * Minimal animated WebP muxer — constructs the RIFF container from
 * individual WebP frames produced by canvas.toBlob('image/webp').
 *
 * RIFF layout:
 *   RIFF [size] WEBP
 *     VP8X  — extended features (animation flag)
 *     ANIM  — animation parameters (loop count)
 *     ANMF  — per-frame chunk (position, size, duration, data)
 *     ANMF  — ...
 */

export interface WebPFrame {
  /** Raw WebP file bytes from canvas.toBlob('image/webp') */
  data: Uint8Array
  /** Frame display duration in milliseconds (1–16777215) */
  duration: number
}

/**
 * Extract only the ALPH + VP8/VP8L chunks from a WebP file.
 * ANMF frame data must contain ONLY these chunks — VP8X, ICCP, EXIF, XMP etc.
 * are not valid inside animation frames and will corrupt the file.
 */
function extractFrameData(webp: Uint8Array): Uint8Array {
  if (webp.length < 12) return webp
  const riff = String.fromCharCode(webp[0]!, webp[1]!, webp[2]!, webp[3]!)
  const fourcc = String.fromCharCode(webp[8]!, webp[9]!, webp[10]!, webp[11]!)
  if (riff !== 'RIFF' || fourcc !== 'WEBP') return webp

  // Walk all chunks after the 12-byte RIFF header, keep only ALPH/VP8/VP8L
  const allowed = new Set(['ALPH', 'VP8 ', 'VP8L'])
  const parts: Uint8Array[] = []
  let offset = 12
  while (offset + 8 <= webp.length) {
    const tag = String.fromCharCode(webp[offset]!, webp[offset + 1]!, webp[offset + 2]!, webp[offset + 3]!)
    const chunkSize = webp[offset + 4]! | (webp[offset + 5]! << 8) | (webp[offset + 6]! << 16) | (webp[offset + 7]! << 24)
    const padded = chunkSize + (chunkSize & 1) // RIFF chunks are 2-byte aligned
    const chunkTotal = 8 + padded

    if (allowed.has(tag)) {
      parts.push(webp.subarray(offset, offset + chunkTotal))
    }
    offset += chunkTotal
  }

  // Concatenate kept chunks
  const totalLen = parts.reduce((s, p) => s + p.length, 0)
  const result = new Uint8Array(totalLen)
  let off = 0
  for (const p of parts) {
    result.set(p, off)
    off += p.length
  }
  return result
}

function writeUint16LE(buf: Uint8Array, off: number, val: number) {
  buf[off] = val & 0xff
  buf[off + 1] = (val >> 8) & 0xff
}

function writeUint24LE(buf: Uint8Array, off: number, val: number) {
  buf[off] = val & 0xff
  buf[off + 1] = (val >> 8) & 0xff
  buf[off + 2] = (val >> 16) & 0xff
}

function writeUint32LE(buf: Uint8Array, off: number, val: number) {
  buf[off] = val & 0xff
  buf[off + 1] = (val >> 8) & 0xff
  buf[off + 2] = (val >> 16) & 0xff
  buf[off + 3] = (val >> 24) & 0xff
}

function writeString(buf: Uint8Array, off: number, str: string) {
  for (let i = 0; i < str.length; i++) buf[off + i] = str.charCodeAt(i)
}

/**
 * Create an animated WebP file from individual WebP frames.
 *
 * @param width  Canvas width in pixels
 * @param height Canvas height in pixels
 * @param frames Array of WebP frame data + durations
 * @returns Complete animated WebP file as Uint8Array
 */
export function createAnimatedWebP(width: number, height: number, frames: WebPFrame[]): Uint8Array {
  if (frames.length === 0) throw new Error('No frames to encode')

  // Strip RIFF headers from all frames
  const stripped = frames.map(f => ({
    data: extractFrameData(f.data),
    duration: Math.max(1, Math.min(f.duration, 16777215)), // clamp to 24-bit range
  }))

  // Calculate total size
  // VP8X chunk: 8 (header) + 10 (payload) = 18
  // ANIM chunk: 8 (header) + 6 (payload) = 14
  // Each ANMF: 8 (header) + 16 (fixed fields) + frameData.length [+ 1 padding if odd]
  let totalPayload = 18 + 14 // VP8X + ANIM
  for (const f of stripped) {
    const anmfPayload = 16 + f.data.length
    const anmfPadded = anmfPayload + (anmfPayload & 1)
    totalPayload += 8 + anmfPadded
  }

  // RIFF header: 'RIFF' (4) + fileSize (4) + 'WEBP' (4) = 12
  const fileSize = 4 + totalPayload // 'WEBP' + payload
  const buf = new Uint8Array(12 + totalPayload)
  let off = 0

  // RIFF header
  writeString(buf, off, 'RIFF'); off += 4
  writeUint32LE(buf, off, fileSize); off += 4
  writeString(buf, off, 'WEBP'); off += 4

  // VP8X chunk — extended features (animation flag)
  writeString(buf, off, 'VP8X'); off += 4
  writeUint32LE(buf, off, 10); off += 4 // chunk size
  // Flags: bit 1 = animation
  writeUint32LE(buf, off, 0x02); off += 4
  // Reserved (3 bytes) + Canvas Width Minus One (3 bytes) packed as 6 bytes
  writeUint24LE(buf, off, width - 1); off += 3
  writeUint24LE(buf, off, height - 1); off += 3

  // ANIM chunk — animation parameters
  writeString(buf, off, 'ANIM'); off += 4
  writeUint32LE(buf, off, 6); off += 4 // chunk size
  writeUint32LE(buf, off, 0x00000000); off += 4 // background color (transparent black)
  writeUint16LE(buf, off, 0); off += 2 // loop count (0 = infinite)

  // ANMF chunks — one per frame
  for (const f of stripped) {
    const anmfPayload = 16 + f.data.length
    const anmfPadded = anmfPayload + (anmfPayload & 1)

    writeString(buf, off, 'ANMF'); off += 4
    writeUint32LE(buf, off, anmfPadded); off += 4

    // Frame X (24 bits, divided by 2) — always 0 for full-frame
    writeUint24LE(buf, off, 0); off += 3
    // Frame Y (24 bits, divided by 2) — always 0
    writeUint24LE(buf, off, 0); off += 3
    // Frame Width Minus One (24 bits)
    writeUint24LE(buf, off, width - 1); off += 3
    // Frame Height Minus One (24 bits)
    writeUint24LE(buf, off, height - 1); off += 3
    // Frame Duration in ms (24 bits)
    writeUint24LE(buf, off, f.duration); off += 3
    // Flags: blending=0 (use alpha), disposal=0 (do not dispose)
    buf[off] = 0x00; off += 1

    // Frame data (VP8/VP8L chunks)
    buf.set(f.data, off); off += f.data.length
    // Padding byte if odd
    if (f.data.length & 1) { buf[off] = 0; off += 1 }
  }

  return buf
}
