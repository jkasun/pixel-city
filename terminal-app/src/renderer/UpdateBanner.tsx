import { useUpdateCheck } from './useUpdateCheck.js'
import { APP_VERSION } from '../version.js'

export function UpdateBanner() {
  const { update, dismiss } = useUpdateCheck()
  if (!update) return null

  const open = () => {
    try {
      const electron = (window as any).require?.('electron')
      electron?.shell?.openExternal?.(update.downloadUrl)
    } catch {
      window.open(update.downloadUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      data-testid="update-banner"
      className="flex items-center justify-between gap-3 px-3 py-1 bg-accent/15 border-b border-accent/30 text-[11px] text-text"
    >
      <span>
        Pixel City <span className="font-mono">v{update.latestVersion}</span>
        {update.isPrerelease && <span className="ml-1 text-text-muted">(prerelease)</span>}
        {' '}is available — you have <span className="font-mono">v{APP_VERSION}</span>.
      </span>
      <span className="flex items-center gap-2">
        <button
          onClick={open}
          className="px-2 py-px rounded-[3px] bg-accent/30 hover:bg-accent/50 transition-colors text-text"
        >
          Download
        </button>
        <button
          onClick={dismiss}
          className="px-2 py-px rounded-[3px] hover:bg-bg-hover transition-colors text-text-muted"
          title="Dismiss until next version"
        >
          ✕
        </button>
      </span>
    </div>
  )
}
