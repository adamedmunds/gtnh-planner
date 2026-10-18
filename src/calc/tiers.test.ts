import { V, overclock, tierForEut } from './tiers';

test('tierForEut picks the lowest tier whose voltage covers the EU/t', () => {
  expect(tierForEut(8)).toBe(0);
  expect(tierForEut(24)).toBe(1);
  expect(tierForEut(30)).toBe(1);
  expect(tierForEut(32)).toBe(1);
  expect(tierForEut(120)).toBe(2);
  expect(V[2]).toBe(128);
});

test('overclock: duration halves (min 1 tick), EU/t quadruples, per overclock', () => {
  expect(overclock(30, 20, 0)).toEqual({ eut: 30, duration: 20 });
  expect(overclock(30, 20, 1)).toEqual({ eut: 120, duration: 10 });
  expect(overclock(30, 20, 2)).toEqual({ eut: 480, duration: 5 });
  expect(overclock(30, 1, 3)).toEqual({ eut: 1920, duration: 1 });
});
