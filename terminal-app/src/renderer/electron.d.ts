import type { IpcRenderer, IpcRendererEvent } from 'electron'

declare global {
  interface Window {
    require(module: 'electron'): { ipcRenderer: IpcRenderer }
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        preload?: string
        nodeintegration?: string
        allowpopups?: string
        webpreferences?: string
      }
    }
  }
}

export type { IpcRendererEvent }
