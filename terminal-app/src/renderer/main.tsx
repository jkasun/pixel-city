// Must be the first import: sets up MonacoEnvironment workers and binds
// @monaco-editor/react to the bundled Monaco before any component renders.
import './monacoSetup'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { loadPixelCitySettings, applyTheme } from './settings.js'
import { installGlobalErrorHandlers } from './globalErrors'
import { GlobalErrorBanner } from './GlobalErrorBanner'
import './styles.css'
import './styles/base.css'
import '@xterm/xterm/css/xterm.css'

installGlobalErrorHandlers()

// Apply saved theme before first render to avoid flash
applyTheme(loadPixelCitySettings().theme ?? 'dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <GlobalErrorBanner />
    <App />
  </>
)
