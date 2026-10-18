# GTNH Planner — Plan 1: Exporter & Test Hologram

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the app and build a tested, pure-TypeScript pipeline (catalog → build model → connections → NBT → `.schematic`) that produces a test hologram the user loads in-game with Schematica.

**Architecture:** Pure TS modules under `src/catalog`, `src/model`, `src/export` with no React/three imports, unit-tested with Vitest. A `tsx` script writes `out/test-hologram.schematic`. The React editor is Plan 2 (written after the in-game checkpoint).

**Tech Stack:** Node 24, Vite 8, React 19, TypeScript, Vitest 5, fflate (gzip), tsx (run TS scripts).

**Spec:** `docs/superpowers/specs/2026-10-18-gtnh-planner-design.md`

## Global Constraints

- Block name for every GT machine/cable/pipe: `gregtech:gt.blockmachines`.
- Machine tile entity: `id: "BaseMetaTileEntity"`, `mID` **int**, `mFacing` **short** (0 down, 1 up, 2 north/−Z, 3 south/+Z, 4 west/−X, 5 east/+X).
- Pipe/cable tile entity: `id: "BaseMetaPipeEntity"`, `mID` **int**, `mConnections` **byte** (bit n = side n, same order as facing).
- Schematic: root compound named `Schematic`; `Width`(X)/`Height`(Y)/`Length`(Z) shorts; `Blocks`/`Data` byte arrays indexed `x + (y * Length + z) * Width`; **no `AddBlocks`**; `SchematicaMapping` = `{ "minecraft:air": 0s, "gregtech:gt.blockmachines": 1s }`; `Materials: "Alpha"`; `Entities: []`; `TileEntities` with coordinates relative to the min corner; gzip-compressed.
- Block metadata: LV–HV machines 1; insulated cables 9; Bronze pipes 6; Steel pipes 7; Tin item pipes 7; Electrum item pipes 6.
- `src/catalog`, `src/model`, `src/export` must not import React or three.
- Textures and exported `.schematic` files are never committed (`public/textures/`, `out/`, `*.schematic` git-ignored).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Negative coordinates** (user builds left/below the origin) → schematic still starts at 0,0,0 with correct relative TE coords. Test in Task 5.
- **Asymmetric bounding box** (e.g. 3×2×4) → every block lands at the right index; an X/Z swap would only show up in-game. Test in Task 5.
- **Duplicate positions** in a hand-edited or old `.json` build → last one wins, a warning is returned, no duplicate TileEntities. Test in Task 5.
- **Unknown catalog keys** (build saved with a key later renamed) → block skipped with a warning; a build with only unknown blocks throws "empty". Test in Task 5.
- **Machine without a facing** → exported with `mFacing = 3` (south), never `undefined`/NaN in NBT. Test in Task 5.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html   scaffold
src/main.tsx, src/App.tsx                                  placeholder UI (Plan 2 replaces)
src/catalog/types.ts        Kind, Tier, CatalogEntry, Catalog, GT_BLOCK_NAME
src/catalog/entries.ts      all catalog entries (data)
src/catalog/index.ts        CATALOG map, getEntry()
src/catalog/catalog.test.ts
src/model/types.ts          Vec3, Facing, ManualMask, PlacedBlock, Build
src/model/directions.ts     DIRS, OPPOSITE, posKey, addVec
src/model/connections.ts    computeConnections()
src/model/connections.test.ts
src/export/nbt.ts           Tag types, constructors, encodeNbt()
src/export/nbtRead.ts       decodeNbt() (tests + inspect script)
src/export/nbt.test.ts
src/export/schematic.ts     buildSchematicTag(), buildSchematic()
src/export/schematic.test.ts
scripts/testLayout.ts       the test hologram Build
scripts/make-test-schematic.ts
scripts/inspect-schematic.ts
```

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm test` (vitest run), `npm run dev`, `npm run build`, `npm run typecheck`; `tsx` available for scripts.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "gtnh-planner",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "schematic:test": "tsx scripts/make-test-schematic.ts",
    "schematic:inspect": "tsx scripts/inspect-schematic.ts"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install react@^19.3.1 react-dom@^19.3.1 fflate@^0.8.3
npm install -D vite@^8.3.4 @vitejs/plugin-react@^6.1.2 typescript@^7.0.2 vitest@^5.0.5 tsx@^4.23.15 @types/react@^19.3.0 @types/react-dom@^19.3.0 @types/node@^26.6.5
```
Expected: installs without peer-dependency errors. If `typescript@7` breaks `tsc --noEmit` or Vite, fall back to `typescript@^5` and note it in the commit message.

- [ ] **Step 3: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "scripts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
```
If `test` is a type error in `defineConfig`, add `/// <reference types="vitest/config" />` as the first line.

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GTNH Planner</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx`:
```tsx
export function App() {
  return <h1>GTNH Planner</h1>;
}
```

Append to `.gitignore`:
```
out/
```

- [ ] **Step 4: Write a smoke test** — `src/smoke.test.ts`

```ts
import { gzipSync, gunzipSync } from 'fflate';

test('toolchain runs and fflate round-trips', () => {
  const input = new Uint8Array([1, 2, 3]);
  expect(Array.from(gunzipSync(gzipSync(input)))).toEqual([1, 2, 3]);
});
```

- [ ] **Step 5: Verify**

Run: `npm test` → Expected: 1 passed.
Run: `npm run typecheck` → Expected: no errors.
Run: `npm run build` → Expected: `dist/` built.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS app with Vitest"
```

---

### Task 2: Catalog

**Files:**
- Create: `src/catalog/types.ts`, `src/catalog/entries.ts`, `src/catalog/index.ts`
- Test: `src/catalog/catalog.test.ts`

**Interfaces:**
- Produces:
  - `type Kind = 'machine' | 'cable' | 'fluidPipe' | 'itemPipe'`
  - `type Tier = 'LV' | 'MV' | 'HV'`
  - `interface CatalogEntry { key: string; name: string; kind: Kind; mID: number; meta: number; tier?: Tier; group: string; thickness?: number; color: string; textures: { top?: string; side?: string; bottom?: string; front?: string } }`
  - `type Catalog = ReadonlyMap<string, CatalogEntry>`
  - `const GT_BLOCK_NAME = 'gregtech:gt.blockmachines'`
  - `const CATALOG_ENTRIES: readonly CatalogEntry[]`, `const CATALOG: Catalog`, `function getEntry(key: string, catalog?: Catalog): CatalogEntry | undefined`
  - Texture paths are relative to `public/textures/` and mirror the jar under `assets/gregtech/textures/` (e.g. `blocks/iconsets/MACHINE_LV_TOP.png`).

- [ ] **Step 1: Write the failing test** — `src/catalog/catalog.test.ts`

```ts
import { CATALOG, CATALOG_ENTRIES, getEntry } from './index';

test('keys and mIDs are unique', () => {
  const keys = CATALOG_ENTRIES.map((e) => e.key);
  const ids = CATALOG_ENTRIES.map((e) => e.mID);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(ids).size).toBe(ids.length);
  expect(CATALOG.size).toBe(CATALOG_ENTRIES.length);
});

test.each([
  ['fluid_extractor_lv', 511, 1, 'machine'],
  ['fluid_extractor_hv', 513, 1, 'machine'],
  ['distillery_lv', 531, 1, 'machine'],
  ['chemical_reactor_lv', 421, 1, 'machine'],
  ['electrolyzer_lv', 371, 1, 'machine'],
  ['extractor_mv', 272, 1, 'machine'],
  ['tin_cable_1x', 1246, 9, 'cable'],
  ['tin_cable_4x', 1248, 9, 'cable'],
  ['copper_cable_1x', 1366, 9, 'cable'],
  ['annealed_copper_cable_4x', 1388, 9, 'cable'],
  ['bronze_pipe_small', 5121, 6, 'fluidPipe'],
  ['bronze_pipe_normal', 5122, 6, 'fluidPipe'],
  ['steel_pipe_large', 5133, 7, 'fluidPipe'],
  ['tin_item_pipe_small', 5590, 7, 'itemPipe'],
  ['electrum_item_pipe_normal', 5612, 6, 'itemPipe'],
] as const)('%s has mID %i, meta %i, kind %s', (key, mID, meta, kind) => {
  const e = getEntry(key);
  expect(e).toBeDefined();
  expect(e!.mID).toBe(mID);
  expect(e!.meta).toBe(meta);
  expect(e!.kind).toBe(kind);
});

test('machines have tier casing + front overlay textures; conduits have thickness', () => {
  for (const e of CATALOG_ENTRIES) {
    if (e.kind === 'machine') {
      expect(e.tier).toBeDefined();
      expect(e.textures.side).toBe(`blocks/iconsets/MACHINE_${e.tier}_SIDE.png`);
      expect(e.textures.front).toMatch(/^blocks\/basicmachines\/[a-z_]+\/OVERLAY_FRONT\.png$/);
    } else {
      expect(e.thickness).toBeGreaterThan(0);
      expect(e.thickness).toBeLessThanOrEqual(1);
    }
  }
});

test('getEntry returns undefined for unknown keys', () => {
  expect(getEntry('nope')).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/catalog` → Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Implement**

`src/catalog/types.ts`:
```ts
export type Kind = 'machine' | 'cable' | 'fluidPipe' | 'itemPipe';
export type Tier = 'LV' | 'MV' | 'HV';

export interface CatalogEntry {
  key: string;
  name: string;
  kind: Kind;
  /** GregTech MetaTileEntity ID written to the tile entity's `mID`. */
  mID: number;
  /** Block metadata for gregtech:gt.blockmachines (GT harvest-tool base type). */
  meta: number;
  tier?: Tier;
  group: string;
  /** Cables/pipes only: cross-section size as a fraction of a block. */
  thickness?: number;
  /** Material/placeholder colour, CSS hex. */
  color: string;
  /** Paths relative to public/textures/. */
  textures: { top?: string; side?: string; bottom?: string; front?: string };
}

export type Catalog = ReadonlyMap<string, CatalogEntry>;

export const GT_BLOCK_NAME = 'gregtech:gt.blockmachines';
```

`src/catalog/entries.ts`:
```ts
import type { CatalogEntry, Tier } from './types';

const TIERS: readonly Tier[] = ['LV', 'MV', 'HV'];

// IDs from gregtech.api.enums.MetaTileEntityIDs (GT 5.09.54.183).
const MACHINES = [
  { base: 'fluid_extractor', name: 'Fluid Extractor', ids: [511, 512, 513], color: '#6b8fb3' },
  { base: 'distillery', name: 'Distillery', ids: [531, 532, 533], color: '#b38f4d' },
  { base: 'chemical_reactor', name: 'Chemical Reactor', ids: [421, 422, 423], color: '#6bb36b' },
  { base: 'electrolyzer', name: 'Electrolyzer', ids: [371, 372, 373], color: '#b3b34d' },
  { base: 'extractor', name: 'Extractor', ids: [271, 272, 273], color: '#8f6bb3' },
] as const;

function machineEntries(): CatalogEntry[] {
  return MACHINES.flatMap((m) =>
    TIERS.map((tier, i): CatalogEntry => ({
      key: `${m.base}_${tier.toLowerCase()}`,
      name: `${tier} ${m.name}`,
      kind: 'machine',
      mID: m.ids[i],
      meta: 1,
      tier,
      group: 'Machines',
      color: m.color,
      textures: {
        top: `blocks/iconsets/MACHINE_${tier}_TOP.png`,
        side: `blocks/iconsets/MACHINE_${tier}_SIDE.png`,
        bottom: `blocks/iconsets/MACHINE_${tier}_BOTTOM.png`,
        front: `blocks/basicmachines/${m.base}/OVERLAY_FRONT.png`,
      },
    })),
  );
}

// GT WireCableBuilder: cable 1x = startId + 6, 4x = startId + 8. Insulated cable meta = 9.
const CABLES = [
  { base: 'tin', name: 'Tin', start: 1240, color: '#dcdcdc' },
  { base: 'copper', name: 'Copper', start: 1360, color: '#ff6400' },
  { base: 'annealed_copper', name: 'Annealed Copper', start: 1380, color: '#ff7814' },
] as const;

function cableEntries(): CatalogEntry[] {
  return CABLES.flatMap((c) => [
    { size: '1x', offset: 6, thickness: 0.25 },
    { size: '4x', offset: 8, thickness: 0.5 },
  ].map((s): CatalogEntry => ({
    key: `${c.base}_cable_${s.size}`,
    name: `${s.size} ${c.name} Cable`,
    kind: 'cable',
    mID: c.start + s.offset,
    meta: 9,
    group: 'Cables',
    thickness: s.thickness,
    color: c.color,
    textures: {},
  })));
}

// GT FluidPipeBuilder: tiny = start, small +1, normal +2, large +3. Meta = 4 + tool quality.
const FLUID_PIPES = [
  { base: 'bronze', name: 'Bronze', start: 5120, meta: 6, color: '#ff8000' },
  { base: 'steel', name: 'Steel', start: 5130, meta: 7, color: '#808080' },
] as const;

const PIPE_SIZES = [
  { size: 'small', label: 'Small', offset: 1, thickness: 0.375 },
  { size: 'normal', label: 'Normal', offset: 2, thickness: 0.5 },
  { size: 'large', label: 'Large', offset: 3, thickness: 0.75 },
] as const;

function fluidPipeEntries(): CatalogEntry[] {
  return FLUID_PIPES.flatMap((p) =>
    PIPE_SIZES.map((s): CatalogEntry => ({
      key: `${p.base}_pipe_${s.size}`,
      name: `${s.label} ${p.name} Fluid Pipe`,
      kind: 'fluidPipe',
      mID: p.start + s.offset,
      meta: p.meta,
      group: 'Fluid pipes',
      thickness: s.thickness,
      color: p.color,
      textures: {},
    })),
  );
}

// GT ItemPipeBuilder: tiny, small, normal, ... in idList order.
const ITEM_PIPES = [
  { base: 'tin', name: 'Tin', small: 5590, normal: 5591, meta: 7, color: '#dcdcdc' },
  { base: 'electrum', name: 'Electrum', small: 5611, normal: 5612, meta: 6, color: '#ffff64' },
] as const;

function itemPipeEntries(): CatalogEntry[] {
  return ITEM_PIPES.flatMap((p) => [
    { size: 'small', label: 'Small', mID: p.small, thickness: 0.375 },
    { size: 'normal', label: 'Normal', mID: p.normal, thickness: 0.5 },
  ].map((s): CatalogEntry => ({
    key: `${p.base}_item_pipe_${s.size}`,
    name: `${s.label} ${p.name} Item Pipe`,
    kind: 'itemPipe',
    mID: s.mID,
    meta: p.meta,
    group: 'Item pipes',
    thickness: s.thickness,
    color: p.color,
    textures: {},
  })));
}

export const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  ...machineEntries(),
  ...cableEntries(),
  ...fluidPipeEntries(),
  ...itemPipeEntries(),
];
```

`src/catalog/index.ts`:
```ts
import { CATALOG_ENTRIES } from './entries';
import type { Catalog, CatalogEntry } from './types';

export * from './types';
export { CATALOG_ENTRIES };

export const CATALOG: Catalog = new Map(CATALOG_ENTRIES.map((e) => [e.key, e]));

export function getEntry(key: string, catalog: Catalog = CATALOG): CatalogEntry | undefined {
  return catalog.get(key);
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/catalog` → Expected: all pass. Then `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/catalog
git commit -m "feat: add GT block catalog (machines, cables, pipes)"
```

---

### Task 3: Build model & connections

**Files:**
- Create: `src/model/types.ts`, `src/model/directions.ts`, `src/model/connections.ts`
- Test: `src/model/connections.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `CATALOG`, `CatalogEntry` from `src/catalog`.
- Produces:
  - `type Vec3 = readonly [number, number, number]`
  - `type Facing = 0 | 1 | 2 | 3 | 4 | 5`
  - `interface ManualMask { forcedOn: number; forcedOff: number }`
  - `interface PlacedBlock { pos: Vec3; key: string; facing?: Facing; manualMask?: ManualMask }`
  - `interface Build { version: 1; name: string; blocks: PlacedBlock[] }`
  - `const DIRS: readonly Vec3[]` (index = GT side), `const OPPOSITE: readonly Facing[]`, `function posKey(p: Vec3): string`, `function addVec(a: Vec3, b: Vec3): Vec3`
  - `function computeConnections(blocks: readonly PlacedBlock[], catalog?: Catalog): Map<string, number>` — key = `posKey(pos)`, value = 6-bit mask; only conduits (non-machine entries) get an entry.

Note: the spec lists `connections?` on `PlacedBlock`; this plan derives connections on demand from neighbours + `manualMask` instead of storing them, so they can never go stale.

- [ ] **Step 1: Write the failing test** — `src/model/connections.test.ts`

```ts
import { computeConnections } from './connections';
import { posKey } from './directions';
import type { PlacedBlock } from './types';

const DOWN = 1 << 0, UP = 1 << 1, NORTH = 1 << 2, SOUTH = 1 << 3, WEST = 1 << 4, EAST = 1 << 5;
const at = (m: Map<string, number>, x: number, y: number, z: number) => m.get(posKey([x, y, z]));

test('straight north-south run: middle piece has mConnections 12 (matches world save)', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, -1], key: 'bronze_pipe_normal' },
    { pos: [0, 0, 0], key: 'bronze_pipe_normal' },
    { pos: [0, 0, 1], key: 'bronze_pipe_normal' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(12);
  expect(at(m, 0, 0, 0)).toBe(NORTH | SOUTH);
  expect(at(m, 0, 0, -1)).toBe(SOUTH);
});

test('cable connects to an adjacent machine; machines get no entry', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'distillery_lv', facing: 3 },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(EAST);
  expect(at(m, 1, 0, 0)).toBeUndefined();
});

test('different materials of the same kind connect; different kinds do not', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'copper_cable_4x' },
    { pos: [0, 1, 0], key: 'bronze_pipe_small' },
    { pos: [0, -1, 0], key: 'tin_item_pipe_small' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(EAST);
  expect(at(m, 1, 0, 0)).toBe(WEST);
  expect(at(m, 0, 1, 0)).toBe(0);
  expect(at(m, 0, -1, 0)).toBe(0);
});

test('forcedOff on one side disconnects both pieces', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: 0, forcedOff: EAST } },
    { pos: [1, 0, 0], key: 'tin_cable_1x' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(0);
  expect(at(m, 1, 0, 0)).toBe(0);
});

test('forcedOn connects toward an empty side, and toward a neighbour that would not auto-connect', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'bronze_pipe_normal', manualMask: { forcedOn: UP | DOWN, forcedOff: 0 } },
  ];
  expect(at(computeConnections(blocks), 0, 0, 0)).toBe(UP | DOWN);
});

test('forcedOff wins over a neighbour forcedOn', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: 0, forcedOff: EAST } },
    { pos: [1, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: WEST, forcedOff: 0 } },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(0);
  expect(at(m, 1, 0, 0)).toBe(0);
});

test('unknown catalog keys are ignored (neither connected to nor given an entry)', () => {
  const blocks: PlacedBlock[] = [
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [1, 0, 0], key: 'removed_thing' },
  ];
  const m = computeConnections(blocks);
  expect(at(m, 0, 0, 0)).toBe(0);
  expect(at(m, 1, 0, 0)).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/model` → Expected: FAIL, cannot resolve `./connections`.

- [ ] **Step 3: Implement**

`src/model/types.ts`:
```ts
export type Vec3 = readonly [number, number, number];

/** GT/Forge side order: 0 down, 1 up, 2 north (-Z), 3 south (+Z), 4 west (-X), 5 east (+X). */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

/** Per-side user overrides for cable/pipe connections (bit n = side n). */
export interface ManualMask {
  forcedOn: number;
  forcedOff: number;
}

export interface PlacedBlock {
  pos: Vec3;
  key: string;
  /** Machines only. */
  facing?: Facing;
  /** Cables/pipes only. */
  manualMask?: ManualMask;
}

export interface Build {
  version: 1;
  name: string;
  blocks: PlacedBlock[];
}
```

`src/model/directions.ts`:
```ts
import type { Facing, Vec3 } from './types';

/** Unit vector for each GT side, indexed by Facing. */
export const DIRS: readonly Vec3[] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];

export const OPPOSITE: readonly Facing[] = [1, 0, 3, 2, 5, 4];

export function posKey(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
```

`src/model/connections.ts`:
```ts
import { CATALOG, type Catalog, type CatalogEntry } from '../catalog';
import { DIRS, OPPOSITE, addVec, posKey } from './directions';
import type { PlacedBlock } from './types';

interface Cell {
  block: PlacedBlock;
  entry: CatalogEntry;
}

const bit = (side: number) => 1 << side;

/**
 * Connection mask for every cable/pipe in the build.
 * Auto rule: connect to any machine, or to a conduit of the same kind (any material).
 * Overrides: either piece's forcedOn turns a shared side on; either piece's forcedOff turns it off (off wins).
 */
export function computeConnections(
  blocks: readonly PlacedBlock[],
  catalog: Catalog = CATALOG,
): Map<string, number> {
  const cells = new Map<string, Cell>();
  for (const block of blocks) {
    const entry = catalog.get(block.key);
    if (entry) cells.set(posKey(block.pos), { block, entry });
  }

  const result = new Map<string, number>();
  for (const [key, { block, entry }] of cells) {
    if (entry.kind === 'machine') continue;
    const own = block.manualMask ?? { forcedOn: 0, forcedOff: 0 };
    let mask = 0;
    for (let side = 0; side < 6; side++) {
      const nb = cells.get(posKey(addVec(block.pos, DIRS[side])));
      const sameKindConduit = nb !== undefined && nb.entry.kind === entry.kind;
      const nbMask = sameKindConduit ? (nb.block.manualMask ?? { forcedOn: 0, forcedOff: 0 }) : undefined;
      const back = bit(OPPOSITE[side]);

      let on = nb !== undefined && (nb.entry.kind === 'machine' || sameKindConduit);
      if (own.forcedOn & bit(side) || (nbMask && nbMask.forcedOn & back)) on = true;
      if (own.forcedOff & bit(side) || (nbMask && nbMask.forcedOff & back)) on = false;
      if (on) mask |= bit(side);
    }
    result.set(key, mask);
  }
  return result;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/model` → Expected: 7 passed. `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/model
git commit -m "feat: add build model and cable/pipe connection rules"
```

---

### Task 4: NBT encoder & decoder

**Files:**
- Create: `src/export/nbt.ts`, `src/export/nbtRead.ts`
- Test: `src/export/nbt.test.ts`

**Interfaces:**
- Produces (`src/export/nbt.ts`):
  - `type TagType = 'end' | 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'byteArray' | 'string' | 'list' | 'compound' | 'intArray'`
  - `type Tag` = discriminated union on `type`; `CompoundTag = { type: 'compound'; value: Record<string, Tag> }`; `ListTag = { type: 'list'; elementType: TagType; value: Tag[] }`; `long` value is `bigint`; `byteArray` value `Uint8Array`; `intArray` value `Int32Array`; numbers otherwise.
  - Constructors: `byte(n)`, `short(n)`, `int(n)`, `long(b: bigint)`, `float(n)`, `double(n)`, `str(s)`, `byteArray(u8)`, `intArray(i32)`, `list(elementType, items)`, `compound(record)`.
  - `function encodeNbt(root: CompoundTag, rootName?: string): Uint8Array` (uncompressed, big-endian).
- Produces (`src/export/nbtRead.ts`):
  - `function decodeNbt(bytes: Uint8Array): { name: string; root: CompoundTag }` — gunzips first if bytes start with `0x1f 0x8b`.

- [ ] **Step 1: Write the failing test** — `src/export/nbt.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/export/nbt.test.ts` → Expected: FAIL, cannot resolve `./nbt`.

- [ ] **Step 3: Implement**

`src/export/nbt.ts`:
```ts
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
```

`src/export/nbtRead.ts`:
```ts
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
```

- [ ] **Step 4: Run tests** — `npx vitest run src/export/nbt.test.ts` → Expected: 5 passed. `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/export/nbt.ts src/export/nbtRead.ts src/export/nbt.test.ts
git commit -m "feat: add NBT encoder/decoder"
```

---

### Task 5: Schematic builder

**Files:**
- Create: `src/export/schematic.ts`
- Test: `src/export/schematic.test.ts`

**Interfaces:**
- Consumes: `CATALOG`, `Catalog`, `GT_BLOCK_NAME` (Task 2); `Build`, `PlacedBlock`, `posKey`, `computeConnections` (Task 3); NBT constructors + `encodeNbt` (Task 4), `decodeNbt` in tests.
- Produces:
  - `const DEFAULT_FACING = 3`
  - `interface SchematicSize { width: number; height: number; length: number }`
  - `function buildSchematicTag(build: Build, catalog?: Catalog): { tag: CompoundTag; warnings: string[]; size: SchematicSize }` — throws `Error('Build is empty')` if no exportable blocks.
  - `function buildSchematic(build: Build, catalog?: Catalog): { bytes: Uint8Array; warnings: string[]; size: SchematicSize }` — gzipped.

- [ ] **Step 1: Write the failing test** — `src/export/schematic.test.ts`

```ts
import { buildSchematic, buildSchematicTag } from './schematic';
import { decodeNbt } from './nbtRead';
import type { CompoundTag, Tag } from './nbt';
import type { Build, PlacedBlock } from '../model/types';

const mk = (blocks: PlacedBlock[]): Build => ({ version: 1, name: 't', blocks });
const v = (t: CompoundTag, k: string): Tag => {
  const x = t.value[k];
  if (!x) throw new Error(`missing ${k}`);
  return x;
};
const num = (t: CompoundTag, k: string) => (v(t, k) as { value: number }).value;
const tes = (t: CompoundTag) => (v(t, 'TileEntities') as { value: CompoundTag[] }).value;

test('single machine: header, mapping, block, data and tile entity', () => {
  const { tag, warnings, size } = buildSchematicTag(mk([{ pos: [5, 64, -3], key: 'distillery_lv', facing: 2 }]));
  expect(warnings).toEqual([]);
  expect(size).toEqual({ width: 1, height: 1, length: 1 });
  expect(v(tag, 'Width')).toEqual({ type: 'short', value: 1 });
  expect(v(tag, 'Height')).toEqual({ type: 'short', value: 1 });
  expect(v(tag, 'Length')).toEqual({ type: 'short', value: 1 });
  expect(v(tag, 'Materials')).toEqual({ type: 'string', value: 'Alpha' });
  expect(v(tag, 'SchematicaMapping')).toEqual({
    type: 'compound',
    value: {
      'minecraft:air': { type: 'short', value: 0 },
      'gregtech:gt.blockmachines': { type: 'short', value: 1 },
    },
  });
  expect(tag.value.AddBlocks).toBeUndefined();
  expect(Array.from((v(tag, 'Blocks') as { value: Uint8Array }).value)).toEqual([1]);
  expect(Array.from((v(tag, 'Data') as { value: Uint8Array }).value)).toEqual([1]);
  expect(v(tag, 'Entities')).toEqual({ type: 'list', elementType: 'compound', value: [] });
  const [te] = tes(tag);
  expect(te.value).toEqual({
    x: { type: 'int', value: 0 },
    y: { type: 'int', value: 0 },
    z: { type: 'int', value: 0 },
    id: { type: 'string', value: 'BaseMetaTileEntity' },
    mID: { type: 'int', value: 531 },
    mFacing: { type: 'short', value: 2 },
  });
});

test('pipes write BaseMetaPipeEntity with mConnections byte and pipe meta', () => {
  const { tag } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'bronze_pipe_normal' },
    { pos: [0, 0, 1], key: 'bronze_pipe_normal' },
  ]));
  const list = tes(tag);
  expect(list).toHaveLength(2);
  const first = list.find((t) => num(t, 'z') === 0)!;
  expect(v(first, 'id')).toEqual({ type: 'string', value: 'BaseMetaPipeEntity' });
  expect(v(first, 'mID')).toEqual({ type: 'int', value: 5122 });
  expect(v(first, 'mConnections')).toEqual({ type: 'byte', value: 1 << 3 });
  expect(first.value.mFacing).toBeUndefined();
  expect(Array.from((v(tag, 'Data') as { value: Uint8Array }).value)).toEqual([6, 6]);
});

test('asymmetric bounding box uses index x + (y * Length + z) * Width', () => {
  // Width (X) 3, Height (Y) 2, Length (Z) 4
  const { tag, size } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'tin_cable_1x' },
    { pos: [2, 1, 3], key: 'distillery_lv' },
    { pos: [1, 0, 2], key: 'bronze_pipe_small' },
  ]));
  expect(size).toEqual({ width: 3, height: 2, length: 4 });
  const blocks = (v(tag, 'Blocks') as { value: Uint8Array }).value;
  const data = (v(tag, 'Data') as { value: Uint8Array }).value;
  expect(blocks.length).toBe(24);
  const idx = (x: number, y: number, z: number) => x + (y * 4 + z) * 3;
  expect(blocks[idx(0, 0, 0)]).toBe(1);
  expect(data[idx(0, 0, 0)]).toBe(9);
  expect(blocks[idx(2, 1, 3)]).toBe(1);
  expect(data[idx(2, 1, 3)]).toBe(1);
  expect(blocks[idx(1, 0, 2)]).toBe(1);
  expect(data[idx(1, 0, 2)]).toBe(6);
  expect(Array.from(blocks).filter((b) => b !== 0)).toHaveLength(3);
});

test('negative coordinates are shifted so the min corner is 0,0,0', () => {
  const { tag } = buildSchematicTag(mk([
    { pos: [-10, -2, -7], key: 'electrolyzer_lv', facing: 5 },
    { pos: [-8, -2, -7], key: 'chemical_reactor_lv', facing: 5 },
  ]));
  const coords = tes(tag).map((t) => [num(t, 'x'), num(t, 'y'), num(t, 'z')]).sort();
  expect(coords).toEqual([[0, 0, 0], [2, 0, 0]]);
  expect(num(tag, 'Width')).toBe(3);
});

test('machine without facing exports mFacing 3 (south)', () => {
  const { tag } = buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'distillery_lv' }]));
  expect(v(tes(tag)[0], 'mFacing')).toEqual({ type: 'short', value: 3 });
});

test('duplicate positions: last wins, one tile entity, warning returned', () => {
  const { tag, warnings } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'distillery_lv' },
    { pos: [0, 0, 0], key: 'electrolyzer_lv' },
  ]));
  expect(tes(tag)).toHaveLength(1);
  expect(v(tes(tag)[0], 'mID')).toEqual({ type: 'int', value: 371 });
  expect(warnings.some((w) => w.includes('0,0,0'))).toBe(true);
});

test('unknown keys are skipped with a warning; all-unknown or empty builds throw', () => {
  const { tag, warnings } = buildSchematicTag(mk([
    { pos: [0, 0, 0], key: 'distillery_lv' },
    { pos: [1, 0, 0], key: 'removed_thing' },
  ]));
  expect(tes(tag)).toHaveLength(1);
  expect(num(tag, 'Width')).toBe(1);
  expect(warnings.some((w) => w.includes('removed_thing'))).toBe(true);
  expect(() => buildSchematicTag(mk([{ pos: [0, 0, 0], key: 'removed_thing' }]))).toThrow('Build is empty');
  expect(() => buildSchematicTag(mk([]))).toThrow('Build is empty');
});

test('buildSchematic gzips a root named "Schematic" that decodes to the same tag', () => {
  const build = mk([{ pos: [0, 0, 0], key: 'distillery_lv', facing: 3 }]);
  const { bytes } = buildSchematic(build);
  expect(bytes[0]).toBe(0x1f);
  expect(bytes[1]).toBe(0x8b);
  const { name, root } = decodeNbt(bytes);
  expect(name).toBe('Schematic');
  expect(root).toEqual(buildSchematicTag(build).tag);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/export/schematic.test.ts` → Expected: FAIL, cannot resolve `./schematic`.

- [ ] **Step 3: Implement** — `src/export/schematic.ts`

```ts
import { gzipSync } from 'fflate';
import { CATALOG, GT_BLOCK_NAME, type Catalog, type CatalogEntry } from '../catalog';
import { computeConnections } from '../model/connections';
import { posKey } from '../model/directions';
import type { Build, PlacedBlock } from '../model/types';
import {
  byte, byteArray, compound, encodeNbt, int, list, short, str, type CompoundTag,
} from './nbt';

export const DEFAULT_FACING = 3;
const GT_LOCAL_ID = 1;
const MAX_DIM = 32767;

export interface SchematicSize { width: number; height: number; length: number }

interface Resolved { block: PlacedBlock; entry: CatalogEntry }

export function buildSchematicTag(
  build: Build,
  catalog: Catalog = CATALOG,
): { tag: CompoundTag; warnings: string[]; size: SchematicSize } {
  const warnings: string[] = [];

  // Resolve catalog entries; last block at a position wins.
  const byPos = new Map<string, Resolved>();
  for (const block of build.blocks) {
    const entry = catalog.get(block.key);
    if (!entry) {
      warnings.push(`Skipped unknown block "${block.key}" at ${posKey(block.pos)}`);
      continue;
    }
    const key = posKey(block.pos);
    if (byPos.has(key)) warnings.push(`Duplicate blocks at ${key}; kept the last one`);
    byPos.set(key, { block, entry });
  }
  const cells = [...byPos.values()];
  if (cells.length === 0) throw new Error('Build is empty');

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { block } of cells) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], block.pos[a]);
      max[a] = Math.max(max[a], block.pos[a]);
    }
  }
  const size: SchematicSize = {
    width: max[0] - min[0] + 1,
    height: max[1] - min[1] + 1,
    length: max[2] - min[2] + 1,
  };
  if (size.width > MAX_DIM || size.height > MAX_DIM || size.length > MAX_DIM) {
    throw new Error('Build is too large for a schematic');
  }

  const volume = size.width * size.height * size.length;
  const blocks = new Uint8Array(volume);
  const data = new Uint8Array(volume);
  const connections = computeConnections(cells.map((c) => c.block), catalog);
  const tileEntities: CompoundTag[] = [];

  for (const { block, entry } of cells) {
    const x = block.pos[0] - min[0];
    const y = block.pos[1] - min[1];
    const z = block.pos[2] - min[2];
    const index = x + (y * size.length + z) * size.width;
    blocks[index] = GT_LOCAL_ID;
    data[index] = entry.meta;

    const te: CompoundTag = compound({ x: int(x), y: int(y), z: int(z) });
    if (entry.kind === 'machine') {
      te.value.id = str('BaseMetaTileEntity');
      te.value.mID = int(entry.mID);
      te.value.mFacing = short(block.facing ?? DEFAULT_FACING);
    } else {
      const mask = connections.get(posKey(block.pos)) ?? 0;
      te.value.id = str('BaseMetaPipeEntity');
      te.value.mID = int(entry.mID);
      // NBT bytes are signed; bit 7 is never set for a 6-bit mask.
      te.value.mConnections = byte(mask);
    }
    tileEntities.push(te);
  }

  const tag = compound({
    Width: short(size.width),
    Height: short(size.height),
    Length: short(size.length),
    Materials: str('Alpha'),
    Blocks: byteArray(blocks),
    Data: byteArray(data),
    SchematicaMapping: compound({
      'minecraft:air': short(0),
      [GT_BLOCK_NAME]: short(GT_LOCAL_ID),
    }),
    Entities: list('compound', []),
    TileEntities: list('compound', tileEntities),
  });
  return { tag, warnings, size };
}

export function buildSchematic(
  build: Build,
  catalog: Catalog = CATALOG,
): { bytes: Uint8Array; warnings: string[]; size: SchematicSize } {
  const { tag, warnings, size } = buildSchematicTag(build, catalog);
  return { bytes: gzipSync(encodeNbt(tag, 'Schematic')), warnings, size };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/export` → Expected: all pass (5 NBT + 8 schematic). `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/export/schematic.ts src/export/schematic.test.ts
git commit -m "feat: build Schematica .schematic files from a build"
```

---

### Task 6: Test hologram script & in-game checkpoint

**Files:**
- Create: `scripts/testLayout.ts`, `scripts/make-test-schematic.ts`, `scripts/inspect-schematic.ts`, `scripts/testLayout.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `Build` (Task 3), `buildSchematic` (Task 5), `decodeNbt` (Task 4), `CATALOG` (Task 2).
- Produces: `TEST_LAYOUT: Build`; `npm run schematic:test` → writes `out/test-hologram.schematic`; `npm run schematic:inspect -- <file>` → prints a summary.

Layout (all at y=0 unless noted; machines face south, +Z, toward the viewer standing at +Z):
- x = 0, 2, 4, 6, 8, z = 0: LV Fluid Extractor, LV Distillery, LV Chemical Reactor, LV Electrolyzer, LV Extractor (facing 3).
- x = 10, 12, z = 0: MV Distillery, HV Distillery (facing 3).
- x = 14, z = 0: LV Distillery facing **east** (5) — checks horizontal rotation.
- z = −1, x = 0..14: 1x Tin Cable run behind the machines (connects along X and north side of each machine).
- y = 1, z = 0, x = 0..8: Normal Bronze Fluid Pipe on top of the LV machines (connects along X and down into each machine).
- z = 2, x = 0..3: Small Tin Item Pipe run in front, not touching machines (connects only along X).

- [ ] **Step 1: Write the failing test** — `scripts/testLayout.test.ts`

```ts
import { TEST_LAYOUT } from './testLayout';
import { buildSchematic } from '../src/export/schematic';
import { CATALOG } from '../src/catalog';

test('test layout only uses catalog keys and exports without warnings', () => {
  for (const b of TEST_LAYOUT.blocks) expect(CATALOG.has(b.key)).toBe(true);
  const { warnings, size } = buildSchematic(TEST_LAYOUT);
  expect(warnings).toEqual([]);
  expect(size).toEqual({ width: 15, height: 2, length: 4 });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run scripts` → Expected: FAIL, cannot resolve `./testLayout`.

- [ ] **Step 3: Implement**

`scripts/testLayout.ts`:
```ts
import type { Build, Facing, PlacedBlock } from '../src/model/types';

const blocks: PlacedBlock[] = [];
const machine = (x: number, key: string, facing: Facing = 3) => blocks.push({ pos: [x, 0, 0], key, facing });

machine(0, 'fluid_extractor_lv');
machine(2, 'distillery_lv');
machine(4, 'chemical_reactor_lv');
machine(6, 'electrolyzer_lv');
machine(8, 'extractor_lv');
machine(10, 'distillery_mv');
machine(12, 'distillery_hv');
machine(14, 'distillery_lv', 5);

for (let x = 0; x <= 14; x++) blocks.push({ pos: [x, 0, -1], key: 'tin_cable_1x' });
for (let x = 0; x <= 8; x++) blocks.push({ pos: [x, 1, 0], key: 'bronze_pipe_normal' });
for (let x = 0; x <= 3; x++) blocks.push({ pos: [x, 0, 2], key: 'tin_item_pipe_small' });

export const TEST_LAYOUT: Build = { version: 1, name: 'test-hologram', blocks };
```

`scripts/make-test-schematic.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSchematic } from '../src/export/schematic';
import { TEST_LAYOUT } from './testLayout';

const { bytes, warnings, size } = buildSchematic(TEST_LAYOUT);
for (const w of warnings) console.warn(`warning: ${w}`);
const outDir = resolve('out');
mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, `${TEST_LAYOUT.name}.schematic`);
writeFileSync(file, bytes);
console.log(`Wrote ${file} (${bytes.length} bytes, ${size.width}x${size.height}x${size.length}, ${TEST_LAYOUT.blocks.length} blocks)`);
```

`scripts/inspect-schematic.ts`:
```ts
import { readFileSync } from 'node:fs';
import { decodeNbt } from '../src/export/nbtRead';
import type { CompoundTag, Tag } from '../src/export/nbt';
import { CATALOG_ENTRIES } from '../src/catalog';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run schematic:inspect -- <file.schematic>');
  process.exit(1);
}
const { name, root } = decodeNbt(new Uint8Array(readFileSync(file)));
const val = (t: Tag | undefined) => (t && 'value' in t ? t.value : undefined);
console.log(`root "${name}"  ${val(root.value.Width)}x${val(root.value.Height)}x${val(root.value.Length)}  Materials=${val(root.value.Materials)}`);
const mapping = root.value.SchematicaMapping as CompoundTag | undefined;
console.log('mapping:', mapping ? Object.fromEntries(Object.entries(mapping.value).map(([k, t]) => [k, val(t)])) : 'none');
const nameById = new Map(CATALOG_ENTRIES.map((e) => [e.mID, e.name]));
const tes = (root.value.TileEntities as { value: CompoundTag[] }).value;
for (const te of tes) {
  const v = te.value;
  const extra = v.mFacing ? `facing=${val(v.mFacing)}` : `conn=0b${Number(val(v.mConnections)).toString(2).padStart(6, '0')}`;
  console.log(`  (${val(v.x)},${val(v.y)},${val(v.z)}) ${val(v.id)} mID=${val(v.mID)} ${nameById.get(Number(val(v.mID))) ?? '?'} ${extra}`);
}
console.log(`${tes.length} tile entities`);
```

- [ ] **Step 4: Run tests and generate the file**

Run: `npm test` → Expected: all pass.
Run: `npm run typecheck` → no errors.
Run: `npm run schematic:test` → Expected: `Wrote …/out/test-hologram.schematic (… bytes, 15x2x4, 36 blocks)`.
Run: `npm run schematic:inspect -- out/test-hologram.schematic` → Expected: 36 tile entities; machines show `facing=3` (the last one `facing=5`); cables behind a machine (even x, 2..12) show `conn=0b111000` (east+west+south), cables at odd x show `conn=0b110000`, end cables drop the missing east/west bit.

- [ ] **Step 5: Independent check with the Python reader**

This uses a tiny standalone Python reader (not our TS code) so a symmetric encode/decode bug can't hide. It lives in the session scratchpad, not the repo. Write `<scratchpad>/tools/check_schematic.py`:

```python
import gzip, struct, sys
def r(f, n): return f.read(n)
def tag(f, t):
    if t == 1: return ('byte', struct.unpack('>b', r(f, 1))[0])
    if t == 2: return ('short', struct.unpack('>h', r(f, 2))[0])
    if t == 3: return ('int', struct.unpack('>i', r(f, 4))[0])
    if t == 4: return ('long', struct.unpack('>q', r(f, 8))[0])
    if t == 5: return ('float', struct.unpack('>f', r(f, 4))[0])
    if t == 6: return ('double', struct.unpack('>d', r(f, 8))[0])
    if t == 7: n = struct.unpack('>i', r(f, 4))[0]; return ('byteArray', r(f, n))
    if t == 8: n = struct.unpack('>H', r(f, 2))[0]; return ('string', r(f, n).decode())
    if t == 9:
        et = r(f, 1)[0]; n = struct.unpack('>i', r(f, 4))[0]
        return ('list', [tag(f, et) for _ in range(n)])
    if t == 10:
        d = {}
        while True:
            tt = r(f, 1)[0]
            if tt == 0: return ('compound', d)
            n = struct.unpack(">H", r(f, 2))[0]; key = r(f, n).decode(); d[key] = tag(f, tt)
    if t == 11: n = struct.unpack('>i', r(f, 4))[0]; return ('intArray', struct.unpack('>%di' % n, r(f, 4 * n)))
    raise ValueError(t)
import io
f = io.BytesIO(gzip.open(sys.argv[1]).read())
assert r(f, 1)[0] == 10
name = r(f, struct.unpack('>H', r(f, 2))[0]).decode()
_, root = tag(f, 10)
print('root', name, {k: root[k] for k in ('Width', 'Height', 'Length', 'Materials')})
print('mapping', root['SchematicaMapping'])
print('AddBlocks present:', 'AddBlocks' in root)
for _, te in root['TileEntities'][1]:
    print({k: v for k, v in te.items()})
```

Run: `python -I <scratchpad>/tools/check_schematic.py out/test-hologram.schematic`
Expected: `root Schematic`, Width/Height/Length shorts 15/2/4, mapping values are `('short', 0)` and `('short', 1)`, `AddBlocks present: False`, every TE has `mID` as `('int', …)`, machines have `mFacing` `('short', …)`, pipes have `mConnections` `('byte', …)`.

- [ ] **Step 6: Document the checkpoint in `README.md`** — append:

````markdown
## Test hologram (in-game check)

```bash
npm install
npm run schematic:test
```

1. Copy `out/test-hologram.schematic` into your instance's `.minecraft/schematics/` folder.
2. In a creative test world, open Schematica's load menu and load `test-hologram`.
3. Expect a 15×2×4 hologram: a row of LV Fluid Extractor, Distillery, Chemical Reactor, Electrolyzer, Extractor, then MV and HV Distillery, all fronts facing south, plus one LV Distillery facing east at the end; a tin cable behind the row, a bronze pipe on top of the first five machines, and a short tin item pipe in front.
````

- [ ] **Step 7: Commit and push**

```bash
git add scripts README.md
git commit -m "feat: add test hologram generator and schematic inspector"
git push
```

- [ ] **Step 8: 🛑 In-game checkpoint** — stop and ask the user to load the hologram and report:
  1. Does it load without an error?
  2. Do machines render as the right GT machines (correct overlays), or as blank/default blocks?
  3. Do fronts face the right way (south; last one east)?
  4. Do cables/pipes show the expected connections?
  5. Optional: using Schematica's printer or placing blocks manually, does a placed machine match the hologram?

Plan 2 (editor) is written after this checkpoint, incorporating whatever the user reports.
