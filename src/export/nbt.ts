export type TagType =
  | 'end' | 'byte' | 'short' | 'int' | 'long' | 'float' | 'double'
  | 'byteArray' | 'string' | 'list' | 'compound' | 'intArray';

export type Tag =
  | { type: 'byte'; value: number }
  | { type: 'short'; value: number }
  | { type: 'int'; value: number }
  | { type: 'long'; value: bigint }
  | { type: 'float'; value: number }
  | { type: 'double'; value: number }
  | { type: 'byteArray'; value: Uint8Array }
  | { type: 'string'; value: string }
  | ListTag
  | CompoundTag
  | { type: 'intArray'; value: Int32Array };

export interface ListTag { type: 'list'; elementType: TagType; value: Tag[] }
export interface CompoundTag { type: 'compound'; value: Record<string, Tag> }

export const TAG_IDS: Record<TagType, number> = {
  end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6,
  byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11,
};

function checkInt(kind: string, n: number, min: number, max: number): number {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RangeError(`NBT ${kind} out of range: ${n}`);
  }
  return n;
}

export const byte = (n: number): Tag => ({ type: 'byte', value: checkInt('byte', n, -128, 127) });
export const short = (n: number): Tag => ({ type: 'short', value: checkInt('short', n, -32768, 32767) });
export const int = (n: number): Tag => ({ type: 'int', value: checkInt('int', n, -(2 ** 31), 2 ** 31 - 1) });
export const long = (n: bigint): Tag => ({ type: 'long', value: n });
export const float = (n: number): Tag => ({ type: 'float', value: n });
export const double = (n: number): Tag => ({ type: 'double', value: n });
export const str = (s: string): Tag => ({ type: 'string', value: s });
export const byteArray = (v: Uint8Array): Tag => ({ type: 'byteArray', value: v });
export const intArray = (v: Int32Array): Tag => ({ type: 'intArray', value: v });
export const list = (elementType: TagType, value: Tag[]): ListTag => ({ type: 'list', elementType, value });
export const compound = (value: Record<string, Tag>): CompoundTag => ({ type: 'compound', value });

class ByteWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  private len = 0;

  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(n: number) { this.ensure(1); this.view.setUint8(this.len, n); this.len += 1; }
  i8(n: number) { this.ensure(1); this.view.setInt8(this.len, n); this.len += 1; }
  i16(n: number) { this.ensure(2); this.view.setInt16(this.len, n); this.len += 2; }
  u16(n: number) { this.ensure(2); this.view.setUint16(this.len, n); this.len += 2; }
  i32(n: number) { this.ensure(4); this.view.setInt32(this.len, n); this.len += 4; }
  i64(n: bigint) { this.ensure(8); this.view.setBigInt64(this.len, n); this.len += 8; }
  f32(n: number) { this.ensure(4); this.view.setFloat32(this.len, n); this.len += 4; }
  f64(n: number) { this.ensure(8); this.view.setFloat64(this.len, n); this.len += 8; }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length; }
  result() { return this.buf.slice(0, this.len); }
}

const utf8 = new TextEncoder();

function writeString(w: ByteWriter, s: string) {
  const b = utf8.encode(s);
  if (b.length > 0xffff) throw new RangeError('NBT string too long');
  w.u16(b.length);
  w.bytes(b);
}

function writePayload(w: ByteWriter, tag: Tag) {
  switch (tag.type) {
    case 'byte': w.i8(tag.value); break;
    case 'short': w.i16(tag.value); break;
    case 'int': w.i32(tag.value); break;
    case 'long': w.i64(tag.value); break;
    case 'float': w.f32(tag.value); break;
    case 'double': w.f64(tag.value); break;
    case 'byteArray': w.i32(tag.value.length); w.bytes(tag.value); break;
    case 'string': writeString(w, tag.value); break;
    case 'intArray':
      w.i32(tag.value.length);
      for (const v of tag.value) w.i32(v);
      break;
    case 'list':
      w.u8(TAG_IDS[tag.elementType]);
      w.i32(tag.value.length);
      for (const item of tag.value) {
        if (item.type !== tag.elementType) throw new TypeError(`List of ${tag.elementType} contains ${item.type}`);
        writePayload(w, item);
      }
      break;
    case 'compound':
      for (const [name, child] of Object.entries(tag.value)) {
        w.u8(TAG_IDS[child.type]);
        writeString(w, name);
        writePayload(w, child);
      }
      w.u8(0);
      break;
  }
}

/** Uncompressed big-endian NBT with a named root compound. */
export function encodeNbt(root: CompoundTag, rootName = ''): Uint8Array {
  const w = new ByteWriter();
  w.u8(TAG_IDS.compound);
  writeString(w, rootName);
  writePayload(w, root);
  return w.result();
}
