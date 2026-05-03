// Module-level register for the active projectCwd.
// Set once when a building opens; read by employeeDbLocal wrappers so they
// don't have to thread projectDir through every call site.
//
// Safe because the renderer only ever has one active project at a time.

let _projectCwd: string | null = null

export function setEmployeeProjectCwd(cwd: string | null): void {
  _projectCwd = cwd
}

export function getEmployeeProjectCwd(): string | null {
  return _projectCwd
}
