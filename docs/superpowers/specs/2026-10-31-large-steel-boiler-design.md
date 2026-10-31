# Large Steel Boiler: steam in the Calculator and Build in 3D

## Why

The user asked for Large Boilers next. They want one **to make steam for their machines** (for example the Oil Cracking
Unit's steam), and they chose the **Large Steel Boiler**. They are at HV. Other design calls are delegated to Claude.

Today a Large Boiler can't appear in a chain. The recipe dump's Large Boiler map (`gt.recipe.largeboilerfakefuels`) is
GT's NEI-only "fake fuels" map, with one recipe per fuel: 1000 L of fuel in, nothing out, 0 EU/t. Nothing on it makes
steam, so the Calculator never offers a boiler when a chain needs steam.

## Goals

- The Calculator offers a Large Steel Boiler as a steam producer, burning any fluid fuel from the dump, with GT's own
  rates.
- Build in 3D lays the boiler out block for block, the same way as the other multiblocks.

## Non-goals

- Bronze, Titanium and Tungstensteel Large Boilers. Each one makes steam at a different rate from the same fuel, while a
  dump recipe belongs to a map, not to one machine. The map offers only the Steel boiler.
- Solid fuels (coal, charcoal, …). The dump keeps only `fuelValue / 1600`, rounded down, so their burn times can't be
  recovered exactly. Their recipes stay as they are: fuel in, nothing out.
- Steam turbines, or the boiler as a power source.
- Throttling with a programmed circuit (it lowers the output by 25 EU/t per step). The planner assumes no circuit.

## Anti-goals

- A boiler that runs dry. **A Large Boiler with fuel and no water explodes** (`MTELargeBoilerBase.onRunningTick`:
  `explodeMultiblock()`).
- Running steam numbers that differ from GT's.
- A boiler drawn with an energy hatch or a power cable. It uses no EU.

## How GT's Large Steel Boiler works (GT 5.09.54.183)

- **Which machine:** mID **15530**, `MTELargeBoilerSteel`, the craftable one. mID 1021 is `MTELargeBoilerSteelLegacy`,
  which only converts into 15530.
- **Steam:** `EUT_GENERATED = 1200`. Each tick at full efficiency it makes `EUt × 2` = **2,400 L of steam**, which is
  **48,000 L/s** (`onRunningTick`: `lEUt * 2 * mEfficiency / 10000`; full efficiency is 10000 when it burns one kind of
  fuel).
- **Water:** `steam / STEAM_PER_WATER` (160), so 15 L per tick, which is **300 L/s**. Distilled water also works; the
  planner uses Water.
- **Fluid fuel:** each 1000 L lasts the fuel recipe's `duration` ticks in a Steel boiler. `LargeBoilerFuelBackend`
  stores `mDuration` as the Steel burn time in ticks, and `runtimeBoost` is ×1 for Steel. The burn time is set to
  `duration × 2` and counts down by 2 a tick while one fuel is burning.
- **Fuels:** every fluid on the map (a non-superheated boiler takes any fuel).

### The recipes the planner adds

The map is reshaped when the recipe data is loaded (in `RecipeDb`, so it needs no re-import):

- **Recipes changed:** every recipe on `gt.recipe.largeboilerfakefuels` with exactly one input, a fluid of 1000 L, and
  no outputs.
- **What each becomes:** in, **1000 L fuel + 15 × d L Water**; out, **2,400 × d L Steam**. Here `d` is the recipe's
  duration in ticks, which stays the same, and the recipe still uses 0 EU/t.
- **Example:** Benzene has d = 365, so its recipe becomes 1000 L Benzene + 5,475 L Water → 876,000 L Steam every
  18.25 s. That is 54.8 L/s of Benzene for 48,000 L/s of Steam.
- **The map's machines:** only `{mID 15530, Large Steel Boiler}`.
- **Everything else is unchanged:** other recipes on the map (solid fuels, and Short Mead with its bucket) and every
  other map.

## The shape (`MTELargeBoilerBase`)

5 wide, 6 tall, 3 deep. GT's shape strings `[c][b]` map to planner coordinates as x = a, y = 5 − b, z = 2 − c (front
z = 2). The controller is at `[2,1,2]`.

| Letter | Block | Block name and meta | Count |
|--------|-------|---------------------|-------|
| `C` | Solid Steel Machine Casing (or a hatch) | `gt.blockcasings2` meta 0 | 32 |
| `F` | Steel Firebox Casing (or a hatch) | `gt.blockcasings3` meta 14 | 15 |
| `P` | Steel Pipe Casing | `gt.blockcasings2` meta 13 | 4 |
| `~` | Controller | | |
| blank | Air (GT doesn't check it) | | |

The catalog already has all three blocks: `casing_solid_steel`, `casing_steel_firebox` and `casing_steel_pipe`.

Layers from bottom to top. Each row is one z, front (z 2) first, written x 0→4:

- **y 0:** every cell is `F`.
- **y 1:** z2 `CC~CC`; z1 `C...C`; z0 `CCCCC`.
- **y 2:** z2 `.CCC.`; z1 `PCC.P`; z0 `.CCC.`.
- **y 3:** z2 `...C.`; z1 `PPC.C`; z0 `...C.`.
- **y 4:** z2 `...C.`; z1 `..C.C`; z0 `...C.`.
- **y 5:** z2 `...C.`; z1 `..CCC`; z0 `...C.`.

GT needs **at least 20 casings and 5 fireboxes** (`checkCasingMin`). It also needs a maintenance hatch, a muffler, an
input hatch and an output hatch. There is **no energy hatch**.

### Hatches as built

- **Controller** `[2,1,2]`, facing front.
- **Maintenance hatch** `[2,1,0]`, facing back (2).
- **Muffler** (LV) `[3,5,1]`, on top of the chimney, facing up (1), with the cell above kept as air.
- **Fluid inputs** on the left side, facing left (4), at `[0,1,1]`, then `[0,1,0]`, then `[0,1,2]`. Fuel and water use
  two of them.
- **Fluid outputs** on the right side, facing right (5), at `[4,1,1]`, then `[4,1,0]`, then `[4,1,2]`. Steam uses one.
- **An item input bus**, which none of the steam recipes needs, would go at `[0,0,1]`, facing left.
- **More fluids than slots** get a note, as for the other multiblocks. With every slot filled, 32 − 8 = 24 casings
  remain, which is at least 20.

## A multiblock with no power

The boiler's recipe uses 0 EU/t, so:

- **Plan:** a multiblock whose recipe uses 0 EU/t gets **no tier**, which keeps it out of the line's power plan. It
  gets no cable, and it adds nothing to the power demand or tiers. A line that has only a boiler gets no power at all.
- **Structure:** `buildable` and `structureFor` don't need an energy hatch for it.
- **Checker:** it doesn't report "has no energy hatch" for a multiblock whose recipe uses no EU.

## Notes the line adds

- The usual multiblock notes: maintenance, and keeping the block above the muffler empty (through `hasMuffler`).
- "Fill the Large Steel Boiler with water before its fuel: a Large Boiler that runs dry explodes".
- "The Large Steel Boiler burns at full rate (48,000 L/s of steam) whenever it has fuel, even if the steam isn't used".

## 3D view

- The controller for 15530 wears `MACHINE_CASING_SOLID_STEEL` with `OVERLAY_FRONT_LARGE_BOILER`. Both are in the
  user's GT jar.
- `hasLayout(15530)` is true. The map has only that machine anyway.

## Left to the builder

- Where the map reshaping lives: its own module, called from the `RecipeDb` constructor.
- Test layout, mirroring the other multiblocks.
- Whether pipes can carry 48,000 L/s. Check this on real lines and report what happens.
