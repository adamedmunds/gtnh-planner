import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** The canvas starts at the browser default 300x150 until react-three-fiber measures it; wait for that. */
async function canvasBox(page: Page) {
  const canvas = page.locator('canvas');
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(400);
  return (await canvas.boundingBox())!;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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
