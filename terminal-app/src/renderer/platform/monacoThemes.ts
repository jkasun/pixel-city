/**
 * Register custom Monaco editor themes for Pixel City.
 *
 * Import this module BEFORE any Monaco editor component renders.
 * The original terminal-app EditorPanel registered these inline,
 * but now that EditorPanel lives in the shared plugin-files package,
 * theme registration must happen in the platform layer.
 */

import * as monaco from 'monaco-editor'

monaco.editor.defineTheme('pixelcity-creme', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '7a6a4a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'a04030' },
    { token: 'string', foreground: '5a7a2e' },
    { token: 'number', foreground: '3a6a8a' },
    { token: 'type', foreground: '7a4a6a' },
    { token: 'variable', foreground: 'a07030' },
    { token: 'function', foreground: '3a6a8a' },
  ],
  colors: {
    'editor.background': '#FFF7D0',
    'editor.foreground': '#5a4a30',
    'editor.lineHighlightBackground': '#FFE6B820',
    'editorLineNumber.foreground': '#c0a870',
    'editorLineNumber.activeForeground': '#8a7040',
    'editor.selectionBackground': '#FFCCA650',
    'editor.inactiveSelectionBackground': '#FFE6B830',
    'editorIndentGuide.background': '#FFD8B440',
    'editorIndentGuide.activeBackground': '#FFCCA680',
    'editorCursor.foreground': '#c08a40',
    'editorWhitespace.foreground': '#FFD8B440',
    'editorWidget.background': '#FFFAEB',
    'editorWidget.border': '#FFCCA6',
    'editorSuggestWidget.background': '#FFFAEB',
    'editorSuggestWidget.border': '#FFCCA6',
    'editorSuggestWidget.selectedBackground': '#FFE6B8',
    'minimap.background': '#FFF9E0',
    'scrollbarSlider.background': '#FFCCA640',
    'scrollbarSlider.hoverBackground': '#FFCCA680',
    'scrollbarSlider.activeBackground': '#c08a4060',
  },
})

monaco.editor.defineTheme('pixelcity-nord', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
    { token: 'keyword', foreground: '81a1c1' },
    { token: 'string', foreground: 'a3be8c' },
    { token: 'number', foreground: 'b48ead' },
    { token: 'type', foreground: '8fbcbb' },
    { token: 'variable', foreground: 'd8dee9' },
    { token: 'function', foreground: '88c0d0' },
  ],
  colors: {
    'editor.background': '#2e3440',
    'editor.foreground': '#d8dee9',
    'editor.lineHighlightBackground': '#3b425220',
    'editorLineNumber.foreground': '#4c566a',
    'editorLineNumber.activeForeground': '#d8dee9',
    'editor.selectionBackground': '#434c5e80',
    'editor.inactiveSelectionBackground': '#434c5e40',
    'editorIndentGuide.background': '#434c5e40',
    'editorIndentGuide.activeBackground': '#4c566a80',
    'editorCursor.foreground': '#88c0d0',
    'editorWhitespace.foreground': '#434c5e40',
    'editorWidget.background': '#3b4252',
    'editorWidget.border': '#434c5e',
    'editorSuggestWidget.background': '#3b4252',
    'editorSuggestWidget.border': '#434c5e',
    'editorSuggestWidget.selectedBackground': '#434c5e',
    'minimap.background': '#2e3440',
    'scrollbarSlider.background': '#4c566a40',
    'scrollbarSlider.hoverBackground': '#4c566a80',
    'scrollbarSlider.activeBackground': '#4c566aa0',
  },
})

monaco.editor.defineTheme('pixelcity-monokai', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'function', foreground: 'a6e22e' },
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editor.lineHighlightBackground': '#3e3d3220',
    'editorLineNumber.foreground': '#90908a',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editor.selectionBackground': '#49483e80',
    'editor.inactiveSelectionBackground': '#49483e40',
    'editorIndentGuide.background': '#49483e40',
    'editorIndentGuide.activeBackground': '#75715e60',
    'editorCursor.foreground': '#f8f8f0',
    'editorWhitespace.foreground': '#49483e40',
    'editorWidget.background': '#3e3d32',
    'editorWidget.border': '#49483e',
    'editorSuggestWidget.background': '#3e3d32',
    'editorSuggestWidget.border': '#49483e',
    'editorSuggestWidget.selectedBackground': '#49483e',
    'minimap.background': '#272822',
    'scrollbarSlider.background': '#49483e60',
    'scrollbarSlider.hoverBackground': '#49483e90',
    'scrollbarSlider.activeBackground': '#49483eb0',
  },
})
