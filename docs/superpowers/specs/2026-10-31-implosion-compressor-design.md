# Implosion Compressor in Build in 3D

## Why

Build in 3D lays out six multiblocks block for block (Distillation Tower, Large Chemical Reactor, Oil Cracking Unit,
Electric Blast Furnace, Vacuum Freezer, Pyrolyse Oven). The user asked for "the next multiblock". They are at HV, and
design calls on this project are delegated to Claude. The Implosion Compressor is GT's other HV-era multiblock, and its
map has 1,140 recipes in the user's dump that run at HV or below. Every one of them runs at 30 EU/t.

While checking, a gap turned up. The Calculator picks the first multiblock on a recipe map, and for three maps that is a
GT++ machine the planner can't lay out and the user can't build yet:

| Map | Calculator picks today | Should pick |
|-----|------------------------|-------------|
| Blast Furnace | 963 Volcanus | 1000 Electric Blast Furnace |
| Vacuum Freezer | 910 Cryogenic Freezer | 1002 Vacuum Freezer |
| Implosion Compressor | 964 Density^2 | 1001 Implosion Compressor |

So a new EBF or freezer step shows as a "build it yourself" stand-in unless the user changes the machine by hand.

## Goals

- Lay out the Implosion Compressor (mID 1001) block for block through `DEFINITIONS` in `src/layout/multiblock.ts`.
- The Calculator prefers a multiblock that Build in 3D can lay out over one it can't, among the machines on a map.

## Non-goals

- GT++ multiblocks (Density^2, Volcanus, Cryogenic Freezer). They stay as stand-ins.
- Changing the machine on chains that are already saved: each node stores its machine, so they keep it.

## Anti-goals

- A muffler hatch with anything above it.
- A structure with fewer than 16 casings (GT won't form it).

## The shape (`MTEImplosionCompressor`, GT 5.09.54.183)

A 3×3×3 box of **Solid Steel Machine Casings** (`gt.blockcasings2` meta 0; texture `MACHINE_CASING_SOLID_STEEL`) with
air in the centre. The controller is at the front of the middle layer. Any casing can be a hatch. GT needs at least 16
casings (`checkCasingMin(errors, mCasing, 16)`), plus an energy hatch, a maintenance hatch, a muffler hatch, an input
bus and an output bus. The controller wears `MACHINE_CASING_SOLID_STEEL` with `OVERLAY_FRONT_IMPLOSION_COMPRESSOR`. Both
textures are in the user's GT jar.

### Hatches as built

These are the Vacuum Freezer's spots, plus a muffler on top:

- **Controller** `[1,1,2]`, facing front.
- **Maintenance hatch** `[1,0,0]`, facing back (2).
- **Muffler** (LV, mID 91) `[1,2,1]`, the centre of the top, facing up (1), with the cell above kept as air. The layout
  and the checker already handle any multiblock that `hasMuffler` names.
- **Energy hatch, then the input bus, then the output bus** go in the freezer's spot order (`placeHatches`): front
  `[0,1,2]`, `[2,1,2]`, `[0,0,2]`, and so on.
- **At most 7 placed hatches**, so that 26 − controller − maintenance − muffler − 7 = 16 casings. Any extra hatches get
  the usual "No room on the implosion compressor for another … hatch." note. Every recipe in the dump needs 3.

The line gets the muffler note ("Keep the block above the Implosion Compressor's muffler hatch empty") through
`hasMuffler`, plus the usual multiblock notes.

## Calculator preference

`machineOptions` (`src/calc/machines.ts`) sorts single blocks first and then by tier. Multiblocks have no tier, so they
tie and keep map order. Within that tie, a multiblock with a Build in 3D definition now comes before one without.
`multiblock.ts` exports `hasLayout(mID)` for this. The legacy Pyrolyse Oven rule (`REPLACED_BY`) stays as it is.

## Left to the builder

- Test layout, mirroring the freezer and Pyrolyse Oven tests.
