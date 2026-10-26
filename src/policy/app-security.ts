import type { Plugin } from 'vite'

/**
 * What the app page may do, and nothing more: run its own scripts and workers (and compile WebAssembly, which the AAC encoder
 * the export brings needs and nothing else uses; it is not a way to run text as script), draw from its own style sheet, show its own
 * and its own made pictures, video and sound (blob: addresses are what the site makes from your files), and connect only to
 * itself. A page that can connect nowhere else cannot send a file or anything else away, whatever a script tried, which backs
 * up the promise that your videos never leave your browser.
 */
export const APP_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "connect-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

/** Puts the security policy into the built app page. The dev server needs its own scripts and sockets, so it gets none. */
export function appPageSecurity(): Plugin {
  return {
    name: 'app-page-security',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${APP_CSP}" />`),
    },
  }
}
