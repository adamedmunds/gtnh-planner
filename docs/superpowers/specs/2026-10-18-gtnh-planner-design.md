# GTNH Planner — Design

Date: 2026-10-18
Status: Approved in conversation (user delegated spec/plan approval: "you can take charge")

## Goal

A local web app for planning GregTech: New Horizons builds in 3D. The user places GT machines, cables and pipes on a grid, sees them rendered with real GTNH textures, and exports a Schematica `.schematic` file that shows a hologram in-game to build from.

First real use: the user's oil berry → light fuel line (6× LV Fluid Extractor, 17× LV Distillery, 1× LV Chemical Reactor, 1× LV Electrolyzer, plus cables and pipes).

## Constraints

- **Stack:** Vite + React + TypeScript, react-three-fiber / drei for 3D. No backend (user preference: React; Next.js only if full stack is needed — it isn't).
- **Local only.** Not published. Textures are extracted from the user's own mod jars and are git-ignored; they are never committed or distributed.
- **Target game:** GTNH 2.9.0-RC-1, GregTech `5.09.54.183`, Schematica `1.12.6-GTNH`.
  Instance: `<your GTNH instance>/.minecraft`
- **Repo:** GitHub repo `adamedmunds/gtnh-planner`.

## Verified facts (from the user's world save and GT source)

- Every GT machine, cable and pipe is block `gregtech:gt.blockmachines`; the specific thing is the tile entity's `mID`.
- Machines: tile entity `id = "BaseMetaTileEntity"`, fields `mID` (int), `mFacing` (short) (0 down, 1 up, 2 north/−Z, 3 south/+Z, 4 west/−X, 5 east/+X).
- Cables/pipes: tile entity `id = "BaseMetaPipeEntity"`, fields `mID` (int), `mConnections` (byte bitmask, bit *n* = side *n* in the same order). Verified: a straight N–S pipe has `mConnections = 12` (bits 2,3).
- Block metadata = GT "tile entity base type" (harvest tool):
  - LV–HV tiered machines: **1**
  - Insulated cables: **9**
  - Fluid/item pipes: **4 + clamp(material tool quality, 0, 3)** (GT `HarvestTool.WrenchPipeLevel0..3`). Observed in world: Wood fluid pipe 4, Electrum item pipe 6, Tin item pipe 7. From `MaterialsInit.setTool(durability, quality, speed)`: Bronze quality 2 → **6**, Steel quality 3 → **7**, Electrum 2 → 6 ✓, Wood 0 → 4 ✓.
- Tile entity coordinates `x, y, z` are absolute in-world; in a schematic they are relative to the schematic origin.

## Catalog (initial)

Machines (block meta 1), IDs from `gregtech.api.enums.MetaTileEntityIDs` in the user's jar:

| Machine | LV | MV | HV | Texture folder (`assets/gregtech/textures/blocks/basicmachines/…`) |
|---|---|---|---|---|
| Fluid Extractor | 511 | 512 | 513 | `fluid_extractor` |
| Distillery | 531 | 532 | 533 | `distillery` |
| Chemical Reactor | 421 | 422 | 423 | `chemical_reactor` |
| Electrolyzer | 371 | 372 | 373 | `electrolyzer` |
| Extractor | 271 | 272 | 273 | `extractor` |

Casings: `assets/gregtech/textures/blocks/iconsets/MACHINE_{LV,MV,HV}_{TOP,SIDE,BOTTOM}.png`.

Cables (block meta 9; GT `WireCableBuilder`: cable 1x = start+6, 2x = +7, 4x = +8):

| Cable | 1x | 4x | Thickness 1x / 4x |
|---|---|---|---|
| Tin | 1246 | 1248 | 0.25 / 0.5 |
| Copper | 1366 | 1368 | 0.25 / 0.5 |
| Annealed Copper | 1386 | 1388 | 0.25 / 0.5 |

Fluid pipes (GT `FluidPipeBuilder`: tiny = start, small +1, normal +2, large +3, huge +4; thickness 0.25/0.375/0.5/0.75/0.875):

| Pipe | Small | Normal | Large | Meta |
|---|---|---|---|---|
| Bronze (start 5120) | 5121 | 5122 | 5123 | 6 |
| Steel (start 5130) | 5131 | 5132 | 5133 | 7 |

Item pipes (GT `ItemPipeBuilder`, tiny/small/normal/large/huge in order):

| Pipe | Small | Normal | Meta |
|---|---|---|---|
| Tin (start 5589) | 5590 | 5591 | 7 |
| Electrum (5610…) | 5611 | 5612 | 6 |

## Architecture

```
scripts/extract-textures.mjs   one-time: jar → public/textures/ (git-ignored)
src/catalog/                   data: catalog entries + types
src/model/                     build state: placed blocks, facing, connections, BOM (pure TS)
src/export/                    NBT writer + .schematic builder (pure TS)
src/editor/                    React UI + r3f scene
```

Units communicate only through the `Build` data type and the catalog. `model` and `export` have no React/three imports and are unit-tested in isolation.

### 1. Texture extractor (`scripts/extract-textures.mjs`)

- Node script; reads the GT jar path from a CLI argument or `GTNH_INSTANCE` env var (default: the instance path above), finds `mods/gregtech-*.jar`.
- Copies only the PNGs referenced by the catalog (plus their `.mcmeta` if present) into `public/textures/<same relative path>`.
- Prints which textures were found/missing. Missing textures are not fatal.
- Uses a small zip library (e.g. `yauzl` or `adm-zip`) — dev dependency only.

### 2. Catalog (`src/catalog/`)

```ts
type Kind = 'machine' | 'cable' | 'fluidPipe' | 'itemPipe';
interface CatalogEntry {
  key: string;            // e.g. 'distillery_lv'
  name: string;           // 'LV Distillery'
  kind: Kind;
  mID: number;
  meta: number;           // block metadata
  tier?: 'LV' | 'MV' | 'HV';
  group: string;          // palette grouping
  thickness?: number;     // cables/pipes, 0..1
  color?: string;         // tint for cable/pipe material + placeholder colour
  textures: { top?: string; side?: string; bottom?: string; front?: string };
}
```

### 3. Model (`src/model/`)

```ts
type Facing = 0 | 1 | 2 | 3 | 4 | 5;
interface PlacedBlock {
  pos: [number, number, number];
  key: string;              // catalog key
  facing?: Facing;          // machines
  connections?: number;     // cables/pipes: 6-bit mask
  manualMask?: { forcedOn: number; forcedOff: number }; // user overrides
}
interface Build { version: 1; name: string; blocks: PlacedBlock[] }
```

- Blocks are stored in a `Map<string, PlacedBlock>` keyed `"x,y,z"` in the editor; serialized as an array.
- **Auto-connect rule:** a cable/pipe connects on side *n* if the neighbour on that side is (a) a cable/pipe of the same `kind` (any material — GT connects e.g. tin cable to copper cable, bronze pipe to steel pipe), or (b) any machine. Then apply `forcedOn` / `forcedOff`. Cable↔cable connections are made symmetric: if either side forces off, both sides are off.
- Pure functions: `placeBlock`, `removeBlock`, `rotateFacing`, `toggleSide`, `computeConnections(build)`, `billOfMaterials(build)`.
- Facing on placement: machine front faces the camera-side face that was clicked (i.e. opposite the placement direction), horizontal only by default.

### 4. Editor (`src/editor/`)

- Layout: 3D canvas fills screen; left palette (groups: Machines / Cables / Fluid pipes / Item pipes, tier tabs LV/MV/HV for machines); right info panel (hovered/selected block, mID, facing, connections); bottom-right materials list panel.
- Controls: left-click face/ground = place selected block adjacent; right-click = remove; `R` = rotate hovered machine facing (cycle N→E→S→W; `Shift+R` cycles up/down too); `Shift+click` on a cable/pipe face = toggle that side; mouse orbit/pan/zoom (drei `OrbitControls`); Y-layer slider hides blocks above the chosen level; ground grid at y=0.
- Rendering: machines = cube with casing textures, front face shows casing + overlay (two stacked materials or a combined canvas texture). Cables/pipes = centre box sized by `thickness` + arm boxes toward each connected side; tinted material texture (`materialicons/…/wire.png` for cables, pipe textures for pipes) or flat colour. Textures use `NearestFilter` for pixel-art look. Missing texture → flat colour from catalog.
- Persistence: autosave `Build` JSON to `localStorage` (try/catch, debounced); "Save .json" and "Load .json" buttons; "New" clears with confirm.
- Export button → downloads `<build name>.schematic`.

### 5. Exporter (`src/export/`)

- `nbt.ts`: minimal big-endian NBT writer (tags: byte, short, int, long, float, double, byte array, string, list, compound, int array) + gzip via `fflate` (or `pako`).
- `schematic.ts`: `buildSchematic(build, catalog): Uint8Array`
  - Bounding box of all blocks → `Width` (X), `Height` (Y), `Length` (Z) as shorts; origin = min corner.
  - `Blocks` byte array, index `x + (y * Length + z) * Width` (verified in Schematica-GTNH `SchematicAlpha.readFromNBT`); `Data` byte array with metadata (same index).
  - **No `AddBlocks`.** Local block IDs are kept below 256 (air = 0, `gregtech:gt.blockmachines` = 1) and remapped by name via `SchematicaMapping`. This sidesteps the two incompatible AddBlocks layouts Schematica-GTNH reads (nibble `AddBlocks` vs full-byte when `useSchematicplusFormat` is on).
  - `SchematicaMapping` compound of shorts: `{ "minecraft:air": 0, "gregtech:gt.blockmachines": 1 }`. Schematica maps each name to the live registry ID on load.
  - `Materials: "Alpha"`, empty `Entities` list. `Icon` is optional (Schematica falls back to a default icon).
  - `TileEntities`: one compound per GT block with **relative** `x,y,z` (int), `id` (string), `mID` (**int**), and `mFacing` (**short**, machines) or `mConnections` (**byte**, pipes). Types match GT's `BaseMetaTileEntity`/`BaseMetaPipeEntity` `writeToNBT` and the user's world save.

## Milestones

1. **Scaffold** — Vite React TS app, Vitest, lint, `.gitignore` (textures, schematics).
2. **Exporter first** — NBT writer, schematic builder, unit tests, and a CLI/dev script that writes `test-hologram.schematic` (one of each catalog machine in a row with facings, plus a short tin cable run and bronze pipe run). Validate it with the Python NBT reader.
3. **🛑 In-game checkpoint (user)** — user copies the test schematic into `.minecraft/schematics`, loads it in a creative world with Schematica, reports what the hologram shows. Adjust exporter if needed.
4. **Texture extractor**.
5. **Editor** — scene, palette, placement/removal, rotation, connections, layer slider, info panel, BOM, persistence, export button.
6. **Oil berry preset** (stretch, small): a "Load example" button with a sensible layout of the user's line.

## Testing

- Vitest unit tests: NBT encoding (byte-exact for known small inputs), schematic index order and AddBlocks, bounding box/relative coords, connection auto-compute and overrides, facing rotation, BOM counts.
- Round-trip: parse exported schematic with a test NBT reader and compare to the build (including tag types: `mID` int, `mFacing` short, `mConnections` byte, mapping values short).
- External check: Python NBT reader (`scratchpad/tools/nbt.py`-style) parses the exported file.
- In-game check by the user at milestone 3 and with the final oil berry layout.

## Error handling

- Missing textures → flat colours, console warning; app still works.
- `localStorage` unavailable/corrupt → start empty, show a small notice.
- Loading an invalid `.json` → error toast, current build untouched.
- Export with zero blocks → button disabled.
- Unknown catalog key in a loaded build → block kept but rendered as a magenta placeholder and skipped on export with a warning.

## Out of scope

- Machine output-side / covers / colours (set in-game).
- Multiblocks, non-GT blocks, the crop farm itself.
- Importing from the world save, writing directly to the schematics folder (would need a backend).
- Hosting/publishing.
