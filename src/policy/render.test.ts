import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { effectiveDate, policyIsPublishable, renderInline, renderPolicyPage } from './render'

const policy = readFileSync(new URL('../../content/privacy-policy.md', import.meta.url), 'utf8')

describe('inline markup', () => {
  it('makes bold, links and e-mail addresses, and escapes the rest', () => {
    expect(renderInline('**Hi** <b> & [site](https://a.example/x) write to me@x.example')).toBe(
      '<strong>Hi</strong> &lt;b&gt; &amp; <a href="https://a.example/x">site</a> write to <a href="mailto:me@x.example">me@x.example</a>',
    )
  })
})

describe('the page', () => {
  const sample = [
    '# Title',
    '',
    '> A note for the owner.',
    '> Over two lines.',
    '',
    'Effective date: 1 May 2027',
    'Contact: a@b.example',
    '',
    '## English',
    '',
    '**Short.** First paragraph',
    'continued.',
    '',
    '- One item',
    '  that goes on',
    '- Two',
    '',
    '## עברית',
    '',
    'שלום',
  ].join('\n')

  it('leaves out the quoted notes and keeps the meta lines together', () => {
    const html = renderPolicyPage(sample)
    expect(html).not.toContain('note for the owner')
    expect(html).toContain('<p class="meta">Effective date: 1 May 2027<br>Contact: <a href="mailto:a@b.example">a@b.example</a></p>')
  })

  it('has no script and allows nothing but its own style', () => {
    const html = renderPolicyPage(sample)
    expect(html).not.toContain('<script')
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain("default-src 'none'")
  })

  it('joins the lines of a paragraph and of a list item', () => {
    const html = renderPolicyPage(sample)
    expect(html).toContain('<p><strong>Short.</strong> First paragraph continued.</p>')
    expect(html).toContain('<ul><li>One item that goes on</li><li>Two</li></ul>')
  })

  it('gives each language its own section, language and direction, and a link to it', () => {
    const html = renderPolicyPage(sample)
    expect(html).toContain('<section id="en" lang="en" dir="ltr"><h2>English</h2>')
    expect(html).toContain('<section id="he" lang="he" dir="rtl"><h2>עברית</h2>')
    expect(html).toContain('<a href="#he" lang="he" dir="rtl">עברית</a>')
  })

  it('has no script', () => {
    expect(renderPolicyPage(sample)).not.toContain('<script')
  })
})

describe('the effective date', () => {
  it('is read from its line', () => {
    expect(effectiveDate('Effective date: 3 June 2027\n')).toBe('3 June 2027')
    expect(effectiveDate('nothing here')).toBeNull()
  })

  it('must be filled in before the policy can be published', () => {
    expect(policyIsPublishable('Effective date: [date of publication]')).toBe(false)
    expect(policyIsPublishable('Effective date: soon')).toBe(false)
    expect(policyIsPublishable('no date line')).toBe(false)
    expect(policyIsPublishable('Effective date: 2027-06-03')).toBe(true)
  })
})

describe('the real policy', () => {
  const html = renderPolicyPage(policy)

  it('has the three languages', () => {
    for (const id of ['en', 'he', 'ar']) expect(html).toContain(`<section id="${id}"`)
  })

  it('names the developer and the contact, and does not publish the draft note', () => {
    expect(html).toContain('Developer: Doi26')
    expect(html).toContain('mailto:justinvideo@medicom.vip')
    expect(html).not.toContain('Draft for review')
  })

  it('says the same things in each language: every section has the same number of paragraphs and list items', () => {
    const counts = ['en', 'he', 'ar'].map((id) => {
      const section = new RegExp(`<section id="${id}".*?</section>`, 's').exec(html)?.[0] ?? ''
      return [(section.match(/<p>/g) ?? []).length, (section.match(/<li>/g) ?? []).length]
    })
    expect(counts[1]).toEqual(counts[0])
    expect(counts[2]).toEqual(counts[0])
  })
})
