import { safeFileName } from './download';

test.each([
  ['oil berry line', 'oil-berry-line'],
  ['  ', 'build'],
  ['a/b\\c:d', 'a-b-c-d'],
  ['Line_2', 'Line_2'],
])('safeFileName(%j) = %j', (input, expected) => {
  expect(safeFileName(input)).toBe(expected);
});
