// Canvas Patcher — L1 Pure TypeScript
// Zero React, zero DOM, zero Node imports. Importable from any process.
//
// Applies a batch of text-based edits to a canvas HTML document. Each edit
// references its target via an anchor string that must appear EXACTLY ONCE
// in the current document — same contract as Claude Code's Edit/MultiEdit
// search/replace flow.
//
// Atomic: if any edit fails (anchor missing, anchor ambiguous, etc.) the
// whole patch is rejected and the original html is returned unchanged.
// Edits apply sequentially — later edits see the document as modified by
// earlier ones. The caller orders.

export type CanvasEdit =
  | { op: 'replace'; old_string: string; new_string: string }
  | { op: 'insert_before'; anchor: string; content: string }
  | { op: 'insert_after'; anchor: string; content: string }
  | { op: 'delete'; target: string }

export interface PatchError {
  /** Index of the edit in the input array. */
  index: number
  /** 'not_found' | 'ambiguous' — anchor appeared 0 or >1 times. */
  reason: 'not_found' | 'ambiguous' | 'invalid_op'
  /** The anchor string that failed (truncated for diagnostics). */
  anchor: string
  message: string
}

export type PatchResult =
  | { ok: true; html: string; applied: number }
  | { ok: false; html: string; errors: PatchError[] }

/** Count how many times `needle` appears in `haystack` (literal, no regex). */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

function applyOne(html: string, edit: CanvasEdit, index: number): { html: string } | { error: PatchError } {
  switch (edit.op) {
    case 'replace': {
      const anchor = edit.old_string
      if (!anchor) {
        return { error: { index, reason: 'invalid_op', anchor: '', message: 'replace requires non-empty old_string' } }
      }
      const count = countOccurrences(html, anchor)
      if (count === 0) {
        return { error: { index, reason: 'not_found', anchor: truncate(anchor), message: `replace anchor not found: "${truncate(anchor)}"` } }
      }
      if (count > 1) {
        return { error: { index, reason: 'ambiguous', anchor: truncate(anchor), message: `replace anchor appears ${count} times — must be exactly once: "${truncate(anchor)}"` } }
      }
      return { html: html.replace(anchor, edit.new_string) }
    }
    case 'insert_before': {
      const anchor = edit.anchor
      if (!anchor) {
        return { error: { index, reason: 'invalid_op', anchor: '', message: 'insert_before requires non-empty anchor' } }
      }
      const count = countOccurrences(html, anchor)
      if (count === 0) {
        return { error: { index, reason: 'not_found', anchor: truncate(anchor), message: `insert_before anchor not found: "${truncate(anchor)}"` } }
      }
      if (count > 1) {
        return { error: { index, reason: 'ambiguous', anchor: truncate(anchor), message: `insert_before anchor appears ${count} times — must be exactly once: "${truncate(anchor)}"` } }
      }
      const at = html.indexOf(anchor)
      return { html: `${html.slice(0, at)}${edit.content}${html.slice(at)}` }
    }
    case 'insert_after': {
      const anchor = edit.anchor
      if (!anchor) {
        return { error: { index, reason: 'invalid_op', anchor: '', message: 'insert_after requires non-empty anchor' } }
      }
      const count = countOccurrences(html, anchor)
      if (count === 0) {
        return { error: { index, reason: 'not_found', anchor: truncate(anchor), message: `insert_after anchor not found: "${truncate(anchor)}"` } }
      }
      if (count > 1) {
        return { error: { index, reason: 'ambiguous', anchor: truncate(anchor), message: `insert_after anchor appears ${count} times — must be exactly once: "${truncate(anchor)}"` } }
      }
      const at = html.indexOf(anchor) + anchor.length
      return { html: `${html.slice(0, at)}${edit.content}${html.slice(at)}` }
    }
    case 'delete': {
      const target = edit.target
      if (!target) {
        return { error: { index, reason: 'invalid_op', anchor: '', message: 'delete requires non-empty target' } }
      }
      const count = countOccurrences(html, target)
      if (count === 0) {
        return { error: { index, reason: 'not_found', anchor: truncate(target), message: `delete target not found: "${truncate(target)}"` } }
      }
      if (count > 1) {
        return { error: { index, reason: 'ambiguous', anchor: truncate(target), message: `delete target appears ${count} times — must be exactly once: "${truncate(target)}"` } }
      }
      return { html: html.replace(target, '') }
    }
    default: {
      const op = (edit as { op?: string }).op ?? '<missing>'
      return { error: { index, reason: 'invalid_op', anchor: '', message: `Unknown edit op: ${op}` } }
    }
  }
}

export function applyPatch(html: string, edits: readonly CanvasEdit[]): PatchResult {
  if (!edits.length) {
    return { ok: true, html, applied: 0 }
  }
  let working = html
  const errors: PatchError[] = []
  for (let i = 0; i < edits.length; i++) {
    const result = applyOne(working, edits[i], i)
    if ('error' in result) {
      errors.push(result.error)
      // Atomic: stop on first error.
      break
    }
    working = result.html
  }
  if (errors.length) {
    return { ok: false, html, errors }
  }
  return { ok: true, html: working, applied: edits.length }
}
