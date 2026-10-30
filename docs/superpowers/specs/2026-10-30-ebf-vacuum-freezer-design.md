# Electric Blast Furnace and Vacuum Freezer in Build in 3D

## Why

Build in 3D lays out three multiblocks block for block (Distillation Tower, Large Chemical Reactor, Oil Cracking Unit;
spec `2026-10-24-multiblocks-design.md`). Every other multiblock is a one-block stand-in with a "build it yourself"
note. The user is at HV and asked for the next two they use: the **Electric Blast Furnace** and the **Vacuum Freezer**
(hot ingots out of one go straight into the other).

## Goals

- Lay out both block for block, through the same definitions table (`DEFINITIONS` in `src/layout/multiblock.ts`):
  - **Electric Blast Furnace** (`EBF_CONTROLLER`, mID 1000).
  - **Vacuum Freezer** (`VACUUM_FREEZER_CONTROLLER`, mID 1002).
- The EBF's Heating Coils are chosen from the recipe's heat, using the coils the user can make: **Cupronickel, Kanthal,
  Nichrome** (the user's answer: "Up to Nichrome").
- The pasted schematic forms and runs: right casings, right coils, muffler with air above it.

## Non-goals

- Coils past Nichrome, or choosing coils in the UI.
- EBF heat bonuses in the Calculator (perfect overclocks, EU discount stay "≈ approximate").
- Changing the coils of the Large Chemical Reactor or Oil Cracking Unit (still Cupronickel).

## Anti-goals

- An EBF whose coils are too cold for its recipe (GT refuses the recipe: "insufficient heat").
- A muffler hatch with anything above it: GT's `MTEHatchMuffler.polluteEnvironment` needs air in front of the muffler,
  and the furnace stops when it can't vent (`MTEMultiBlockBase` line 813).
- A Vacuum Freezer with fewer than 16 casings.

## The two shapes (from GT 5.09.54.183 source)

Block names confirmed in the user's world save registry: `gregtech:gt.blockcasings`, `gregtech:gt.blockcasings2`,
`gregtech:gt.blockcasings5`.

### Electric Blast Furnace — 3×3×4 (`MTEElectricBlastFurnace`)

- Shape, top to bottom: `fff/fmf/fff`, `CCC/C-C/CCC`, `CCC/C-C/CCC`, `b~b/bbb/bbb`. Controller `~` at the bottom
  layer's front centre.
- `b` (bottom layer): Heat Proof Machine Casing (`gt.blockcasings`, meta 11) or any of input/output hatch, input/output
  bus, maintenance hatch, energy hatch.
- `C` (the two middle layers): 16 Heating Coils, all the same kind; their centres are air.
- `f` (top layer): Heat Proof Machine Casing or an output hatch. `m` (top centre): the muffler hatch.
- No casing minimum ("0-12" Heat Proof casings in the tooltip).
- **Heat.** `heat = coil heat + 100 × (energy hatch tier − 2)` with tiers LV 1, MV 2, HV 3 (`checkMachine`:
  `getCoilLevel().getHeat() + 100 * (GTUtility.getTier(getMaxInputVoltage()) - 2)`). Coil heats
  (`HeatingCoilLevel.getHeat`): Cupronickel 1801 K, Kanthal 2701 K, Nichrome 3601 K. The recipe runs when its heat
  (`specialValue` in the dump) ≤ the furnace's heat.
- **Coil choice:** the first of Cupronickel, Kanthal, Nichrome whose heat with the line's energy hatch reaches the
  recipe's. Coil blocks: `gt.blockcasings5`, meta 0 / 1 / 2.
- **Too hot:** if even Nichrome falls short, the EBF keeps the one-block stand-in, and the note says why, e.g. "The
  Electric Blast Furnace's recipe needs 4,500 K; Nichrome coils with an HV energy hatch give 3,701 K. Build it
  yourself with better coils." In the user's dump, 71 of the 1,266 EBF recipes up to HV are like this; 1,047 need
  Cupronickel only.
- **Muffler:** LV Muffler Hatch (`MUFFLER_HATCH_LV`, mID 91, block meta 1 like the other LV hatches) at the top centre,
  **facing up**. The cell above it stays air: the layout never puts a block, pipe or cable there, and the checker
  rejects a line that does ("The Electric Blast Furnace's muffler hatch is covered; it needs air above it").
- **Energy:** one energy hatch at the recipe's voltage (GT adds up hatch voltages, so one is enough).
- **As built** (front is +z, x left to right seen from the front), all on the bottom layer:
  - Energy hatch: front right, facing front. Maintenance hatch: back centre, facing back.
  - Input bus: left side centre, facing left. Output bus: right side centre, facing right.
  - Fluid hatches, inputs before outputs, one per fluid: front left (facing front), back left (facing left), back
    right (facing right). More than 3 get a note. (Up to HV the dump has at most one fluid in and one out.)
  - Two or more fluid output hatches are pasted locked to their fluid, as for the LCR.

### Vacuum Freezer — 3×3×3 (`MTEVacuumFreezer`)

- Every cell but the centre (air) is Frost Proof Machine Casing (`gt.blockcasings2`, meta 1) or a hatch. Controller at
  the middle layer's front centre.
- Any casing can be an input/output hatch or bus, maintenance or energy hatch. **At least 16 casings**
  (`checkCasingMin(errors, mCasing, 16)`): 25 cells around the air and controller, so at most 9 hatches.
- **As built**, the same spots as the LCR: maintenance hatch at the bottom layer's back centre, facing back; the other
  hatches fill the 8 front-face spots around the controller, then the side centres, energy hatch first, then inputs,
  then outputs. It stops at 8 of those (16 casings remain); more get a note. (Up to HV the dump's freezer recipes need
  energy plus one in and one out.)

## Data the layout needs

- A planned EBF carries its recipe's heat (`specialValue`); the structure picks the coil from it.
- Whether a multiblock is laid out as itself (`supported` in `plan.ts`, `structureFor`) also depends on the EBF's heat:
  both must agree, so a too-hot EBF is a stand-in everywhere (layout, power, checker).

## Notes the line adds

- The existing multiblock notes (maintenance hatch, programmed circuit in the controller or input bus).
- EBF: "The Electric Blast Furnace uses Kanthal Heating Coils (its recipe needs 2,000 K)." and "Keep the block above
  the Electric Blast Furnace's muffler hatch empty."
- Too-hot EBF: the note above, in place of "build it yourself".

## 3D view and schematic

- New catalog blocks: Heat Proof casing (`MACHINE_HEATPROOFCASING`), Frost Proof casing (`MACHINE_CASING_FROST_PROOF`),
  Kanthal and Nichrome coils (`MACHINE_COIL_KANTHAL`, `MACHINE_COIL_NICHROME`), LV Muffler Hatch (front overlay
  `OVERLAY_MUFFLER`).
- Controllers 1000 and 1002 wear their casing with `OVERLAY_FRONT_ELECTRIC_BLAST_FURNACE` /
  `OVERLAY_FRONT_VACUUM_FREEZER` (all names present in the user's GT jar; textures never committed).
- The schematic writes the muffler like the other hatches, with `mFacing` 1 (up).

## Left to the builder

- How the muffler's port is described (a new port kind or a flag) and how the layout keeps the cell above it free.
- Where beside the core the 4-tall EBF stands (as for the towers).
