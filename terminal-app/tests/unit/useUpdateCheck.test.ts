import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { compareSemver, fetchLatest, parseDownloadUrl } from '../../src/renderer/useUpdateCheck'

describe('compareSemver', () => {
  const cases: Array<[string, string, number]> = [
    ['1.2.1', '1.2.1', 0],
    ['1.2.2', '1.2.1', 1],
    ['1.2.1', '1.2.2', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.3.0', '1.2.99', 1],
    ['1.2.1', '1.2.1-beta', 1],          // release > prerelease at same version
    ['1.2.1-beta', '1.2.1', -1],
    ['1.2.1-beta.2', '1.2.1-beta.1', 1], // prerelease ordering
  ]
  it.each(cases)('cmp(%s, %s) sign = %d', (a, b, want) => {
    expect(Math.sign(compareSemver(a, b))).toBe(want)
  })
})

describe('fetchLatest', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockJsonOk(body: unknown) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body } as Response)
  }

  it('hits /releases/latest on the stable channel and returns the tag stripped of v', async () => {
    mockJsonOk({ tag_name: 'v1.5.0', html_url: 'https://x/r/v1.5.0', prerelease: false, draft: false })
    const info = await fetchLatest('owner/repo', 'stable')
    expect(fetchMock).toHaveBeenCalledOnce()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://api.github.com/repos/owner/repo/releases/latest')
    expect(info).toEqual({ latestVersion: '1.5.0', downloadUrl: 'https://x/r/v1.5.0', isPrerelease: false })
  })

  it('hits /releases?per_page=10 on the prerelease channel and picks highest semver', async () => {
    mockJsonOk([
      { tag_name: 'v1.4.0',     html_url: 'u1', prerelease: false, draft: false },
      { tag_name: 'v1.5.0-rc.1',html_url: 'u2', prerelease: true,  draft: false },
      { tag_name: 'v1.5.0-rc.2',html_url: 'u3', prerelease: true,  draft: false },
      { tag_name: 'v2.0.0-beta',html_url: 'u4', prerelease: true,  draft: false },
    ])
    const info = await fetchLatest('owner/repo', 'prerelease')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo/releases?per_page=10')
    expect(info).toEqual({ latestVersion: '2.0.0-beta', downloadUrl: 'u4', isPrerelease: true })
  })

  it('skips drafts when picking from the prerelease list', async () => {
    mockJsonOk([
      { tag_name: 'v3.0.0', html_url: 'u-draft', prerelease: false, draft: true },
      { tag_name: 'v1.4.0', html_url: 'u-real',  prerelease: false, draft: false },
    ])
    const info = await fetchLatest('o/r', 'prerelease')
    expect(info?.latestVersion).toBe('1.4.0')
    expect(info?.downloadUrl).toBe('u-real')
  })

  it('uses a download URL from the release body marker when present', async () => {
    mockJsonOk({
      tag_name: 'v2.0.0',
      html_url: 'https://github.com/o/r/releases/tag/v2.0.0',
      prerelease: false,
      draft: false,
      body: 'release notes here\n\n<!-- pixelcity:download=https://pixelcity.dev/download/v2.0.0 -->\n\nmore notes',
    })
    const info = await fetchLatest('o/r', 'stable')
    expect(info?.downloadUrl).toBe('https://pixelcity.dev/download/v2.0.0')
  })

  it('returns null when the API responds non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
    const info = await fetchLatest('o/r', 'stable')
    expect(info).toBeNull()
  })

  it('returns null when the prerelease list is empty', async () => {
    mockJsonOk([])
    const info = await fetchLatest('o/r', 'prerelease')
    expect(info).toBeNull()
  })
})

describe('parseDownloadUrl', () => {
  it('returns the marker URL when present', () => {
    expect(parseDownloadUrl('intro\n<!-- pixelcity:download=https://x/y -->\nrest', 'fallback'))
      .toBe('https://x/y')
  })
  it('is case-insensitive on the marker prefix', () => {
    expect(parseDownloadUrl('<!-- PixelCity:Download=https://x/y -->', 'fallback'))
      .toBe('https://x/y')
  })
  it('returns the fallback when the marker is missing', () => {
    expect(parseDownloadUrl('just normal release notes', 'https://gh/r')).toBe('https://gh/r')
  })
  it('returns the fallback when the body is empty or null', () => {
    expect(parseDownloadUrl('', 'https://gh/r')).toBe('https://gh/r')
    expect(parseDownloadUrl(null, 'https://gh/r')).toBe('https://gh/r')
    expect(parseDownloadUrl(undefined, 'https://gh/r')).toBe('https://gh/r')
  })
})
