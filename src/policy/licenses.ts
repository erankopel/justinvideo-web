import { escapeHtml, PAGE_STYLE, STATIC_PAGE_CSP } from './render'

/** A component that the site bundles, with the license it comes under. */
export interface Component {
  readonly name: string
  readonly version: string
  /** The SPDX name of the license, as the package says it. */
  readonly license: string
  readonly homepage: string
  /** Where the source code of exactly this version can be had. */
  readonly sourceUrl: string
  /** The full text of the license, as the package ships it. */
  readonly text: string
  /** The package this component is built into, when it is not a package of its own: a library inside a module of another. */
  readonly insideOf?: string
  /** Where the commands that built this component are, when it is built into another. */
  readonly buildUrl?: string
}

/** Splits a plain text file into paragraphs at its blank lines, each with its lines joined, for showing as it is written. */
function paragraphs(text: string): string[] {
  return text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => line.trim() !== '---' && !line.startsWith('# '))
    .join('\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
}

const isMozilla = (license: string): boolean => license.toUpperCase().startsWith('MPL')
const isLesser = (license: string): boolean => license.toUpperCase().startsWith('LGPL')

/**
 * The page of licenses and notices: who owns JustInVideo, what it is derived from and the license that must stay with
 * that, and every component that the site bundles with its license text. A component under the Mozilla Public License says
 * that it is used as published and where its source code is, as that license asks. One under the Lesser General Public License,
 * which is a library built into a component of another package, says the same, and that the library is kept in a file of its
 * own that can be replaced by another build of it, and where the commands that built it are.
 */
export function renderLicensesPage(notice: string, components: readonly Component[]): string {
  const own = paragraphs(notice)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', ' ')}</p>`)
    .join('\n')
  const parts = components
    .map((component) => {
      const mozilla = isMozilla(component.license)
        ? `<p>${escapeHtml(component.name)} is used here exactly as it was published, without changes. The source code of this version is available at <a href="${escapeHtml(component.sourceUrl)}">${escapeHtml(component.sourceUrl)}</a>, and the license applies to ${escapeHtml(component.name)} only, not to the rest of the site.</p>`
        : ''
      const lesser = isLesser(component.license)
        ? `<p>${escapeHtml(component.name)} is used here exactly as it was built and published${component.insideOf ? ` in ${escapeHtml(component.insideOf)}` : ''}, without changes, as a WebAssembly module inside a file of its own, which the page loads only when it is needed, so that it can be replaced by another build of the library. The source code of this version is available at <a href="${escapeHtml(component.sourceUrl)}">${escapeHtml(component.sourceUrl)}</a>${component.buildUrl ? `, and the commands that built it are at <a href="${escapeHtml(component.buildUrl)}">${escapeHtml(component.buildUrl)}</a>` : ''}. The license applies to ${escapeHtml(component.name)} only, not to the rest of the site.</p>`
        : ''
      return `<section id="${escapeHtml(component.name)}">
<h2>${escapeHtml(component.name)} ${escapeHtml(component.version)}</h2>
<p>License: ${escapeHtml(component.license)}. <a href="${escapeHtml(component.homepage)}">${escapeHtml(component.homepage)}</a></p>
${mozilla}${lesser}
<pre>${escapeHtml(component.text.trim())}</pre>
</section>`
    })
    .join('\n')
  const nav = components.map((component) => `<a href="#${escapeHtml(component.name)}">${escapeHtml(component.name)}</a>`).join('')
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${STATIC_PAGE_CSP}">
<title>Licenses and notices</title>
<style>${PAGE_STYLE}
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 0.85rem/1.5 ui-monospace, monospace; }
</style>
</head>
<body>
<main>
<h1>Licenses and notices</h1>
${own}
<nav aria-label="Components">${nav}</nav>
${parts}
</main>
</body>
</html>
`
}
