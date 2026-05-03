// ── Types ────────────────────────────────────────────────────────

export type GitStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | null

export interface FileNode {
  id: string
  name: string
  children?: FileNode[]
  isFolder: boolean
}

export type MediaType = 'image' | 'pdf' | 'video' | 'audio' | null

export interface OpenTab {
  path: string
  name: string
  content: string
  modified: boolean
  mediaType?: MediaType
}

// ── Constants ────────────────────────────────────────────────────

export const IGNORED = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', 'build', '.next',
  '.cache', 'coverage', '__pycache__', '.turbo', '.vercel',
])

export const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql', graphql: 'graphql', toml: 'toml',
  svelte: 'html', vue: 'html', php: 'php', rb: 'ruby',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  swift: 'swift', kt: 'kotlin', dart: 'dart',
  dockerfile: 'dockerfile', makefile: 'makefile',
}

export const GIT_STATUS_COLORS: Record<string, string> = {
  modified: 'var(--git-modified)',
  added: 'var(--git-added)',
  untracked: 'var(--git-added)',
  deleted: 'var(--git-deleted)',
  renamed: 'var(--git-added)',
}

export const SPECIAL_FOLDER_COLORS: Record<string, string> = {
  src: '#42a5f5',
  lib: '#42a5f5',
  app: '#42a5f5',
  components: '#7e57c2',
  hooks: '#7e57c2',
  utils: '#7e57c2',
  helpers: '#7e57c2',
  types: '#7e57c2',
  styles: '#e91e90',
  css: '#e91e90',
  assets: '#ffa726',
  images: '#ffa726',
  public: '#ffa726',
  static: '#ffa726',
  config: '#78909c',
  scripts: '#78909c',
  test: '#66bb6a',
  tests: '#66bb6a',
  __tests__: '#66bb6a',
  spec: '#66bb6a',
  docs: '#26c6da',
  api: '#ef5350',
  routes: '#ef5350',
  pages: '#42a5f5',
  renderer: '#42a5f5',
  main: '#42a5f5',
}

export const FILE_ICON_MAP: Record<string, { color: string; letter: string }> = {
  ts:     { color: '#3178c6', letter: 'TS' },
  tsx:    { color: '#3178c6', letter: 'TX' },
  js:     { color: '#f7df1e', letter: 'JS' },
  jsx:    { color: '#61dafb', letter: 'JX' },
  mjs:    { color: '#f7df1e', letter: 'JS' },
  cjs:    { color: '#f7df1e', letter: 'JS' },
  json:   { color: '#fbc02d', letter: '{}' },
  css:    { color: '#42a5f5', letter: '#' },
  scss:   { color: '#cd6799', letter: 'S' },
  less:   { color: '#1d365d', letter: 'L' },
  html:   { color: '#e44d26', letter: '<>' },
  xml:    { color: '#e44d26', letter: '<>' },
  md:     { color: '#42a5f5', letter: 'M' },
  mdx:    { color: '#f9ac00', letter: 'MX' },
  py:     { color: '#3572a5', letter: 'Py' },
  rs:     { color: '#dea584', letter: 'Rs' },
  go:     { color: '#00add8', letter: 'Go' },
  java:   { color: '#b07219', letter: 'J' },
  kt:     { color: '#a97bff', letter: 'Kt' },
  swift:  { color: '#f05138', letter: 'Sw' },
  dart:   { color: '#00b4ab', letter: 'D' },
  rb:     { color: '#cc342d', letter: 'Rb' },
  php:    { color: '#777bb3', letter: 'P' },
  c:      { color: '#555555', letter: 'C' },
  cpp:    { color: '#f34b7d', letter: 'C+' },
  h:      { color: '#555555', letter: 'H' },
  hpp:    { color: '#f34b7d', letter: 'H' },
  sh:     { color: '#89e051', letter: '$' },
  bash:   { color: '#89e051', letter: '$' },
  zsh:    { color: '#89e051', letter: '$' },
  sql:    { color: '#e38c00', letter: 'SQ' },
  graphql:{ color: '#e10098', letter: 'GQ' },
  yaml:   { color: '#cb171e', letter: 'Y' },
  yml:    { color: '#cb171e', letter: 'Y' },
  toml:   { color: '#9c4221', letter: 'T' },
  svg:    { color: '#ffb13b', letter: 'SV' },
  png:    { color: '#a074c4', letter: '' },
  jpg:    { color: '#a074c4', letter: '' },
  jpeg:   { color: '#a074c4', letter: '' },
  gif:    { color: '#a074c4', letter: '' },
  webp:   { color: '#a074c4', letter: '' },
  ico:    { color: '#a074c4', letter: '' },
  mp4:    { color: '#e57373', letter: '' },
  webm:   { color: '#e57373', letter: '' },
  mov:    { color: '#e57373', letter: '' },
  avi:    { color: '#e57373', letter: '' },
  mkv:    { color: '#e57373', letter: '' },
  mp3:    { color: '#ba68c8', letter: '' },
  wav:    { color: '#ba68c8', letter: '' },
  flac:   { color: '#ba68c8', letter: '' },
  aac:    { color: '#ba68c8', letter: '' },
  m4a:    { color: '#ba68c8', letter: '' },
  ogg:    { color: '#ba68c8', letter: '' },
  pdf:    { color: '#e53935', letter: 'PD' },
  lock:   { color: '#6d8086', letter: '' },
  log:    { color: '#6d8086', letter: '' },
  env:    { color: '#fbc02d', letter: '' },
  vue:    { color: '#41b883', letter: 'V' },
  svelte: { color: '#ff3e00', letter: 'S' },
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif', 'tiff', 'tif'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'])

export function getMediaType(filename: string): MediaType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  return null
}

export function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_MAP[ext] || 'plaintext'
}

export function getFolderColor(name: string): string {
  return SPECIAL_FOLDER_COLORS[name.toLowerCase()] || '#90a4ae'
}

export function getFileIconData(ext: string, lowerName: string): { color: string; letter: string } {
  // Special filenames
  if (lowerName === 'package.json') return { color: '#66bb6a', letter: 'N' }
  if (lowerName === 'tsconfig.json') return { color: '#3178c6', letter: 'TS' }
  if (lowerName === '.gitignore') return { color: '#f54d27', letter: '' }
  if (lowerName === 'dockerfile') return { color: '#2496ed', letter: 'D' }
  if (lowerName === 'makefile') return { color: '#6d8086', letter: 'M' }
  if (lowerName === '.env' || lowerName.startsWith('.env.')) return { color: '#fbc02d', letter: '' }
  if (lowerName === 'readme.md') return { color: '#42a5f5', letter: '' }
  if (lowerName === 'license' || lowerName === 'license.md') return { color: '#ffa726', letter: '' }
  if (lowerName.endsWith('.config.ts') || lowerName.endsWith('.config.js')) return { color: '#78909c', letter: '' }

  return FILE_ICON_MAP[ext] || { color: '#6d8086', letter: '' }
}
