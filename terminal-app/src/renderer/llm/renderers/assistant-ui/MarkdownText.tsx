// ── Markdown Text Renderer ──────────────────────────────────────────
// Renders assistant text as markdown using the marked library
// (already a dependency in terminal-app). Falls back to plain text.

import React, { useMemo, type FC } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

interface MarkdownTextProps {
  text: string
}

export const MarkdownText: FC<MarkdownTextProps> = ({ text }) => {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
      return DOMPurify.sanitize(raw)
    } catch {
      return null
    }
  }, [text])

  if (!html) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
  }

  return (
    <div
      className="aui-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
