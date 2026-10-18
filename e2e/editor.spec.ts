import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** The canvas starts at the browser default 300x150 until react-three-fiber measures it; wait for that. */
async function canvasBox(page: Page) {
  const canvas = page.locator('canvas');
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(400);
  return (await canvas.boundingBox())!;
}

// Each Playwright test gets a fresh browser context, so storage starts empty.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('place a machine, see it in the materials list, export a gzipped schematic', async ({ page }) => {
  await page.getByTestId('palette-distillery_lv').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect(page.getByTestId('materials')).toContainText('1× LV Distillery');

  const download = page.waitForEvent('download');
  await page.getByTestId('export').click();
  const file = await (await download).path();
  const bytes = readFileSync(file!);
  expect(bytes[0]).toBe(0x1f);
  expect(bytes[1]).toBe(0x8b);
});

test('right-click removes, and the build survives a reload', async ({ page }) => {
  const box = await canvasBox(page);
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('materials')).toContainText('1× LV Distillery');
  await page.mouse.click(at.x, at.y - 8, { button: 'right' }); // a few px up: lands on the placed block
  await expect(page.getByTestId('materials')).toHaveCount(0);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('materials')).toContainText('1× LV Distillery');
  await page.waitForTimeout(600); // autosave debounce
  await page.reload();
  await expect(page.getByTestId('materials')).toContainText('1× LV Distillery');
});

test('loads the oil berry example', async ({ page }) => {
  page.once('dialog', (d) => d.accept('5.6'));
  await page.getByTestId('example').click();
  await expect(page.getByTestId('materials')).toContainText('6× LV Fluid Extractor');
  await expect(page.getByTestId('materials')).toContainText('17× LV Distillery');
  await expect(page.getByTestId('export')).toBeEnabled();
});

test('a dragged pointer does not place anything', async ({ page }) => {
  const box = await canvasBox(page);
  const x = box.x + box.width / 2, y = box.y + box.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('materials')).toHaveCount(0);
  await expect(page.getByTestId('export')).toBeDisabled();
});

/** Moves around the cursor until the info panel shows `name`, returning that screen point. */
async function findBlock(page: Page, near: { x: number; y: number }, name: RegExp) {
  for (const dy of [0, -6, -12, -18, 6, -24, 12]) {
    for (const dx of [0, -6, 6, -12, 12]) {
      await page.mouse.move(near.x + dx, near.y + dy);
      const heading = page.locator('.info h3');
      if ((await heading.count()) > 0 && name.test((await heading.textContent()) ?? '')) return { x: near.x + dx, y: near.y + dy };
    }
  }
  throw new Error(`no block matching ${name} near the cursor`);
}

test('a drag that ends over a block neither places nor removes', async ({ page }) => {
  const box = await canvasBox(page);
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };
  await page.mouse.click(at.x, at.y);
  const onBlock = await findBlock(page, at, /LV Distillery/);
  for (const button of ['left', 'right'] as const) {
    await page.mouse.move(onBlock.x - 120, onBlock.y + 40);
    await page.mouse.down({ button });
    await page.mouse.move(onBlock.x, onBlock.y, { steps: 10 });
    await page.mouse.up({ button });
  }
  await expect(page.getByTestId('materials')).toHaveText('1× LV Distillery');
});

test('a right-drag that starts on a block pans instead of removing it', async ({ page }) => {
  const box = await canvasBox(page);
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };
  await page.mouse.click(at.x, at.y);
  const onBlock = await findBlock(page, at, /LV Distillery/);
  await page.mouse.move(onBlock.x, onBlock.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(onBlock.x + 90, onBlock.y + 30, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await expect(page.getByTestId('materials')).toHaveText('1× LV Distillery');
});

test('R rotates the hovered machine', async ({ page }) => {
  const box = await canvasBox(page);
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };
  await page.mouse.click(at.x, at.y);
  await findBlock(page, at, /LV Distillery/);
  const front = page.locator('.info dd').nth(2);
  const before = await front.innerText();
  await page.keyboard.press('r');
  await expect(front).not.toHaveText(before);
});

test('Shift+click on a pipe toggles a connection', async ({ page }) => {
  await page.getByTestId('palette-bronze_pipe_large').click();
  const box = await canvasBox(page);
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };
  await page.mouse.click(at.x, at.y);
  const onPipe = await findBlock(page, at, /Large Bronze Fluid Pipe/);
  const connected = page.locator('.info dd').last();
  await expect(connected).toHaveText('none');
  await page.keyboard.down('Shift');
  await page.mouse.click(onPipe.x, onPipe.y);
  await page.keyboard.up('Shift');
  await page.mouse.move(onPipe.x + 1, onPipe.y);
  await expect(connected).not.toHaveText('none');
  await expect(page.getByTestId('materials')).toHaveText('1× Large Bronze Fluid Pipe'); // nothing placed
});

test('loading an invalid file shows an error and keeps the current build', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
  await expect(page.getByTestId('toasts')).toContainText('Not a valid JSON file');
  await expect(page.getByTestId('materials')).toHaveText('1× LV Distillery');
});

test('Ctrl+Z undoes and Ctrl+Y redoes', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect(page.getByTestId('materials')).toHaveText('1× LV Distillery');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('materials')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('materials')).toHaveText('1× LV Distillery');
});
