import { useState, useRef, useEffect } from 'react'
import { platform } from './platform/index.js'

// Reusable instruction field with text/file toggle
export function InstructionField({ value, onChange, placeholder, rows = 6, autoFocus = false }: {
  value: string
  onChange: (val: string) => void
  placeholder: string
  rows?: number
  autoFocus?: boolean
}) {
  const isFile = value.trim().endsWith('.md')
  const [mode, setMode] = useState<'text' | 'file'>(isFile ? 'file' : 'text')
  const [stashedText, setStashedText] = useState(isFile ? '' : value)
  const [stashedFile, setStashedFile] = useState(isFile ? value : '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  const handleBrowse = async () => {
    try {
      const filePath = await platform().dialog.openFile({
        title: 'Select Markdown File',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (filePath) {
        setStashedFile(filePath)
        onChange(filePath)
      }
    } catch (err) {
      console.error('[InstructionField] Failed to open file dialog:', err)
    }
  }

  const switchToText = () => {
    if (mode === 'text') return
    setStashedFile(value)
    setMode('text')
    onChange(stashedText)
  }

  const switchToFile = () => {
    if (mode === 'file') return
    setStashedText(value)
    setMode('file')
    onChange(stashedFile)
  }

  return (
    <>
      <div className="flex mt-2 mx-3.5">
        <button
          className={`py-1 px-3.5 text-[11px] font-ui border border-border cursor-pointer border-r-0 ${mode === 'text' ? 'bg-accent-dim text-accent border-accent' : 'bg-bg-hover text-text-muted hover:bg-bg-input hover:text-text-dim'}`}
          onClick={switchToText}
        >Text</button>
        <button
          className={`py-1 px-3.5 text-[11px] font-ui border border-border cursor-pointer ${mode === 'file' ? 'bg-accent-dim text-accent border-accent' : 'bg-bg-hover text-text-muted hover:bg-bg-input hover:text-text-dim'}`}
          onClick={switchToFile}
        >MD File</button>
      </div>
      {mode === 'text' ? (
        <textarea
          ref={textareaRef}
          className="block w-[calc(100%-28px)] mx-3.5 my-2.5 px-2.5 py-2 bg-bg-input border border-border text-text font-ui text-xs leading-relaxed resize-y min-h-[80px] focus:outline-none focus:border-accent placeholder:text-text-muted"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      ) : (
        <div className="flex gap-1.5 mx-3.5 my-2.5">
          <input
            type="text"
            className="flex-1 px-2.5 py-1.5 bg-bg-input border border-border text-text font-ui text-xs focus:outline-none focus:border-accent placeholder:text-text-muted"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="path/to/instructions.md"
          />
          <button className="py-1 px-3 text-[11px] font-ui bg-bg-hover border border-border text-text-dim cursor-pointer hover:bg-bg-input hover:text-text-bright" onClick={handleBrowse}>Browse</button>
        </div>
      )}
    </>
  )
}
