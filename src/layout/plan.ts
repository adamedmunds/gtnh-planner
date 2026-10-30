import type { Chain } from '../calc/chain';
import { nodeRates } from '../calc/rates';
import { V, tierName, tierForEut, TIER_NAMES } from '../calc/tiers';
import { CATALOG_ENTRIES, machineKey } from '../catalog';
import { haveBoxes, type ScreenSolve } from '../calculator/drive';
import { formatNumber } from '../calculator/format';
import { resourceInfo } from '../calculator/graphModel';
import type { RecipeDb } from '../recipes/db';
import { EU, type MachineRef, type ResourceKey } from '../recipes/types';
import { COILS, EBF_ID, PYROLYSE_OVEN_ID, buildable, coilFor, ebfHeat, hasMuffler } from './multiblock';
import type { LayoutStyle, LinePlan, PlanMachine, PlanMarker, PlanNetwork, PowerPlan, PowerTier } from './types';

const POWER_TIERS: readonly PowerTier[] = ['LV', 'MV', 'HV'];
const tierIndex = (t: string) => TIER_NAMES.indexOf(t);

/** Hand-made catalog key for a machine, else its generated `gt_<mID>` key. */
function keyFor(m: MachineRef): string {
  return CATALOG_ENTRIES.find((e) => e.kind === 'machine' && e.mID === m.mID)?.key ?? machineKey(m.mID);
}

/** "5.57 Oil Berry/s", "557 L/s Oil". */
function amountText(n: number, key: ResourceKey, db: RecipeDb): string {
  const { name, kind } = resourceInfo(key, db);
  return kind === 'fluid' ? `${formatNumber(n)} L/s ${name}` : `${formatNumber(n)} ${name}/s`;
}

/**
 * Decides what goes where: stages with many machines repeat in identical slices (sized by the first input you
 * have), the rest live in one core; plus the networks that join them, the in/out markers and the power.
 */
export function planLine(chain: Chain, db: RecipeDb, screen: ScreenSolve, style: LayoutStyle): LinePlan | { error: string } {
  const result = screen.result;
  const solved = new Map(result.nodes.filter((n) => !n.invalid && n.machines > 1e-9).map((n) => [n.id, n]));
  const nodes = chain.nodes.filter((n) => solved.has(n.id));
  if (!nodes.length) return { error: 'Nothing to build yet — add machines and type how much you have or want' };

  const perNode = nodes.map((node) => {
    const r = nodeRates(node, db);
    const perMachine = r.valid ? r.perMachine : new Map<ResourceKey, number>();
    const mapIndex = node.kind === 'recipe' ? db.bySignature(node.recipeSig)!.map : db.mapIndexById(node.fuelMap)!;
    const ref = db.map(mapIndex).machines.find((m) => m.mID === node.machineMID)!;
    // A multiblock dump carries no tier: it runs at the lowest voltage that covers its recipe's EU/t.
    const tier = tierName(ref) ?? (ref.multiblock && r.valid ? TIER_NAMES[tierForEut(Math.abs(r.eut))] : undefined);
    const recipe = node.kind === 'recipe' ? db.bySignature(node.recipeSig) : undefined;
    const kept = (recipe?.inputs ?? []).filter((s) => s.consumed === false).map((s) => {
      const circuit = /gt\.integrated_circuit@(\d+)$/.exec(s.key);
      return { key: s.key, name: circuit ? `Programmed Circuit ${circuit[1]}` : resourceInfo(s.key, db).name };
    });
    const title = recipe ? db.map(recipe.map).name : `${resourceInfo((node as { fuelKey: string }).fuelKey, db).name} generator`;
    return {
      id: node.id,
      build: solved.get(node.id)!.build,
      title,
      kept,
      heat: recipe?.specialValue ?? 0,
      node,
      ref,
      tier,
      machines: solved.get(node.id)!.machines,
      perMachineEut: r.valid ? Math.abs(r.eut) : 0,
      eut: Math.abs(solved.get(node.id)!.eut),
      inputs: [...perMachine].filter(([k, v]) => v < 0 && k !== EU).map(([k]) => k),
      outputs: [...perMachine].filter(([k, v]) => v > 0 && k !== EU).map(([k]) => k),
    };
  });
  // A generator matching each voltage: one entry per voltage (its own generator, count and EU).
  const info = perNode.flatMap((i) => {
    const tiers = solved.get(i.node.id)!.tiers;
    if (i.node.kind !== 'generator' || !tiers?.length) return [i];
    const mapIndex = db.mapIndexById(i.node.fuelMap)!;
    return tiers.filter((t) => t.machines > 1e-9).map((t) => {
      const ref = db.map(mapIndex).machines.find((m) => m.mID === t.machineMID)!;
      const r = nodeRates({ ...i.node, machineMID: t.machineMID }, db);
      return { ...i, id: `${i.node.id}@${t.tier}`, build: t.build, ref, tier: t.tier, machines: t.machines, eut: Math.abs(t.eut), perMachineEut: r.valid ? Math.abs(r.eut) : 0 };
    });
  });

  for (const i of info) {
    if (i.tier && !i.ref.multiblock && tierIndex(i.tier) > tierIndex('HV')) {
      return { error: `Can't build power for this line yet (needs ${i.tier})` };
    }
  }

  const machine = (i: (typeof info)[number], count: number): PlanMachine => {
    const pm: PlanMachine = {
      nodeId: i.id,
      key: i.ref.multiblock ? 'marker_multiblock' : keyFor(i.ref),
      machine: { key: keyFor(i.ref), name: i.ref.name, mID: i.ref.mID, ...(i.tier ? { tier: i.tier } : {}) },
      ...(i.tier ? { tier: i.tier } : {}),
      count,
      eut: i.perMachineEut,
      avgEut: i.eut,
      title: i.title,
      kept: i.kept,
      inputs: i.inputs,
      outputs: i.outputs,
      generator: i.node.kind === 'generator',
      multiblock: i.ref.multiblock,
    };
    if (i.ref.mID === EBF_ID) pm.heat = i.heat;
    if (!planned(i)) return pm;
    // A multiblock we can build: its own controller, its fluid outputs in recipe order.
    const recipe = i.node.kind === 'recipe' ? db.bySignature(i.node.recipeSig) : undefined;
    const fluidOutputs = (recipe?.outputs ?? []).map((o) => o.key).filter((k) => k.startsWith('fluid:'));
    return { ...pm, key: keyFor(i.ref), machine: { ...pm.machine, multiblock: true }, fluidOutputs };
  };
  /** A multiblock we can build (a definition, a tier up to HV, for an EBF coils hot enough) is laid out as itself; same rule as `structureFor`. */
  function planned(i: (typeof info)[number]): boolean {
    return i.ref.multiblock && buildable(i.ref.mID, i.tier, i.heat);
  }

  // Markers: everything taken from outside comes in; the product and everything else made goes out.
  const markers: PlanMarker[] = [];
  const kindOf = (k: ResourceKey) => (resourceInfo(k, db).kind === 'fluid' ? 'fluid' : 'item');
  for (const k of result.inputs.keys()) markers.push({ id: `in:${k}`, key: k, dir: 'in', kind: kindOf(k) });
  for (const k of [...result.outputs.keys(), ...result.byproducts.keys()]) markers.push({ id: `out:${k}`, key: k, dir: 'out', kind: kindOf(k) });

  const networks: PlanNetwork[] = [];
  const keys = new Set(info.flatMap((i) => [...i.inputs, ...i.outputs]));
  for (const key of keys) {
    const producers = info.filter((i) => i.outputs.includes(key)).map((i) => i.id);
    const consumers = info.filter((i) => i.inputs.includes(key)).map((i) => i.id);
    if (markers.some((m) => m.id === `in:${key}`)) producers.push(`in:${key}`);
    if (markers.some((m) => m.id === `out:${key}`)) consumers.push(`out:${key}`);
    if (producers.length + consumers.length < 2) continue;
    const flow = Math.max(
      result.nodes.reduce((s, n) => s + Math.max(0, n.rates.get(key) ?? 0), 0),
      result.nodes.reduce((s, n) => s - Math.min(0, n.rates.get(key) ?? 0), 0),
    );
    networks.push({ key, name: resourceInfo(key, db).name, kind: kindOf(key), flow, producers, consumers });
  }

  // Power: the machines' tiers, from the line's generators or from outside, stepping down with transformers.
  const users = info.filter((i) => i.node.kind !== 'generator' && (!i.ref.multiblock || planned(i)) && i.tier);
  const tiers = POWER_TIERS.filter((t) => users.some((i) => i.tier === t || (t === 'LV' && i.tier === 'ULV')));
  const demand: PowerPlan['demand'] = {};
  for (const i of users) {
    const t = (i.tier === 'ULV' ? 'LV' : i.tier) as PowerTier;
    demand[t] = (demand[t] ?? 0) + i.eut;
  }
  const gens = info.filter((i) => i.node.kind === 'generator' && i.tier);
  const top = (list: string[]) => POWER_TIERS[Math.max(0, ...list.map((t) => POWER_TIERS.indexOf(t as PowerTier)))];
  const source: PowerPlan['source'] = gens.length
    ? { kind: 'generators', tier: top(gens.map((g) => g.tier!)) }
    : { kind: 'outside', tier: top(tiers), eut: result.euUsed };
  const transformers: PowerPlan['transformers'] = [];
  for (let t = POWER_TIERS.indexOf(source.tier) - 1; t >= 0; t--) {
    const below = POWER_TIERS.slice(0, t + 1).reduce((s, x) => s + (demand[x] ?? 0), 0);
    if (below > 0) transformers.push({ from: POWER_TIERS[t + 1], to: POWER_TIERS[t], count: Math.ceil(below / (V[t + 1] * 4) - 1e-9) });
  }
  if (source.kind === 'outside') markers.push({ id: 'power', key: EU, dir: 'in', kind: 'power' });

  /** What to set on the machines in game: fronts, auto-output, circuits, outside power. */
  const buildNotes = (machines: PlanMachine[], times: (m: PlanMachine) => number): string[] => [
    'Place every machine with its front (the face with its picture) toward the walkway, then wrench its output to the side shown in the 3D view.',
    'Turn on item and fluid auto-output on every machine.',
    ...machines.filter((m) => !(m.multiblock && m.key !== 'marker_multiblock')).flatMap((m) => m.kept.map((k) => {
      const n = times(m);
      return n === 1 ? `Put a ${k.name} in the ${m.title}` : `Put a ${k.name} in every ${m.title} (${n})`;
    })),
    ...(source.kind === 'outside'
      ? [`Power in: bring ${source.tier}, ${formatNumber(source.eut)} EU/t (${Math.max(1, Math.ceil(source.eut / V[POWER_TIERS.indexOf(source.tier) + 1] - 1e-9))} A)`]
      : []),
  ];
  const power: PowerPlan = { tiers, source, demand, transformers };

  const straightPlan = (fallback?: string): LinePlan => ({
    style: 'straight',
    sliceCount: 0,
    core: [],
    straight: info.map((i) => machine(i, i.build)),
    networks,
    markers,
    power,
    notes: [
      ...(fallback ? [fallback] : []),
      ...multiblockNotes(),
      ...buildNotes(info.map((i) => machine(i, i.build)), (m) => m.count),
    ],
    ...(fallback ? { fallback } : {}),
  });
  const multiblockNotes = () => info.filter((i) => i.ref.multiblock).flatMap((i) => {
    if (!planned(i)) {
      if (i.ref.mID === EBF_ID && buildable(i.ref.mID, i.tier)) {
        const hatch = !i.tier || i.tier === 'ULV' ? 'LV' : i.tier;
        const max = ebfHeat(COILS[COILS.length - 1].heat, i.tier);
        return [`The ${i.ref.name}'s recipe needs ${formatNumber(i.heat)} K; ${COILS[COILS.length - 1].name} coils with an ${hatch} energy hatch give ${formatNumber(max)} K. Build it yourself with better coils`];
      }
      return [`Build the ${i.ref.name} here yourself (multiblocks aren't laid out yet)`];
    }
    const name = i.ref.name;
    const coil = i.ref.mID === EBF_ID ? coilFor(i.heat, i.tier) : undefined;
    return [
      `Fix the ${name}'s maintenance hatch with tools after pasting it`,
      ...(coil ? [`The ${name} uses ${coil.name} Heating Coils (its recipe needs ${formatNumber(i.heat)} K)`] : []),
      ...(i.ref.mID === PYROLYSE_OVEN_ID ? [`The ${name} uses Kanthal Heating Coils so it runs at the recipe's speed (Cupronickel would halve it)`] : []),
      ...(hasMuffler(i.ref.mID) ? [`Keep the block above the ${name}'s muffler hatch empty`] : []),
      ...(i.ref.mID === PYROLYSE_OVEN_ID ? [`Place a Steel Frame Box on top of each of the ${name}'s two back pipe columns (Schematica can't hold frame boxes)`] : []),
      ...(i.ref.mID === 1169 || i.ref.mID === 1160 ? [`The ${name}'s Heating Coils are Cupronickel; better ones can be swapped in`] : []),
      ...i.kept.map((k) => `Put a ${k.name} in the ${name}'s controller or input bus`),
    ];
  });

  if (style === 'straight') return straightPlan();

  // Slices are sized by the first input you have (else the first input from outside).
  const haveKey = haveBoxes(chain)[0]?.key ?? [...result.inputs.keys()][0];
  const anchor = haveKey ? info.find((i) => i.inputs.includes(haveKey)) : undefined;
  const fallback = "This line doesn't repeat, so it's laid out in a straight line.";
  if (!anchor) return straightPlan(fallback);
  const sliceCount = Math.ceil(anchor.machines - 1e-9);
  if (sliceCount < 2) return straightPlan(fallback);

  const repeats = (i: (typeof info)[number]) => !i.ref.multiblock && i.machines / sliceCount >= 0.5;
  const slice = info.filter(repeats).map((i) => machine(i, Math.ceil(i.machines / sliceCount - 1e-9)));
  const coreInfo = info.filter((i) => !repeats(i));
  const core = coreInfo.map((i) => machine(i, Math.ceil(i.machines - 1e-9)));
  const coreServes = coreInfo.length
    ? Math.min(...coreInfo.map((i) => Math.floor((Math.ceil(i.machines - 1e-9) * anchor.machines) / i.machines + 1e-9)))
    : undefined;
  const haveAmount = (result.inputs.get(haveKey!) ?? 0);
  const notes = [
    `${sliceCount} slices for ${amountText(haveAmount, haveKey!, db)} · paste more slices on either end to grow it`,
    ...(coreServes !== undefined ? [`This core handles up to ${coreServes} slices`] : []),
    ...multiblockNotes(),
    ...buildNotes([...slice, ...core], (m) => (slice.includes(m) ? m.count * sliceCount : m.count)),
  ];
  return {
    style: 'modular',
    slice,
    sliceCount,
    core,
    ...(coreServes !== undefined ? { coreServes } : {}),
    inputsPerSlice: { key: haveKey!, amount: haveAmount / anchor.machines },
    networks,
    markers,
    power,
    notes,
  };
}
