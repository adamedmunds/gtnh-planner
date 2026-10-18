# Simpler Calculator Screen (Plan 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Calculator screen with a left-to-right graph of typeable boxes (What I have → machines → What I get), a big recipe picker that builds both ways, a plain summary, and real item icons rendered by the game.

**Architecture:** The chain model gains machine caps and box positions; a pure "drive" layer (`src/calculator/drive.ts`) turns typed numbers into the existing targets/limits/externals and wraps the solver (one-machine fallback, shortfall diagnosis). Pure view models feed thin React components; the dumper mod gains a client-side icon renderer whose sprite sheets the import script copies next to the recipe data.

**Tech Stack:** React 19, `@xyflow/react` 12.12.0, HiGHS, Vitest, Playwright; Forge 1.7.10 mod (Java, JDK 25 build via `./gradlew`).

**Spec:** `docs/superpowers/specs/2026-10-18-calculator-simple-ui-design.md` (approved). Underlying data/solver spec: `docs/superpowers/specs/2026-10-18-calculator-design.md`.

## Global Constraints

- No on-screen jargon: the words "target", "limit", "external", "bought in", "maximise", "byproduct" never appear in the Calculator UI.
- Nothing is reachable only by right-click or a hidden menu; every action is a visible button or field.
- Text readable at the default view: graph zoom is never below 0.5 (`minZoom: 0.5`), fit-to-view caps at zoom 1.
- Undo/redo, autosave, project Save/Load .json and the 3D Editor tab keep working; old saved chains still load.
- Icons and recipe data stay local: `public/data/` is git-ignored; nothing from the user's game is committed.
- Box headings exactly: **What I have**, **What I get**; summary headings exactly: **What I have**, **What I get**, **Also made**, **Machines to build**, **Power**, **Problems**.
- Tier badge colours: ULV `#9e9e9e`, LV `#9ccc65`, MV `#ffb74d`, HV `#ffd54f`, EV `#90a4ae`, IV `#ce93d8`, higher `#ef9a9a`.

## Review Focus

1. A chain with nothing typed and no caps (fresh build) → numbers for one machine of the product step, never a blank screen or a "set a limit" message. (Task 4 test.)
2. A cap typed on something that doesn't constrain the product (unrelated have amount) → still shows one-machine numbers instead of "unbounded". (Task 4 test.)
3. Old saved chains (several targets, limits on made resources, no layout) → load with one What I get, the rest as Also made, limits as What I have boxes. (Task 4 test.)
4. Icon file missing, partial, or an item without an icon → fallback square with a letter, never a broken image. (Task 2 test.)
5. A typed machine count of 0 or blank → 0 is rejected (must be > 0), blank removes the cap. (Task 4 test.)

---

### Task 1: Dumper — `/gtnhplanner icons`

**Files:**
- Create: `mod/src/main/java/dev/gtnhplanner/dumper/IconExporter.java`, `mod/src/main/java/dev/gtnhplanner/dumper/ClientCommand.java`
- Modify: `mod/src/main/java/dev/gtnhplanner/dumper/DumperMod.java` (client-side registration), `DumpCommand.java` usage text

**Interfaces:**
- Produces (files in `.minecraft/gtnh-planner/icons/`): `icons-<n>.png` sheets, 2048×2048, 64×64 cells of 32×32 px, transparent background; `icons.json`:
  `{ "format": 1, "size": 32, "perRow": 64, "sheets": ["icons-0.png", …], "icons": { "<resource key>": [sheet, col, row] } }`
  with resource keys exactly as the app uses them: `item:<registry id>@<meta>`, `fluid:<fluid id>`.
- Input: the items/fluids/machines tables of `.minecraft/gtnh-planner/recipes.json.gz` (so keys match the dump); machine icons are keyed `item:gregtech:gt.blockmachines@<mID>`.

- [ ] **Step 1: Client command.** Register `ClientCommand` (name `gtnhplanner`) through `ClientCommandHandler.instance.registerCommand` in an `FMLInitializationEvent` handler guarded by `event.getSide().isClient()` (no client classes loaded on a dedicated server). `icons` runs `IconExporter` on the client thread; any other argument is forwarded unchanged to the server with `Minecraft.getMinecraft().thePlayer.sendChatMessage("/gtnhplanner " + args)` so `/gtnhplanner dump` still works. Usage: `/gtnhplanner dump | icons`.
- [ ] **Step 2: `IconExporter`.** Reads the dump (error message "Run /gtnhplanner dump first" when absent). Renders one sheet per client tick (`TickEvent.RenderTickEvent` END, unregister when done) into a `net.minecraft.client.shader.Framebuffer(2048, 2048, true)` with an orthographic projection, scale 2 (16 px GUI items → 32 px): items via `RenderItem.renderItemAndEffectIntoGUI` (+ `RenderHelper.enableGUIStandardItemLighting`), wildcard meta 32767 rendered as meta 0; fluids by drawing `fluid.getStillIcon()` from `TextureMap.locationBlocksTexture` tinted with `fluid.getColor()`. Read back with `glReadPixels` (flip vertically) into a `BufferedImage`, write PNG with `ImageIO`. Per-item exceptions are caught and counted (cell left transparent, no entry in the index). Chat: progress every sheet, final "Saved N icons (M failed) to <path>".
- [ ] **Step 3: Build.** Run: `cd mod && JAVA_HOME="/c/Program Files/Java/jdk-25" ./gradlew spotlessApply build -x test`. Expected: BUILD SUCCESSFUL; copy `mod/build/libs/*dirty.jar` over `export v2/.minecraft/mods/gtnhplannerdumper-0.1.jar`.
- [ ] **Step 4: Commit** `git add mod && git commit -m "feat(dumper): /gtnhplanner icons renders item and fluid icons"`. In-game check (the user, in `export v2`): `/gtnhplanner dump`, then `/gtnhplanner icons`; a GT dust, a cell, a fluid and a machine look like NEI.

---

### Task 2: Icons in the app

**Files:**
- Create: `src/recipes/icons.ts`, `src/recipes/icons.test.ts`, `src/calculator/ui/Icon.tsx`
- Modify: `scripts/import-recipes.ts` (copy icons), `.gitignore` check (`public/data` already ignored)

**Interfaces:**
- Produces:
  - `interface IconIndex { size: number; perRow: number; sheets: string[]; icons: Record<ResourceKey, [number, number, number]> }`
  - `parseIconIndex(raw: unknown): IconIndex | undefined` — undefined unless `format === 1`, numeric `size`/`perRow`, string array `sheets`, and object `icons`; entries whose sheet index is out of range are dropped.
  - `loadIconIndex(url: string, fetchFn?: typeof fetch): Promise<IconIndex | undefined>` — any failure → undefined.
  - `iconStyle(index: IconIndex | undefined, key: ResourceKey, px: number, base: string): { backgroundImage: string; backgroundPosition: string; backgroundSize: string } | undefined` — sprite CSS scaled to `px` (`backgroundSize` = `perRow*px`px square; position `-col*px px -row*px px`; image `url(${base}${sheet})`), undefined when the key has no icon.
  - `fallbackColour(key: ResourceKey): string` — deterministic `hsl(h 45% 45%)` from a string hash.
  - `<Icon k={key} px={16|24|32} title?>` — sprite span, or a fallback square of `fallbackColour` with the resource name's first letter. Icon index comes from `useIcons()` (loads `${BASE_URL}data/icons/icons.json` once).
  - `npm run recipes` also copies `<dump dir>/icons/*` to `public/data/icons/` when present (prints "copied N icon sheets" or "no icons yet — run /gtnhplanner icons").

- [ ] **Step 1: Write the failing tests** (`icons.test.ts`): `'parses a valid index and drops out-of-range entries'`; `'rejects anything else'` (`null`, `{}`, `format: 2`); `'iconStyle positions the sprite'` → key at `[1, 3, 2]`, px 16, perRow 64 → `{ backgroundImage: 'url(/data/icons/icons-1.png)', backgroundPosition: '-48px -32px', backgroundSize: '1024px 1024px' }`; `'no icon → undefined'`; `'fallbackColour is stable'`; `'loadIconIndex: 404 or bad JSON → undefined'`.
- [ ] **Step 2: Run** `npx vitest run src/recipes/icons.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `icons.ts`, `Icon.tsx`, the import-script copy.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` → pass.
- [ ] **Step 5: Commit** `git add src scripts && git commit -m "feat: item and fluid icons from the dumper's sprite sheets"`

---

### Task 3: Core — machine caps, "what uses this", all fuels, tier names

**Files:**
- Modify: `src/calc/chain.ts`, `src/calc/solve.ts`, `src/calc/suggest.ts`, `src/calc/tiers.ts`, `src/recipes/db.ts`, `src/project/project.ts` and their tests

**Interfaces:**
- Produces:
  - `ChainNode` (both kinds) gains `maxMachines?: number`; `Chain` gains `layout?: Record<string, Position>` (keys `have:<key>`, `get:<key>`). `parseChain` keeps `maxMachines` only when finite and > 0, and `layout` entries with finite x/y.
  - `solveChain`: constraint `x_n ≤ maxMachines` per capped node; `bindingLimits` unchanged; new `ChainResult.bindingMachines: { id: string; maxMachines: number }[]` (caps the solution sits on, same tolerance as limits).
  - `usesFor(key: ResourceKey, chain: Chain, db: RecipeDb, limit = 10): Suggestion[]` — `db.consumersOf(key)` minus recipes already in the chain; `Suggestion.unpacks` here means "fills a container with this" (an output `o` with `db.containerFluid(o.key) === key`); `loops` = other consumed inputs the chain makes; sort: unpacks last, loops desc, tier, eut.
  - `RecipeDb.allFuels(): Fuel[]`.
  - `TIER_NAMES = ['ULV','LV','MV','HV','EV','IV','LuV','ZPM','UV','UHV','UEV','UIV','UMV','UXV','MAX']`; `tierName(m: MachineRef): string | undefined`.

- [ ] **Step 1: Write the failing tests**
  - `solve.test.ts` `'machine cap: 4 distilleries scale the reference line'` → reference chain with `dist.maxMachines = 4` → `machines(dist) ≈ 4`, Light Fuel ≈ 513.25 × 4 / 16.71, `bindingMachines` equals `[{ id: 'dist', maxMachines: 4 }]`, `bindingLimits` `[]`.
  - `suggest.test.ts` `'usesFor: oil berries go to the fluid extractor'` → `usesFor(K.oilBerry, emptyChain(), db)[0].recipe.id === 0`; `'usesFor skips recipes already in the chain'`.
  - `db.test.ts` `'allFuels'` → length 1.
  - `tiers.test.ts` `'tierName'` → LV for mID 511's machine, MV for 372's.
  - `project.test.ts` `'maxMachines and layout round-trip; bad ones are dropped'`.
- [ ] **Step 2: Run** `npx vitest run src/calc src/recipes src/project` → FAIL on the new tests only.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` → pass.
- [ ] **Step 5: Commit** `git commit -am "feat: machine caps, uses-for suggestions, fuel list, tier names"`

---

### Task 4: Drive — typed numbers → chain, and the solve the screen shows

**Files:**
- Create: `src/calculator/drive.ts`, `src/calculator/drive.test.ts`
- Modify: `src/calculator/chainState.ts` (+ actions), `chainState.test.ts`, `src/App.tsx` (normalise restored/loaded chains)

**Interfaces:**
- Consumes: Task 3 (`maxMachines`, `bindingMachines`, `layout`).
- Produces:
  - New `ChainAction`s: `{ type: 'setHave'; key; amount?: number }` (adds to `externals`; amount → limit, undefined → no limit; switches a rate target to maximise), `{ type: 'removeHave'; key }`, `{ type: 'setWant'; key; rate?: number }` (replaces **all** targets with `{key, rate}` or `{key, maximise: true}`), `{ type: 'setMachineCap'; id; max?: number }` (switches a rate target to maximise when `max` is set).
  - `normalizeChain(chain: Chain): Chain` — keeps only the first target; returns the same object when nothing changes.
  - `interface HaveBox { key: ResourceKey; amount?: number }`; `haveBoxes(chain: Chain): HaveBox[]` — union of `externals` and `limits` keys, in that order, amount from the limit.
  - `productOf(chain: Chain, db: RecipeDb): { key: ResourceKey; provisional: boolean } | undefined` — the target's key; else, provisional: the newest node (last in `chain.nodes`) with an output no other node consumes — its first such output (EU never counts); else undefined.
  - `type ScreenMode = 'exact' | 'max' | 'oneMachine'`
  - `interface Shortfall { kind: 'have'; key: ResourceKey; need: number; have: number } | { kind: 'machines'; id: string; need: number; have: number }`
  - `solveForScreen(chain: Chain, db: RecipeDb, solver: LpSolver): Promise<{ result: ChainResult; mode: ScreenMode; product?: { key; provisional }; shortfalls: Shortfall[] }>` —
    1. product = `productOf`; no product → solve as is, mode 'max'.
    2. effective chain: target = the chain's target, or `{product, maximise}` when provisional.
    3. maximise with no `limits` and no `maxMachines` → cap the first node producing the product at 1 → mode 'oneMachine'.
    4. maximise result `unbounded` → retry with that cap → 'oneMachine'.
    5. rate target and result `infeasible` → second solve with every limit and `maxMachines` removed; shortfalls = each typed have amount below that solve's input, each typed cap below that solve's machines.
  - `screenProblems(s: Awaited<ReturnType<typeof solveForScreen>>, chain: Chain, db: RecipeDb): string[]` — shortfalls as `"Needs 10.9 Oil Berry/s — you have 5.57"` / `"Needs 33 Basic Distillery — you set 4"` (formatNumber, formatRate units), then invalid nodes as `"<machine>: <reason>"`. Never uses the old solver message words ("limit", "maximise", "target").
  - `driveText(s, chain, db): string` — exact: `"Making 1,000 L/s Light Fuel"`; max: `"Making as much Light Fuel as 5.57 Oil Berry/s allows"` (several: `"… as 5.57 Oil Berry/s and 4 Basic Distillery allow"`); oneMachine: `"Showing one Chemical Reactor — type how much you have or want"`.

- [ ] **Step 1: Write the failing tests** (oil fixture + HiGHS, chains via `testChains.ts`)
  - reducer: `'setHave adds the input and its amount; blank amount means as much as needed'`; `'typing a have amount turns "make exactly" into "as much as possible"'`; `'setWant keeps exactly one want'`; `'setMachineCap 0 is ignored; undefined clears'` (reducer stores only > 0).
  - `'normalizeChain keeps the first target'`; `'haveBoxes lists bought-in inputs and limits'`.
  - `'productOf: the want, else the newest node's unconsumed output'` → `[fe]` → `{ key: K.oil, provisional: true }`; `[fe, dist]` → Sulfuric Light Fuel; with a Light Fuel want → `{ key: K.lightFuel, provisional: false }`.
  - `'nothing typed → one machine of the product step'` → `line()` with want Light Fuel (maximise), no limits, no caps → mode `'oneMachine'`, `machines(cr) === 1`.
  - `'an unrelated have amount still shows one machine'` → limit on `item:x@0` → mode `'oneMachine'`.
  - `'have amount drives the reference line'` → reference with target maximise → mode `'max'`, Light Fuel ≈ 513.25.
  - `'1000 L/s names the berries with what is needed'` → rate 1000 + limit 5.57 → shortfalls `[{ kind: 'have', key: K.oilBerry, need ≈ 10.85, have: 5.57 }]`; `screenProblems` first line matches `/^Needs 10\.\d+ Oil Berry\/s — you have 5\.57$/`.
  - `'a machine cap that falls short is named'` → rate 1000, no limit, `dist.maxMachines = 4` → `{ kind: 'machines', id: 'dist', need ≈ 32.5, have: 4 }`; text matches `/Needs 3\d(\.\d+)? Basic Distillery — you set 4/`.
  - `'driveText'` for the three modes (exact strings above, with fixture names).
- [ ] **Step 2: Run** `npx vitest run src/calculator` → FAIL (drive module missing).
- [ ] **Step 3: Implement**; App: `normalizeChain` on restored and loaded chains.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` → pass.
- [ ] **Step 5: Commit** `git commit -am "feat: typed numbers drive the solve; one-machine view and plain shortfalls"`

---

### Task 5: View models — boxes, edges, layout, summary

**Files:**
- Modify: `src/calculator/graphModel.ts`, `src/calculator/layout.ts`, `src/calculator/overview.ts` and tests

**Interfaces:**
- Consumes: Task 4 (`haveBoxes`, `productOf`, `solveForScreen` output), Task 3 (`tierName`).
- Produces:
  - `NodeView` gains `tier?: string`, `maxMachines?: number`, `machineIcon: ResourceKey` (`item:gregtech:gt.blockmachines@<mID>`); `ResourceRow` gains `actions: ('make' | 'have' | 'use' | 'want')[]` — inputs that are unmet: `['make','have']`; outputs: `['use','want']`, minus `'want'` on the current product.
  - `interface HaveView { id: string /* have:<key> */; key; name; kind; amount?: number; used: number }`, `interface GetView { id: string /* get:<key> */; key; name; kind; rate: number; typed?: number; provisional: boolean }`.
  - `boxViews(chain: Chain, db: RecipeDb, screen?: ScreenSolve): { haves: HaveView[]; get?: GetView; alsoMade: RateRow[] }` (`ScreenSolve` = the `solveForScreen` return type, exported from drive.ts).
  - `chainEdges` also links `have:<key>` → consumers of key and producers of the product → `get:<key>`.
  - `autoArrange` places have boxes in column 0, machines shifted one column right, the get box one column right of the last machine; returns keys for boxes too. `chainReducer` `arrange` writes `have:`/`get:` keys into `chain.layout`.
  - `overview(chain, db, screen?)` → `{ haves: RateRow[]; gets: RateRow[]; alsoMade: RateRow[]; machines: { name; tier?; icon; build; exact }[]; power: { used; made; outside }; problems: string[] }` (problems from `screenProblems`).

- [ ] **Step 1: Write the failing tests** — `'reference: one have box (Oil Berry 5.57, used 5.57) and a get box (Light Fuel ≈513.25)'`; `'Also made lists Sulfur Dust'`; `'row actions: unmet input → make/have; outputs → use/want, no want on the product'`; `'edges from the have box and into the get box'`; `'layout: have box left of every machine, get box right of every machine'`; `'arrange stores box positions in chain.layout'`; `'summary machines carry tier names and machine icons'`; `'power: outside = used − made when positive'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run && npm run typecheck` → pass.
- [ ] **Step 5: Commit** `git commit -am "feat: have/get boxes, edges, layout and plain summary model"`

---

### Task 6: Picker model

**Files:**
- Create: `src/calculator/picker.ts`, `src/calculator/picker.test.ts`

**Interfaces:**
- Consumes: `suggestFor`, `usesFor` (Task 3), `RecipeDb.allFuels`, `generatorOptions`.
- Produces:
  - `type PickerMode = { kind: 'makes'; key } | { kind: 'uses'; key } | { kind: 'power' }`
  - `interface PickerRow { id: string; recipe?: Recipe; fuel?: Fuel; machine: MachineRef; tier?: string; consumed: Stack[]; kept: Stack[]; outputs: Stack[]; seconds: number; eut: number; reason?: string }`
  - `pickerTitle(mode, db): string` — `"What makes Sulfuric Light Fuel?"`, `"What uses Oil Berry?"`, `"Power it with a generator"`.
  - `pickerRows(mode: PickerMode, chain: Chain, db: RecipeDb, limit: number): PickerRow[]` — makes/uses in `suggestFor`/`usesFor` order; `reason` = `"uses Oil you already make"` (names of chain-made consumed inputs, joined with " and "), else undefined. Power: fuels the chain makes first, then the rest, each with its lowest generator; `consumed` = the fuel, `eut` = generator EU/t, `reason` = `"burns Light Fuel the line makes"`.
  - `filterRows(rows: PickerRow[], text: string, db: RecipeDb): PickerRow[]` — case-insensitive match on any stack name, map or machine name.

- [ ] **Step 1: Write the failing tests** — `'makes: distillery for sulfuric light fuel in a chain with an extractor, reason names Oil'`; `'uses: oil berry → fluid extractor first'`; `'power: light fuel first when the line makes it'`; `'kept lists the programmed circuit'`; `'filter by "distill"'`; titles.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `git add src/calculator && git commit -m "feat: recipe picker model for makes, uses and power"`

---

### Task 7: Picker dialog and start screen

**Files:**
- Create: `src/calculator/ui/Picker.tsx`, `src/calculator/ui/StartPrompt.tsx`
- Delete: `src/calculator/ui/RecipeBrowser.tsx`, `src/calculator/ui/SuggestList.tsx` (and their CSS)
- Modify: `src/calculator/ui/Calculator.tsx`, `src/calculator/ui/NodeCard.tsx` (row buttons open the picker), `src/styles.css`, `e2e/calculator.spec.ts`

**Interfaces:**
- Consumes: Task 6, Task 2 `<Icon>`, Task 4 actions, `newRecipeNode`/`newGeneratorNode`.
- Produces: `<Picker mode onClose onUse(row) />` — centred modal (Esc / × / backdrop close), title, subtitle `"N recipes · best match first"`, filter box, rows (icon chips `"50 L Oil"`, kept as `"needs Programmed Circuit (not used up)"`, meta line `"Distillery · LV 24 EU/t · 1.5 s"`, reason tag, first row highlighted), **Use this** per row, 10 rows + "Show more". Test ids: `picker`, `picker-row`, `use-recipe`. `<StartPrompt />` in the empty graph: two search fields, placeholders `"What do you want to make?"` and `"What do you have?"`, results with icons (test id `start-result`, `data-key`); make → picker('makes') then `setWant` + node; have → `setHave` + picker('uses').
  - Using a row: adds the node; making-mode from the start prompt also `setWant(key)`; uses-mode from a box/row adds the node to the right. After any structural change the Calculator dispatches one `load` with `autoArrange` applied (one undo step).

- [ ] **Step 1: Rewrite the e2e** helpers: `start(page, 'make' | 'have', text, key)`, `pick(page, ...patterns)` (filters `picker-row` by text, clicks `use-recipe`). New tests: `'start from what you want: Light Fuel → chemical reactor'` → one machine box + a What I get box; `'start from what you have: Oil Berry → fluid extractor'` → What I have box, extractor box, Oil shown as product; delete the 3b browser tests that no longer apply.
- [ ] **Step 2: Run** `npx playwright test e2e/calculator.spec.ts` → FAIL.
- [ ] **Step 3: Implement**; NodeCard row buttons for this task: **+ add what makes this** (picker makes), **+ use this in…** (picker uses).
- [ ] **Step 4: Run** `npx playwright test && npx vitest run && npm run typecheck` → pass.
- [ ] **Step 5: Commit** `git add -A src e2e && git commit -m "feat: start screen and recipe picker replace the browser"`

---

### Task 8: Boxes, typeable numbers, drive line, summary

**Files:**
- Create: `src/calculator/ui/HaveBox.tsx`, `src/calculator/ui/GetBox.tsx`, `src/calculator/ui/SummaryPanel.tsx`
- Delete: `src/calculator/ui/TargetsBar.tsx`, `src/calculator/ui/ResourceMenu.tsx`, `src/calculator/ui/OverviewPanel.tsx`
- Modify: `NodeCard.tsx` (machine box), `ChainGraph.tsx`, `Calculator.tsx`, `useSolve.ts` (→ `solveForScreen`), `styles.css`, `e2e/calculator.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 7; `RateInput`.
- Produces:
  - Graph node types `have`, `machine` (recipe + generator), `get`.
  - **What I have** box: icon + name, `RateInput` labelled `"How much <name> you have"` (blank allowed → `setHave` without amount; shows used amount greyed), hint `"type how much you have"`, × removes, **+ use this in…**.
  - **Machine box**: machine icon, name, tier badge (Global colours), machine `<select>`, OC toggle, big `×<build>` with `"<running> running · <EU/t>"`, count field `RateInput` labelled `"Machines of <machine>"` (`setMachineCap`; lock icon when set), rows with icons and the Task 5 actions as buttons (**+ add what makes this**, **I have this**, **+ use this in…**, **I want this**), red border + reason when invalid.
  - **What I get** box: icon + name, `RateInput` labelled `"How much <name> you want"` showing the solved rate greyed until typed (`setWant`), dashed border + **I want this** when provisional, `Also made: …` lines.
  - Drive line above the graph (test id `drive-line`) with `driveText`; Summary panel (test ids `summary-have`, `summary-get`, `summary-also`, `summary-machines`, `summary-power`, `summary-problems`).
  - Power section: when `outside > 0` and no generator node, button **Power it with a generator** → picker('power').
  - Graph: `minZoom 0.5`, fit `maxZoom 1`.

- [ ] **Step 1: Write the failing e2e** `'type what you have, what you want, and a machine count'`: build the oil line (start make Light Fuel → reactor; **+ add what makes this** on Sulfuric Light Fuel → distillery; on Oil → extractor; on Hydrogen Cell → electrolyzer; **I have this** on Oil Berry); type `5.57` in "How much Oil Berry you have" → `summary-get` matches `/557\.\d L\/s/` (no generator yet, so power comes from outside); type `4` in "Machines of Basic Distillery" → `summary-get` shows ≈ 133.3 L/s; clear it, type `1000` in "How much Light Fuel you want" → `summary-problems` contains `Needs` and `Oil Berry`; Ctrl+Z → problems gone. Also assert the UI contains none of the words target/limit/maximise/bought in (`expect(page.locator('.calc-root')).not.toContainText(/target|limit|maximi[sz]e|bought in/i)`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx playwright test && npx vitest run && npm run typecheck && npm run build` → pass.
- [ ] **Step 5: Commit** `git add -A src e2e && git commit -m "feat: typeable have/get boxes and machine counts, plain summary"`

---

### Task 9: End-to-end reference and forward flow

**Files:**
- Modify: `e2e/calculator.spec.ts`; fixes in `src/calculator/**` only for defects the tests expose.

- [ ] **Step 1: Write the e2e tests** (spec §Testing):
  - `'reference: oil berry line to ≈513 L/s'`: build as in Task 8 plus **Power it with a generator** → Light Fuel row → set machine `Advanced Combustion Generator`; type `5.57` → `summary-get` `/513\.\d L\/s/`, `summary-machines` contains `×6`, `×17`, `×5`; power outside `0 EU/t`; `drive-line` reads `Making as much Light Fuel as 5.57 Oil Berry/s allows`; Save .json → clear storage → reload → load → same numbers.
  - `'forward: what you have → use this in…'`: start have Oil Berry → Fluid Extractor → **+ use this in…** on Oil → Distillery (50 L Oil row) → product is Sulfuric Light Fuel (dashed) → **I want this** on it makes it solid.
  - `'nothing typed shows one machine'`: start make Light Fuel → reactor → `drive-line` starts with `Showing one`.
- [ ] **Step 2: Run** `npx playwright test e2e/calculator.spec.ts` — fix code, not expectations; numbers must agree with `npx tsx scripts/check-oil-chain.ts` (513.25).
- [ ] **Step 3: Run everything** `npm test && npm run typecheck && npx playwright test && npm run build` → green.
- [ ] **Step 4: Commit** `git add -A src e2e && git commit -m "test: end-to-end reference and forward flows on the simpler screen"`
