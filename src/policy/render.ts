/**
 * Turns the privacy policy (docs/store/PRIVACY-POLICY.md, copied to content/privacy-policy.md) into a static page. The
 * page is plain HTML with no script, so a store reviewer or a search engine can read it as it is. Only the small part
 * of Markdown that the policy uses is understood: headings, paragraphs, bullet lists, bold, links and quoted blocks.
 * A quoted block is a note for the owner and is left out of the page.
 */

const LANGUAGE_OF_HEADING: Readonly<Record<string, { lang: string; dir: 'ltr' | 'rtl' }>> = {
  English: { lang: 'en', dir: 'ltr' },
  עברית: { lang: 'he', dir: 'rtl' },
  العربية: { lang: 'ar', dir: 'rtl' },
}

export const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Inline markup: bold, links and bare e-mail addresses, with everything else shown as text. */
export function renderInline(text: string): string {
  const pieces = escapeHtml(text).split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/)
  return pieces
    .map((piece) => {
      const bold = /^\*\*([^*]+)\*\*$/.exec(piece)
      if (bold) return `<strong>${bold[1]}</strong>`
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece)
      if (link) return `<a href="${link[2]}">${link[1]}</a>`
      return piece.replace(EMAIL, (address) => `<a href="mailto:${address}">${address}</a>`)
    })
    .join('')
}

interface Block {
  readonly kind: 'h1' | 'h2' | 'p' | 'ul'
  readonly lines: readonly string[]
}

function blocksOf(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  let current: { kind: Block['kind'] | 'quote'; lines: string[] } | null = null
  const flush = (): void => {
    if (current && current.kind !== 'quote') blocks.push({ kind: current.kind, lines: current.lines })
    current = null
  }
  for (const line of lines) {
    if (line.trim() === '') {
      flush()
    } else if (line.startsWith('# ')) {
      flush()
      blocks.push({ kind: 'h1', lines: [line.slice(2).trim()] })
    } else if (line.startsWith('## ')) {
      flush()
      blocks.push({ kind: 'h2', lines: [line.slice(3).trim()] })
    } else if (line.startsWith('>')) {
      if (current?.kind !== 'quote') {
        flush()
        current = { kind: 'quote', lines: [] }
      }
    } else if (line.startsWith('- ')) {
      if (current?.kind !== 'ul') {
        flush()
        current = { kind: 'ul', lines: [] }
      }
      current.lines.push(line.slice(2).trim())
    } else if (current?.kind === 'ul' && line.startsWith('  ')) {
      current.lines[current.lines.length - 1] += ' ' + line.trim()
    } else {
      if (current?.kind !== 'p') {
        flush()
        current = { kind: 'p', lines: [] }
      }
      current.lines.push(line.trim())
    }
  }
  flush()
  return blocks
}

/** The effective date as the policy states it, or null when the line is missing. */
export function effectiveDate(markdown: string): string | null {
  const match = /^Effective date:\s*(.+)$/m.exec(markdown)
  return match?.[1]?.trim() ?? null
}

/** True once the effective date has been filled in: it holds a year and no square-bracket placeholder. */
export function policyIsPublishable(markdown: string): boolean {
  const date = effectiveDate(markdown)
  return date !== null && !date.includes('[') && /\d{4}/.test(date)
}

/** What a static page may do: draw itself from its own inline style, and nothing else. It has no script and connects nowhere. */
export const STATIC_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

export const PAGE_STYLE = `
:root { color-scheme: light dark; --background: #ffffff; --text: #1b1b1f; --muted: #55555c; --accent: #3b4cca; --rule: #d6d6dc; font-family: system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { :root { --background: #121316; --text: #e6e6ea; --muted: #a8a8b0; --accent: #aab4ff; --rule: #34353b; } }
body { margin: 0; background: var(--background); color: var(--text); line-height: 1.6; }
main { box-sizing: border-box; max-width: 44rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
a { color: var(--accent); }
h1 { margin-block: 0 0.5rem; }
.meta { color: var(--muted); margin-block: 0 1.5rem; }
nav { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; margin-block-end: 2rem; }
nav a { display: inline-block; min-height: 44px; line-height: 44px; }
section { border-block-start: 1px solid var(--rule); padding-block: 1.5rem 0.5rem; }
section h2 { margin-block-start: 0; }
li { margin-block: 0.5rem; }
`

/** The whole policy page. The first language in the file is the one the page declares for itself. */
export function renderPolicyPage(markdown: string): string {
  const blocks = blocksOf(markdown)
  const title = blocks.find((block) => block.kind === 'h1')?.lines[0] ?? 'Privacy policy'
  const preamble: string[] = []
  const sections: { heading: string; html: string[] }[] = []

  for (const block of blocks) {
    if (block.kind === 'h1') continue
    if (block.kind === 'h2') {
      sections.push({ heading: block.lines[0] ?? '', html: [] })
      continue
    }
    const target = sections.length === 0 ? preamble : sections[sections.length - 1]?.html
    if (!target) continue
    if (block.kind === 'ul') {
      target.push(`<ul>${block.lines.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
    } else if (sections.length === 0) {
      target.push(`<p class="meta">${block.lines.map(renderInline).join('<br>')}</p>`)
    } else {
      target.push(`<p>${renderInline(block.lines.join(' '))}</p>`)
    }
  }

  const known = sections.map((section) => ({ ...section, language: LANGUAGE_OF_HEADING[section.heading] }))
  const nav = known
    .map((section) => {
      const lang = section.language
      return lang ? `<a href="#${lang.lang}" lang="${lang.lang}" dir="${lang.dir}">${escapeHtml(section.heading)}</a>` : ''
    })
    .join('')
  const body = known
    .map((section) => {
      const lang = section.language
      const attributes = lang ? ` id="${lang.lang}" lang="${lang.lang}" dir="${lang.dir}"` : ''
      return `<section${attributes}><h2>${escapeHtml(section.heading)}</h2>${section.html.join('')}</section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${STATIC_PAGE_CSP}">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${preamble.join('\n')}
<nav aria-label="Language">${nav}</nav>
${body}
</main>
</body>
</html>
`
}
