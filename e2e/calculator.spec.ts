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

/** The self-powered oil berry line at 5.57 Oil Berry/s (MV combustion generators). */
async function buildOilLine(page: Page) {
  await openCalculator(page);
  await addLightFuelReactor(page);
  await addMaker(page, KEY.sulfuricLightFuel, 'Distillery', /50 L Oil/);
  await addMaker(page, KEY.oil, 'Oil Berry', /Fluid Extractor/);
  await addMaker(page, KEY.hydrogenCell, 'Hydrogen Sulfide', /Electrolyzer/);
  await page.locator(`[data-testid=node-row][data-key="${KEY.oilBerry}"]`).first().getByRole('button', { name: 'I have this' }).click();
  await page.getByRole('button', { name: 'Power it with a generator' }).click();
  await page.getByTestId('picker').getByLabel('Filter').fill('Light Fuel');
  await page.getByTestId('picker-row').filter({ hasText: /Combustion/ }).filter({ hasNotText: 'Sulfuric' }).first().getByTestId('use-recipe').click();
  await page.getByTestId('node-card').filter({ hasText: 'Light Fuel → EU' }).getByTestId('machine-select')
    .selectOption({ label: 'Advanced Combustion Generator' });
  const have = page.getByLabel('How much Oil Berry you have');
  await have.fill('5.57');
  await have.press('Enter');
  await expect(page.getByTestId('summary-get')).toContainText(/513\.\d L\/s/);
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

  test('reference: oil berry line to ≈513 L/s, self-powered', async ({ page }) => {
    test.setTimeout(120_000);
    await openCalculator(page);
    await addLightFuelReactor(page);
    await addMaker(page, KEY.sulfuricLightFuel, 'Distillery', /50 L Oil/);
    await addMaker(page, KEY.oil, 'Oil Berry', /Fluid Extractor/);
    await addMaker(page, KEY.hydrogenCell, 'Hydrogen Sulfide', /Electrolyzer/);
    await page.locator(`[data-testid=node-row][data-key="${KEY.oilBerry}"]`).first().getByRole('button', { name: 'I have this' }).click();

    await page.getByRole('button', { name: 'Power it with a generator' }).click();
    await expect(page.getByTestId('picker')).toContainText('Power it with a generator');
    await page.getByTestId('picker').getByLabel('Filter').fill('Light Fuel');
    await page.getByTestId('picker-row').filter({ hasText: /Combustion/ }).filter({ hasNotText: 'Sulfuric' }).first().getByTestId('use-recipe').click();
    await page.getByTestId('node-card').filter({ hasText: 'Light Fuel → EU' }).getByTestId('machine-select')
      .selectOption({ label: 'Advanced Combustion Generator' });

    const have = page.getByLabel('How much Oil Berry you have');
    await have.fill('5.57');
    await have.press('Enter');
    await expect(page.getByTestId('summary-get')).toContainText(/513\.\d L\/s/);
    const machines = page.getByTestId('summary-machines');
    for (const m of ['×6 Basic Fluid Extractor', '×17 Basic Distillery', '×1 Basic Chemical Reactor', '×1 Advanced Electrolyzer', '×5 Advanced Combustion Generator']) {
      await expect(machines).toContainText(m);
    }
    await expect(page.getByTestId('summary-power').locator('dd').nth(2)).toHaveText('0 EU/t');
    await expect(page.getByTestId('drive-line')).toHaveText('Making as much Light Fuel as 5.57 Oil Berry/s allows');
    await expect(page.getByTestId('summary-problems')).toHaveCount(0);

    // Save the project, forget everything, load it back.
    await page.getByTestId('tab-editor').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save .json' }).click();
    const file = (await (await download).path())!;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('input[type=file]').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: readFileSync(file) });
    await page.getByTestId('tab-calculator').click();
    await expect(page.getByTestId('summary-get')).toContainText(/513\.\d L\/s/, { timeout: 30_000 });
  });

  test('forward: what you have → use this in…, then pick the product', async ({ page }) => {
    await openCalculator(page);
    await start(page, 'have', 'Oil Berry', KEY.oilBerry);
    await pick(page, 'Fluid Extractor', /Fluid Extractor/);
    await expect(page.getByTestId('have-box')).toHaveAttribute('data-key', KEY.oilBerry);
    await expect(page.getByTestId('get-box')).toHaveAttribute('data-key', KEY.oil);
    await page.locator(`[data-testid=node-row][data-key="${KEY.oil}"]`).first().getByTestId('add-use').click();
    await pick(page, 'Distillery', /Sulfuric Light Fuel/);
    const get = page.getByTestId('get-box');
    await expect(get).toHaveAttribute('data-key', KEY.sulfuricLightFuel);
    await expect(get).toHaveClass(/provisional/);
    await get.getByRole('button', { name: 'I want this' }).click();
    await expect(get).not.toHaveClass(/provisional/);
  });

  test('nothing typed shows one machine', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await expect(page.getByTestId('drive-line')).toHaveText(/^Showing one Basic Chemical Reactor/);
    await expect(page.getByTestId('summary-machines')).toContainText('×1 Basic Chemical Reactor');
  });

  test('closing the picker after "What do you have?" leaves nothing behind', async ({ page }) => {
    await openCalculator(page);
    await start(page, 'have', 'Oil Berry', KEY.oilBerry);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('have-box')).toHaveCount(0);
    await expect(page.getByPlaceholder('What do you want to make?')).toBeVisible();
  });

  test('deleting the product machine lets the line pick a new product', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await page.getByTestId('node-card').getByTitle('Remove from the line').click();
    await start(page, 'have', 'Oil Berry', KEY.oilBerry);
    await pick(page, 'Fluid Extractor', /Fluid Extractor/);
    await expect(page.getByTestId('get-box')).toHaveAttribute('data-key', KEY.oil);
    await expect(page.getByTestId('summary-problems')).toHaveCount(0);
  });

  test('the picker counts and filters every recipe, not just the first 500', async ({ page }) => {
    await openCalculator(page);
    await start(page, 'have', 'Water', 'fluid:water');
    const count = Number((await page.getByTestId('picker').locator('header .hint').innerText()).split(' ')[0].replace(/,/g, ''));
    expect(count).toBeGreaterThan(500);
  });

  test('text stays readable: the built line is not zoomed out below 0.8', async ({ page }) => {
    test.setTimeout(120_000);
    await openCalculator(page);
    await addLightFuelReactor(page);
    await addMaker(page, KEY.sulfuricLightFuel, 'Distillery', /50 L Oil/);
    await addMaker(page, KEY.oil, 'Oil Berry', /Fluid Extractor/);
    await addMaker(page, KEY.hydrogenCell, 'Hydrogen Sulfide', /Electrolyzer/);
    await page.waitForTimeout(500);
    const zoom = await page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(zoom).toBeGreaterThanOrEqual(0.8);
  });

  test('Build in 3D lays out the oil line as a core and slices', async ({ page }) => {
    test.setTimeout(120_000);
    await buildOilLine(page);
    await page.getByRole('button', { name: 'Build in 3D' }).click();
    await expect(page.getByTestId('tab-editor')).toHaveClass(/on/);
    const materials = page.getByTestId('materials');
    await expect(materials).toContainText('6× LV Fluid Extractor');
    await expect(materials).toContainText('18× LV Distillery');
    await expect(page.getByTestId('line-notes')).toContainText('6 slices');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('materials')).toHaveCount(0);
  });

  test('Build in 3D as a straight line keeps the exact counts', async ({ page }) => {
    test.setTimeout(120_000);
    await buildOilLine(page);
    await page.getByLabel('Straight line (no copy-paste slices)').check();
    await page.getByRole('button', { name: 'Build in 3D' }).click();
    await expect(page.getByTestId('materials')).toContainText('17× LV Distillery');
  });

  test('the calculator tab loads recipes and is remembered', async ({ page }) => {
    await openCalculator(page);
    await page.reload();
    await expect(page.getByPlaceholder('What do you want to make?')).toBeVisible({ timeout: 30_000 });
  });
});
