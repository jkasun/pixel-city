import { useState, useEffect } from 'react'
import { InstructionField } from '../InstructionField.js'

export function GitInstructionsDialog({ instructions, onSave, onClose }: {
  instructions: string
  onSave: (text: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(instructions)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-bg-popup border-2 border-border shadow-[4px_4px_0px_var(--bg-deep)] w-[480px] max-w-[90%] font-ui text-text-bright animate-[instructions-dialog-in_0.1s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle text-[13px] font-bold tracking-[0.02em]">
          <span>Git Instructions</span>
          <button className="bg-transparent border-none text-text-muted cursor-pointer text-sm px-1.5 py-0.5 font-ui hover:text-text-bright" onClick={onClose}>✕</button>
        </div>
        <p className="px-3.5 pt-2.5 pb-0 m-0 text-[11px] text-text-muted leading-snug">
          These instructions are included when an agent commits code. Define your commit message style, branch rules, and push policies.
        </p>
        <InstructionField
          value={text}
          onChange={setText}
          placeholder="e.g. Use conventional commits. Never push to main directly. Include ticket numbers in commit messages."
          rows={8}
          autoFocus
        />
        <div className="flex justify-end gap-2 px-3.5 py-2.5 border-t border-border-subtle">
          <button className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-bg-hover text-text-muted border-border hover:bg-bg-input hover:text-text-bright" onClick={onClose}>Cancel</button>
          <button className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-accent-dim text-text-bright border-accent hover:brightness-110" onClick={() => onSave(text)}>Save</button>
        </div>
      </div>
    </div>
  )
}
