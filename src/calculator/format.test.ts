import { formatNumber, formatRate, parseRateInput } from './format';

test('formatNumber: 4 significant figures, separators, no exponent, no -0', () => {
  expect(formatNumber(513.25)).toBe('513.3');
  expect(formatNumber(5.57)).toBe('5.57');
  expect(formatNumber(0.0464)).toBe('0.0464');
  expect(formatNumber(12000)).toBe('12,000');
  expect(formatNumber(0)).toBe('0');
  expect(formatNumber(-1e-12)).toBe('0');
});

test('formatRate adds the unit for the resource kind', () => {
  expect(formatRate(5.57, 'item')).toBe('5.57/s');
  expect(formatRate(513.25, 'fluid')).toBe('513.3 L/s');
  expect(formatRate(599.3, 'eu')).toBe('599.3 EU/t');
});

test('parseRateInput accepts only finite positive numbers', () => {
  expect(parseRateInput('5.57')).toBe(5.57);
  expect(parseRateInput(' 2 ')).toBe(2);
  for (const bad of ['', '0', '-1', 'abc', '1e999', 'Infinity', '3abc']) expect(parseRateInput(bad)).toBeUndefined();
  expect(parseRateInput('0', { allowZero: true })).toBe(0);
  expect(parseRateInput('-1', { allowZero: true })).toBeUndefined();
});
