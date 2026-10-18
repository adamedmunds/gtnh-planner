import { createHighsSolver } from './highs';
import type { LpSolver } from './types';

let solver: LpSolver;
beforeAll(async () => {
  solver = await createHighsSolver();
});

test('solves the README workshop LP (continuous): 20 chairs, 10 tables, profit 1100', async () => {
  const r = await solver.solve({
    sense: 'max',
    objective: { chairs: 30, tables: 50 },
    constraints: [
      { name: 'carpentry', terms: { chairs: 1, tables: 2 }, op: '<=', rhs: 40 },
      { name: 'finishing', terms: { chairs: 2, tables: 1 }, op: '<=', rhs: 50 },
    ],
  });
  expect(r.status).toBe('optimal');
  if (r.status !== 'optimal') return;
  expect(r.objective).toBeCloseTo(1100);
  expect(r.values.chairs).toBeCloseTo(20);
  expect(r.values.tables).toBeCloseTo(10);
});

test('reports infeasible', async () => {
  const r = await solver.solve({
    sense: 'min',
    objective: { x: 1 },
    constraints: [
      { name: 'lo', terms: { x: 1 }, op: '>=', rhs: 5 },
      { name: 'hi', terms: { x: 1 }, op: '<=', rhs: 1 },
    ],
  });
  expect(r.status).toBe('infeasible');
});

test('reports unbounded', async () => {
  const r = await solver.solve({ sense: 'max', objective: { x: 1 }, constraints: [{ name: 'c', terms: { x: 1 }, op: '>=', rhs: 0 }] });
  expect(r.status).toBe('unbounded');
});

test('variable and row names with resource-key characters round-trip', async () => {
  const v = 'x_item:gregtech:gt.metaitem.01@30001';
  const r = await solver.solve({
    sense: 'min',
    objective: { [v]: 1 },
    constraints: [{ name: 'net_fluid:liquid_light_fuel', terms: { [v]: 2 }, op: '=', rhs: 6 }],
  });
  expect(r.status).toBe('optimal');
  if (r.status === 'optimal') expect(r.values[v]).toBeCloseTo(3);
});
