import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const hasRecipes = existsSync('public/data/recipes.json.gz');

async function openCalculator(page: Page) {
  await page.getByTestId('tab-calculator').click();
  await expect(page.getByPlaceholder('Search items and fluids')).toBeVisible({ timeout: 30_000 });
}

/** Recipe browser → Light Fuel → Made by → the chemical reactor recipe that also makes Hydrogen Sulfide Cells. */
async function addLightFuelReactor(page: Page) {
  await showInBrowser(page, 'Light Fuel', 'fluid:liquid_light_fuel');
  await page.getByTestId('browser-row').filter({ hasText: 'Chemical Reactor' }).filter({ hasText: 'Hydrogen Sulfide Cell' })
    .first().getByTestId('add-recipe').click();
}

async function showInBrowser(page: Page, text: string, key: string) {
  await page.getByPlaceholder('Search items and fluids').fill(text);
  await page.locator(`[data-testid=browser-result][data-key="${key}"]`).click();
  await expect(page.getByTestId('browser-selected')).toHaveText(text);
}

/** Opens "suggest" on the first node row for `key` and adds the first suggestion matching every pattern. */
async function suggest(page: Page, key: string, ...match: RegExp[]) {
  await page.locator(`[data-testid=node-row][data-key="${key}"]`).first().getByTestId('suggest').click();
  let row = page.getByTestId('suggestion');
  for (const m of match) row = row.filter({ hasText: m });
  await row.first().getByRole('button', { name: 'Add' }).click();
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

  test('browse, add a recipe and set a target', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await page.getByTestId('browser-selected').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Make/ }).click();
    await expect(page.getByTestId('targets-bar')).toContainText('Light Fuel');
    await expect(page.getByTestId('overview-outputs')).toContainText('Light Fuel');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('targets-bar')).not.toContainText('Light Fuel');
  });

  test('suggest builds the chain upstream', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await expect(page.getByTestId('node-card')).toHaveCount(1);
    await suggest(page, 'fluid:liquid_sufluriclight_fuel', /Distillery/, /50 L Oil(,| →)/);
    await expect(page.getByTestId('node-card')).toHaveCount(2);
    await expect(page.locator('.react-flow__edge-text', { hasText: 'Sulfuric Light Fuel' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Auto-arrange' }).click();
    const box = async (title: string) => (await page.getByTestId('node-card').filter({ hasText: title }).boundingBox())!;
    expect((await box('Distillery')).x).toBeLessThan((await box('Chemical Reactor')).x);
    await expect(page.getByRole('button', { name: 'Build in 3D' })).toBeDisabled();
  });

  test('reference: oil berry line to ≈513 L/s, with undo', async ({ page }) => {
    test.setTimeout(120_000);
    await openCalculator(page);
    await addLightFuelReactor(page);
    await suggest(page, 'fluid:liquid_sufluriclight_fuel', /Distillery/, /50 L Oil(,| →)/);
    await suggest(page, 'fluid:oil', /Oil Berry/);
    await suggest(page, 'item:gregtech:gt.metaitem.01@30001', /Electrolyzer/, /Hydrogen Sulfide Cell/);

    await showInBrowser(page, 'Light Fuel', 'fluid:liquid_light_fuel');
    await page.getByRole('button', { name: /^Burned in/ }).click();
    await page.getByTestId('browser-row').filter({ hasText: 'Combustion' }).first().getByTestId('add-recipe').click();
    await page.getByTestId('node-card').filter({ hasText: 'Light Fuel → EU' }).getByTestId('machine-select')
      .selectOption({ label: 'Advanced Combustion Generator' });

    await page.getByTestId('browser-selected').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Maximise' }).click();
    await page.locator('[data-testid=node-row][data-key="item:cropsnh:materialLeaf@10"]').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Supply limit/ }).click();
    const limit = page.getByLabel('Supply limit for Oil Berry');
    await limit.fill('5.57');
    await limit.press('Enter');

    const outputs = page.getByTestId('overview-outputs');
    await expect(outputs).toContainText('Light Fuel');
    await expect(outputs).toContainText(/513\.\d L\/s/);
    await expect(page.getByTestId('overview-problems')).toHaveCount(0);
    await expect(page.getByTestId('overview-power').locator('dd').nth(2)).toHaveText('0 EU/t');

    await page.getByRole('heading', { name: 'Outputs' }).click(); // leave the input so Ctrl+Z reaches the calculator
    await page.keyboard.press('Control+z');
    await expect(outputs).not.toContainText(/513\.\d L\/s/);
    await page.keyboard.press('Control+y');
    await expect(outputs).toContainText(/513\.\d L\/s/);

    // Save the project, forget everything, load it back.
    await page.getByTestId('tab-editor').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save .json' }).click();
    const file = (await (await download).path())!;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('input[type=file]').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: readFileSync(file) });
    await page.getByTestId('tab-calculator').click();
    await expect(page.getByTestId('overview-outputs')).toContainText(/513\.\d L\/s/, { timeout: 30_000 });
  });

  test('maximise without a limit says why nothing is shown', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    await page.getByTestId('browser-selected').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Maximise' }).click();
    await expect(page.getByTestId('overview-problems')).toContainText('Set a supply limit');
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

  test('a suggest list closes when its input is marked bought in', async ({ page }) => {
    await openCalculator(page);
    await addLightFuelReactor(page);
    const row = page.locator('[data-testid=node-row][data-key="item:gregtech:gt.metaitem.01@30001"]');
    await row.getByTestId('suggest').click();
    await expect(page.getByTestId('suggestion').first()).toBeVisible();
    await row.locator('.node-row > span').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark bought in' }).click();
    await expect(page.getByTestId('suggestion')).toHaveCount(0);
  });

  test('the calculator tab loads recipes and is remembered', async ({ page }) => {
    await openCalculator(page);
    await page.reload();
    await expect(page.getByPlaceholder('Search items and fluids')).toBeVisible({ timeout: 30_000 });
  });
});
