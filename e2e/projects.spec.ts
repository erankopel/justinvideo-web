import { readFileSync, statSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { editRecord, media, pick, plantStray, reloadSaved, storedFacts, storedPaths, storedRecords } from './helpers'

test.describe('importing a video', () => {
  test('makes a project that opens at once, and is still there after a reload', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('No projects yet')).toBeVisible()
    await pick(page, media('landscape.webm'))

    await expect(page).toHaveURL(/#\/p\/p[0-9a-f]+/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('landscape')
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(1)
    await expect(page.getByTestId('clips')).toContainText('Clip 1')
    await expect(page.getByTestId('clips')).toContainText('0:02')
    await expect(page.locator('ul.sources')).toContainText('landscape.webm')
    await expect(page.locator('ul.sources')).toContainText('320 by 180')
    await expect(page.locator('ul.sources')).toContainText('With sound')

    await page.getByRole('link', { name: /Projects/ }).click()
    const card = page.locator('li.project')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('landscape')
    await expect(card).toContainText('Clips: 1')
    await expect(card.locator('img.thumb')).toBeVisible()

    await reloadSaved(page)
    await expect(page.locator('li.project')).toHaveCount(1)
    await expect(page.locator('li.project img.thumb')).toBeVisible()
  })

  test('keeps a copy of the video in the storage of the browser, byte for byte', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(page.getByRole('heading', { level: 1 })).toContainText('landscape')

    const paths = await storedPaths(page)
    const copy = paths.find((p) => /^p[0-9a-f]+\/media\/[0-9a-f]+\.webm$/.test(p))
    expect(copy, paths.join(', ')).toBeDefined()
    const stored = await storedFacts(page, copy ?? '')
    expect(stored.size).toBe(statSync(media('landscape.webm')).size)
    const { createHash } = await import('node:crypto')
    expect(stored.sha256).toBe(createHash('sha256').update(readFileSync(media('landscape.webm'))).digest('hex'))
  })

  test('reads the rotation of a phone video, so a portrait video is portrait', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('portrait-rotated.mp4'))
    await expect(page.locator('ul.sources')).toContainText('180 by 320')
  })

  test('knows a video without sound', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('silent.webm'))
    await expect(page.locator('ul.sources')).toContainText('No sound')
  })

  test('puts several videos in one project, in order', async ({ page }) => {
    await page.goto('/')
    await pick(page, [media('landscape.webm'), media('silent.webm')])
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(2)
    await expect(page.getByTestId('clips').locator('li').nth(1)).toContainText(/0:02\W+to\W+0:03/)
    await expect(page.locator('ul.sources li')).toHaveCount(2)
  })

  test('adds a video to a project and the undo history survives a reload', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(1)
    const undo = page.getByRole('button', { name: 'Undo' })
    const redo = page.getByRole('button', { name: 'Redo' })
    await expect(undo).toBeDisabled()

    await pick(page, media('silent.webm'))
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(2)
    await expect(undo).toBeEnabled()

    await reloadSaved(page)
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(2)
    await undo.click()
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(1)
    await expect(redo).toBeEnabled()

    await reloadSaved(page)
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(1)
    await expect(redo).toBeEnabled()
    await redo.click()
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(2)
  })

  test('refuses a file that is not a video, says why, and keeps nothing', async ({ page }) => {
    await page.goto('/')
    await pick(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just some words') })
    await expect(page.getByRole('alert')).toContainText('notes.txt')
    await expect(page.getByRole('alert')).toContainText('not a video')
    await expect(page.getByText('No projects yet')).toBeVisible()
    expect(await storedPaths(page)).toEqual([])
    expect(await storedRecords(page)).toEqual([])
  })

  test('refuses an empty file', async ({ page }) => {
    await page.goto('/')
    await pick(page, { name: 'empty.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(0) })
    await expect(page.getByRole('alert')).toContainText('empty or longer than 24 hours')
  })

  test('refuses what is not a video and still imports the good ones given with it', async ({ page }) => {
    await page.goto('/')
    await pick(page, [
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('words') },
      { name: 'good.webm', mimeType: 'video/webm', buffer: readFileSync(media('silent.webm')) },
    ] as never)
    // The list stays, with what was refused, because opening the project would hide it.
    await expect(page.getByRole('alert')).toContainText('notes.txt')
    await expect(page.locator('li.project')).toHaveCount(1)
    await expect(page.locator('li.project')).toContainText('good')
    await expect(page).toHaveURL(/#\/$|\/$/)
  })

  test('takes videos dropped on the page', async ({ page }) => {
    await page.goto('/')
    // The page listens for drops once the site has started.
    await expect(page.getByText('No projects yet')).toBeVisible()
    const bytes = [...readFileSync(media('silent.webm'))]
    // Playwright builds a real drop event from a DataTransfer handle in every browser; a hand-made one is not honoured by Firefox.
    const transfer = await page.evaluateHandle((data) => {
      const files = new DataTransfer()
      files.items.add(new File([new Uint8Array(data)], 'dropped.webm', { type: 'video/webm' }))
      return files
    }, bytes)
    await page.dispatchEvent('body', 'drop', { dataTransfer: transfer })
    await expect(page.getByRole('heading', { level: 1 })).toContainText('dropped')
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(1)
  })
})

test.describe('managing projects', () => {
  test('renames a project and keeps the new name', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await page.getByRole('button', { name: 'Rename' }).click()
    const box = page.getByRole('dialog')
    await box.getByLabel('Project name').fill('Summer trip')
    await box.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Summer trip')
    await reloadSaved(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Summer trip')
    await page.getByRole('link', { name: /Projects/ }).click()
    await expect(page.locator('li.project')).toContainText('Summer trip')
  })

  test('deletes a project with its copy of the video, after asking', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await page.getByRole('link', { name: /Projects/ }).click()
    expect((await storedPaths(page)).length).toBeGreaterThan(0)

    await page.getByRole('button', { name: /Delete landscape/ }).click()
    const box = page.getByRole('dialog')
    await expect(box).toContainText('Delete this project?')
    await box.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('li.project')).toHaveCount(1)

    await page.getByRole('button', { name: /Delete landscape/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('No projects yet')).toBeVisible()
    expect(await storedPaths(page)).toEqual([])
    expect(await storedRecords(page)).toEqual([])
  })

  test('deletes a project from its own page and goes back to the list', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByText('No projects yet')).toBeVisible()
  })

  test('shows a damaged project instead of hiding it, and lets it be deleted', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await page.getByRole('link', { name: /Projects/ }).click()
    await editRecord(page, { json: '{"format":1,"id":', previousJson: null })
    await reloadSaved(page)
    const card = page.locator('li.project.damaged')
    await expect(card).toContainText('cannot be opened')
    await expect(card).toContainText('damaged')
    await card.getByRole('button', { name: /Delete/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('No projects yet')).toBeVisible()
  })

  test('opens the save before a damaged one', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(1)
    await pick(page, media('silent.webm'))
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(2)
    // The second save kept the first as the copy before it. Damage the current one.
    await editRecord(page, { json: 'garbage' })
    await reloadSaved(page)
    await expect(page.getByTestId('clips').locator('li')).toHaveCount(1)
  })

  test('says a project from a newer version cannot be opened', async ({ page }) => {
    await page.goto('/')
    await pick(page, media('landscape.webm'))
    await expect(page.getByRole('heading', { level: 1 })).toContainText('landscape')
    await editRecord(page, { json: '{"format":999}' })
    await reloadSaved(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('cannot be opened')
    await expect(page.getByText('newer version')).toBeVisible()
  })

  test('says so for a project that does not exist', async ({ page }) => {
    await page.goto('/#/p/pdoesnotexist')
    await expect(page.getByRole('alert')).toContainText('does not exist')
  })

  test('clears the leftovers of an interrupted import when the site starts', async ({ page }) => {
    // The privacy page is on the same origin, and so shares its file system, but does not start the site's own code.
    await page.goto('/privacy/')
    await plantStray(page)
    expect((await storedPaths(page)).some((path) => path.startsWith('pstray/'))).toBe(true)
    await page.goto('/')
    await expect.poll(() => storedPaths(page)).toEqual([])
  })
})

test.describe('the page', () => {
  test('follows the language: Hebrew reads right to left, and the choice is kept', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('הפרויקטים שלך')
    await pick(page, media('landscape.webm'))
    await expect(page.getByTestId('clips')).toContainText('קטע 1')
    await reloadSaved(page)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await page.getByRole('button', { name: 'العربية' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await page.getByRole('button', { name: 'English' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  })

  test('links to the privacy policy', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Privacy policy' }).click()
    await expect(page).toHaveURL(/\/privacy\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('JustInVideo privacy policy')
  })
})
