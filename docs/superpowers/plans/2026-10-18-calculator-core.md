# GTNH Planner — Plan 3a: Calculator Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The non-UI half of the production calculator: dumper v2, recipe import, an in-app recipe database, rate/overclock maths, an LP solver behind an interface, chain solving with the oil berry chain as the reference, "suggest the rest", and project persistence — all pure TypeScript (plus the Java mod change), fully tested.

**Architecture:** `mod/` gains three dump sections (format 2). `scripts/import-recipes.ts` converts a dump into a compact app file. `src/recipes` loads it into a `RecipeDb` with lookups and search. `src/calc` turns a `Chain` into an LP (`src/calc/solver`, HiGHS) and interprets the result. `src/project` wraps `{ build, chain }`. Plan 3b builds the Calculator UI on these interfaces.

**Tech Stack:** Java 8-target Forge 1.7.10 mod (JDK 25 + Gradle, existing `mod/`), TypeScript, Vitest, `highs` 1.15.x (MIT, WASM), fflate.

**Spec:** `docs/superpowers/specs/2026-10-18-calculator-design.md`

## Global Constraints

- `src/recipes`, `src/calc`, `src/project` import no React/three.
- Resource keys: `item:<registryId>@<meta>` | `fluid:<fluidId>` | `eu`.
- Rates: items/fluids per **second**; EU resource in **EU/t**. 20 ticks = 1 s.
- Voltage table `V = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608, 33554432, 134217728, 536870912, 2147483647]` (tier 0 = ULV, 1 = LV, 2 = MV …), copied from GT `GTValues.V`.
- Overclock (GTNH standard): per tier above the recipe tier, duration ÷ 2 (floor, min 1 tick), EU/t × 4. Multiblocks: same rule, flagged `approximate`.
- Generator fuel energy = `euPerLitre × efficiency% / 100` per litre (GT `MTEBasicGenerator`).
- Generated app data and dumps are git-ignored (`public/data/`).
- LP backend: `highs` via `loadHighs()` → `highs.solve(lpText, { output_flag: false })` → `{ Status, Columns[name].Primal }`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Maximise with no supply limit** → the LP is unbounded; the user must get "set a supply limit for …", not a crash or Infinity. Test in Task 6.
- **A chain node whose recipe signature is not in the current DB** (after a re-dump) → node flagged `missing`, excluded from the LP, rest still solves. Test in Task 6.
- **Chanced outputs and non-consumed inputs** (circuits) → chance scales output rate; count-0 inputs never become external inputs. Test in Task 4.
- **ULV recipes (EU/t ≤ 8) on an LV machine with overclock on** → one overclock (duration ÷ 2, EU/t × 4), never zero duration. Test in Task 4.
- **Format-1 dump (no generator stats)** → imports fine; generator machines report `generator: undefined` so generator nodes are refused with "re-dump to enable". Test in Task 2.

---

## File Structure

```
mod/src/main/java/dev/gtnhplanner/dumper/RecipeDumper.java   + containers, machine voltage/amps, generator stats, format 2
src/recipes/types.ts          Resource, Stack, Recipe, RecipeMapInfo, MachineRef, Fuel, AppRecipeData (file shape)
src/recipes/importDump.ts     dump (format 1|2) → AppRecipeData (pure; used by the script and tests)
scripts/import-recipes.ts     CLI: read dump .gz → write public/data/recipes.json.gz + recipes-meta.json
src/recipes/db.ts             RecipeDb: from AppRecipeData; producersOf/consumersOf/search/bySignature/fuelsFor
src/calc/tiers.ts             V table, tierForEut, overclock
src/calc/rates.ts             nodeRates(node, db) → per-machine resource rates (+ validity)
src/calc/solver/types.ts      LpModel, LpResult, LpSolver
src/calc/solver/highs.ts      HighsSolver (LP text writer + highs)
src/calc/chain.ts             Chain, ChainNode, Target, Limit, emptyChain, signature helpers
src/calc/solve.ts             solveChain(chain, db, solver) → ChainResult
src/calc/suggest.ts           suggestFor(key, chain, db) → ranked candidates
src/project/project.ts        Project v2, parseProject (accepts build-only v1), serializeProject
src/test/oilBerryDb.ts        fixture AppRecipeData with the verified oil berry recipes + combustion gens
```

---

### Task 1: Dumper v2 (mod)

**Files:** Modify `mod/src/main/java/dev/gtnhplanner/dumper/RecipeDumper.java`.

**Interfaces:** Produces dump `format: 2` with:
- `machines[]` entries gain `voltage` (long, `GTValues.V[mTier]` for `MTETieredMachineBlock`), and for `MTEBasicGenerator` a `generator: { efficiency: getEfficiency(), euOut: V[mTier], ampsOut: 1 }`. Do **not** call `maxEUOutput()`/`maxEUInput()` (they dereference the base tile entity, null on prototypes).
- `containers: [{ item: itemIdx, fluid: fluidIdx, amount }]` from `FluidContainerRegistry.getRegisteredFluidContainerData()`, only for filled containers whose `id@meta` is already in the item table (keeps the file small). Written after `machines`, before `items`/`fluids` (adding fluids it references).

- [ ] **Step 1:** Implement the three additions and bump `FORMAT` to 2; keep every per-entry read in try/catch (log + skip), as for recipes.
- [ ] **Step 2:** `cd mod && JAVA_HOME="/c/Program Files/Java/jdk-25" ./gradlew spotlessApply build -x test` → `BUILD SUCCESSFUL`.
- [ ] **Step 3:** Copy the jar to `…/instances/export v2/.minecraft/mods/gtnhplannerdumper-0.1.jar` (replace).
- [ ] **Step 4: Commit** `feat(dumper): format 2 — fluid containers, machine voltage, generator stats`.
- [ ] **Step 5 (async, user):** ask the user to restart `export v2` and run `/gtnhplanner dump`. Later tasks do not block on it (they use fixtures); Task 2's real-data check runs when it arrives.

### Task 2: Import (dump → app data)

**Files:** Create `src/recipes/types.ts`, `src/recipes/importDump.ts`, `scripts/import-recipes.ts`, test `src/recipes/importDump.test.ts`. Modify `package.json` (`"recipes": "tsx scripts/import-recipes.ts"`), `.gitignore` (`public/data/`).

**Interfaces:**
- `type ResourceKey = string`; `interface Resource { key; name; kind: 'item'|'fluid'|'eu' }`.
- `interface Stack { key: ResourceKey; amount: number; chance?: number /*0..1, outputs*/; consumed?: boolean /*inputs; false when count 0*/ }`.
- `interface Recipe { id: number; map: number; eut: number; duration: number; specialValue: number; inputs: Stack[]; outputs: Stack[] }`.
- `interface MachineRef { mID; name; tier?; multiblock; voltage?; generator?: { efficiency; euOut; ampsOut } }`.
- `interface RecipeMapInfo { index; id; name; amperage; machines: MachineRef[] }`.
- `interface Fuel { map: number; key: ResourceKey /*fluid*/; euPerLitre: number }`.
- `interface AppRecipeData { format: 1; gregtech: string; dumpFormat: 1|2; exportedAt: number; resources: Resource[]; maps: RecipeMapInfo[]; recipes: Recipe[]; fuels: Fuel[] }` — recipes reference resources by key string (readable, gzip removes the redundancy).
- `importDump(dump: unknown): { data: AppRecipeData; warnings: string[] }`.
- Fuels: for every recipe whose map has at least one machine with `generator` (format 2), or whose map id ends in `fuel`/`fuels` (format 1), with `specialValue > 0`: the fuel fluid is its fluid input, else its item input mapped through `containers`; `euPerLitre = specialValue`. Fuel recipes are kept out of `recipes`.

- [ ] **Step 1: Failing tests** (fixture dumps built inline):
  - `maps item/fluid indices to resource keys` — input `[[0, 1]]` with `items[0] = { id: 'gregtech:gt.metaitem.01', meta: 11342, name: 'Oil Berry' }` → `{ key: 'item:gregtech:gt.metaitem.01@11342', amount: 1, consumed: true }`.
  - `count-0 item inputs are not consumed` → `consumed: false`.
  - `output chance 10000 → 1, 2500 → 0.25`.
  - `fuel recipe via container becomes a Fuel` — diesel map, item input Light Fuel Cell, `containers` maps that cell to fixture fluid id `'lightfuel'` (1000 L), `sv 305` → `fuels` contains `{ key: 'fluid:lightfuel', euPerLitre: 305 }` and `recipes` does not contain it.
  - `format-1 dump: machines have no generator; fuels still found by map id` and `dumpFormat` is 1.
  - `bad recipe index is skipped with a warning`.
- [ ] **Step 2:** `npx vitest run src/recipes/importDump.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `importDump`; the script reads `--dump <path>` (or `GTNH_DUMP`), gunzips (fflate), writes `public/data/recipes.json.gz` and `public/data/recipes-meta.json` (`{ gregtech, dumpFormat, exportedAt, counts }`), prints counts and warnings count.
- [ ] **Step 4:** tests pass; `npm run recipes` on the real format-1 dump prints ≈176k recipes and a non-zero fuel count.
- [ ] **Step 5: Commit** `feat: recipe dump importer`.

### Task 3: RecipeDb

**Files:** Create `src/recipes/db.ts`, test `src/recipes/db.test.ts`, fixture `src/test/oilBerryDb.ts`.

**Interfaces:**
- `class RecipeDb { constructor(data: AppRecipeData); resource(key): Resource | undefined; recipe(id): Recipe | undefined; map(index): RecipeMapInfo; producersOf(key): Recipe[]; consumersOf(key): Recipe[]; search(text: string, limit = 50): Resource[]; bySignature(sig: string): Recipe | undefined; fuelsFor(mapIndex): Fuel[]; readonly gregtech: string; readonly dumpFormat: 1|2 }`.
- `recipeSignature(r: Recipe, db: RecipeDb): string` = `<mapId>|<sorted inputs key*amount>|<sorted outputs key*amount>` (map **id**, not index).
- `oilBerryData(): AppRecipeData` fixture with exactly the verified recipes: Fluid Extractor (map `gt.recipe.fluidextractor`, machines 511 LV/512/513), Distillery 50 L Oil → 50 L Sulfuric Light Fuel 24×30 with circuit (531/532/533), Chemical Reactor 30×160 (421…), Electrolyzer 120×72 H2S cell + empty cell → sulfur + 2 H cells (371 LV / 372 MV), and fuel map `gt.recipe.dieselgeneratorfuel` with machines 1110 (LV, eff 95, euOut 32) / 1111 (MV, eff 90, euOut 128) and fuel Light Fuel 305 EU/L. Also one decoy distillery recipe (100 L Oil → 30 L Sulfuric Heavy Fuel).

- [ ] **Step 1: Failing tests:** `producersOf('fluid:oil')` = the extractor recipe; `consumersOf('fluid:oil')` has both distillery recipes; `search('light fuel')` ranks exact-prefix matches first and is case-insensitive; `bySignature(recipeSignature(r))` returns `r`; `fuelsFor(dieselMap)` returns the Light Fuel fuel.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (indexes built once in the constructor). **Step 4:** pass. **Step 5: Commit** `feat: in-app recipe database`.

### Task 4: Tiers, overclock and per-machine rates

**Files:** Create `src/calc/tiers.ts`, `src/calc/chain.ts` (types only here), `src/calc/rates.ts`, tests `src/calc/tiers.test.ts`, `src/calc/rates.test.ts`.

**Interfaces:**
- `tiers.ts`: `V: readonly number[]`; `tierForEut(eutPerAmp: number): number` (lowest t with `V[t] ≥ eut`); `overclock(eut, duration, overclocks): { eut; duration }`.
- `chain.ts`: `type ChainNode = { id: string; kind: 'recipe'; recipeSig: string; machineMID: number; overclock: boolean; position: { x: number; y: number } } | { id: string; kind: 'generator'; fuelMap: string /*map id*/; fuelKey: ResourceKey; machineMID: number; position: { x: number; y: number } }`; `type Target = { key; rate: number } | { key; maximise: true }`; `interface Limit { key; maxRate: number }`; `interface Chain { version: 1; nodes: ChainNode[]; targets: Target[]; limits: Limit[]; externals: ResourceKey[] }`; `emptyChain(): Chain`.
- `rates.ts`: `interface NodeRates { valid: true; perMachine: Map<ResourceKey, number>; eut: number; duration: number; approximate: boolean } | { valid: false; reason: string }`; `nodeRates(node: ChainNode, db: RecipeDb): NodeRates`. Positive = produced. EU entry `eu` = −effective EU/t (consumers) or +`euOut×ampsOut` (generators). Generator nodes (`kind: 'generator'`, machine has `generator`): consume fuel L/s = `euOut×ampsOut×20 / (euPerLitre × efficiency/100)`.
- Invalid when: recipe signature missing (`reason: 'missing recipe'`), machine voltage < recipe EU/t per amp (`'machine tier too low'`), generator node without generator stats (`'re-dump to enable generators'`).

- [ ] **Step 1: Failing tests:**
  - `tierForEut(30) === 1`, `tierForEut(24) === 1`, `tierForEut(120) === 2`, `tierForEut(8) === 0`.
  - `overclock(30, 20, 1)` → `{ eut: 120, duration: 10 }`; `overclock(30, 1, 3)` → duration stays 1.
  - LV extractor node: per machine `item Oil Berry −1/s`, `fluid oil +100/s`, `eu −30`.
  - LV distillery: oil −33.333…/s, sulfuric light fuel +33.333…/s, `eu −24`, circuit absent from the map.
  - Chanced output 25% → rate × 0.25.
  - LV electrolyzer on the 120 EU/t recipe → `{ valid: false, reason: 'machine tier too low' }`; MV electrolyzer valid, `eu −120`.
  - ULV recipe (eut 7, dur 100) on LV machine with overclock → `eut 28`, `duration 50`.
  - MV combustion generator burning Light Fuel → `eu +128`, light fuel −`128×20/(305×0.9)` ≈ −9.326 L/s.
  - Format-1 db generator node → invalid `'re-dump to enable generators'`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat: tiers, overclocking and per-machine rates`.

### Task 5: LP solver interface + HiGHS

**Files:** Create `src/calc/solver/types.ts`, `src/calc/solver/highs.ts`, test `src/calc/solver/highs.test.ts`. `npm install highs@^1.15.4`.

**Interfaces:**
- `interface LpModel { sense: 'min'|'max'; objective: Record<string, number>; constraints: { name: string; terms: Record<string, number>; op: '>='|'<='|'='; rhs: number }[] }` (all variables ≥ 0).
- `type LpResult = { status: 'optimal'; objective: number; values: Record<string, number> } | { status: 'infeasible' } | { status: 'unbounded' } | { status: 'error'; message: string }`.
- `interface LpSolver { solve(model: LpModel): Promise<LpResult> }`; `createHighsSolver(): Promise<LpSolver>`.
- Variable/constraint names are sanitised to `[A-Za-z0-9_]` with a reversible map (resource keys contain `:@.`).

- [ ] **Step 1: Failing tests:** chairs/tables LP without integrality → optimal objective 1100 at chairs 20, tables 10 (continuous optimum of the README model is the same); infeasible model (`x >= 5`, `x <= 1`) → `infeasible`; unbounded max → `unbounded`; names with `item:gregtech:x@1` round-trip.
- [ ] **Step 2:** FAIL. **Step 3:** implement (LP text: `Maximize/Minimize`, `Subject To`, `Bounds` `>= 0`, `End`; status map `Optimal→optimal`, `Infeasible→infeasible`, `Unbounded`/`Primal unbounded`→`unbounded`). **Step 4:** pass. **Step 5: Commit** `feat: LP solver interface with HiGHS backend`.

### Task 6: Solve a chain

**Files:** Create `src/calc/solve.ts`, test `src/calc/solve.test.ts`.

**Interfaces:**
- `interface NodeResult { id; machines: number; build: number /*ceil*/; eut: number /*total*/; rates: Map<ResourceKey, number> /*total per second*/; invalid?: string; approximate: boolean }`.
- `interface ChainResult { status: 'ok' | 'infeasible' | 'unbounded' | 'error'; message?: string; shortfalls: { key; needed: number; available: number }[]; nodes: NodeResult[]; inputs: Map<ResourceKey, number>; outputs: Map<ResourceKey, number>; byproducts: Map<ResourceKey, number>; euUsed: number; euMade: number }`.
- `solveChain(chain: Chain, db: RecipeDb, solver: LpSolver): Promise<ChainResult>`.
- Formulation exactly as the spec (§2 LP): variables `x_<nodeId>`; per resource `net_r` row; targets `≥ rate` or maximise objective; limits `≥ −maxRate`; produced-and-not-external resources `≥ 0`; resources consumed but never produced are external inputs (no row unless limited); EU row `net_eu ≥ 0` when any generator node exists, else EU is reported as external power demand. Objective in rate mode: minimise `Σ x_n` + `1e-6 × Σ external inputs` (tie-break).
- On `infeasible`: re-solve with an elastic slack `s_t ≥ 0` on each target row (cost `1e6`) and report `shortfalls` from non-zero slacks plus binding limits; status stays `infeasible`.
- On `unbounded`: `message: 'Set a supply limit for … to maximise <target name>'` naming the external inputs feeding the target.
- Invalid nodes are excluded and returned with `invalid` set.

- [ ] **Step 1: Failing tests** (fixture `oilBerryData()`, real HiGHS):
  - **Reference:** nodes extractor LV, distillery LV (light fuel recipe), chemical reactor LV, electrolyzer MV, combustion generator MV burning light fuel; limit Oil Berry ≤ 5.57; target maximise Light Fuel. Expect machines ≈ 5.57 / 16.71 / 0.3713 / 0.1671 (±0.5 %), hydrogen cell and empty cell rows balanced (|net| < 1e-6), `byproducts` has Sulfur Dust ≈ 0.0464/s, `euUsed` ≈ 599.3, light fuel output ≈ 513.3 L/s (±0.5 %).
  - **Rate mode:** same nodes without the generator, target Light Fuel 100 L/s, no limits → status `ok`, machines ≈ 1.0 / 3.0 / 0.0667 / 0.0300, Oil Berry input 1.0/s, `euUsed` ≈ 107.6 (30 + 72 + 2.0 + 3.6), EU reported as external power demand.
  - **Infeasible:** target Light Fuel 1000 L/s with Oil Berry ≤ 5.57 → `infeasible`, `shortfalls[0].key === 'fluid:lightfuel'` with needed 1000 and available ≈ 513.
  - **Unbounded:** maximise Light Fuel without limits → `unbounded`, message mentions "Oil Berry".
  - **Missing recipe node:** one node with a bogus `recipeSig` → that node `invalid: 'missing recipe'`, the rest solves.
  - **Invalid tier:** LV electrolyzer node → invalid, chain reports hydrogen as an external input.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat: chain solver`.

### Task 7: Suggest the rest

**Files:** Create `src/calc/suggest.ts`, test `src/calc/suggest.test.ts`.

**Interfaces:** `interface Suggestion { recipe: Recipe; machine: MachineRef; newExternals: ResourceKey[]; closesLoop: boolean }`; `suggestFor(key: ResourceKey, chain: Chain, db: RecipeDb, limit = 10): Suggestion[]` — candidates = `producersOf(key)`; machine = lowest-tier machine able to run it; sort by (closesLoop desc, machine tier asc, newExternals length asc, recipe EU/t asc); exclude recipes already in the chain.

- [ ] **Step 1: Failing tests:** for `item:… Hydrogen Cell` in a chain that has the chemical reactor → the electrolyzer recipe first with `closesLoop: true` and machine 372 (MV, since LV is too low); for `fluid:oil` → extractor recipe with machine 511; a recipe already in the chain is not suggested.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat: suggest recipes for unmet inputs`.

### Task 8: Project persistence

**Files:** Create `src/project/project.ts`, test `src/project/project.test.ts`.

**Interfaces:** `interface Project { version: 2; build: Build; chain: Chain }`; `serializeProject(p): string`; `parseProject(text): { project: Project; warnings: string[] }` — accepts version 2, or a version-1 build file (wraps it with `emptyChain()`); reuses `parseBuild` for the build part; validates chain shape (bad nodes skipped with warnings; unknown target/limit entries dropped).

- [ ] **Step 1: Failing tests:** round-trip a project; a v1 build JSON becomes `{ version: 2, build, chain: emptyChain() }`; a chain node with non-numeric `machineMID` is skipped with a warning; a garbage file throws `BuildParseError`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat: project file with build and chain`.

### Task 9: Real-data check (after the user's re-dump)

- [ ] **Step 1:** `npm run recipes` on the format-2 dump → prints `dumpFormat 2`, fuels > 0, Light Fuel fuel at 305 EU/L.
- [ ] **Step 2:** `npx tsx scripts/check-oil-chain.ts` (new, small): loads `public/data/recipes.json.gz` into `RecipeDb`, builds the reference chain by **searching the real DB** (extractor/distillery/reactor/electrolyzer recipes and Light Fuel fuel), solves with HiGHS, prints the same numbers as Task 6's reference test → within ±0.5 %.
- [ ] **Step 3: Commit** `test: verify the oil berry chain against the real recipe dump`.
