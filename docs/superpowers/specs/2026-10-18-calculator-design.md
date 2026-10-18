# GTNH Planner — Production Calculator (Project 1 of 2) — Design

Date: 2026-10-18
Status: Approved in conversation, section by section (data, solver, screen, saving/errors/scope)

## Goal

A gtnhplanner.com-style production calculator inside the planner, using the recipes of the user's own GTNH pack:
build a production chain as a node graph (by hand, with a "suggest the rest" helper), set targets and supply limits,
and get balanced machine counts, rates, power and byproducts. Project 2 (separate spec) will turn a solved chain
into an auto-generated 3D layout and schematic; this project only prepares the hand-off.

## Context and verified facts

- Recipes come from our own mod (`mod/`, `/gtnhplanner dump`), run in the Prism instance `export v2`
  (GTNH 2.9.0-RC-1, GregTech 5.09.54.183). Output: `.minecraft/gtnh-planner/recipes.json.gz`,
  format 1: 176,576 recipes, 172 recipe maps, 894 machines, 44,387 items, 1,420 fluids, 1.8 MB.
- Verified against the user's oil berry chain: Fluid Extractor 1 Oil Berry → 100 L Oil, 30 EU/t × 20 t;
  Distillery 50 L Oil → 50 L Sulfuric Light Fuel, 24 EU/t × 30 t (programmed circuit, count 0);
  Chemical Reactor 2 Hydrogen Cell + 12,000 L Sulfuric Light Fuel → 12,000 L Light Fuel + Hydrogen Sulfide Cell +
  Empty Cell, 30 EU/t × 160 t; Electrolyzer (MV) 1 Hydrogen Sulfide Cell + 1 Empty Cell → Sulfur Dust + 2 Hydrogen
  Cell, 120 EU/t × 72 t. Machines are linked to maps by mID (e.g. distillery map: 531/532/533).
- Generator fuels (`gt.recipe.dieselgeneratorfuel` etc.) list the fuel as a **cell item** with `sv` = fuel value in
  **EU per litre** (Light Fuel: 305). Combustion generators 1110–1114 (LV–IV) and large engines are on that map.
  GT generator EU = fuel value × litres × efficiency% (MTEBasicGenerator); LV/MV/HV combustion efficiency 95/90/85.

## Architecture

```
mod/                          dumper v2 (Java): + fluid containers, generator stats, machine voltage/amperage
scripts/import-recipes.ts     recipes.json.gz (dump) → public/data/recipes.json.gz (app format), git-ignored
src/recipes/                  data model, loading (worker), lookups, search            — pure TS, tested
src/calc/                     chain model, rates/overclock, LP builder, solve, suggest — pure TS, tested
src/calc/solver/              LP backend interface + HiGHS implementation
src/project/                  project = { build, chain } persistence (extends current build persistence)
src/calculator/ (UI)          Calculator tab: overview, graph (@xyflow/react), recipe browser, targets bar
```

`src/recipes` and `src/calc` have no React/three imports. The LP backend is behind an interface so tests can use
a pure-JS stub where WASM is awkward and the solver can be swapped.

## 1. Recipe data

### Dumper v2 (mod)
Add to the dump (format 2), read from GregTech/Forge directly:
- `containers`: for every item that is a fluid container (`FluidContainerRegistry.getFluidForFilledItem`, and GT
  cells), `{ item: itemIdx, fluid: fluidIdx, amount }`. Used to turn fuel-cell recipes into fluid fuel.
- `machines[]` gains `voltage` (EU/t per amp, `maxEUInput`/`V[tier]`), `amperage` (max amps in), and for generators
  (`MTEBasicGenerator` and subclasses) `generator: { efficiency, euOut, ampsOut }`.
- `format: 2`. Format 1 dumps still import; generator nodes are then disabled with "re-dump to enable".

### Import script
`npm run recipes [-- --dump <path>]` (default: `export v2` instance path) reads the dump and writes
`public/data/recipes.json.gz` plus a small `public/data/recipes-meta.json` (gregtech version, dump time, counts,
format). Normalises to the app model; validates (indices in range, positive durations except fuel maps) and reports
problems without failing on individual bad recipes.

### App data model (`src/recipes`)
- `ResourceKey`: `item:<registryId>@<meta>` | `fluid:<fluidId>` | `eu`.
- `Resource { key, name, kind: 'item'|'fluid'|'eu' }`.
- `Recipe { id, map, eut, duration, specialValue, inputs: Stack[], outputs: Stack[] }`;
  `Stack { key: ResourceKey, amount, chance (0–1, outputs), consumed (inputs; false for count-0 items) }`.
- `RecipeMap { id, name, amperage, machines: MachineRef[] }`;
  `MachineRef { mID, name, tier?, multiblock, voltage?, amperage?, generator? }`.
- `RecipeDb` with `producersOf(key)`, `consumersOf(key)`, `search(text, limit)`, `recipe(id)`, `map(id)`.
- Stable recipe identity for saved chains: `recipeSignature = map id + sorted input/output keys and amounts`.

### Loading
The app fetches `data/recipes.json.gz`, gunzips and indexes in a Web Worker (fflate), then exposes `RecipeDb` to the
UI. Missing file → Calculator tab shows import instructions; 3D editor unaffected. GregTech version differing from
the catalog's (5.09.54.183) → warning banner, still usable.

## 2. Chain model and solver (`src/calc`)

### Chain
```ts
interface Chain {
  version: 1;
  nodes: ChainNode[];           // { id, recipeSig, machineMID, overclock: boolean, position }
  targets: Target[];            // { key, rate } (per second) or { key, maximise: true }
  limits: Limit[];              // { key, maxRate } supply caps
  externals: ResourceKey[];     // resources the user marked as "bought in" (no warning)
}
```
Links are implicit: every node output resource feeds every node input of the same resource.

### Rates
- Recipe tier = lowest tier whose voltage ≥ EU/t (per amp of the map). Machine tier from `MachineRef`.
- Overclock (when enabled and machine tier > recipe tier), per tier above: duration ÷ 2 (floor, minimum 1 tick),
  EU/t × 4 (GTNH standard overclock). Multiblocks use the same rule and are flagged "approximate".
- Per machine: items/fluids per second = amount × chance × 20 ÷ effectiveDuration; consumed inputs only.
- EU: consumers use effective EU/t × 20 per second of resource `eu`; generator nodes produce
  `euOut × ampsOut` EU/t and consume fuel litres/tick = EU/t ÷ (fuelValue × efficiency).
- A node whose machine cannot run its recipe (voltage too low) is invalid and excluded, with a red flag.

### LP formulation (solved with HiGHS)
- Variables `x_n ≥ 0`: machines running at node n (fractional).
- Per resource r: `net_r = Σ_n x_n · rate_n(r)` (outputs positive, inputs negative).
- Target with rate: `net_r ≥ rate`. Maximise target: objective maximise `net_r`.
- Limit: `net_r ≥ −maxRate` (consumption beyond production is capped).
- Every other resource that some node produces: `net_r ≥ 0` if it is not marked external and nothing caps it
  (surplus = byproduct). Resources consumed but produced by no node are external inputs (unbounded unless limited).
- Objective (target-rate mode): minimise `Σ x_n` (fewest machines), tie-broken by minimising external inputs.
- Infeasible → report which constraint(s) bind (targets vs limits), e.g. "needs 7.2 Oil Berry/s, limit 5.6".
- Results: `x_n`, `ceil(x_n)` to build, per-node and total rates, external inputs, outputs, byproducts, EU used/made/net.

### Suggest the rest
For each external input with producers in the DB: rank candidates by (machine tier ascending, number of new external
inputs ascending, avoids pulling in an existing chain resource unless it closes a loop); show the list; add the chosen
recipe as a node at a position next to its consumer. Never auto-picks between alternatives without the user.

## 3. Calculator screen (`src/calculator`)

- Top-level tabs: **Calculator** | **3D Editor** (shared project).
- Left **Overview**: inputs, outputs, byproducts with rates; machines by type/tier with build counts; power used /
  generated / net; problems list (infeasible, invalid tier, unmet inputs).
- Centre **graph** (`@xyflow/react`): node = recipe card (inputs/outputs with live rates, machine picker over the
  map's machines, overclock toggle, machines exact + to build, EU/t); edges labelled with flow; "suggest" button on
  unmet inputs; toolbar: auto-arrange, fit, undo/redo, **Build in 3D** (disabled placeholder explaining project 2).
- Right **recipe browser**: search items/fluids; "made by" / "used in" lists with inputs, outputs, EU/t, duration,
  machine; click to add a node linked into the chain.
- Targets bar above the graph; right-click any resource: set target, set limit, mark external.

## 4. Saving, errors, scope

- **Project** = `{ version: 2, build, chain }`; autosave + Save/Load .json as today; version-1 (build-only) files load
  with an empty chain. Nodes store `recipeSig`; on load, nodes whose signature no longer exists are flagged.
- Errors: no recipe data → instructions; GT version mismatch → warning; infeasible → shortfall named, last valid
  numbers greyed; invalid machine tier → red node.
- Out of scope: auto 3D layout (project 2), multiblock parallels/perfect OC/coil bonuses (approximate only), item
  icons, headless/server auto-dump.

## Testing

- Unit: import normalisation (fixture dump), lookups/search, overclock/rate maths, LP formulation, suggestions.
- Reference test: the oil berry chain with Oil Berry ≤ 5.57/s and self-powered MV combustion generators →
  ≈5.57 extractors, ≈16.7 distilleries, ≈0.37 chemical reactors, ≈0.17 MV electrolyzers, hydrogen loop balanced,
  Sulfur as byproduct, ≈557 L/s gross Light Fuel, ≈599 EU/t, ≈43.7 L/s burned (599 ÷ (305 × 0.9) × 20),
  ≈513 L/s net. (`scripts/make-oil-berry-line.ts` prints ≈522 because it assumes the extractors' full 6 berries/s.)
- Edge cases: infeasible target, loops, chanced outputs, non-consumed inputs, invalid machine tier.
- E2E (Playwright): search Light Fuel → build the chain → set Oil Berry ≤ 5.57/s → overview shows ≈513 L/s net; undo works.
- Dumper v2: in-game run in `export v2`, verify Light Fuel Cell → 1000 L Light Fuel and combustion generator
  efficiency/output against GT values.
