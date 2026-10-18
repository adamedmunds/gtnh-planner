import { gzipSync } from 'fflate';
import {
  byte, byteArray, compound, double, encodeNbt, float, int, intArray, list, long, short, str,
} from './nbt';
import { decodeNbt } from './nbtRead';

test('encodes a tiny compound byte-exactly', () => {
  // TAG_Compound "" { TAG_Byte "a" = 1 } TAG_End
  const bytes = encodeNbt(compound({ a: byte(1) }));
  expect(Array.from(bytes)).toEqual([0x0a, 0x00, 0x00, 0x01, 0x00, 0x01, 0x61, 0x01, 0x00]);
});

test('encodes big-endian short/int and root name', () => {
  const bytes = encodeNbt(compound({ s: short(0x0102), i: int(-2) }), 'R');
  expect(Array.from(bytes)).toEqual([
    0x0a, 0x00, 0x01, 0x52,
    0x02, 0x00, 0x01, 0x73, 0x01, 0x02,
    0x03, 0x00, 0x01, 0x69, 0xff, 0xff, 0xff, 0xfe,
    0x00,
  ]);
});

test('round-trips every tag type, preserving types', () => {
  const root = compound({
    b: byte(-5),
    s: short(-300),
    i: int(123456),
    l: long(-9007199254740993n),
    f: float(1.5),
    d: double(Math.PI),
    ba: byteArray(new Uint8Array([0, 255, 7])),
    st: str('gregtech:gt.blockmachines'),
    li: list('compound', [compound({ x: int(1) }), compound({ x: int(2) })]),
    empty: list('compound', []),
    nested: compound({ deep: compound({ v: short(9) }) }),
    ia: intArray(new Int32Array([1, -1, 2147483647])),
  });
  const { name, root: back } = decodeNbt(encodeNbt(root, 'Schematic'));
  expect(name).toBe('Schematic');
  expect(back).toEqual(root);
});

test('decodeNbt transparently gunzips', () => {
  const raw = encodeNbt(compound({ a: byte(1) }));
  expect(decodeNbt(gzipSync(raw)).root).toEqual(compound({ a: byte(1) }));
});

test('rejects out-of-range values instead of silently wrapping', () => {
  expect(() => encodeNbt(compound({ b: byte(200) }))).toThrow(/byte/);
  expect(() => encodeNbt(compound({ s: short(40000) }))).toThrow(/short/);
  expect(() => encodeNbt(compound({ i: int(2 ** 31) }))).toThrow(/int/);
});
