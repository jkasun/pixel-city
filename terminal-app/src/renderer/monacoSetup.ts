// Configure Monaco workers and bind @monaco-editor/react to the bundled Monaco.
// Must be imported before any component that uses monaco-editor so
// `self.MonacoEnvironment.getWorker` is in place when Monaco spins up its first
// worker (otherwise Monaco falls back to a URL resolver that calls `toUri` on
// an undefined config and throws "Cannot read properties of undefined (reading 'toUrl')").
//
// loader.config({ monaco }) tells @monaco-editor/react to use this bundled
// instance instead of AMD-loading a second copy from a CDN — without it the
// AMD copy boots without MonacoEnvironment hooked up and foreign-module loads
// fail inside the worker.
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

;(window as Window & { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })
