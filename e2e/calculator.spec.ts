import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const hasRecipes = existsSync('public/data/recipes.json.gz');
const KEY = {
  lightFuel: 'fluid:liquid_light_fuel',
  sulfuricLightFuel: 'fluid:liquid_sufluriclight_fuel',
  oil: 'fluid:oil',
  oilBerry: 'item:cropsnh:materialLeaf@10',
  hydrogenCell: 'item:gregtech:gt.metaitem.01@30001',
};

async function openCalculator(page: Page) {
  await page.getByTestId('tab-calculator').click();
  await expect(page.getByPlaceholder('What do you want to make?')).toBeVisible({ timeout: 30_000 });
}

/** Start screen: search "What do you want to make?" or "What do you have?" and pick the item with `key`. */
async function start(page: Page, kind: 'make' | 'have', text: string, key: string) {
  await page.getByPlaceholder(kind === 'make' ? 'What do you want to make?' : 'What do you have?').fill(text);
  await page.locator(`[data-testid=start-result][data-key="${key}"]`).first().click();
  await expect(page.getByTestId('picker')).toBeVisible();
}

/** In the open picker, type `filter` in its filter box, then "Use this" on the first row matching every pattern. */
async function pick(page: Page, filter: string, ...match: RegExp[]) {
  await page.getByTestId('picker').getByLabel('Filter').fill(filter);
  let row = page.getByTestId('picker-row');
  for (const m of match) row = row.filter({ hasText: m });
  await row.first().getByTestId('use-recipe').click();
  await expect(page.getByTestId('picker')).toHaveCount(0);
}

/** "+ add what makes this" on the first machine row for `key`, then pick. */
async function addMaker(page: Page, key: string, filter: string, ...match: RegExp[]) {
  await page.locator(`[data-testid=node-row][data-key="${key}"]`).first().getByTestId('add-make').click();
  await pick(page, filter, ...match);
}

/** Light Fuel from the chemical reactor recipe that also makes Hydrogen Sulfide Cells. */
async function addLightFuelReactor(page: Page) {
  await start(page, 'make', 'Light Fuel', KEY.lightFuel);
  await pick(page, 'Hydrogen Sulfide', /Chemical Reactor/);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('missing recipe data shows import instructions', async ({ page }) => {
  await page.route('**/data/recipes.json.gz', (r) => r.fulfill({ status: 404 }));
  await page.getByTestId('tab-calculator').click();
  await expect(page.getByTestId('recipe-status')).toContainText('npm run recipes');
  await page.getByTestId('tab-editor').click();
  await expect(page.getByTestId('palette-distillery_lv')).toBeVisible();
});

test.describe('with recipe data', () => {
  test.skip(!hasRecipes, 'run npm run recipes first');

  test('start from what you want: Light Fuel → chemical reactor', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await expect(page.getByTestId('node-card')).toHaveCount(1);
    await expect(page.getByTestId('node-card')).toContainText('Chemical Reactor');
  });

  test('start from what you have: Oil Berry → fluid extractor', async ({ page }) => {
    await openCalculator(page);
    await start(page, 'have', 'Oil Berry', KEY.oilBerry);
    await expect(page.getByTestId('picker')).toContainText('What uses Oil Berry?');
    await pick(page, 'Fluid Extractor', /Fluid Extractor/);
    await expect(page.getByTestId('node-card')).toHaveCount(1);
    await expect(page.getByTestId('node-card')).toContainText('Fluid Extractor');
  });

  test('the picker shows clear rows and closes with Escape', async ({ page }) => {
    await openCalculator(page);
    await start(page, 'make', 'Light Fuel', KEY.lightFuel);
    await page.getByTestId('picker').getByLabel('Filter').fill('Hydrogen Sulfide');
    const row = page.getByTestId('picker-row').filter({ hasText: /Chemical Reactor/ }).filter({ hasText: /Hydrogen Sulfide Cell/ }).first();
    await expect(row).toContainText('12,000 L Sulfuric Light Fuel');
    await expect(row).toContainText('EU/t');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('node-card')).toHaveCount(0);
  });

  test('add what makes this builds the chain upstream', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await addMaker(page, KEY.sulfuricLightFuel, 'Distillery', /50 L Oil/);
    await expect(page.getByTestId('node-card')).toHaveCount(2);
    await expect(page.locator('.react-flow__edge-text', { hasText: 'Sulfuric Light Fuel' })).toHaveCount(1);
    const box = async (title: string) => (await page.getByTestId('node-card').filter({ hasText: title }).boundingBox())!;
    expect((await box('Distillery')).x).toBeLessThan((await box('Chemical Reactor')).x);
    await expect(page.getByRole('button', { name: 'Build in 3D' })).toBeDisabled();
  });

  test('use this in… builds forward', async ({ page }) => {
    await openCalculator(page);
    await start(page, 'have', 'Oil Berry', KEY.oilBerry);
    await pick(page, 'Fluid Extractor', /Fluid Extractor/);
    await page.locator(`[data-testid=node-row][data-key="${KEY.oil}"]`).first().getByTestId('add-use').click();
    await expect(page.getByTestId('picker')).toContainText('What uses Oil?');
    await pick(page, 'Distillery', /Sulfuric Light Fuel/);
    await expect(page.getByTestId('node-card')).toHaveCount(2);
  });

  test('Delete on the 3D Editor tab does not touch the calculator graph', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await page.getByTestId('node-card').locator('header b').click();
    await page.getByTestId('tab-editor').click();
    await page.keyboard.press('Delete');
    await page.getByTestId('tab-calculator').click();
    await expect(page.getByTestId('node-card')).toHaveCount(1);
  });

  test('the oil berry line, undo, and save/load', async ({ page }) => {
    test.setTimeout(120_000);
    await openCalculator(page);
    await addLightFuelReactor(page);
    await addMaker(page, KEY.sulfuricLightFuel, 'Distillery', /50 L Oil/);
    await addMaker(page, KEY.oil, 'Oil Berry', /Fluid Extractor/);
    await addMaker(page, KEY.hydrogenCell, 'Hydrogen Sulfide', /Electrolyzer/);
    await expect(page.getByTestId('node-card')).toHaveCount(4);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('node-card')).toHaveCount(3);
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('node-card')).toHaveCount(4);

    await page.getByTestId('tab-editor').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save .json' }).click();
    const file = (await (await download).path())!;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('input[type=file]').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: readFileSync(file) });
    await page.getByTestId('tab-calculator').click();
    await expect(page.getByTestId('node-card')).toHaveCount(4, { timeout: 30_000 });
  });

  test('type what you have, what you want, and a machine count', async ({ page }) => {
    test.setTimeout(120_000);
    await openCalculator(page);
    await addLightFuelReactor(page);
    await addMaker(page, KEY.sulfuricLightFuel, 'Distillery', /50 L Oil/);
    await addMaker(page, KEY.oil, 'Oil Berry', /Fluid Extractor/);
    await addMaker(page, KEY.hydrogenCell, 'Hydrogen Sulfide', /Electrolyzer/);
    await page.locator(`[data-testid=node-row][data-key="${KEY.oilBerry}"]`).first().getByRole('button', { name: 'I have this' }).click();

    const have = page.getByLabel('How much Oil Berry you have');
    await have.fill('5.57');
    await have.press('Enter');
    await expect(page.getByTestId('summary-get')).toContainText('557 L/s'); // 5.57 berries × 100 L; no generator yet, so power comes from outside

    const count = page.getByLabel('Machines of Basic Distillery');
    await count.fill('4');
    await count.press('Enter');
    await expect(page.getByTestId('summary-get')).toContainText('133.3 L/s');
    await count.fill('');
    await count.press('Enter');

    const want = page.getByLabel('How much Light Fuel you want');
    await want.fill('1000');
    await want.press('Enter');
    await expect(page.getByTestId('summary-problems')).toContainText('Needs');
    await expect(page.getByTestId('summary-problems')).toContainText('Oil Berry');
    await expect(page.getByTestId('drive-line')).toHaveText('Making 1,000 L/s Light Fuel');

    await page.getByTestId('drive-line').click(); // leave the field so Ctrl+Z reaches the calculator
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('summary-problems')).toHaveCount(0);
    await expect(page.locator('.calc-root')).not.toContainText(/target|limit|maximi[sz]e|bought in/i);
  });

  test('the calculator tab loads recipes and is remembered', async ({ page }) => {
    await openCalculator(page);
    await page.reload();
    await expect(page.getByPlaceholder('What do you want to make?')).toBeVisible({ timeout: 30_000 });
  });
});
