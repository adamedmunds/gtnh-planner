import { gunzipSync } from 'fflate';
import { TAG_IDS, type CompoundTag, type Tag, type TagType } from './nbt';

const TYPE_BY_ID = Object.fromEntries(
  Object.entries(TAG_IDS).map(([k, v]) => [v, k as TagType]),
) as Record<number, TagType>;

class ByteReader {
  private pos = 0;
  private view: DataView;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private take(n: number) {
    if (this.pos + n > this.bytes.length) throw new RangeError('Unexpected end of NBT data');
    const p = this.pos;
    this.pos += n;
    return p;
  }
  u8() { return this.view.getUint8(this.take(1)); }
  i8() { return this.view.getInt8(this.take(1)); }
  i16() { return this.view.getInt16(this.take(2)); }
  u16() { return this.view.getUint16(this.take(2)); }
  i32() { return this.view.getInt32(this.take(4)); }
  i64() { return this.view.getBigInt64(this.take(8)); }
  f32() { return this.view.getFloat32(this.take(4)); }
  f64() { return this.view.getFloat64(this.take(8)); }
  raw(n: number) { const p = this.take(n); return this.bytes.slice(p, p + n); }
  string() { return new TextDecoder().decode(this.raw(this.u16())); }
}

function typeOf(id: number): TagType {
  const t = TYPE_BY_ID[id];
  if (!t) throw new TypeError(`Unknown NBT tag id ${id}`);
  return t;
}

function readPayload(r: ByteReader, type: TagType): Tag {
  switch (type) {
    case 'byte': return { type, value: r.i8() };
    case 'short': return { type, value: r.i16() };
    case 'int': return { type, value: r.i32() };
    case 'long': return { type, value: r.i64() };
    case 'float': return { type, value: r.f32() };
    case 'double': return { type, value: r.f64() };
    case 'byteArray': return { type, value: r.raw(r.i32()) };
    case 'string': return { type, value: r.string() };
    case 'intArray': {
      const n = r.i32();
      const value = new Int32Array(n);
      for (let i = 0; i < n; i++) value[i] = r.i32();
      return { type, value };
    }
    case 'list': {
      const elementType = typeOf(r.u8());
      const n = r.i32();
      const value: Tag[] = [];
      for (let i = 0; i < n; i++) value.push(readPayload(r, elementType));
      return { type, elementType, value };
    }
    case 'compound': {
      const value: Record<string, Tag> = {};
      for (;;) {
        const id = r.u8();
        if (id === 0) break;
        const name = r.string();
        value[name] = readPayload(r, typeOf(id));
      }
      return { type, value };
    }
    case 'end':
      throw new TypeError('Unexpected TAG_End payload');
  }
}

export function decodeNbt(bytes: Uint8Array): { name: string; root: CompoundTag } {
  const data = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const r = new ByteReader(data);
  if (r.u8() !== TAG_IDS.compound) throw new TypeError('NBT root is not a compound');
  const name = r.string();
  return { name, root: readPayload(r, 'compound') as CompoundTag };
}
