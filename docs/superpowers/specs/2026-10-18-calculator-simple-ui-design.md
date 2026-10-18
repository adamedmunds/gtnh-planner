# GTNH Planner — Simpler Calculator Screen — Design

Date: 2026-10-18
Status: Draft for approval (builder-checked)
Builds on: `2026-10-18-calculator-design.md` (data, solver, chain model — unchanged except where noted) and the
Calculator UI on branch `feat/calculator-ui` (Plan 3b), which this redesign replaces on screen.

## Why

The user tried the first Calculator screen on their oil berry line and said: "I don't really understand what's going
on." What went wrong, in their words and from watching them:

- They clicked the boxes expecting to **type numbers into them** ("boxes that I could input things on, or even sliders
  to mention what my input would be vs what my output is"). The numbers were display-only; changes went through a
  separate targets bar and right-click menus they never found.
- **Building the chain** (search → add → "suggest" for each missing input) was helpful, but the choices were "hard to
  see all the information so I could tell what I was picking" — a cramped list inside a small box.
- They want to **keep the visual graph**, like gtnhplanner.com (screenshot shared: left-to-right machine boxes with
  item icons, ×count, tier badges, coloured lines, a left summary with "Set" machine counts).

They usually start from **what they have** ("my farm gives about 5.6 berries a second — what do I get, what do I
build?"), sometimes from **what they want**, and want to **build the chain in both directions** (backward from a
product, forward from something they have). They want **real item icons** and to **set machine counts**.

Success: the user can build their oil berry line and read off "5.57 berries/s in → 513 L/s Light Fuel out, build 6
extractors, 17 distilleries, …" without being told where to click.

## Goals

1. A left-to-right graph that reads like a recipe: a **"What I have"** box at the start, machine boxes in the
   middle, a **"What I get"** box at the end.
2. **Type numbers straight into the boxes**: what I have (per second), what I get (per second), and machine counts.
   Everything else re-balances immediately.
3. A **big, readable recipe picker** for "what makes this?" and "what uses this?", with icons, amounts, machine, tier, power, time, and the
   best match highlighted with a reason.
4. **Real item and fluid icons** from the user's own game.
5. A **plain summary** on the left: what I have, what I get, also made, machines to build (with tiers), power,
   problems in plain sentences.

## Non-goals

- Auto-building the whole chain without asking (the user picks each recipe; the best one is highlighted).
- The 3D layout / schematic from a chain (project 2; "Build in 3D" stays as a disabled placeholder).
- Multiblock specifics (parallels, coils, perfect overclocks) — still "≈ approximate".
- Sharing, accounts, mobile layouts.

## Anti-goals (it fails even if it works)

- Jargon on screen: "target", "limit", "external", "bought in", "maximise", "byproduct" are not shown to the user.
- Anything that can only be done by right-clicking, or a control that only exists in a hidden menu.
- Text too small to read at the default view.
- Losing work: undo/redo, autosave and Save/Load .json keep working as today.

## The screen

```
┌ Summary ───────┐┌ Graph ─────────────────────────────────────────────────────────────┐
│ What I have    ││ [What I have]──▶[Fluid Extractor ×6 LV]──▶[Distillery ×17 LV]──▶ … │
│ What I get     ││  Oil Berry           in 5.57/s  out 557 L/s                         │
│ Also made      ││  [ 5.57 ]/s                                       [What I get]      │
│ Machines       ││                                                    Light Fuel       │
│ Power          ││                 [Electrolyzer ×1 MV] [Combustion Gen ×5 MV]  [ 513 ]│
│ Problems       ││                                                                     │
└────────────────┘└─────────────────────────────────────────────────────────────────────┘
```

The right-hand recipe browser panel goes away. Looking things up happens in the picker (below).

### Boxes

- **What I have** (blue border): one per raw input. Item icon + name, a number field "[ 5.57 ] /s", and a hint
  "type how much you have". The field may be left **empty**, meaning "as much as needed" (the planner then shows the
  amount it uses, greyed). Removable.
- **Machine box**: machine name, tier badge (GT tier colours: LV green, MV orange, …), **big ×count to build** with
  "N running · EU/t" under it, then input and output rows with icon, name and rate. The machine is chosen from a
  dropdown on the box; an overclock toggle stays. The **count is typeable** ("I have 4") — see Numbers. Invalid
  machines (tier too low, recipe missing after a re-dump) get a red border and a plain reason.
- **What I get** (green border): the product. Icon + name, a number field "[ 513 ] L/s", hint "or type how much you
  want". Small "Also made: Sulfur Dust 0.05/s" lines show other surplus.
- Unmet inputs on a machine box show a clear button **"+ add what makes this"** and a second one **"I have this"**
  (creates a What I have box for it). No hidden menus.
- Lines are coloured: fluids by their colour family (yellow-ish default), items grey; labels show the flow rate.
- The graph lays itself out left to right after every change (have-boxes first column, get-box last); the user can
  still drag boxes, and an "Arrange" button re-tidies. New boxes come into view.

### Numbers (how typing drives the solve)

There is always one way the line is being driven, shown in a small line at the top of the graph in plain words
("Making as much Light Fuel as 5.57 Oil Berry/s allows" / "Making 1,000 L/s Light Fuel").

- **Before anything is typed**, the line shows numbers for **one machine of the product step** (the What I get
  field shows that rate greyed, hint "type how much you have or want"), so rates, machine counts and power appear
  while building. Nothing on screen says "set a limit".
- Typing in **What I get** → "make exactly this much". Have-amounts and machine counts the user typed still act as
  caps; if they can't reach it, the Problems list names **every typed number that falls short**, each with what the
  line would need ("Needs 10.9 Oil Berry/s — you have 5.57"; "Needs 33 Distilleries — you set 4"). The "needs"
  figures come from a second solve with the typed caps removed.
- Typing in **What I have** or a **machine count** → "make as much as possible" within everything typed; the What I
  get field then shows the calculated amount (greyed) until the user types in it again.
- Clearing the What I get field returns to "as much as possible".
- A machine count is a cap: "at most this many running". It is shown as a small lock on the box; clearing it removes
  the cap.
- All typed values are validated as today (positive finite numbers; empty clears); bad input reverts.

### Building the chain (both directions)

1. **Empty graph** → a big centred prompt with two searches (icons in results):
   - **"What do you want to make?"** → pick an item → the picker shows what makes it → "Use this" creates the machine
     box and a What I get box for that item.
   - **"What do you have?"** → pick an item → a What I have box is created and the picker shows what uses it →
     "Use this" creates the machine box to the right.
2. **Backward:** on any unmet input, **"+ add what makes this"** opens the picker (what makes it); **"I have this"**
   adds a What I have box.
3. **Forward:** on a What I have box and on every machine output row, **"+ use this in…"** opens the picker in
   "what uses this" mode; the new machine is placed to the right.
4. **Which output is the product:** every output row has **"I want this"**, which makes it the What I get box
   (replacing the previous one, which becomes an "Also made" line). While no What I get box exists — e.g. while
   building forward — the newest machine's first output is used as the product and shown with a dashed border and
   the hint "I want this?" so numbers still appear.
5. **Power**: if the line uses power and nothing makes it, the summary's Power section says "Needs 599 EU/t" with a
   button **"Power it with a generator"** → the picker lists generators for fuels the line makes first, then any fuel.
   Otherwise power is assumed to come from outside (shown plainly, not as a problem).

### Recipe picker

A large panel (centred, closable with Esc or ×), titled "What makes Sulfuric Light Fuel?" (or "What uses Oil Berry?"
in forward mode) and "for the Chemical Reactor · N recipes". Each recipe is a row:

- inputs → outputs as icon chips with amounts ("50 L Oil → 50 L Sulfuric Light Fuel"); things not used up (circuits,
  molds) listed separately as "needs … (not used up)";
- a plain line: machine name, tier and EU/t, seconds per craft, multiblock marker;
- a reason tag on good matches ("uses Oil you already make"; "recycles Empty Cells");
- one **Use this** button (optionally a tier dropdown before using).

Order uses the existing ranking (container-emptying recipes last, recipes using more of what the line makes first,
then tier); in forward mode, container-filling recipes go last and recipes whose other inputs the line already makes
go first. The best row is highlighted. Long lists show 10 then "Show more"; a filter box narrows by text.

### Summary panel (left)

Plain headings: **What I have**, **What I get**, **Also made**, **Machines to build** (icon, tier badge,
"×17 Distillery"), **Power** (used / made / from outside), **Problems** (sentences, e.g. "Needs 10.9 Oil Berry/s —
you have 5.57", "Electrolyzer: needs MV, LV can't run it"). Numbers greyed while a problem stands, as today.

## Icons

- The dumper mod gains **`/gtnhplanner icons`** (client side, in the `export v2` instance): renders every item that
  appears in the recipe data (plus machine blocks) with the game's own item renderer into an off-screen 32×32 buffer,
  exactly as in inventories/NEI (tinted GT materials, 3D blocks, overlays), and every fluid as its still icon tinted
  with the fluid colour. Output: PNG sprite sheets + an index (resource key → sheet, x, y) in
  `.minecraft/gtnh-planner/icons/`.
- `npm run recipes` also copies/packs them into `public/data/icons/` (git-ignored, never committed or published).
- The app loads sheets lazily; a missing icon falls back to a coloured square with the first letter.

## Chain model and solver changes

- "What I have" boxes map to the existing **externals + limits**: empty field = external with no cap; a number = a
  supply cap. "What I get" maps to **targets** (rate when typed, maximise otherwise). Users never see those words.
- **One What I get box per chain.** Older chains with several targets load with the first as the What I get and
  the others dropped from targets (they still show as "Also made").
- Supply limits from older chains on things the line makes are shown as What I have boxes.
- New: **machine-count caps** — `ChainNode.maxMachines?: number`, solved as `x_n ≤ maxMachines`.
- New: which box drives ("exactly this much" vs "as much as possible") is just the target type; the plain-words
  drive line is derived from it.
- Have/get boxes need positions on the graph: stored with the chain (`chain.layout?: Record<string, Position>` keyed
  by `have:<key>` / `get:<key>`), so old saved chains still load.
- Existing undo/redo, autosave, project Save/Load and the 3D Editor tab are unchanged.

## Decided by the user

- Keep a visual left-to-right graph like gtnhplanner.com; boxes are simple to read (option "B" flow in graph form).
- Type numbers into the input and output boxes; also set machine counts.
- Keep building the chain step by step, but with a big, readable picker — **in both directions** (from what you
  want, and from what you have).
- Real item icons.

## My calls (the user can override)

- Icons are rendered by the game itself through the dumper mod rather than rebuilt from texture files.
- The right-hand recipe browser panel is removed; search lives in the empty-graph prompt and the picker.
- Machine counts are caps ("at most"), not exact counts, so the line still balances.
- Typing in What I get switches to "exactly this much"; typing anywhere else switches back to "as much as possible".
- Power from outside is allowed and shown plainly, not as an error.
- Exactly one What I get box; other outputs are "Also made" (promotable with "I want this").
- Before anything is typed, numbers are shown for one machine of the product step.
- When a typed amount can't be reached, every typed number that falls short is listed with what the line needs.
- Old saved chains: extra targets dropped to "Also made"; limits on things the line makes become What I have boxes.

## Left to the builder

- Exact visual styling, sizes, colours of fluid lines, sprite-sheet size and format.
- How the auto-layout places side machines (loops, generators).
- Whether the picker's tier choice is a dropdown on the row or on the box afterwards.

## Testing

- Unit: drive-mode mapping (typing → targets/limits/caps), machine-count cap in the LP (oil line with 4 distilleries
  → output scales to 4/16.71 of 513 L/s), layout with have/get boxes, picker ordering and reason tags, icon index
  lookup and fallback.
- E2E on real data: from an empty graph, "What do you want to make?" → Light Fuel → build the oil line through the
  picker → type 5.57 into What I have → What I get shows ≈513 L/s and the summary lists 6/17/1/1/5 machines; type 4
  on the Distillery → output drops accordingly; clear it, type 1000 into What I get → problem names Oil Berry with
  what's needed; undo works. Forward: "What do you have?" → Oil Berry → "use this in…" → Fluid Extractor → shows
  Oil as the dashed product.
- In game: run `/gtnhplanner icons` in `export v2`, check a tinted GT dust, a GT cell, a fluid and a block icon look
  like NEI.
