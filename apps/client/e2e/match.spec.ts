import { expect, test, type Page } from '@playwright/test'

/** Click the canvas at the projected screen position of a board coord —
 *  the click travels the real R3F raycasting path.
 *
 *  Pieces are cones centered at y=0.55 (see Pieces.tsx); a synthetic
 *  Playwright click projected at ground level (y=0) raycasts past the cone
 *  and hits the tile beneath it instead of selecting the piece. Projecting
 *  at the piece's own mid-height puts the synthetic ray back on the cone. */
async function clickCoord(page: Page, key: string, y = 0): Promise<void> {
  const pos = await page.evaluate(([k, height]) => window.__meridianDebug!.worldToScreen(k, height), [
    key,
    y,
  ] as [string, number])
  await page.mouse.click(pos.x, pos.y)
}

async function statusText(page: Page): Promise<string> {
  return (await page.getByTestId('status').textContent()) ?? ''
}

test('two browsers complete a full match to a win', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()

  // Lobby: create, read the code, join from the second browser.
  await host.goto('/')
  await host.getByTestId('create-button').click()
  await expect(host.getByTestId('join-code')).toBeVisible()
  const code = (await host.getByTestId('join-code').textContent())!.trim()
  expect(code).toMatch(/^[A-Z]{4}$/)

  await guest.goto('/')
  await guest.getByTestId('join-input').fill(code)
  await guest.getByTestId('join-button').click()

  await expect(host.getByTestId('status')).toHaveText('your turn')
  await expect(guest.getByTestId('status')).toHaveText("opponent's turn")

  // Host (seat 0) marches p0-0 from (-3,0) across the board, capturing all
  // three guest pieces; guest passes every turn. Same path the server's own
  // scripted-match test uses.
  const path = ['-2,0', '-1,0', '0,0', '1,0', '2,0', '3,0', '3,-1', '3,-2']
  let from = '-3,0'
  for (const target of path) {
    await expect(host.getByTestId('status')).toHaveText('your turn')
    await clickCoord(host, from, 0.55) // select our piece (occupied hex — click at piece mid-height)
    await clickCoord(host, target, 0) // move / capture (destination hex — ground level)
    from = target

    // stop passing once the match is over
    const hostBanner = host.getByTestId('winner-banner')
    if (await hostBanner.isVisible().catch(() => false)) break
    if (target === '3,-2') break
    await expect(guest.getByTestId('status')).toHaveText('your turn')
    await guest.getByTestId('end-turn').click()
  }

  await expect(host.getByTestId('winner-banner')).toHaveText(/You win/)
  await expect(guest.getByTestId('winner-banner')).toHaveText(/You lose/)
})

test('perf snapshot: single-digit draw calls', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()
  await host.goto('/')
  await host.getByTestId('create-button').click()
  const code = (await host.getByTestId('join-code').textContent())!.trim()
  await guest.goto('/')
  await guest.getByTestId('join-input').fill(code)
  await guest.getByTestId('join-button').click()
  await expect(host.getByTestId('status')).toHaveText('your turn')

  const info = await host.evaluate(() => window.__meridianDebug!.renderInfo())
  console.log('PERF renderInfo:', JSON.stringify(info))
  expect(info.drawCalls).toBeLessThan(10)
})
