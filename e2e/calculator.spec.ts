import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const hasRecipes = existsSync('public/data/recipes.json.gz');

async function openCalculator(page: Page) {
  await page.getByTestId('tab-calculator').click();
  await expect(page.getByPlaceholder('Search items and fluids')).toBeVisible({ timeout: 30_000 });
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

  test('the calculator tab loads recipes and is remembered', async ({ page }) => {
    await openCalculator(page);
    await page.reload();
    await expect(page.getByPlaceholder('Search items and fluids')).toBeVisible({ timeout: 30_000 });
  });
});
