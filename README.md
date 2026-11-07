# GTNH Planner

**Try it: https://gtnhplanner.adamedmunds.dev**

A 3D build planner for GregTech: New Horizons. Lay out GT machines, cables and pipes in the browser, then export a Schematica `.schematic` to build from a hologram in-game.

Textures are extracted from your own GTNH install and are never committed.

> **Disclaimer:** GTNH Planner is an unofficial fan tool. NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR
> ASSOCIATED WITH MOJANG OR MICROSOFT. It is not affiliated with or endorsed by GregTech or the GT New Horizons team.
> Minecraft and mod textures, icons and recipe data belong to their respective owners. This repository contains none
> of them. If you own any of that content and want it removed from the hosted version, open an issue and it will be
> taken down.

## Test hologram (in-game check)

```bash
npm install
npm run schematic:test
```

1. Copy `out/test-hologram.schematic` into your instance's `.minecraft/schematics/` folder.
2. In a creative test world, open Schematica's load menu and load `test-hologram`.
3. Expect a 15×2×6 hologram. Front row: LV Fluid Extractor, Distillery, Chemical Reactor, Electrolyzer, Extractor, then MV and HV Distillery, all fronts facing south, plus one LV Distillery facing east at the end; a tin cable behind the row, a bronze pipe on top of the first five machines, and a short tin item pipe in front. Back row (4 blocks further south): MV and HV Fluid Extractor, Chemical Reactor, Electrolyzer and Extractor, all facing south.

## Oil berry line

```bash
npm run schematic:oil                                   # 6 extractors, 17 distilleries (≈5.6 berries/s)
npm run schematic:oil -- --berries 8.4                  # sized for a berry rate
npm run schematic:oil -- --extractors 9 --distilleries 26
```

Writes `out/oil-berry-line*.schematic` and prints the materials list, throughput and fuel balance.

The chemical reactor + electrolyzer module sits in the middle; extractor modules grow west and distillery
modules grow east. A bigger line contains a smaller one block-for-block, so you can expand an existing
build by extending the back (oil), front (berries/sulfuric) and bottom (light fuel) lines and adding modules
at either end. Up to 15 extractors per chemical reactor.

## Editor

```bash
npm install
cp .env.example .env  # once: point GTNH_INSTANCE / GTNH_DUMP at your own game files (.env is not committed)
npm run textures      # once: copies textures from your GTNH GregTech jar into public/textures (not committed)
npm run recipes       # imports your /gtnhplanner dump into public/data (not committed)
npm run dev           # open the printed URL
```

Left-click to place against the face you point at, right-click to remove, **R** to rotate (Shift+R includes
up/down), Shift+click a pipe face to connect/disconnect that side. Drag to orbit, right/middle-drag to pan,
scroll to zoom. The layer slider hides everything above a Y level. Builds autosave in the browser; use
Save/Load .json to keep several. "Oil berry example" loads the generated line for a berry rate. Export
downloads a `.schematic` for Schematica.

Tests: `npm test` (unit), `npm run e2e` (drives the real app in Chromium; first run `npx playwright install chromium`).

Deploying: see [DEPLOY.md](DEPLOY.md).

## License

[MIT](LICENSE). The license covers this code only, not Minecraft's or any mod's textures, icons or recipe data.
