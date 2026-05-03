/**
 * MemPalace access log — best-effort JSONL append + tail reader.
 *
 * Writers (MCP tool handlers) call `logAccess`. The Memory plugin reads
 * recent events via `readRecentAccess` to visualize live memory access
 * (pulses on touched wings/rooms/drawers).
 *
 * The file lives at `<configDir>/access.jsonl`. Writes never throw;
 * reads return `[]` on any error. The reader scans only the tail to
 * keep cost bounded as the log grows.
 */

import fs from 'fs'
import path from 'path'

export type AccessTool =
  | 'search'
  | 'kg_query'
  | 'kg_add'
  | 'traverse'
  | 'find_tunnels'
  | 'diary_read'
  | 'diary_write'
  | 'add_drawer'

export interface AccessEvent {
  ts: string
  tool: AccessTool
  agent?: string
  wing?: string
  room?: string
  drawerId?: string
  entity?: string
  query?: string
  count?: number
}

const FILE_NAME = 'access.jsonl'
const TAIL_BYTES = 64 * 1024

export function logAccess(configDir: string, event: AccessEvent): void {
  try {
    fs.mkdirSync(configDir, { recursive: true })
    fs.appendFileSync(path.join(configDir, FILE_NAME), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort: never fail the calling tool because logging hiccupped
  }
}

export interface ReadOptions {
  sinceMs?: number
  limit?: number
}

export function readRecentAccess(configDir: string, options: ReadOptions = {}): AccessEvent[] {
  const sinceMs = options.sinceMs ?? 5000
  const limit = options.limit ?? 100
  try {
    const file = path.join(configDir, FILE_NAME)
    if (!fs.existsSync(file)) return []
    const stat = fs.statSync(file)
    if (stat.size === 0) return []
    const tailBytes = Math.min(stat.size, TAIL_BYTES)
    const buf = Buffer.alloc(tailBytes)
    const fd = fs.openSync(file, 'r')
    try {
      fs.readSync(fd, buf, 0, tailBytes, stat.size - tailBytes)
    } finally {
      fs.closeSync(fd)
    }
    const text = buf.toString('utf-8')
    // Drop the leading partial line when the tail starts mid-record.
    const start = stat.size > tailBytes ? text.indexOf('\n') : -1
    const body = start === -1 ? text : text.slice(start + 1)
    const cutoff = Date.now() - sinceMs
    const events: AccessEvent[] = []
    for (const line of body.split('\n')) {
      if (!line) continue
      try {
        const event = JSON.parse(line) as AccessEvent
        const t = new Date(event.ts).getTime()
        if (Number.isFinite(t) && t >= cutoff) events.push(event)
      } catch {
        // skip malformed line
      }
    }
    return events.length > limit ? events.slice(events.length - limit) : events
  } catch {
    return []
  }
}
