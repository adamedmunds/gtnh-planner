# GTNH Planner

A local 3D build planner for GregTech: New Horizons. Lay out GT machines, cables and pipes in the browser, then export a Schematica `.schematic` to build from a hologram in-game.

Textures are extracted from your own GTNH install and are never committed.

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
