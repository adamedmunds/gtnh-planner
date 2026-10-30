# Pyrolyse Oven in Build in 3D

## Why

Build in 3D lays out five multiblocks block for block (Distillation Tower, Large Chemical Reactor, Oil Cracking Unit,
Electric Blast Furnace, Vacuum Freezer; specs `2026-10-24-multiblocks-design.md`, `2026-10-30-ebf-vacuum-freezer-design.md`).
A Pyrolyse Oven is still a one-block stand-in with "build it yourself". The user asked for it in the 3D viewer next
("can you support the 3d viewer please"). They are at HV, and design calls on this project are delegated to Claude.

## Goals

- Lay out the Pyrolyse Oven block for block through the same definitions table (`DEFINITIONS` in
  `src/layout/multiblock.ts`).
- The pasted schematic forms and runs at the speed the Calculator assumes.
- The Calculator offers the oven the user can craft.

## Non-goals

- The legacy oven's shape (mID 1159). Saved chains that still name 1159 keep the stand-in and its "build it yourself" note.
- Choosing coils in the UI, or coil speed bonuses in the Calculator.

## Anti-goals

- An oven that runs slower than the Calculator says (Cupronickel coils halve its speed; see below).
- A muffler hatch with anything above it (`MTEHatchMuffler.polluteEnvironment`; the furnace stops when it can't vent).
- A schematic block that pastes as the wrong block.

## Which Pyrolyse Oven (GT 5.09.54.183)

The recipe map `gt.recipe.pyro` lists two machines, both named "Pyrolyse Oven":

- **mID 1159** (`PYROLYSE_OVEN_CONTROLLER`) is `MTEPyrolyseOvenLegacy`: deprecated, the old 5×4×5 shape, and has no
  crafting recipe of its own. Its only recipe is a shapeless conversion into the new oven (`MTERecipeLoader`, "Pyrolyse
  Oven Conversion Recipe").
- **mID 15546** (`PyrolyzeOven`) is `MTEPyrolyseOven`: the craftable one (MV hull, MV pistons, MV circuits,
  Cupronickel wire, MV pump).

The planner lays out **15546**. The Calculator stops offering 1159 wherever 15546 is on the same map, because
`machineOptions` (`src/calc/machines.ts`) currently sorts 1159 first and so makes it the default. A chain that already
names 1159 still shows it as its current machine (as `graphModel` does today for any machine not in the list).

## The shape (`MTEPyrolyseOven`)

7 wide, 6 tall, 5 deep. The shape is mirror-symmetric left to right. Below, x runs 0–6 from left to right as seen from
the front, y runs 0–5 from bottom to top, and z = 4 is the front row (the planner's convention: front faces +z). GT's
shape strings map as x = a, y = 5 − b, z = 4 − c.

Legend:

| Letter | Block | Block name and meta |
|--------|-------|---------------------|
| `P` | Pyrolyse Oven Casing | `gt.blockcasingsNH` meta 2; texture `MACHINE_ULV_SIDE` |
| `H` | A hatch position (otherwise `P`) | |
| `C` | Heating Coil | `gt.blockcasings5`; Kanthal, meta 1 |
| `B` | Steel Firebox Casing | `gt.blockcasings3` meta 14; sides `MACHINE_CASING_FIREBOX_STEEL`, top and bottom `MACHINE_CASING_FIREBOX_STEEL_TOP` |
| `A` | Steel Pipe Casing | `gt.blockcasings2` meta 13; `MACHINE_CASING_PIPE_STEEL` |
| `E` | Steel Frame Box | `gt.blockframes`, meta 305 (Steel's material ID, `MaterialsIDMap`) |
| `~` | Controller | |
| `.` | Air, or any block (GT doesn't check it) | |

All four block names are confirmed in the user's world save registry.

Layers from bottom to top. Each row is one z, front (z 4) first, written x 0→6:

- **y 0** (GT `G`: output bus/hatch, energy, maintenance, or casing). z4 `HHHHHHH`; z3, z2, z1 `HCHHHCH`; z0 `HHHHHHH`.
- **y 1** (`D`: casing only). z4 `PBP~PBP`; z3 `P.P.P.P`; z2 `P.....P`; z1 `P.P.P.P`; z0 `PAPPPAP`.
- **y 2** (GT `F`: input bus/hatch, muffler, or casing). z4 `HBH.HBH`; z3, z2, z1 `H.HHH.H`; z0 `HAH.HAH`.
- **y 3**. z4 `.H...H.` (F); z3, z2, z1 `.C...C.`; z0 `.A...A.`.
- **y 4**. z0 `.A...A.`; the other rows are empty.
- **y 5**. z0 `.E...E.`; the other rows are empty.

Totals: 12 coils, 8 Steel Pipe Casings, 4 Steel Firebox Casings, 2 Steel Frame Boxes, and 73 cells that are casing or
hatch. GT needs **at least 60 casings** (`checkCasingMin(errors, casingAmount, 60)`), so 13 hatches at most. It also
needs an energy hatch, a maintenance hatch, a muffler, any input and any output (`checkMachine`).

### Hatches as built

- **Controller** `[3,1,4]`, facing front.
- **Energy hatch** `[5,0,4]`, facing front (3), at the recipe's voltage.
- **Maintenance hatch** `[3,0,0]`, facing back (2).
- **Muffler** (LV, mID 91) `[3,2,2]`, facing up (1). The cell above it, `[3,3,2]`, stays air. The layout keeps it free
  and the checker rejects a line that covers it, as for the EBF.
- **Inputs** on the left side, y 2, facing left (4):
  - Item input bus at `[0,2,2]`.
  - Fluid input hatches at `[0,2,3]`, then `[0,2,1]`.
- **Outputs** on the right side, y 0, facing right (5):
  - Item output bus at `[6,0,2]`.
  - Fluid output hatches at `[6,0,3]`, then `[6,0,1]`.
- **More fluids** than those slots get a note. Up to HV, the user's dump has at most one fluid in and one out, and at
  most one item in and one out (46 recipes).
- **Locking:** two or more fluid output hatches are pasted locked, through the existing `lockOutputs`.

### Coils: Kanthal

GT's speed multiplier is `2 / (1 + coil tier)` (`getSpeedBonus`), applied as a duration modifier
(`ProcessingLogic.setDurationModifier`). The coil tier is `ordinal − 2` (`HeatingCoilLevel.getTier`), so:

| Coil | Tier | Recipe time |
|------|------|-------------|
| Cupronickel | 0 | × 2 (half speed) |
| Kanthal | 1 | × 1 |
| Nichrome | 2 | × 2/3 |

The Calculator counts machines at the recipe's own duration, so the oven is built with **Kanthal**, which matches it
exactly. The user can make up to Nichrome. EU/t doesn't depend on the coil.

## Steel Frame Boxes can't go in the schematic

GT checks for a real `BlockFrameBox` whose metadata is Steel (305) (`GTStructureUtility.ofFrame`). Schematica
1.12.6-GTNH stores block metadata as one byte (`SchematicAlpha` reads `Data[i] & 255` and writes `(byte) meta`). Its
`ExtendedMetadata` tag is an event payload, not block metadata, and EndlessIDs doesn't patch Schematica. So a frame
written as 305 would paste as material 49's frame.

- The 3D view shows the two frames.
- The schematic leaves those two cells empty.
- A line note says: "Place a Steel Frame Box on top of each of the Pyrolyse Oven's two back pipe columns (Schematica
  can't hold frame boxes)".
- **Anti-goal:** no frame or other block is ever written with metadata above 255. The schematic writer refuses one
  instead of truncating it.

## Notes the line adds

- The usual multiblock notes (maintenance hatch, programmed circuit in the controller or input bus).
- "The Pyrolyse Oven uses Kanthal Heating Coils so it runs at the recipe's speed (Cupronickel would halve it)".
- "Keep the block above the Pyrolyse Oven's muffler hatch empty". This is the EBF's note, generalised to any planned
  multiblock that has a muffler.
- The frame note above.

## 3D view and schematic

New catalog blocks:

- `casing_pyrolyse`: Pyrolyse Oven Casing.
- `casing_steel_pipe`: Steel Pipe Casing.
- `casing_steel_firebox`: Steel Firebox Casing, with separate top/bottom and side textures.
- `frame_steel`: Steel Frame Box. Drawn see-through with GT's `materialicons/NONE/frameGt.png`, tinted Steel grey
  `#808080`; never written to the schematic.

The controller for 15546 wears `MACHINE_ULV_SIDE` with `OVERLAY_FRONT_PYROLYSE_OVEN` (both are in the user's GT jar).
Textures are extracted by `npm run textures` and are never committed.

## Left to the builder

- How a catalog entry is marked as not written to the schematic, and how frame tinting is drawn.
- How the 1159 → 15546 preference is expressed in `machineOptions`.
- Generalising the EBF-only muffler note and the checker's muffler message to any multiblock with a muffler.
