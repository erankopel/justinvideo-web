import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { privacyPolicyPage } from './plugin'

const policy = (date: string): string => `# Policy\n\nEffective date: ${date}\nContact: a@b.example\n\n## English\n\nHello.\n`

function pluginFor(markdown: string) {
  const folder = mkdtempSync(join(tmpdir(), 'policy-'))
  const file = join(folder, 'policy.md')
  writeFileSync(file, markdown)
  const emitted: string[] = []
  const context = {
    error: (message: string): never => {
      throw new Error(message)
    },
    emitFile: (asset: { fileName: string }): void => void emitted.push(asset.fileName),
  }
  const run = (): void => (privacyPolicyPage(file).generateBundle as unknown as (this: typeof context) => void).call(context)
  return { run, emitted }
}

describe('the build of the privacy policy page', () => {
  const before = process.env['PUBLIC_BUILD']
  afterEach(() => {
    if (before === undefined) delete process.env['PUBLIC_BUILD']
    else process.env['PUBLIC_BUILD'] = before
  })

  it('refuses the public build while the effective date is a placeholder, and says what to fix', () => {
    process.env['PUBLIC_BUILD'] = '1'
    const { run, emitted } = pluginFor(policy('[date of publication]'))
    expect(run).toThrow(/no effective date yet.*PRIVACY-POLICY\.md/)
    expect(emitted).toEqual([])
  })

  it('makes the public build once the date is filled in', () => {
    process.env['PUBLIC_BUILD'] = '1'
    const { run, emitted } = pluginFor(policy('1 December 2026'))
    run()
    expect(emitted).toEqual(['privacy/index.html'])
  })

  it('lets every other build carry the placeholder, so that development is not held up', () => {
    delete process.env['PUBLIC_BUILD']
    const { run, emitted } = pluginFor(policy('[date of publication]'))
    run()
    expect(emitted).toEqual(['privacy/index.html'])
  })
})
