import { describe, expect, it } from 'vitest'
import { bundledComponents } from './licenses-plugin'
import { type Component, renderLicensesPage } from './licenses'

const mpl: Component = { name: 'lib-a', version: '1.2.3', license: 'MPL-2.0', homepage: 'https://a.example/', sourceUrl: 'https://github.com/x/a/tree/v1.2.3', text: 'Mozilla Public License <2.0>' }
const lgpl: Component = {
  name: 'lib-c',
  version: '7.8.9',
  license: 'LGPL-2.1-or-later',
  homepage: 'https://c.example/',
  sourceUrl: 'https://github.com/x/c',
  text: 'Lesser <license>',
  insideOf: 'lib-a 1.2.3',
  buildUrl: 'https://github.com/x/a/tree/v1.2.3/packages/c',
}
const mit: Component = { name: 'lib-b', version: '4.5.6', license: 'MIT', homepage: 'https://b.example/', sourceUrl: 'https://github.com/x/b/tree/v4.5.6', text: 'MIT text & more' }

describe('renderLicensesPage', () => {
  const html = renderLicensesPage('# Notice\n\nOwn notice.\nOver two lines.\n\n---\n\nSecond paragraph.', [mpl, mit])

  it('shows the notice as paragraphs and each component with its license text, escaped', () => {
    expect(html).toContain('<p>Own notice. Over two lines.</p>')
    expect(html).toContain('<p>Second paragraph.</p>')
    // The heading and the rule of the file are not shown as text.
    expect(html).not.toContain('<p># Notice')
    expect(html).not.toContain('<p>---')
    expect(html).toContain('<h2>lib-a 1.2.3</h2>')
    expect(html).toContain('<pre>Mozilla Public License &lt;2.0&gt;</pre>')
    expect(html).toContain('<pre>MIT text &amp; more</pre>')
  })

  it('says where the source of a component under the Mozilla license is, and only for that one', () => {
    expect(html).toContain('used here exactly as it was published, without changes')
    expect(html).toContain('<a href="https://github.com/x/a/tree/v1.2.3">https://github.com/x/a/tree/v1.2.3</a>')
    expect(html.match(/used here exactly as it was published/g)).toHaveLength(1)
  })

  it('says of a library under the Lesser license that it is built into another package, unchanged, in a file that can be replaced, and where its source and its build are', () => {
    const page = renderLicensesPage('Own.', [mpl, lgpl, mit])
    expect(page).toContain('<h2>lib-c 7.8.9</h2>')
    expect(page).toContain('used here exactly as it was built and published in lib-a 1.2.3, without changes')
    expect(page).toContain('so that it can be replaced by another build of the library')
    expect(page).toContain('<a href="https://github.com/x/c">https://github.com/x/c</a>')
    expect(page).toContain('the commands that built it are at <a href="https://github.com/x/a/tree/v1.2.3/packages/c">')
    expect(page).toContain('<pre>Lesser &lt;license&gt;</pre>')
    // Only the library under that license is told so, and the Mozilla one still is its own.
    expect(page.match(/built and published/g)).toHaveLength(1)
    expect(page.match(/used here exactly as it was published/g)).toHaveLength(1)
  })

  it('has no script and allows nothing but its own style', () => {
    expect(html).not.toContain('<script')
    expect(html).toContain("default-src 'none'")
  })
})

describe('bundledComponents', () => {
  it('lists the packages the site depends on, with their licenses and the source of their version', () => {
    const components = bundledComponents()
    const names = components.map((component) => component.name)
    // FFmpeg is not a package of its own: it is listed after the AAC encoder that has it built in.
    expect(names).toEqual(['@mediabunny/aac-encoder', 'ffmpeg-libavcodec', 'mediabunny', 'preact'])
    const ffmpeg = components.find((component) => component.name === 'ffmpeg-libavcodec')
    expect(ffmpeg?.license).toBe('LGPL-2.1-or-later')
    expect(ffmpeg?.text).toContain('GNU LESSER GENERAL PUBLIC LICENSE')
    expect(ffmpeg?.insideOf).toMatch(/^@mediabunny\/aac-encoder \d/)
    expect(ffmpeg?.buildUrl).toMatch(/\/packages\/aac-encoder$/)
    const mediabunny = components.find((component) => component.name === 'mediabunny')
    expect(mediabunny?.license).toBe('MPL-2.0')
    expect(mediabunny?.text).toContain('Mozilla Public License')
    expect(mediabunny?.sourceUrl).toMatch(/^https:\/\/github\.com\/Vanilagy\/mediabunny\/tree\/v\d+\.\d+\.\d+$/)
    const preact = components.find((component) => component.name === 'preact')
    expect(preact?.license).toBe('MIT')
    expect(preact?.sourceUrl).toBe(`https://github.com/preactjs/preact/tree/v${preact?.version}`)
  })
})
