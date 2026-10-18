# Calculator UI (Plan 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Calculator tab: load the user's recipe data, build a chain as a node graph (recipe browser, suggest, generators), set targets/limits/externals, and see the solved overview — beside the existing 3D Editor tab, saved in one project.

**Architecture:** All logic the screen needs is pure TS in `src/calculator/*.ts` (state reducer + history, view models, layout, formatting, storage) and `src/recipes/load.ts`, unit-tested in Vitest (node env, no DOM). React components in `src/calculator/ui/*.tsx` only render those models and dispatch actions; they are verified by Playwright. `App.tsx` becomes the shell: tab bar, toasts, project save/load, both histories.

**Tech Stack:** React 19, `@xyflow/react` 12.12.0 (new dependency), `highs` (WASM via `highs/runtime?url`), fflate async `gunzip` (runs in fflate's worker), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-calculator-design.md` (§1 Loading, §3 Calculator screen, §4 Saving/errors). Core (§1 data, §2 solver) is merged on main.

## Global Constraints

- Top-level tabs: **Calculator** | **3D Editor** (shared project). The 3D Editor stays the default tab so existing behaviour and e2e tests are unchanged; the last tab is remembered per browser (try/catch storage).
- `src/recipes` and `src/calc` gain no React/three imports.
- Missing recipe file → Calculator shows import instructions (`/gtnhplanner dump` in the `export v2` instance, then `npm run recipes`, reload); 3D editor unaffected.
- GregTech version different from the catalog's `5.09.54.183` → warning banner, still usable.
- Infeasible → shortfall and binding supply limits named; numbers greyed. Invalid machine tier → red node with the reason.
- Project = `{ version: 2, build, chain }`; Save/Load .json saves/loads the project; version-1 files load the build only.
- Rates are shown per second: items `/s`, fluids `L/s`, power `EU/t`; numbers to 4 significant figures.
- "Build in 3D" is present but disabled, with a tooltip saying it arrives in project 2.
- Recipe data and textures are never committed (`public/data` is git-ignored).

**Decision (recorded here, not in the spec):** gunzip runs off the main thread via fflate's async `gunzip`; JSON parse and `RecipeDb` indexing run on the main thread once (~0.5 s), because `RecipeDb`'s Maps cannot cross a worker boundary cheaply. Infeasible results show the solver's best-effort (relaxed) numbers greyed; unbounded/error show the last OK numbers greyed.

## Review Focus

1. Recipe file missing, served as the dev server's HTML fallback, already decoded by the browser (no gzip magic), or corrupt → instructions or an error message, never a blank tab. (Task 1 tests.)
2. A saved chain whose recipe signature no longer exists (re-dump) → red "missing recipe" node; the rest of the chain still renders and solves. (Task 3 test.)
3. Typed rates: empty, `0`, negative, `abc`, `1e999` in target/limit fields → rejected and the field reverts; never NaN/Infinity in the chain. (Task 3 `parseRateInput` tests.)
4. Rapid edits while a solve is in flight → an older solve never overwrites a newer result. (Task 3 `createLatest` test.)
5. Loading a version-1 build file keeps the current chain; a version-2 file replaces both; Ctrl+Z restores the previous chain. (Task 2 tests.)

---

### Task 1: Recipe loading and DB helpers

**Files:**
- Create: `src/recipes/load.ts`, `src/recipes/load.test.ts`, `src/calc/machines.ts`, `src/calc/machines.test.ts`
- Modify: `src/recipes/db.ts` (+ `fuelUsesOf`), `src/recipes/db.test.ts`, `src/calc/suggest.ts` (use `defaultMachine`), `src/catalog/index.ts` (+ `CATALOG_GREGTECH`)

**Interfaces:**
- Produces:
  - `export const CATALOG_GREGTECH = '5.09.54.183'` (`src/catalog/index.ts`)
  - `RecipeDb.fuelUsesOf(key: ResourceKey): Fuel[]` — every fuel entry for that resource across generator maps, in map order.
  - `defaultMachine(recipe: Recipe, db: RecipeDb): MachineRef | undefined` — lowest-tier single-block machine (multiblocks last) whose voltage ≥ EU/t per amp; same rule `suggestFor` uses today (move it, don't copy it).
  - `machineOptions(recipe: Recipe, db: RecipeDb): MachineRef[]` — all map machines that can run the recipe, sorted like `defaultMachine`.
  - `generatorOptions(mapIndex: number, db: RecipeDb): MachineRef[]` — map machines with `generator` stats, by tier (format 1: all map machines).
  - `type RecipeLoad = { status: 'ok'; db: RecipeDb; warning?: string } | { status: 'missing' } | { status: 'error'; message: string }`
  - `loadRecipeDb(url: string, fetchFn?: typeof fetch): Promise<RecipeLoad>`

- [ ] **Step 1: Write the failing tests**

`src/recipes/load.test.ts` (fixture: `gzipSync(strToU8(JSON.stringify(oilBerryData())))`; `fetchFn` is a stub returning `new Response(body, { status })`):
- `'gzipped data loads into a RecipeDb'` → `status 'ok'`, `db.resource(K.lightFuel)?.name === 'Light Fuel'`, no `warning`.
- `'data the browser already decoded (no gzip magic) also loads'` → plain JSON body → `'ok'`.
- `'404 means missing'` → `{ status: 'missing' }`.
- `'the dev server HTML fallback means missing'` → body `'<!doctype html>…'`, status 200 → `'missing'`.
- `'a different GregTech version loads with a warning'` → data with `gregtech: '5.09.55.0'` → `warning` matches `/5\.09\.55\.0/` and `/5\.09\.54\.183/`.
- `'corrupt gzip is an error, not missing'` → bytes `[0x1f, 0x8b, 1, 2, 3]` → `status 'error'`.
- `'a network failure is an error'` → `fetchFn` rejects → `'error'` with the message.

`src/recipes/db.test.ts`: `'fuelUsesOf lists the generator maps that burn a fluid'` → `db.fuelUsesOf(K.lightFuel)` equals `[{ map: 4, key: K.lightFuel, euPerLitre: 305 }]`; `db.fuelUsesOf(K.oil)` is `[]`.

`src/calc/machines.test.ts` (oil fixture):
- `defaultMachine(recipe 4 (120 EU/t))?.mID === 372`; `defaultMachine(recipe 1)?.mID === 531`.
- `machineOptions(recipe 4).map(m => m.mID)` equals `[372]`; `machineOptions(recipe 1)` equals `[531, 532]`.
- `generatorOptions(4, db).map(m => m.mID)` equals `[1110, 1111]`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/recipes src/calc/machines.test.ts`
Expected: FAIL — `loadRecipeDb`, `fuelUsesOf`, `defaultMachine` not defined.

- [ ] **Step 3: Implement**

`loadRecipeDb`: fetch; `!ok` → missing; bytes starting `1f 8b` → fflate async `gunzip` (promisified); else use bytes as-is; decode text; text not starting with `{` → missing; `JSON.parse`; shape check (`format === 1`, arrays `resources/maps/recipes/fuels`) else error "not planner recipe data — re-run npm run recipes"; build `RecipeDb`; warning when `gregtech !== CATALOG_GREGTECH`: `` `Recipes are from GregTech ${x}; the block catalog is for ${CATALOG_GREGTECH}. Numbers may be off.` ``. Any thrown error → `{ status: 'error', message }`. `fuelUsesOf`: index built in the constructor next to `fuels`. Refactor `suggestFor` to call `defaultMachine`; its tests must stay green unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src && npm run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/recipes src/calc src/catalog/index.ts
git commit -m "feat: recipe data loader, fuel lookups and machine options"
```

---

### Task 2: Chain state, history and storage

**Files:**
- Create: `src/calculator/chainState.ts`, `src/calculator/chainState.test.ts`, `src/calculator/chainStorage.ts`, `src/calculator/chainStorage.test.ts`
- Modify: `src/project/project.ts` (export `parseChain`; `parseProject` returns `fromVersion`), `src/project/project.test.ts`

**Interfaces:**
- Consumes: `Chain`, `ChainNode`, `Position`, `Target`, `emptyChain` (`src/calc/chain.ts`).
- Produces:
  - `type NewNode` = `ChainNode` without `id` (distributive over the union).
  - `type ChainAction =`
    `{ type: 'addNode'; node: NewNode }` | `{ type: 'removeNode'; id: string }` |
    `{ type: 'moveNode'; id: string; position: Position }` | `{ type: 'arrange'; positions: Record<string, Position> }` |
    `{ type: 'setMachine'; id: string; machineMID: number }` | `{ type: 'setOverclock'; id: string; on: boolean }` |
    `{ type: 'setTarget'; target: Target }` | `{ type: 'removeTarget'; key: ResourceKey }` |
    `{ type: 'setLimit'; key: ResourceKey; maxRate: number }` | `{ type: 'removeLimit'; key: ResourceKey }` |
    `{ type: 'setExternal'; key: ResourceKey; on: boolean }` | `{ type: 'load'; chain: Chain }`
  - `nextNodeId(chain: Chain): string` — `n<k>` with k = 1 + highest numeric suffix among `n<digits>` ids (so ids from loaded files never collide).
  - `chainReducer(chain: Chain, a: ChainAction): Chain` — returns the **same object** when nothing changes (unknown id, same value).
  - `interface ChainHistory { past: Chain[]; present: Chain; future: Chain[] }`, `initialChainHistory(chain?: Chain): ChainHistory`,
    `chainHistoryReducer(h: ChainHistory, a: ChainAction | { type: 'undo' } | { type: 'redo' }): ChainHistory` — limit 100, no entry when the reducer returns the same chain.
  - `CHAIN_KEY = 'gtnh-planner:chain'`; `loadChain(storage: Storage | undefined): { chain: Chain; error?: string }`; `saveChain(storage: Storage | undefined, chain: Chain): boolean`.
  - `parseChain(raw: unknown, warnings: string[]): Chain` (exported); `parseProject(text)` → `{ project, warnings, fromVersion: 1 | 2 }`.

- [ ] **Step 1: Write the failing tests**

`chainState.test.ts`:
- `'addNode assigns n1, n2 and skips ids already used'` → chain with node `n7` → added node id `n8`.
- `'setTarget replaces the target for the same key'` → set `{key: lf, rate: 10}` then `{key: lf, maximise: true}` → `targets` equals `[{ key: lf, maximise: true }]`.
- `'setLimit replaces; removeLimit removes'`; `'setExternal on/off is idempotent'` (on twice → one entry).
- `'removeNode drops only that node'`; `'arrange moves every listed node and ignores unknown ids'`.
- `'no-op actions return the same chain'` → `setMachine` on unknown id, `setOverclock` to the current value → `toBe(chain)`.
- `'undo/redo restore chains; no-ops add no history'` → addNode, setTarget, undo → present has no target; redo → target back; a no-op leaves `past.length` unchanged.
- `'load is undoable'` → load chain B over A, undo → present is A.

`chainStorage.test.ts` (in-memory `Storage` stub): round-trip; nothing stored → `emptyChain()` without error; garbage JSON → empty chain + `error` mentioning the calculator chain; `saveChain(undefined, …)` → `false`; a storage whose `setItem` throws → `false`.

`project.test.ts`: `'version-1 files report fromVersion 1'`, `'version-2 files report fromVersion 2'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/calculator src/project`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Implement** the reducer, history and storage (storage stores `JSON.stringify(chain)`; loads via `parseChain`, ignoring its warnings).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/calculator src/project
git commit -m "feat: calculator chain state, undo history and autosave storage"
```

---

### Task 3: View models — format, nodes/edges, overview, solve state

**Files:**
- Create: `src/calculator/format.ts`, `src/calculator/graphModel.ts`, `src/calculator/overview.ts`, `src/calculator/solveState.ts`, and a `.test.ts` beside each.

**Interfaces:**
- Consumes: `nodeRates` (`src/calc/rates.ts`), `ChainResult`, `NodeResult` (`src/calc/solve.ts`), `machineOptions`, `generatorOptions` (Task 1).
- Produces:
  - `formatNumber(n: number): string` — 4 significant figures, thousands separators, no exponent: `513.25→'513.3'`, `5.57→'5.57'`, `0.04640→'0.0464'`, `12000→'12,000'`, `0→'0'`, `-1e-12→'0'` (no `-0`, no exponent).
  - `formatRate(n: number, kind: 'item'|'fluid'|'eu'): string` — `'5.57/s'`, `'513.3 L/s'`, `'599.3 EU/t'`.
  - `parseRateInput(text: string, opts?: { allowZero?: boolean }): number | undefined` — finite, > 0 (≥ 0 with `allowZero`), else `undefined`.
  - `interface ResourceRow { key: ResourceKey; name: string; kind: 'item'|'fluid'|'eu'; rate: number; unmet: boolean; external: boolean }` (`rate` ≥ 0, per second; per machine when unsolved).
  - `interface NodeView { id: string; kind: 'recipe'|'generator'; title: string; machineMID: number; machineOptions: { mID: number; name: string }[]; overclock?: boolean; machines: number; build: number; eut: number; inputs: ResourceRow[]; outputs: ResourceRow[]; invalid?: string; approximate: boolean }` — `title`: recipe map name, or `'<fuel name> → EU'` for generators (fallback to the key when unknown). Machine options include the current machine even when it can't run the recipe.
  - `nodeView(node: ChainNode, chain: Chain, db: RecipeDb, result?: NodeResult): NodeView` — inputs are consumed inputs only.
  - `producedKeys(chain: Chain, db: RecipeDb): Set<ResourceKey>` — keys some valid node outputs; `unmet` = input not in this set.
  - `interface EdgeView { id: string; source: string; target: string; key: ResourceKey; flow: number }`
  - `chainEdges(chain: Chain, db: RecipeDb, result?: ChainResult): EdgeView[]` — one edge per (producer, consumer, resource), excluding `eu`; `flow = consumed_c × produced_p / Σ produced` (0 without a result); id `${source}>${target}:${key}`.
  - `interface RateRow { key: ResourceKey; name: string; kind: 'item'|'fluid'|'eu'; rate: number }`
  - `interface Overview { inputs: RateRow[]; outputs: RateRow[]; byproducts: RateRow[]; machines: { name: string; build: number; exact: number }[]; power: { used: number; made: number; net: number }; problems: string[] }`
  - `overview(chain: Chain, db: RecipeDb, result?: ChainResult): Overview` — rows sorted by rate descending; machines grouped by machine name (sum of exact, sum of per-node `build`), sorted by name; problems in order: `result.message` (when status ≠ ok), `"<node title> (<machine name>): <invalid reason>"` per invalid node, and `"<name> comes from outside the chain — set a supply limit or mark it bought in"` per input neither limited nor external.
  - `displayResult(current: ChainResult | undefined, lastOk: ChainResult | undefined): { result?: ChainResult; greyed: boolean }` — ok → current, not greyed; infeasible → current, greyed; unbounded/error → lastOk, greyed.
  - `createLatest(): { next(): number; isLatest(ticket: number): boolean }`.

- [ ] **Step 1: Write the failing tests** (oil fixture + HiGHS solver as in `solve.test.ts`; the reference chain is `line + gen` with maximise Light Fuel and Oil Berry ≤ 5.57)

- `format.test.ts`: the six `formatNumber` cases above; `formatRate` three cases; `parseRateInput`: `'5.57'→5.57`, `''`, `'0'`, `'-1'`, `'abc'`, `'1e999'`, `'Infinity'` → `undefined`; `parseRateInput('0', { allowZero: true }) === 0`.
- `graphModel.test.ts`:
  - `'distillery card shows solved totals'` → dist view: title `'Distillery'`, `build 17`, input row Oil rate within 0.5% of 557.1 (5.57 × 100), output Sulfuric Light Fuel ≈ 557.1; the circuit is not an input row.
  - `'an unsolved card shows per-machine rates and flags unmet inputs'` → chain `[fe]` alone, no result → Oil Berry input `rate 1`, `unmet true`; Oil output `rate 100`.
  - `'externals are marked on rows'` → Oil Berry in `externals` → `external true`.
  - `'an electrolyzer card offers only machines that can run it, plus the current one'` → node with machineMID 371 → option mIDs include both 371 (current) and 372, and not 532-style machines from other maps; `invalid 'machine tier too low'`.
  - `'a node whose recipe is gone is invalid but still has a view'` → recipeSig `'gone'` → `invalid 'missing recipe'`, `inputs []`, title `'Missing recipe'`.
  - `'generator card'` → gen view title `'Light Fuel → EU'`, options `[1110, 1111]`, input Light Fuel ≈ 43.7 L/s (solved).
  - `'edges link producers to consumers with flows'` → reference chain: an edge `fe>dist:fluid:oil` with flow ≈ 557.1; edges `cr>el` and `el>cr` both exist (the hydrogen loop); no edge carries `eu`.
- `overview.test.ts`:
  - `'reference overview'` → outputs `[Light Fuel ≈ 513.25]`, byproducts contains Sulfur Dust ≈ 0.0464, inputs `[Oil Berry 5.57]`, machines include `{ name: 'Basic Distillery', build: 17 }`, `power.net` ≈ 0, `problems []`.
  - `'infeasible problems name the limit'` → rate target 1000 → `problems[0]` matches `/Oil Berry/`.
  - `'an unlimited, non-external input is a problem; marking it bought in clears it'`.
  - `'an invalid node is listed as a problem'` → electrolyzer on 371 → a problem matching `/Basic Electrolyzer.*machine tier too low/`.
- `solveState.test.ts`: `displayResult` three statuses + `(undefined, undefined)` → `{ greyed: false }`; `createLatest`: tickets 1, 2 → `isLatest(1) false`, `isLatest(2) true`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/calculator`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement** the four modules.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/calculator
git commit -m "feat: calculator view models (cards, edges, overview, formatting)"
```

---

### Task 4: Layout — auto-arrange and new-node placement

**Files:**
- Create: `src/calculator/layout.ts`, `src/calculator/layout.test.ts`

**Interfaces:**
- Consumes: `chainEdges` (Task 3) for producer→consumer links.
- Produces:
  - `COLUMN = 360`, `ROW = 220`.
  - `autoArrange(chain: Chain, db: RecipeDb): Record<string, Position>` — column = longest path from a source along producer→consumer links, cycles broken by DFS back edges in node order; x = column × COLUMN; y = index within column × ROW (node order).
  - `placeNewNode(chain: Chain, db: RecipeDb, io: { inputs: ResourceKey[]; outputs: ResourceKey[] }): Position` — left of the leftmost node consuming one of `outputs` (same y); else right of the rightmost node producing one of `inputs` (same y); else `(0, maxY + ROW)` (`(0, 0)` for an empty chain); then step y by ROW until no node is within 100 px.

- [ ] **Step 1: Write the failing tests**
  - `'oil line arranges left to right'` → `x(fe) < x(dist) < x(cr) < x(el)`, `x(gen) === x(el)`, `y(gen) !== y(el)`.
  - `'a cycle does not hang and every node gets a position'` → chain `[cr, el]` only → both have positions.
  - `'a new producer goes left of its consumer'` → chain `[dist]` at (500, 40), io outputs `[oil]` → `{ x: 140, y: 40 }`.
  - `'a new consumer goes right of its producer'`; `'unrelated goes below'`; `'placement avoids sitting on a node'` → two consumers stacked → y differs from both.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/calculator/layout.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `layout.ts`.
- [ ] **Step 4: Run** `npx vitest run src && npm run typecheck` → all pass.
- [ ] **Step 5: Commit** `git add src/calculator && git commit -m "feat: chain auto-arrange and placement of new nodes"`

---

### Task 5: Shell — tabs, project save/load, recipe loading, solving

**Files:**
- Create: `src/calculator/useRecipes.ts`, `src/calculator/useSolve.ts`, `src/calculator/solver.ts`, `src/calculator/ui/Calculator.tsx`, `e2e/calculator.spec.ts`
- Modify: `src/App.tsx`, `src/styles.css`, `package.json` (+ `@xyflow/react@12.12.0`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `getSolver(): Promise<LpSolver>` — memoised `createHighsSolver({ locateFile: () => wasmUrl })` with `import wasmUrl from 'highs/runtime?url'`; a rejected load clears the memo.
  - `useRecipes(enabled: boolean): RecipeLoad | { status: 'loading' } | { status: 'idle' }` — starts `loadRecipeDb(\`${import.meta.env.BASE_URL}data/recipes.json.gz\`)` the first time `enabled` is true.
  - `useSolve(chain: Chain, db: RecipeDb | undefined): { result?: ChainResult; greyed: boolean; solving: boolean }` — solves on every chain change, uses `createLatest` + `displayResult`.
  - `<Calculator active history dispatch toast />` (props: `active: boolean; history: ChainHistory; dispatch: (a: ChainAction | {type:'undo'} | {type:'redo'}) => void; toast(text: string, kind?: 'info' | 'error'): void`).
  - DOM test ids: `tab-calculator`, `tab-editor`, `recipe-status` (loading / instructions / error text), `version-warning`.

- [ ] **Step 1: Write the failing e2e tests** in `e2e/calculator.spec.ts` (skip the whole file with `test.skip(!existsSync('public/data/recipes.json.gz'), 'run npm run recipes first')` except the missing-data test):
  - `'missing recipe data shows import instructions'` → `page.route('**/data/recipes.json.gz', r => r.fulfill({ status: 404 }))`, click `tab-calculator` → `recipe-status` contains `npm run recipes`; click `tab-editor` → palette still visible.
  - `'the calculator tab loads recipes and is remembered'` → click `tab-calculator` → search box (`getByPlaceholder('Search items and fluids')`) visible within 20 s; reload → calculator tab still active.
  - `'saving a project and loading it back keeps the chain'` deferred to Task 8 (needs nodes).

- [ ] **Step 2: Run** `npx playwright test e2e/calculator.spec.ts` → FAIL (no tab).

- [ ] **Step 3: Implement**
  - `npm install @xyflow/react@12.12.0`.
  - `App.tsx`: tab bar above the existing `.app` (wrap both in `.shell`, grid rows `auto 1fr`); editor `.app` gets `hidden` when not active (stays mounted); the editor keydown handler returns early unless the editor tab is active; `chainHistoryReducer` lives in App (initial from `loadChain(safeStorage())`, error → toast); chain autosave debounced 400 ms + on `pagehide` with `saveChain`, notifying once on failure like the build autosaver; Toolbar's Save writes `serializeProject({ version: 2, build, chain })`, Load uses `parseProject` — `fromVersion 2` also dispatches `{ type: 'load', chain }`; confirm-replace also considers chain nodes for v2 files; last tab in localStorage key `gtnh-planner:tab`.
  - `Calculator.tsx` (this task): uses `useRecipes(active-ever)`; renders `recipe-status` for loading ("Loading recipes…"), missing (instructions: run `/gtnhplanner dump` in the `export v2` instance, then `npm run recipes`, then reload), error (message); `version-warning` banner; otherwise a three-column layout placeholder with the search input (filled in by Task 6/7). Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z dispatch undo/redo when `active` and focus is not in an input.
  - Styles for `.shell`, `.tabbar`, `.calc` grid (`260px 1fr 320px`), banner, status panel — same tokens as `styles.css`.

- [ ] **Step 4: Run** `npx playwright test && npx vitest run && npm run typecheck`
Expected: new tests pass; all existing editor e2e tests still pass.

- [ ] **Step 5: Commit** `git add -A src e2e package.json package-lock.json && git commit -m "feat: calculator tab shell with recipe loading, project save/load"`

---

### Task 6: Side panels — recipe browser, targets bar, resource menu, overview

**Files:**
- Create: `src/calculator/ui/RecipeBrowser.tsx`, `src/calculator/ui/TargetsBar.tsx`, `src/calculator/ui/ResourceMenu.tsx`, `src/calculator/ui/OverviewPanel.tsx`
- Modify: `src/calculator/ui/Calculator.tsx`, `src/styles.css`, `e2e/calculator.spec.ts`

**Interfaces:**
- Consumes: `overview`, `formatRate`, `parseRateInput` (Task 3); `defaultMachine`, `generatorOptions`, `fuelUsesOf` (Task 1); `placeNewNode` (Task 4).
- Produces:
  - `ResourceMenuProvider` + `useResourceMenu(): (e: React.MouseEvent, key: ResourceKey) => void` — any element showing a resource calls it on `contextmenu`. Menu items: **Make … /s** (`setTarget {key, rate}` with the current output rate or 1), **Maximise** (`setTarget {key, maximise: true}`), **Supply limit** (`setLimit` with the current input rate or 1), **Mark bought in** / **Unmark bought in**, **Show in recipe browser**. Escape or outside click closes.
  - Recipe browser: search (`db.search`, 50 results) → pick a resource → tabs **Made by** (`producersOf`), **Used in** (`consumersOf`), **Burned in** (`fuelUsesOf`, only when non-empty). Rows show map name, inputs/outputs with amounts (fluids in L, chances as %), EU/t, seconds, default machine; lists show 50 rows then a "Show more" button. **Add** dispatches `addNode` (recipe: `recipeSig`, `defaultMachine`, `overclock: false`, `placeNewNode` position; generator: first `generatorOptions` machine, fuel map id, fuel key). Rows with no machine show a disabled "no machine". Test ids: `browser-result`, `browser-row`, `add-recipe`.
  - Targets bar (above the graph area): one chip per target (`name` + rate input or "max", toggle, ×), limit (`name ≤` input `/s`, ×), external (`name` bought in, ×). Inputs commit on Enter/blur via `parseRateInput` (limits `allowZero`); invalid → revert. Test id `targets-bar`.
  - Overview panel: sections Inputs, Outputs, Byproducts, Machines (`<build>× <name>` and exact), Power (used / made / net), Problems; greyed class when `greyed`. Test ids `overview-outputs`, `overview-inputs`, `overview-problems`, `overview-power`.

- [ ] **Step 1: Write the failing e2e test** `'browse, add a recipe and set a target'`: open calculator; search `Light Fuel`; click the `browser-result` with exact text `Light Fuel`; in Made by, click `add-recipe` on the first `browser-row` containing `Hydrogen Sulfide Cell`; right-click `Light Fuel` in `overview` byproducts → **Make … /s**; `targets-bar` contains `Light Fuel`; `overview-outputs` contains `Light Fuel`; Ctrl+Z → `targets-bar` no longer contains `Light Fuel`.
- [ ] **Step 2: Run** `npx playwright test e2e/calculator.spec.ts -g browse` → FAIL.
- [ ] **Step 3: Implement** the four components and wire them in `Calculator.tsx` (left: overview; centre: targets bar over a graph placeholder; right: browser).
- [ ] **Step 4: Run** `npx playwright test e2e/calculator.spec.ts && npx vitest run && npm run typecheck` → pass.
- [ ] **Step 5: Commit** `git add -A src e2e && git commit -m "feat: recipe browser, targets bar, resource menu and overview"`

---

### Task 7: Graph — node cards, edges, suggest, toolbar

**Files:**
- Create: `src/calculator/ui/ChainGraph.tsx`, `src/calculator/ui/NodeCard.tsx`, `src/calculator/ui/SuggestList.tsx`
- Modify: `src/calculator/ui/Calculator.tsx`, `src/styles.css`, `e2e/calculator.spec.ts`

**Interfaces:**
- Consumes: `nodeView`, `chainEdges`, `formatRate` (Task 3); `autoArrange`, `placeNewNode` (Task 4); `suggestFor` (`src/calc/suggest.ts`); `useResourceMenu` (Task 6).
- Produces:
  - `ChainGraph` — `ReactFlow` (import `@xyflow/react/dist/style.css`) with node types `recipe` and `generator` both rendered by `NodeCard`; nodes from `chain.nodes` (positions overridden by a local drag map during a drag; `moveNode` dispatched once on drag stop); edges from `chainEdges`, label `"<name> <formatRate(flow)>"`; Delete/Backspace on a selected node dispatches `removeNode`; `fitView` on first render.
  - Graph toolbar: **Auto-arrange** (`arrange` with `autoArrange`), **Fit**, **Undo**, **Redo**, **Build in 3D** (disabled; title `"Coming next: turn this chain into a 3D layout and schematic (project 2)"`).
  - `NodeCard`: title; machine `<select>` over `machineOptions` (`setMachine`); overclock checkbox for recipes (`setOverclock`); `machines` (4 s.f.) and "build N"; EU/t; input/output rows with `formatRate(rate)`, right-click opens the resource menu; unmet input rows have a **suggest** button opening `SuggestList`; external rows show "bought in"; red border + reason when `invalid`; "≈" badge when `approximate`; greyed when the result is greyed; × button removes the node. Test ids: `node-card` (with `data-node-id`), `suggest`, `machine-select`.
  - `SuggestList`: `suggestFor(key, chain, db)` rows (map name, inputs → outputs, machine name, "closes loop" tag); click adds the node with `suggestion.machine` at `placeNewNode`; empty list says "Nothing in the recipe data makes this — mark it bought in or set a supply limit". Test id `suggestion`.

- [ ] **Step 1: Write the failing e2e test** `'suggest builds the chain upstream'`: add the chemical-reactor Light Fuel recipe as in Task 6; on its `node-card`, click `suggest` on the Sulfuric Light Fuel row; click the first `suggestion` containing `Distillery` and `Oil`; expect 2 `node-card`s and an edge label containing `Sulfuric Light Fuel`; click Auto-arrange → the distillery card's x is left of the reactor card's x (bounding boxes); `Build in 3D` is disabled.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the graph, cards, suggest list, toolbar.
- [ ] **Step 4: Run** `npx playwright test && npx vitest run && npm run typecheck` → pass.
- [ ] **Step 5: Commit** `git add -A src e2e && git commit -m "feat: chain graph with node cards, suggestions and toolbar"`

---

### Task 8: End-to-end reference chain

**Files:**
- Modify: `e2e/calculator.spec.ts`; fixes in `src/calculator/ui/*` only if the test exposes a defect.

- [ ] **Step 1: Write the e2e test** `'reference: oil berry line to ≈513 L/s, with undo'` (spec §Testing E2E):
  1. Calculator tab → browser `Light Fuel` → Made by → add the chemical reactor recipe (row with `Hydrogen Sulfide Cell`).
  2. Suggest on Sulfuric Light Fuel → Distillery from Oil; suggest on Oil → row containing `Oil Berry` (Fluid Extractor); suggest on Hydrogen Cell → row containing `Hydrogen Sulfide Cell` (Electrolyzer).
  3. Browser `Light Fuel` → Burned in → add the Combustion Generator Fuels row; set its `machine-select` to `Advanced Combustion Generator`.
  4. Right-click Light Fuel → Maximise; right-click Oil Berry → Supply limit; type `5.57` + Enter in its targets-bar input.
  5. Expect `overview-outputs` to contain `Light Fuel` and match `/513\.\d L\/s/` (≈513.25 → `513.3 L/s`); `overview-problems` empty; `overview-power` net `0`.
  6. Ctrl+Z → outputs no longer match `/513\.\d/`; Ctrl+Y → match again.
  7. Save .json (download) → reload page → Load that file → still `513.3 L/s` on the calculator tab.
- [ ] **Step 2: Run** `npx playwright test e2e/calculator.spec.ts -g reference` — if it fails, find the cause (superpowers:systematic-debugging) and fix the code, not the expectation; numbers must match `npx tsx scripts/check-oil-chain.ts` (513.25).
- [ ] **Step 3: Run everything** `npm test && npm run typecheck && npx playwright test && npm run build` → all green.
- [ ] **Step 4: Commit** `git add -A src e2e && git commit -m "test: calculator end-to-end reference chain"`
