# Generators Matched to Each Voltage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A generator box can match each machine's voltage: LV machines on LV generators, HV on HV, sized per voltage, in the Calculator and the 3D layout.

**Spec:** `docs/superpowers/specs/2026-10-19-build-in-3d-design.md`, section "Generators matched to each machine's voltage".

## Global Constraints
- Power per voltage in the solver: `eu@<tier>` rows; step-down only; outside power per voltage when nothing in the line makes it.
- Chain generator node: `matchTiers?: boolean` (default off = today's behaviour).
- Fixture DB generators: 1110 (LV Basic Combustion), 1111 (MV Advanced Combustion) on `gt.recipe.dieselgeneratorfuel`.

### Task 1: Solver tracks power per voltage
- Tests (src/calc/solve.test.ts): oil chain with the MV generator unchanged (≈5 generators, nothing from outside); same chain with `matchTiers` → generator result lists LV and MV tiers, LV generators cover LV machines, MV covers the MV electrolyzer; a chain with a machine above every generator's voltage reports outside power at that voltage.
- `NodeResult.tiers?: { tier: string; machineMID: number; machines: number; build: number; eut: number }[]`; `ChainResult.euOutside: Partial<Record<string, number>>`.

### Task 2: Chain switch and Calculator card
- `setMatchTiers` action; storage keeps it; generator card select "Generators: one tier / match each machine's voltage" with one row per voltage; summary shows outside power per voltage.
- e2e: switching to match shows an LV and an MV generator row on the oil line.

### Task 3: Planner and layout use each voltage's generators
- planLine makes one generator PlanMachine per voltage (`<id>@<tier>`), each feeding its own voltage; powerEachRegion sizes generators per voltage; the core router connects each generator to its own voltage's network.
- Tests: oil line with match lays out (modular and straight) and passes the checker; no transformer where every voltage has its generator.
