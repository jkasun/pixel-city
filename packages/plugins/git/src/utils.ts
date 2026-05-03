// ── Language detection (pure, no fs) ────────────────────────────

export function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less',
    html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    sh: 'shell', bash: 'shell', zsh: 'shell', sql: 'sql',
    svelte: 'html', vue: 'html', php: 'php', rb: 'ruby',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    swift: 'swift', kt: 'kotlin', dart: 'dart',
  }
  return map[ext] || 'plaintext'
}

// ── Path utilities (no Node.js path module) ─────────────────────

export function posixBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

export function posixResolve(base: string, relative: string): string {
  if (relative.startsWith('/')) return relative
  const baseParts = base.replace(/\\/g, '/').split('/').filter(Boolean)
  const relParts = relative.replace(/\\/g, '/').split('/').filter(Boolean)
  for (const part of relParts) {
    if (part === '..') baseParts.pop()
    else if (part !== '.') baseParts.push(part)
  }
  const prefix = base.startsWith('/') ? '/' : ''
  return prefix + baseParts.join('/')
}
