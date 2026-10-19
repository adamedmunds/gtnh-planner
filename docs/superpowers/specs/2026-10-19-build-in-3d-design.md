# GTNH Planner — Build in 3D (Project 2) — Design

Date: 2026-10-19
Status: Draft for approval (builder-checked)
Builds on: the Calculator (`2026-10-18-calculator-design.md`, `2026-10-18-calculator-simple-ui-design.md`), the 3D
Editor and Schematica export (`2026-10-18-gtnh-planner-design.md`), and the oil berry line generator
(`src/presets/oilBerryLine.ts`).

## Why

The Calculator tells the user what to build ("6 Fluid Extractors, 17 Distilleries, …") but they still have to design
the physical layout by hand. The user wants: "the machines laid out so I can export and build it". The **Build in 3D**
button (already on the Calculator, disabled) should turn a solved line into a ready-to-build layout in the 3D Editor,
which they export as a Schematica hologram and build in game.

Most important to them after "it works": **modular / copy-and-pasteable, so expanding is super easy**. When they
grow a line it is usually because they have more input (more berries), so the parts that grow should be the stages
with many machines, repeated as identical chunks they can paste onto the end.

Nothing has been built in game from a generated hologram yet (only loading was tested), so the first real check of
buildability is the user building one of these.

## Goals

1. **Build in 3D** turns the current solved Calculator line into blocks in the 3D Editor: every machine the summary
   says to build, plus the pipes, cables, generators and transformers that join and power them, laid out so the user
   can export and build it.
2. Two layout styles, chosen with a setting next to the button:
   - **Modular** (default): a **core** with copy-paste **slices**, walkway down the middle, machines stacked two
     high on each side (the user's choice "B").
   - **Straight line**: exact machine counts laid out in chain order along a walkway, no slices (like option "A":
     rows, one high, longest footprint).
3. Works for any line the Calculator can solve, not only the oil berry line. Machines that are not in the editor's
   hand-made palette are added automatically from the recipe data.
4. Clearly marked places where inputs come in and products go out.

## Non-goals (follow-ups)

- **Fit to a space** (the stretch goal): the user gives dimensions and the planner finds the smallest design that
  fits. Agreed as a follow-up project once they have built from these holograms.
- EnderIO conduits (the user wants them later; the layout should not make switching hard, but this version places
  GregTech pipes and cables only).
- Multiblocks (they stay "approximate" in the Calculator; a chain needing one gets a clearly marked placeholder area
  rather than a built structure).
- AE2, logistics, chests/tanks automation beyond marked in/out points.

## Anti-goals (fails even if it works)

- A layout that cannot be built as shown: pipes that don't connect, machines that can't be reached, power that
  can't flow, a machine whose output faces into a wall.
- A modular layout whose slices aren't truly identical, so pasting one more doesn't just work.
- Losing the user's current 3D build without asking.
- Jargon or a confusing control: same plain-language bar as the simpler Calculator.

## What the user sees

- On the Calculator, next to **Build in 3D**: a checkbox **"Straight line (no copy-paste slices)"**, off by default
  (off = Modular). The button is enabled whenever the line solves with at least one machine to build.
- Pressing it: if the 3D Editor already has blocks, a confirm "Replace your 3D build with this line? (Ctrl+Z undoes
  this.)". Then the 3D Editor tab opens with the layout framed in view, named after the product (e.g. "Light Fuel
  line"), and a short note: "6 slices for 5.57 Oil Berry/s · paste more slices on either end to grow it".
- Markers in the build for "Oil Berry in", "Light Fuel out" (and any other inputs/outputs): a distinct marker block
  type that shows in the editor and the materials list, and exports as a plain block (e.g. a chest/tank placeholder)
  the user swaps for their own input/output.
- The materials list (existing) reflects everything to place.

### Growing a modular line (decided by the user)

- **In the planner:** while the 3D build is a generated modular line, the 3D Editor shows **"+ slice"** buttons for
  each end ("+ slice on the left" / "+ slice on the right") and a matching remove. Each adds one identical slice to
  that end and updates the note ("7 slices · handles 7 Oil Berry/s"); the core warns when it's past what it can
  serve. Then export the whole build again as usual. Each press is one undo step.
- **In game:** **"Export one slice"** saves a schematic of a single slice on its own, so the user can load it in
  Schematica and line it up by hand at either end of a line they've already built. The slice schematic's origin is
  chosen so it lines up with a fixed, easy-to-find point on the end of the existing line (e.g. the corner of the
  last slice's walkway), and the export message says which block to align it to.
- If the user edits the generated build by hand (places/removes blocks), the "+ slice" buttons stop showing for that
  build (it's no longer the generated layout); "Export one slice" likewise needs the generated layout.

## Modular layout (default)

- **Slices** repeat the stages with many machines. A slice is the smallest whole-number set of those machines that
  balances (for oil: 1 Fluid Extractor + 3 Distilleries + its power), sized for a round amount of input (≈1 Oil
  Berry/s). Counts are rounded **up** to whole slices, so the build has a little headroom over the typed amount
  (5.57 berries/s → 6 slices = 6 extractors, 18 distilleries).
- **The core** holds stages the line only needs a fraction of (oil: Chemical Reactor, Electrolyzer, their power,
  the transformer). It sits in the middle; slices extend both ways. The note says how many slices one core can serve
  ("this core handles up to 15 slices").
- Machines stacked two high on both sides of a 1-wide walkway; everything reachable from the walkway floor.
- Every pipe and cable line runs straight through each slice at the same position, so a pasted slice connects to its
  neighbour with no extra work. Power: each slice carries its share of generators/transformers, or a power line
  runs through all slices — builder's call, but it must keep slices identical.
- If a line can't be split cleanly into slices (e.g. no stage repeats), it falls back to the straight-line layout and
  says so.

## Straight-line layout

- Exact counts from the Calculator (the "×N to build"), in chain order from inputs to product along one walkway, one
  machine high, pipes behind, cables on top — like today's oil berry hologram style "A".

## How it's built (decided and my calls)

Decided by the user:
- Layout style B (two high around a walkway) for Modular; slices grow with more input; the core holds one-offs.
- A setting to switch to a straight line.
- Fit-to-space is a follow-up.
- Growing: a "+ slice" button in the planner, plus "Export one slice" to line up by hand in game.
- Support power up to HV.
- GregTech pipes for now; EnderIO later.

My calls (the user can override):
- Pipe/cable choice: ordinary GregTech pipes, item pipes and cables from the palette, sized for the flow and tier;
  a warning in the note when a flow is more than one pipe of the largest available size can carry, rather than
  silently under-sizing.
- The palette grows automatically: machines used by the solved line that aren't in `src/catalog/entries.ts` get
  generated catalog entries from the recipe data's `MachineRef` (mID, name, tier) with the generic casing textures
  for their tier and a neutral front overlay, so they render in the editor and export with the right `mID`.
- Power up to **HV** (the user is at HV now): the palette gains HV cables, HV→MV (and MV→LV) transformers and HV
  generators, with GregTech IDs checked against the user's GT 5.09.54.183 and their textures extracted. Lines needing
  power above HV say "can't build power for this yet" instead of drawing something that won't work.
- Covers: the hologram doesn't place GregTech covers. Where a machine needs one to work as laid out (e.g. a pump
  cover so a chemical reactor sends fluid one way and cells another), the build note lists the cover and which
  machine face it goes on, for the user to add in game.
- Generators and transformers come from the Calculator line (generator nodes) or, when power comes from outside,
  a marked "Power in (N EU/t, tier)" point instead of generators.
- Machine facing follows what GregTech needs to work when built as shown (front/output faces toward the pipe line
  that takes their output); where an in-game setting is needed (e.g. enabling auto-output), the note lists it.
- Replacing the 3D build is one undo step in the editor.

## Left to the builder

- Exact slice geometry, pipe/cable rows and how power is shared within slices, as long as slices are identical and
  connect by pasting.
- How the "smallest whole-number set" for slices is computed for general chains, and the fallback rule.
- Marker block representation in the editor/export.
- How in-game IO notes are shown (note text vs per-block info).

## Testing

- Unit: slice computation for the oil line (1 extractor : 3 distilleries per slice; core = reactor + electrolyzer),
  rounding (5.57 → 6 slices), fallback to straight line for a chain with no repeating stage; generated catalog
  entries for an unknown machine; every pipe network in a generated build is connected (existing connections model);
  slices are byte-identical when translated by the slice length; straight-line counts equal the Calculator's.
- Unit: "+ slice" on either end keeps every slice identical and all networks connected; removing goes back to the
  same blocks; the one-slice schematic's blocks equal one slice of the full build at the stated offset.
- E2E (real data): build the oil berry line in the Calculator, type 5.57, press Build in 3D → 3D Editor shows the
  build, materials list has 6 Fluid Extractors and 18 Distilleries (modular) / 6 and 17 (straight line), export
  produces a schematic; "+ slice on the right" → 7 extractors / 21 distilleries; "Export one slice" downloads a
  schematic; Ctrl+Z restores the previous build.
- In game (the user): load the exported schematic in `GT_New_Horizons_2.9.0-RC-1`, build one slice + core, confirm
  berries → Light Fuel flows; paste a second slice and confirm it connects.

## Refinements after the first preview (2026-10-19, decided by the user)

After trying Build in 3D on the dev server the user asked for:

1. **More compact layouts.** "A lot of empty space … a lot of places where I [could] compact things." Keep the
   approved shape (walkway, machines two high, copy-paste slices) but drop the waste: shared lanes directly behind /
   under / over the machines instead of 3–4 blocks out, no gap column after every machine column, a tighter core and
   markers. Smallest footprint that still passes the build checker.
2. **Cable loss.** GregTech cables lose EU per block for every amp they carry (Tin 1, Copper 2, Annealed Copper 1,
   Gold 2, Electrum 1, Silver 1 — GT LoaderMetaPipeEntities). Cables come in 1x, 2x, 4x, 8x, 12x and 16x; amps scale
   with size, loss per block doesn't (e.g. 4x Copper = 4 A of MV at 2 EU/block). Choose the cable by: voltage tier ≥
   the network's, enough amps in one cable (pick the size), then the lowest loss. Keep power runs short (generators and
   transformers next to what they feed). Count the EU lost along each run in the power budget (generators) and show
   it in the line notes.
3. **See what's in each pipe** — all three of:
   - **Floating icons** over each pipe run (item/fluid icon from the game; a power symbol with the voltage for
     cables), about once per slice, with a toolbar toggle "Show what's in pipes".
   - **Hover to highlight**: pointing at a pipe lights up its whole network (pipes and the machines it connects) and
     the info panel says what it carries, how much per second, and which pipe it is.
   - **A legend in the line notes** listing every network with its icon; clicking one highlights it in 3D.
   Generated pipes and cables remember what they carry (saved with the build).

## Tidy routing (2026-10-19, decided by the user)

After the refinements the user said the routing "looks off … a bunch of spaghetti cabling, no tidiness" (cables
arching up and over machines). Cause: every pipe and cable is found by its own path search, one network at a time,
power last, with nothing that prefers straight or parallel runs. The user approved replacing that with **fixed straight
runs** ("yes that's the tidy I mean"), shown as a cross-section mockup (`.superpowers/brainstorm/…/tidy-routing.html`).
Sharing was confirmed: everything carrying the same thing is one network that later branches join, never a second pipe.

### The cross-section (decided)

Looking down the walkway (z = 0, two blocks tall at y = 0..1), the same on both sides:

| y \ side | back (z = ±2) | machine column (z = ±1) |
|---|---|---|
| 3 | spare | **input run** of the upper row (over its top) |
| 2 | **output run** of the upper row | upper machine |
| 1 | **power feed** (source side of the power) | **power run**, sandwiched: touches the top of the lower machine and the bottom of the upper one |
| 0 | **output run** of the lower row | lower machine |
| −1 | spare | **input run** of the lower row (in the floor) |

- Machines face the walkway (front = picture), output on the back, main input on their outer face (under the lower
  row, over the upper row). Rows are one block apart vertically (upper machines at y = 2) for the power run.
- Every run is a straight line along the walkway. A run that several slices need continues straight through every
  slice into the core.
- Four rows per slice: north lower/upper, south lower/upper. Machines in a row sit side by side, touching.
- The walkway (z = 0, y = 0..1) and the floor under it (y = −1, z = 0) stay clear. y = 2 at z = 0 is free air above
  head height (bridges may use y = 3 at z = 0).
- Footprint goal: 5 wide (z = −2..2) and 5 tall (y = −1..3) when no extra runs are needed; extra runs may use the
  spare cells and z = ±3, growing to 7 wide.
- Line notes say the floor runs sit one block below the walkway, so the player digs one layer for them.

### Power (decided, and it fixes the straight-line loss the reviewer found)

- The power run of each side carries the voltage of the machines on that side. Both rows of a side run at one
  voltage (row assignment keeps it so).
- Step-down transformers sit **in the power run itself**, input face toward the power feed behind it (z = ±2, y = 1),
  so each transformer is right next to the machines it feeds: no long low-voltage runs. One per 4 A of the lower
  voltage, per side, per slice (or per stretch of a straight line).
- The power feed runs straight along the line at the source voltage (or one step below the source when the core steps
  HV down first). Generators put power out of their back into their row's output run, which touches the feed.
- Machines on a side at the source voltage take power straight from the feed through the power run (no transformer).
- Cable sizes and loss as in the refinements (cableFor, cableLoss). A straight oil line must lose well under its
  demand (target: under 15%) and never say "fall short".

### Joining runs (decided)

- Where one run feeds another (oil out → oil in), they are joined by a short crossover in the slice's **service
  column** (one machine-free column at the same x in every slice), using the existing search router restricted to the
  service column and spare cells, with a penalty for bends so crossovers are straight risers and bridges.
- Outside the service column, every conduit block connects only along the walkway (to its neighbours in the run) or
  to the machine it touches. That's the measurable meaning of "tidy".
- The core (one-off machines: reactor, electrolyzer, extra generators, HV→MV steps, markers) uses the same rows and
  runs where it can; anything else in the core is joined by the bend-penalised search. The core may be messier than a
  slice but must stay within the line's cross-section bounds.

### Which machines go in which row (decided)

- Each row holds one kind of machine where possible, so its input and output runs are uniform. When a slice has more
  kinds than rows, a row is split into stretches; the runs of a stretch belong to that stretch, and a run several slices
  need gets its own spare-cell run (through-run) joined in the service column.
- Pick the arrangement with the shortest slice, then the fewest extra through-runs, then the fewest crossover blocks.
- Second inputs and second outputs (a machine that takes two things, or makes an item and a fluid) use a free face
  at the end of a stretch or the service column, with the cover and note rules already in place (pump/conveyor cover,
  Item Filter).

### Straight lines and fallbacks (my calls)

- A straight line is the same cross-section with no slices: one long stretch per kind, transformers in the power run
  next to the machines they feed, the core at one end.
- If a line can't be laid out tidily, the generator falls back to the current search-based layout and the notes say
  "Couldn't keep this line tidy, so some pipes take detours". The checker still has the last word.
- The previous compact/narrow/roomy forms become that fallback; the tidy layout is tried first for both styles.

### Left to the builder

- The exact row-assignment search, the service column's position in the slice, and the bend penalty's weight.
- Which spare cell each through-run takes.
- How second inputs/outputs pick their face, within the rules above.

### Testing

- Oil line (modular): passes the checker; outside the service column every conduit connects only along x or to its
  machine; footprint 5–7 wide and ≤ 5 tall; generators cover use plus loss with no "fall short".
- Oil line (straight): passes the checker; cable loss under 15% of demand; no "fall short"; transformers touch the
  machines they feed or the power run next to them.
- Each slice has the same blocks (paste still works); growing and one-slice export still work.
- An HV-powered variant lays out (HV feed, HV→MV in the core or power runs, then MV→LV in the power runs).
- A line that can't be tidy falls back with the note, and still passes the checker.
- Screenshots before/after for the user, fresh schematics.
