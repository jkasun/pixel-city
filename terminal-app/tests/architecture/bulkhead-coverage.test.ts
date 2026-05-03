/**
 * Architectural test: bulkhead coverage.
 *
 * Step 9 of the bulkhead/observability plan. Asserts that the panels we
 * decided to wrap in <Bulkhead> in Step 4 stay wrapped — accidental removal
 * of a Bulkhead during a refactor should fail this test.
 *
 * Approach: ALLOW-LIST assertion (not regex JSX parsing). The previous
 * iteration tried a heuristic regex over the JSX tree and was too noisy on
 * conditional renderings (`{cond && <Bulkhead>...</Bulkhead>}`). The
 * allow-list assertion is simpler, deterministic, and catches the failure
 * mode we actually care about: someone deletes or renames a Bulkhead.
 *
 * For App.tsx we assert the layout-root contains the expected top-level
 * panel components by name. App.tsx itself does not render <Bulkhead>
 * directly — the bulkheads live inside the panel components it composes
 * (PluginPanel, AgentPanel and their descendants).
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

describe('Bulkhead coverage', () => {
  it('OfficeApp.tsx wraps every expected compartment in <Bulkhead>', () => {
    const src = read('src/renderer/OfficeApp.tsx')
    // These names correspond to the compartments declared in Step 4.
    // If you intentionally remove or rename one, update this list AND
    // confirm the panel is still inside *some* Bulkhead.
    const expected = [
      'office-canvas',
      'character-picker',
      'floor-generator',
      'editor-toolbar',
      'make-permanent-modal',
      'fire-confirm-modal',
    ]
    const missing: string[] = []
    for (const name of expected) {
      if (!src.includes(`<Bulkhead name="${name}"`)) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  it('OfficeApp.tsx imports the Bulkhead primitive', () => {
    const src = read('src/renderer/OfficeApp.tsx')
    expect(src).toMatch(/from\s+['"]\.\/Bulkhead(\.js)?['"]/)
  })

  it('App.tsx layout root composes the expected top-level panels', () => {
    // App.tsx renders the high-level shell; bulkhead enforcement happens
    // inside the panel components it composes. We still assert their
    // presence so an accidental delete of a panel surfaces here.
    const src = read('src/renderer/App.tsx')
    const expectedComponents = [
      'Toolbar',
      'PluginPanel',
      'AgentPanel',
      'StatusBar',
      'SettingsModal',
    ]
    const missing: string[] = []
    for (const name of expectedComponents) {
      if (!new RegExp(`<${name}\\b`).test(src)) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  it('Bulkhead primitive itself exists and exports the expected component', () => {
    const src = read('src/renderer/Bulkhead.tsx')
    expect(src).toMatch(/export\s+function\s+Bulkhead\b/)
    // Must accept a `name` prop — the architectural contract for tagged
    // compartments (used by logging + DegradedPanel title).
    expect(src).toMatch(/name\s*:\s*string/)
  })
})
