import { expect, type Page, test } from '@playwright/test'
import { clearHistory, media, pick } from './helpers'

const clips = (page: Page) => page.locator('.timeline .clip')

/** A project open in the first tab, and the address of its page. */
async function openProject(page: Page): Promise<string> {
  await page.goto('/')
  await pick(page, media('landscape.webm'))
  await expect(clips(page)).toHaveCount(1)
  await clearHistory(page)
  await expect(clips(page)).toHaveCount(1)
  return page.url()
}

test.describe('one project in one tab', () => {
  test('a second tab is told that the project is open elsewhere, and the first goes on undisturbed', async ({ page }) => {
    const address = await openProject(page)
    const second = await page.context().newPage()
    await second.goto(address)
    const gate = second.locator('[data-gate=busy]')
    await expect(gate).toContainText('This project is open in another tab')
    await expect(gate).toContainText('Changing it in two places at once can lose changes')
    await expect(second.locator('.timeline')).toHaveCount(0)
    await expect(clips(page)).toHaveCount(1)
    await expect(page.getByTestId('split')).toBeEnabled()
  })

  test('a tab can take the project over, and the other is told and stops, and can take it back with what was changed', async ({ page }) => {
    const address = await openProject(page)
    const second = await page.context().newPage()
    await second.goto(address)
    await second.getByTestId('use-here').click()
    await expect(clips(second)).toHaveCount(1)
    await expect(page.locator('[data-gate=lost]')).toContainText('taken over by another tab')
    await expect(page.locator('.timeline')).toHaveCount(0)

    // A change made in the tab that has it.
    await second.getByTestId('add-text').click()
    await second.getByTestId('text-field').fill('Made in the second tab')
    await second.getByTestId('text-save').click()
    await expect(second.locator('.timeline .cue')).toHaveCount(1)
    await expect(second.locator('main[data-saving=false]')).toBeVisible()

    // The first tab takes it back, and shows the project as it is stored, with that change.
    await page.getByTestId('use-here').click()
    await expect(clips(page)).toHaveCount(1)
    await expect(page.locator('.timeline .cue')).toHaveCount(1)
    await expect(second.locator('[data-gate=lost]')).toBeVisible()
  })

  test('closing the tab that has the project lets the next tab have it at once', async ({ page }) => {
    const address = await openProject(page)
    const second = await page.context().newPage()
    await second.goto(address)
    await expect(second.locator('[data-gate=busy]')).toBeVisible()
    await page.close()
    const third = await second.context().newPage()
    await third.goto(address)
    await expect(third.locator('.timeline')).toBeVisible()
    await expect(third.locator('[data-gate]')).toHaveCount(0)
  })

  test('leaving the project for the list lets another tab have it', async ({ page }) => {
    const address = await openProject(page)
    const second = await page.context().newPage()
    await second.goto(address)
    await expect(second.locator('[data-gate=busy]')).toBeVisible()
    await page.getByRole('link', { name: /Projects/ }).click()
    await expect(page.locator('li.project')).toHaveCount(1)
    await second.reload()
    await expect(second.locator('.timeline')).toBeVisible()
  })

  test('a project that another tab has open is not renamed or deleted from the list', async ({ page }) => {
    const address = await openProject(page)
    const list = await page.context().newPage()
    await list.goto('/')
    await expect(list.locator('li.project')).toHaveCount(1)
    await list.getByRole('button', { name: /Delete landscape/ }).click()
    await list.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(list.getByTestId('project-busy')).toContainText('open in another tab')
    await expect(list.locator('li.project')).toHaveCount(1)

    await list.getByRole('button', { name: /Rename/ }).first().click()
    await list.getByRole('dialog').getByLabel('Project name').fill('Renamed meanwhile')
    await list.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(list.getByTestId('project-busy')).toBeVisible()
    await expect(list.locator('li.project')).toContainText('landscape')

    // Once the project is closed in the first tab, the list can do both.
    await page.goto('/')
    await list.getByRole('button', { name: /Rename/ }).first().click()
    await list.getByRole('dialog').getByLabel('Project name').fill('Renamed now')
    await list.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(list.locator('li.project')).toContainText('Renamed now')
    await expect(list.getByTestId('project-busy')).toHaveCount(0)
    expect(address).toContain('#/p/')
  })

  test('is in the app’s language: Hebrew', async ({ page }) => {
    const address = await openProject(page)
    const second = await page.context().newPage()
    await second.addInitScript(() => localStorage.setItem('justinvideo-language', 'he'))
    await second.goto(address)
    await expect(second.locator('[data-gate=busy]')).toContainText('הפרויקט פתוח בלשונית אחרת')
    await expect(second.getByTestId('use-here')).toHaveText('להשתמש בו כאן')
  })
})
