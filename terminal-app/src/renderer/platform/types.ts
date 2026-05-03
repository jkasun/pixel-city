// ── Platform Bridge Types ───────────────────────────────────────────
// Abstracts platform-specific operations (Electron IPC, WebSocket RPC,
// or direct HTTP) behind a unified interface. Each app (terminal-app,
// web-app) provides its own implementation.
//
// Grouped by functional domain so sub-bridges can be implemented
// independently and stubbed individually for testing.

// ── Config ──────────────────────────────────────────────────────────

export interface ConfigBridge {
  /** Load project config. Returns the full config object. */
  load(projectDir: string): Promise<Record<string, unknown>>

  /** Save (merge) config values for a project. */
  save(projectDir: string, config: Record<string, unknown>): Promise<void>

  /** Resolve instruction file references (e.g. world-instructions.md). */
  resolveInstructions(projectDir: string, context: Record<string, unknown>): Promise<string>

  /** Read level-1 memory for an employee. */
  readMemory(employeeId: string): Promise<string>

  /** Read mempalace wake-up context for an employee (status, diary, recent drawers). */
  readMempalace(projectDir: string, employeeId: string): Promise<{
    success: boolean
    status: { total_drawers: number; wings: Record<string, number> } | null
    diary: Array<{ date: string; topic: string; content: string }>
    recent_drawers: Array<{ room: string; filed_at: string; content: string }>
  }>

  /** Load office instructions from `.pixelcity/office-instructions.md`. */
  loadOfficeInstructions(projectDir: string | null | undefined): Promise<{ content: string; path: string }>

  /** Save office instructions to `.pixelcity/office-instructions.md`. */
  saveOfficeInstructions(projectDir: string | null | undefined, content: string): Promise<{ path: string }>

  /** Open the office instructions file in the OS default editor. */
  openOfficeInstructionsFile(projectDir: string | null | undefined): Promise<{ path: string }>

  /** Load city configuration from `~/.pixelcity/city-configuration.md`. */
  loadCityConfiguration(): Promise<{ content: string; path: string }>

  /** Save city configuration to `~/.pixelcity/city-configuration.md`. */
  saveCityConfiguration(content: string): Promise<{ path: string }>

  /** Load canvas preferences from `~/.pixelcity/canvas-preferences.md`. */
  loadCanvasPreferences(): Promise<{ content: string; path: string }>

  /** Save canvas preferences to `~/.pixelcity/canvas-preferences.md`. */
  saveCanvasPreferences(content: string): Promise<{ path: string }>
}

// ── Dialog ──────────────────────────────────────────────────────────

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface DialogBridge {
  /** Show native folder picker. Returns selected path or null if cancelled. */
  openFolder(): Promise<string | null>

  /** Show native file picker. Returns selected path or null if cancelled. */
  openFile(opts?: { title?: string; filters?: FileFilter[] }): Promise<string | null>
}

// ── Settings ────────────────────────────────────────────────────────

export interface TerminalSettings {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
}

export interface EditorSettings {
  fontSize: number
  tabSize: number
  wordWrap: boolean
}

export interface SettingsBridge {
  /** Push settings changes to the platform. */
  update(settings: Record<string, unknown>): void

  /** Listen for settings changes from other sources. Returns unsubscribe. */
  onChange(cb: (settings: Record<string, unknown>) => void): () => void
}

// ── Auth ─────────────────────────────────────────────────────────────

export interface AuthBridge {
  /** Start OAuth flow. Returns the auth callback data. */
  startOAuth(url: string): Promise<Record<string, string>>

  /** Listen for OAuth callback (Electron deep link). Returns unsubscribe. */
  onAuthCallback(cb: (data: Record<string, string>) => void): () => void
}

// ── Notifications ───────────────────────────────────────────────────

export interface NotificationBridge {
  /** Show a system notification. */
  send(title: string, body: string): Promise<void>
}

// ── App / Shell ─────────────────────────────────────────────────────

export interface AppBridge {
  /** Get app version string. */
  getVersion(): Promise<string>

  /** Open external URL in default browser. */
  openExternal(url: string): Promise<void>

  /** Open the settings window/panel. */
  openSettings(): Promise<void>

  /** Focus the main window. */
  focusMain(): Promise<void>

  /** Check if a CLI command exists on PATH. */
  checkCommandExists(command: string): Promise<boolean>
}

// ── Building Directory ──────────────────────────────────────────────

export interface BuildingBridge {
  /** Load all building → directory mappings. */
  loadDirs(): Promise<Record<string, string>>

  /** Set working directory for a building. */
  setDir(buildingUid: string, workingDir: string): Promise<void>

  /** Remove directory mapping for a building. */
  removeDir(buildingUid: string): Promise<void>

  /** Check if a directory exists. */
  dirExists(dirPath: string): Promise<boolean>
}

// ── Workspace ───────────────────────────────────────────────────────

export interface WorkspaceBridge {
  /**
   * Write `.mcp.json` and the codex `config.toml` for a project so spawned
   * agents discover Pixel City's MCP servers. Content references the shared
   * launcher at `~/.pixelcity/mcp-launcher.cjs` and is identical between dev
   * and prod, so concurrent writes don't conflict. Per-agent identity is
   * delivered via the system prompt, not via env blocks here.
   */
  ensureMcpConfig(projectDir: string): Promise<void>
}

// ── Usage / Billing ─────────────────────────────────────────────────

export interface UsageBridge {
  /** Get Claude usage statistics (from ~/.claude/stats-cache.json). */
  getStats(): Promise<Record<string, unknown>>

  /**
   * Get Claude plan/quota info by scraping `/usage` from a short-lived
   * Claude Code PTY. Pass a `configDir` to target a specific subscription
   * (e.g. a building-scoped CLAUDE_CONFIG_DIR). Pass `force` to bypass
   * the in-memory cache.
   */
  getPlan(opts?: { configDir?: string; force?: boolean }): Promise<Record<string, unknown>>
}

// ── PTY (for shell terminals not managed by ExecutionBackend) ───────

export interface PtyBridge {
  /** Create a new PTY shell. Returns the PTY ID. */
  create(opts: {
    shell?: string
    cwd?: string
    cols?: number
    rows?: number
    env?: Record<string, string>
  }): Promise<number>

  /** Send input to a PTY. */
  input(ptyId: number, data: string): void

  /** Resize a PTY. */
  resize(ptyId: number, cols: number, rows: number): void

  /** Kill a PTY. */
  kill(ptyId: number): void

  /** Listen for PTY output. Returns unsubscribe. */
  onOutput(ptyId: number, cb: (data: string) => void): () => void

  /** Listen for PTY exit. Returns unsubscribe. */
  onExit(ptyId: number, cb: (exitCode: number) => void): () => void
}

// ── File System ────────────────────────────────────────────────────

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modified: number
}

export interface FsListResult {
  path: string
  entries: FsEntry[]
}

export interface FileSystemBridge {
  /** List directory contents. */
  list(dirPath: string, opts?: { showHidden?: boolean }): Promise<FsListResult>

  /** Read file content as UTF-8. */
  readFile(filePath: string): Promise<{ content: string; size: number }>

  /** Write file content. */
  writeFile(filePath: string, content: string): Promise<void>

  /** Create a file or directory. */
  create(targetPath: string, isDirectory: boolean): Promise<void>

  /** Delete a file or directory. */
  delete(targetPath: string): Promise<void>

  /** Rename a file or directory. */
  rename(oldPath: string, newPath: string): Promise<void>

  /** Get file/directory info. */
  stat(targetPath: string): Promise<FsEntry>

  /** Get git status for a directory (short format). */
  gitStatus(cwd: string): Promise<Array<{ status: string; path: string }>>

  /** List files via git ls-files (respects .gitignore). */
  gitFiles(cwd: string): Promise<string[]>

  /** Get current git branch. */
  gitBranch(cwd: string): Promise<string | null>

  /** Watch directory for changes. Returns unsubscribe function. */
  watch?(dirPath: string, cb: (event: string, filename: string) => void): () => void

  /** Copy text to clipboard. */
  copyToClipboard?(text: string): void

  /** Reveal file in system file manager. */
  revealInFileManager?(filePath: string): void
}

// ── The Full Bridge ─────────────────────────────────────────────────

export interface PlatformBridge {
  readonly config: ConfigBridge
  readonly dialog: DialogBridge
  readonly settings: SettingsBridge
  readonly auth: AuthBridge
  readonly notification: NotificationBridge
  readonly app: AppBridge
  readonly building: BuildingBridge
  readonly workspace: WorkspaceBridge
  readonly usage: UsageBridge
  readonly pty: PtyBridge
  readonly fs: FileSystemBridge
}
