import { useEffect, useState } from 'react'
import { config } from '../config.js'
import { APP_VERSION } from '../version.js'

export interface UpdateInfo {
  latestVersion: string
  /** Where the Download button points. Defaults to the GitHub release page; */
  /** can be overridden per-release with `<!-- pixelcity:download=URL -->` in the release body. */
  downloadUrl: string
  isPrerelease: boolean
}

interface GhRelease {
  tag_name: string
  html_url: string
  body?: string
  prerelease: boolean
  draft: boolean
}

const DOWNLOAD_MARKER = /<!--\s*pixelcity:download=([^\s>]+)\s*-->/i

export function parseDownloadUrl(body: string | undefined | null, fallback: string): string {
  if (!body) return fallback
  const match = body.match(DOWNLOAD_MARKER)
  return match ? match[1] : fallback
}

const DISMISSED_KEY = 'pixelcity:updateBannerDismissedFor'

function stripV(tag: string): string {
  return tag.replace(/^v/, '')
}

// Lightweight semver compare. Handles `1.2.3` and `1.2.3-beta.1`.
// Returns >0 if a > b, <0 if a < b, 0 if equal.
export function compareSemver(a: string, b: string): number {
  const [aMain, aPre = ''] = a.split('-')
  const [bMain, bPre = ''] = b.split('-')
  const aParts = aMain.split('.').map(n => parseInt(n, 10) || 0)
  const bParts = bMain.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff
  }
  // Same major.minor.patch — a release without prerelease tag wins over one with.
  if (!aPre && bPre) return 1
  if (aPre && !bPre) return -1
  if (aPre === bPre) return 0
  return aPre > bPre ? 1 : -1
}

export async function fetchLatest(repo: string, channel: 'stable' | 'prerelease'): Promise<UpdateInfo | null> {
  const base = `https://api.github.com/repos/${repo}/releases`
  const url = channel === 'prerelease' ? `${base}?per_page=10` : `${base}/latest`
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } })
  if (!res.ok) return null
  const data = await res.json()

  let release: GhRelease | null = null
  if (Array.isArray(data)) {
    // prerelease channel: highest by semver, skipping drafts
    const candidates = (data as GhRelease[]).filter(r => !r.draft)
    candidates.sort((a, b) => compareSemver(stripV(b.tag_name), stripV(a.tag_name)))
    release = candidates[0] ?? null
  } else {
    release = data as GhRelease
  }
  if (!release) return null
  return {
    latestVersion: stripV(release.tag_name),
    downloadUrl: parseDownloadUrl(release.body, release.html_url),
    isPrerelease: release.prerelease,
  }
}

export function useUpdateCheck(): { update: UpdateInfo | null; dismiss: () => void } {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    const cfg = config.update
    if (!cfg.enabled) return

    // Mock mode: short-circuit the fetch and ignore dismissal state so the
    // banner is always visible while testing.
    if (cfg.mockLatestVersion) {
      setUpdate({
        latestVersion: cfg.mockLatestVersion,
        downloadUrl: cfg.mockDownloadUrl ?? `https://github.com/${cfg.repo}/releases`,
        isPrerelease: false,
      })
      return
    }

    let cancelled = false
    fetchLatest(cfg.repo, cfg.channel)
      .then(info => {
        if (cancelled || !info) return
        if (compareSemver(info.latestVersion, APP_VERSION) <= 0) return
        try {
          if (localStorage.getItem(DISMISSED_KEY) === info.latestVersion) return
        } catch {}
        setUpdate(info)
      })
      .catch(() => { /* silent — update check is best-effort */ })
    return () => { cancelled = true }
  }, [])

  const dismiss = () => {
    if (update) {
      try { localStorage.setItem(DISMISSED_KEY, update.latestVersion) } catch {}
    }
    setUpdate(null)
  }

  return { update, dismiss }
}
