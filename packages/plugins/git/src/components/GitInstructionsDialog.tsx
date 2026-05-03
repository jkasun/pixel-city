import { useState, useEffect, useRef } from 'react'

export function GitInstructionsDialog({ instructions, onSave, onClose }: {
  instructions: string
  onSave: (text: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(instructions)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div data-testid="git-instructions-dialog" className="absolute inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-bg-popup border-2 border-border shadow-[4px_4px_0px_var(--bg-deep)] w-[480px] max-w-[90%] font-ui text-text-bright animate-[instructions-dialog-in_0.1s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle text-[13px] font-bold tracking-[0.02em]">
          <span>Git Instructions</span>
          <button data-testid="git-instructions-close" className="bg-transparent border-none text-text-muted cursor-pointer text-sm px-1.5 py-0.5 font-ui hover:text-text-bright" onClick={onClose}>&times;</button>
        </div>
        <p className="px-3.5 pt-2.5 pb-0 m-0 text-[11px] text-text-muted leading-snug">
          These instructions are included when an agent commits code. Define your commit message style, branch rules, and push policies.
        </p>
        <div className="px-3.5 py-2.5">
          <textarea
            ref={textareaRef}
            data-testid="git-instructions-textarea"
            className="w-full bg-bg-input border border-border text-text text-[12px] font-ui p-2.5 rounded resize-y outline-none box-border focus:border-accent placeholder:text-text-dim placeholder:opacity-50"
            rows={8}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="e.g. Use conventional commits. Never push to main directly. Include ticket numbers in commit messages."
          />
        </div>
        <div className="flex justify-end gap-2 px-3.5 py-2.5 border-t border-border-subtle">
          <button data-testid="git-instructions-cancel" className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-bg-hover text-text-muted border-border hover:bg-bg-input hover:text-text-bright" onClick={onClose}>Cancel</button>
          <button data-testid="git-instructions-save" className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-accent-dim text-text-bright border-accent hover:brightness-110" onClick={() => onSave(text)}>Save</button>
        </div>
      </div>
    </div>
  )
}
