import { createHighsSolver } from '../calc/solver/highs';
import { solveForScreen } from '../calculator/drive';
import { db, reference } from '../calculator/testChains';
import { buildLine } from './build';
import { checkLine } from './check';
import { planLine } from './plan';
import { UNTIDY_NOTE } from './tidy';

vi.mock('./tidySlice', async (orig) => ({ ...(await orig<typeof import('./tidySlice')>()), tidySlice: () => ({ fail: 'forced for this test' }) }));

test("a line that can't be tidy says so, and still passes the checker", async () => {
  const plan = planLine(reference(), db, await solveForScreen(reference(), db, await createHighsSolver()), 'modular');
  if ('error' in plan) throw new Error(plan.error);
  const { build } = buildLine(plan, 'Light Fuel line');
  expect(build.notes).toContain(UNTIDY_NOTE);
  expect(checkLine(build, plan)).toEqual([]);
});
