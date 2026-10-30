# Multiblocks in Build in 3D

## Why

Build in 3D lays a chain out block by block and exports a schematic the user pastes in game. Multiblocks are only a
one-block stand-in today (`marker_multiblock`, a bookshelf, "build it yourself"). A Distillation Tower with 1 input and
5 outputs needs 6 pipes, more than a one-block stand-in has free faces, so the user's Sulfuric Light Fuel line fails
to lay out ("The Multiblock goes here has more pipes than free sides").

The user wants option 1 of the two offered: the layout places the **real** multiblock — every casing, coil, the
controller and the hatches — with pipes to the right hatches and the energy hatch cabled to the line's power, so the
pasted schematic is a working machine.

## Goals

- Lay out three multiblocks the user plans to use, block for block:
  - **Distillation Tower** (`DISTILLATION_TOWER_CONTROLLER`, mID 1126).
  - **Large Chemical Reactor** (`LCR_CONTROLLER`, mID 1169).
  - **Oil Cracking Unit** (`OIL_CRACKER_CONTROLLER`, mID 1160).
- Each multiblock's hatches get their pipes and power from the line's normal routing; the line passes the checker.
- Adding another multiblock later is a matter of describing its shape and where its hatches may go, not new layout code.
- The 3D view shows the real blocks with their textures; the schematic writes them so they paste ready to run.

## Non-goals

- Other multiblocks (they keep today's stand-in and "build it yourself" note).
- Multiblock specifics in the Calculator (parallels, coil bonuses, perfect overclocks stay "≈ approximate").
- Choosing coils or hatch tiers in the UI. Coils are always Cupronickel (the user's decision); the notes say better coils
  can be swapped in.
- Auto-maintenance: a normal maintenance hatch, with a note to fix it.

## Anti-goals

- A pasted multiblock that doesn't form (wrong casing, a hatch where GT doesn't allow one, a missing coil).
- A Distillation Tower whose output fluids come out of the wrong layer.
- A pipe touching a hatch face that can't take it (an energy hatch or output hatch only works through its front).

## The three shapes (from GT 5.09.54.183 source)

All block names below are confirmed in the user's world save (`gregtech:gt.blockcasings4`, `…5`, `…8`).

### Distillation Tower — height varies

- 3 wide × 3 deep. **Height = number of fluid outputs + 1.** The user's 5-output recipe gives a 6-tall tower.
- Casing: Clean Stainless Steel Machine Casing (`gregtech:gt.blockcasings4`, meta 1). Per GT's structure: the bottom
  layer is a solid 3×3 (`b~b / bbb / bbb`, controller at `~`); each layer above is a ring of 8 with an **air** centre,
  except the **top** layer, whose centre is a casing (that's how GT finds the top). At least `7 × height − 5` casings.
- Every layer above the bottom needs at least one output hatch, and the tower is at least 3 tall: a recipe with one
  fluid output still gets a 3-tall tower, its second upper layer holding an output hatch nothing comes out of.
- Bottom layer: the controller (front centre), an input hatch, an energy hatch, a maintenance hatch, and an input
  bus / output bus if the recipe has items.
- Layer *n* above the bottom (n = 1 … outputs): one output hatch for the recipe's *n*-th fluid output, in the recipe's
  own output order. Fluids appear in the recipe data in that order; the builder must take the order from the recipe,
  not from a map or set.

### Large Chemical Reactor — 3×3×3

- Chemically Inert Machine Casing (`gt.blockcasings8`, meta 0) all round, a PTFE Pipe Casing (`gt.blockcasings8`,
  meta 1) in the very centre. Shape: `ccc/cxc/ccc`, `c~c/xPx/cxc`, `ccc/cxc/ccc`. **Exactly one** of the five `x` spots
  is a Heating Coil (Cupronickel, `gt.blockcasings5`, meta 0); the other `x` spots are casings or hatches.
- Controller: front centre, middle layer. Input/output hatches and buses, the energy hatch and the maintenance hatch
  may replace any outer casing (at least 8 casings must remain).

### Oil Cracking Unit — 5×3×3

- Columns across its width: `l c m c r` (left side, coil, middle, coil, right side). Coils (16, Cupronickel) fill the
  two `c` columns; Clean Stainless Steel casings fill `l`, `m`, `r`.
- Controller: front centre, middle layer.
- The hydrocarbon input hatch goes on one side column, the cracked-fluid output hatch on the **opposite** side column,
  and the hydrogen or steam input hatch on the middle column. Energy and maintenance hatches on any casing.

## Hatches (from GT source)

| Hatch | IDs (ULV…HV) | Takes / gives through |
|---|---|---|
| Input hatch | 50–53 | any face |
| Output hatch | 60–63 | pushes out of its **front** only |
| Input bus | 70–73 | any face |
| Output bus | 80–83 | pushes out of its **front** only |
| Energy hatch | 40–43 | takes power through its **front** only |
| Maintenance hatch | 90 | no pipes |

- Every hatch faces outward from the structure, with its pipe or cable on its front.
- Energy hatch tier: the recipe's voltage (the user's Distillation Tower recipe, 480 EU/t, needs HV). If one hatch
  can't carry the recipe's EU/t, add a second.
- Input/output hatches and buses: LV (cheapest). Hatch capacity is a buffer, not a speed limit.
- Block meta for hatches and controllers follows GT's harvest-tool rule (as for other GT machines); the builder checks
  each against the source.

## How it fits a line

- Multiblocks stand beside the core, not copied into each slice (they're too big for the slice cross-section). They're
  routed with the core: their hatches are where their pipes and cable land.
- **As many as the line needs.** As for every other machine, the line builds the count the summary says (today
  `ceil(machines)` for a multiblock in the core). One Distillation Tower handles about 312 L/s of Oil, so the 557 L/s
  oil berry line gets two, side by side. Each one's layer-*n* output hatch joins the same network, and each has its own
  energy hatch, counted in generator sizing.
- *(Our call)* The multiblocks are sized for the slices the line is built with. "This core handles up to N slices"
  counts them too, so growing past that warns as it does today. It doesn't add more multiblocks.
- Its power counts like any machine's in generator sizing and power networks (today multiblocks are left out of
  both). Its energy hatch joins the network of its voltage, with the same keep-apart and burn rules as other cables.
- Notes the line adds for a multiblock: fix the maintenance hatch with tools after pasting; any programmed circuit goes
  in the controller or an input bus; better coils than Cupronickel can be swapped in.

## 3D view and schematic

- Casings, coils, the controller and hatches are drawn as real blocks with their GT textures (from the user's jar, never
  committed).
- The schematic writes casings and coils as plain `gregtech:gt.blockcasings*` blocks with their meta, and the controller
  and hatches as GT machines (`BaseMetaTileEntity`, `mID`, `mFacing`), like other machines.

## Left to the builder

- Exactly where on each structure the hatches go (within GT's rules above), and which side the cracker's hydrocarbon
  goes in on.
- Where beside the core the multiblock stands, and how the router reaches hatches above the slice cross-section (a
  6-tall tower is taller than today's bounds).
- How a multiblock is described in code so the next one is data, not code.
- Texture choices for controller and hatch faces.
