import type { ChainResult } from '../calc/solve';
import { createLatest, displayResult } from './solveState';

const r = (status: ChainResult['status']) => ({ status }) as ChainResult;

test('displayResult: ok shows current; infeasible shows current greyed; unbounded/error show the last ok greyed', () => {
  const ok = r('ok');
  expect(displayResult(ok, undefined)).toEqual({ result: ok, greyed: false });
  const inf = r('infeasible');
  expect(displayResult(inf, ok)).toEqual({ result: inf, greyed: true });
  expect(displayResult(r('unbounded'), ok)).toMatchObject({ result: ok, greyed: true });
  expect(displayResult(r('error'), ok)).toMatchObject({ result: ok, greyed: true });
  expect(displayResult(undefined, undefined)).toEqual({ result: undefined, greyed: false });
});

test('createLatest: only the newest ticket is current', () => {
  const latest = createLatest();
  const a = latest.next();
  const b = latest.next();
  expect(latest.isLatest(a)).toBe(false);
  expect(latest.isLatest(b)).toBe(true);
});

test('unbounded or failed solves keep the last ok numbers but pass on their message', () => {
  const ok = r('ok');
  const unbounded = { ...r('unbounded'), message: 'Set a supply limit for Oil Berry to maximise Light Fuel.' };
  expect(displayResult(unbounded, ok)).toEqual({ result: ok, greyed: true, problem: unbounded.message });
  expect(displayResult(unbounded, undefined)).toEqual({ result: undefined, greyed: true, problem: unbounded.message });
  expect(displayResult(r('error'), ok).problem).toMatch(/error/);
});
