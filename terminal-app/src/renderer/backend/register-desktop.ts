// ── Desktop Backend Registration ────────────────────────────────────
// Call this at app startup in the Electron desktop environment.
// Registers LocalBackend as the default execution backend.
//
// Usage (in App.tsx or similar):
//   import './backend/register-desktop'

import { backendRegistry } from './registry.js'
import { LocalBackend } from './local/LocalBackend.js'

backendRegistry.register(new LocalBackend())
backendRegistry.setDefault('local')
