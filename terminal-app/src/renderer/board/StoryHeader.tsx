import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Task } from './boardTypes'

marked.setOptions({ breaks: true, gfm: true })

interface StoryHeaderProps {
  story: Task
  onUpdate: (updates: Partial<Task>) => void
}

export function StoryHeader({ story, onUpdate }: StoryHeaderProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [description, setDescription] = useState(story.description ?? '')
  const descHtml = useMemo(() => DOMPurify.sanitize(marked.parse(description || '') as string), [description])

  useEffect(() => {
    setDescription(story.description ?? '')
  }, [story.description])

  const handleDescBlur = useCallback(() => {
    const trimmed = description.trim()
    if (trimmed !== (story.description ?? '')) {
      onUpdate({ description: trimmed || undefined })
    }
    setEditingDesc(false)
  }, [description, story.description, onUpdate])

  return (
    <div data-testid="board-story-header" className="border-b border-border bg-[var(--bg-sidebar)]">
      <div data-testid="board-story-header-toggle" className="flex items-center gap-1.5 px-3 py-[5px] cursor-pointer text-[10px] text-text-dim select-none hover:text-text hover:bg-white/[0.02]" onClick={() => setExpanded(v => !v)}>
        <span className="text-[9px] w-[10px]">{expanded ? '▾' : '▸'}</span>
        <span className="font-semibold text-text text-[10px]">Story Details</span>
      </div>
      {expanded && (
        <div className="px-3 pt-1 pb-2.5 flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-[8px] uppercase tracking-[0.1em] text-text-dim">Description</label>
              <button
                className="bg-none border border-border text-text-dim font-[inherit] text-[8px] px-2 py-0.5 rounded-[3px] cursor-pointer transition-all duration-[0.12s] hover:text-text hover:border-text-dim"
                onClick={() => setEditingDesc(v => !v)}
              >{editingDesc ? 'Preview' : 'Edit'}</button>
            </div>
            {editingDesc ? (
              <textarea
                className="bg-white/[0.03] border border-border rounded-[4px] text-text font-[inherit] text-[10.5px] leading-[1.5] p-2 resize-y outline-none caret-accent min-h-[60px] transition-[border-color] duration-[0.12s] placeholder:text-text-dim focus:border-accent-dim"
                value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={handleDescBlur}
                placeholder="Add a story description (markdown supported)..."
                rows={5}
                autoFocus
              />
            ) : (
              description ? (
                <div
                  className="bg-white/[0.03] border border-border rounded-[4px] px-3 py-[10px] text-[10.5px] leading-[1.6] text-text min-h-[80px] overflow-y-auto max-h-[300px] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px] [&_p]:mb-2 [&_p:last-child]:mb-0 [&_h1]:text-text-bright [&_h1]:mb-1.5 [&_h1]:text-[14px] [&_h1]:font-semibold [&_h2]:text-text-bright [&_h2]:mb-1.5 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h3]:text-text-bright [&_h3]:mb-1.5 [&_h3]:text-[11px] [&_h3]:font-semibold [&_ul]:mb-2 [&_ul]:pl-[18px] [&_ol]:mb-2 [&_ol]:pl-[18px] [&_li]:mb-0.5 [&_code]:bg-white/[0.06] [&_code]:px-1 [&_code]:rounded-[3px] [&_code]:text-[10px] [&_pre]:bg-black/30 [&_pre]:rounded-[4px] [&_pre]:p-2 [&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-accent-dim [&_blockquote]:mb-2 [&_blockquote]:py-0.5 [&_blockquote]:px-2.5 [&_blockquote]:text-text-muted [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline [&_hr]:border-none [&_hr]:border-t [&_hr]:border-border [&_hr]:my-2"
                  dangerouslySetInnerHTML={{ __html: descHtml }}
                />
              ) : (
                <div
                  className="text-[10px] text-text-dim cursor-pointer py-1 italic hover:text-text"
                  onClick={() => setEditingDesc(true)}
                >No description — click Edit to add one</div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
