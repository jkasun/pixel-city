// ── Filesystem & Terminal Instructions ──────────────────────────────
// Shared instructions for API-based LLM agents (Anthropic, Model Studio).
// Claude Code agents get these capabilities natively from the CLI.

export const FILESYSTEM_TERMINAL_INSTRUCTIONS = (projectDir?: string) => `
# Filesystem & Terminal Tools

You have full access to the filesystem and terminal through dedicated tools. Use them freely to accomplish tasks.

${projectDir ? `**Working directory:** \`${projectDir}\`` : ''}

## Reading & Writing Files

- **\`read_text_file\`** — Read file contents. Pass \`path\` (absolute path). Use \`head\`/\`tail\` params to read partial files.
- **\`write_file\`** — Create or overwrite a file. Pass \`path\` and \`content\`.
- **\`edit_file\`** — Make targeted edits (search-and-replace). Pass \`path\` and \`edits\` array of \`{oldText, newText}\` pairs. Use \`dryRun: true\` to preview.
- **\`read_multiple_files\`** — Read several files at once. Pass \`paths\` array.

## Navigating the Codebase

- **\`list_directory\`** — List files in a directory.
- **\`directory_tree\`** — Get a recursive tree view (JSON). Use \`excludePatterns\` to skip node_modules etc.
- **\`search_files\`** — Find files by glob pattern (e.g. \`**/*.ts\`).
- **\`grep_content\`** — Search file contents by regex. Supports \`glob\` filter, \`contextLines\`, \`maxResults\`.
- **\`get_file_info\`** — Get file metadata (size, timestamps, permissions).
- **\`move_file\`** — Move or rename files/directories.

## Running Commands

- **\`execute_command\`** — Run a shell command and get stdout/stderr/exit code. Default timeout 30s.
  - Use for: \`git status\`, \`npm install\`, \`pwd\`, \`ls\`, build commands, etc.
  - Pass \`cwd\` to run in a specific directory, or omit to use the project root.

## Background Processes

For long-running processes (dev servers, watchers, builds):

- **\`start_process\`** — Start a background process. Returns a \`processId\`.
  - Example: \`start_process({ command: "npm run dev" })\`
- **\`read_process_output\`** — Read output from a background process. Use \`tail: 50\` for last 50 lines, or \`sinceLastRead: true\` for new lines only.
- **\`send_process_input\`** — Send text to a process's stdin (for interactive prompts).
- **\`stop_process\`** — Stop a background process gracefully. Use \`force: true\` to kill immediately.
- **\`list_processes\`** — List all running background processes.

## Parallel Operations

You can call MULTIPLE tools in a single response when operations are independent.
- Reading 3 files? Make 3 \`read_text_file\` calls in one response.
- Creating independent files? Make all \`write_file\` calls together.
- Only serialize operations that depend on each other's results.

## Best Practices

- Always read a file before editing it — understand what you're changing.
- Use \`grep_content\` to find code rather than guessing file locations.
- For build/test commands, use \`execute_command\`. For dev servers, use \`start_process\`.
- Check command output and exit codes — don't assume success.
- Use absolute paths when possible.
`
