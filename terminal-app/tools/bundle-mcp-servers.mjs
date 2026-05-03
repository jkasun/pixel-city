#!/usr/bin/env node
/**
 * Bundle registered MCP server files and copy the registry + system-prompts.
 * Only bundles servers listed in mcp-server/registry.json (the source of truth).
 */
import { readFileSync, readdirSync, mkdirSync, copyFileSync } from 'fs'
import { execSync } from 'child_process'
import { resolve, join } from 'path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const serversDir = join(ROOT, 'mcp-server', 'servers')
const outDir = 'dist/mcp-server/servers'

// Clean and recreate output directory
execSync(`rm -rf dist/mcp-server`)
mkdirSync(outDir, { recursive: true })

// Read registry — only bundle registered servers
const registry = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'registry.json'), 'utf8'))
const registeredFiles = new Set(registry.servers.map(s => s.file + '.js'))

const allFiles = readdirSync(serversDir).filter(f => f.endsWith('.js'))
const skipped = allFiles.filter(f => !registeredFiles.has(f))
if (skipped.length > 0) {
  console.log(`Skipping unregistered servers: ${skipped.join(', ')}`)
}

const files = allFiles.filter(f => registeredFiles.has(f))

for (const file of files) {
  const name = file.replace('.js', '')
  const src = join(serversDir, file)
  const out = join(outDir, `${name}.cjs`)
  // PIXEL_CITY_WS_URL is injected at spawn time by the launcher (mcp-server/launcher.cjs);
  // we deliberately do NOT bake it into the bundle so the launcher is authoritative.
  execSync(
    `npx esbuild ${src} --bundle --platform=node --format=cjs --target=node18 ` +
    `--outfile=${out} ` +
    `--banner:js="var import_meta_url = require('url').pathToFileURL(__filename).href;" ` +
    `--define:import.meta.url=import_meta_url`,
    { stdio: 'inherit' }
  )
}

// Copy registry.json so it's available at runtime in packaged app
copyFileSync(
  join(ROOT, 'mcp-server', 'registry.json'),
  join('dist', 'mcp-server', 'registry.json')
)

// Copy launcher.cjs so the packaged app can install it to ~/.pixelcity at runtime
copyFileSync(
  join(ROOT, 'mcp-server', 'launcher.cjs'),
  join('dist', 'mcp-server', 'launcher.cjs')
)

// Copy system-prompts so meeting guidelines are available in packaged app
const sysPromptsDir = join(ROOT, 'terminal-app', 'system-prompts')
const outSysPrompts = join('dist', 'mcp-server', 'system-prompts')
mkdirSync(outSysPrompts, { recursive: true })
const promptFiles = readdirSync(sysPromptsDir).filter(f => f.endsWith('.md'))
for (const f of promptFiles) {
  copyFileSync(join(sysPromptsDir, f), join(outSysPrompts, f))
}

console.log(`Bundled ${files.length} MCP servers + registry.json + ${promptFiles.length} system-prompts`)
