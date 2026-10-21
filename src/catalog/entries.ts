import type { CatalogEntry, Tier } from './types';

const TIERS: readonly Tier[] = ['LV', 'MV', 'HV'];

// IDs from gregtech.api.enums.MetaTileEntityIDs (GT 5.09.54.183).
const MACHINES = [
  { base: 'fluid_extractor', name: 'Fluid Extractor', ids: [511, 512, 513], color: '#6b8fb3' },
  { base: 'distillery', name: 'Distillery', ids: [531, 532, 533], color: '#b38f4d' },
  { base: 'chemical_reactor', name: 'Chemical Reactor', ids: [421, 422, 423], color: '#6bb36b' },
  { base: 'electrolyzer', name: 'Electrolyzer', ids: [371, 372, 373], color: '#b3b34d' },
  { base: 'extractor', name: 'Extractor', ids: [271, 272, 273], color: '#8f6bb3' },
] as const;

function machineEntries(): CatalogEntry[] {
  return MACHINES.flatMap((m) =>
    TIERS.map((tier, i): CatalogEntry => ({
      key: `${m.base}_${tier.toLowerCase()}`,
      name: `${tier} ${m.name}`,
      kind: 'machine',
      mID: m.ids[i],
      meta: 1,
      tier,
      group: 'Machines',
      color: m.color,
      textures: {
        top: `blocks/iconsets/MACHINE_${tier}_TOP.png`,
        side: `blocks/iconsets/MACHINE_${tier}_SIDE.png`,
        bottom: `blocks/iconsets/MACHINE_${tier}_BOTTOM.png`,
        front: `blocks/basicmachines/${m.base}/OVERLAY_FRONT.png`,
      },
    })),
  );
}

// GT WireCableBuilder: cable 1x = startId + 6, 4x = startId + 8. Insulated cable meta = 9.
// Tier, amperage per 1x and EU lost per block per amp, from GT LoaderMetaPipeEntities (WireCableBuilder).
const CABLES = [
  { base: 'tin', name: 'Tin', start: 1240, color: '#dcdcdc', tier: 'LV', amps: 1, loss: 1 },
  { base: 'copper', name: 'Copper', start: 1360, color: '#ff6400', tier: 'MV', amps: 1, loss: 2 },
  { base: 'annealed_copper', name: 'Annealed Copper', start: 1380, color: '#ff7814', tier: 'MV', amps: 1, loss: 1 },
  { base: 'gold', name: 'Gold', start: 1420, color: '#ffe650', tier: 'HV', amps: 3, loss: 2 },
  { base: 'electrum', name: 'Electrum', start: 1440, color: '#ffff64', tier: 'HV', amps: 2, loss: 1 },
  { base: 'silver', name: 'Silver', start: 1460, color: '#dcdcff', tier: 'HV', amps: 1, loss: 1 },
] as const;

// Cable n×: id = start + 6.. (1x, 2x, 4x, 8x, 12x, 16x); amps scale with size, loss per block doesn't.
const CABLE_SIZES = [
  { size: '1x', n: 1, offset: 6, thickness: 0.25, insulation: 'SMALL' },
  { size: '2x', n: 2, offset: 7, thickness: 0.3125, insulation: 'SMALL' },
  { size: '4x', n: 4, offset: 8, thickness: 0.4375, insulation: 'MEDIUM' },
  { size: '8x', n: 8, offset: 9, thickness: 0.5625, insulation: 'MEDIUM_PLUS' },
  { size: '12x', n: 12, offset: 10, thickness: 0.6875, insulation: 'LARGE' },
  { size: '16x', n: 16, offset: 11, thickness: 0.8125, insulation: 'HUGE' },
] as const;

function cableEntries(): CatalogEntry[] {
  return CABLES.flatMap((c) => CABLE_SIZES.map((s): CatalogEntry => ({
    cable: { tier: c.tier, ampsPerSize: c.amps, size: s.n, lossPerBlock: c.loss },
    key: `${c.base}_cable_${s.size}`,
    name: `${s.size} ${c.name} Cable`,
    kind: 'cable',
    mID: c.start + s.offset,
    meta: 9,
    group: 'Cables',
    thickness: s.thickness,
    color: c.color,
    textures: {
      side: 'blocks/iconsets/INSULATION_FULL.png',
      end: `blocks/iconsets/INSULATION_${s.insulation}.png`,
      core: 'blocks/materialicons/NONE/wire.png',
    },
  })));
}

// Metal pipes use GT's NONE icon set (METALLIC/SHINY fall back to it), tinted with the material colour.
const pipeTextures = (icon: string) => ({
  side: 'blocks/materialicons/NONE/pipeSide.png',
  end: `blocks/materialicons/NONE/${icon}.png`,
});

// GT pipe sizes, in id order. Meta = 4 + the material's tool quality (0-3), from GT LoaderMetaPipeEntities.
const PIPE_SIZES = [
  { size: 'tiny', label: 'Tiny', thickness: 0.25, icon: 'pipeTiny' },
  { size: 'small', label: 'Small', thickness: 0.375, icon: 'pipeSmall' },
  { size: 'normal', label: 'Normal', thickness: 0.5, icon: 'pipeMedium' },
  { size: 'large', label: 'Large', thickness: 0.75, icon: 'pipeLarge' },
  { size: 'huge', label: 'Huge', thickness: 0.875, icon: 'pipeHuge' },
] as const;

// GT FluidPipeBuilder: tiny = start, small +1, ... huge +4. `capacity`: its baseCapacity, the normal pipe's L/t.
const FLUID_PIPES = [
  { base: 'copper', name: 'Copper', start: 5110, meta: 5, color: '#ff6400', capacity: 20 },
  { base: 'bronze', name: 'Bronze', start: 5120, meta: 6, color: '#ff8000', capacity: 120 },
  { base: 'cast_iron', name: 'Cast Iron', start: 5260, meta: 6, color: '#c8b4b4', capacity: 180 },
  { base: 'steel', name: 'Steel', start: 5130, meta: 7, color: '#808080', capacity: 240 },
  { base: 'stainless_steel', name: 'Stainless Steel', start: 5140, meta: 7, color: '#c8c8dc', capacity: 360 },
  { base: 'titanium', name: 'Titanium', start: 5150, meta: 7, color: '#dca0f0', capacity: 480 },
  { base: 'plastic', name: 'Plastic', start: 5170, meta: 5, color: '#c8c8c8', capacity: 360 },
  { base: 'ptfe', name: 'PTFE', start: 5680, meta: 5, color: '#646464', capacity: 480 },
] as const;

/** L/t of each fluid pipe size for a material's baseCapacity (GT FluidPipeBuilder, Java integer division). */
const FLUID_SIZE_CAPACITY: Record<string, (base: number) => number> = {
  tiny: (b) => Math.floor(b / 6), small: (b) => Math.floor(b / 3), normal: (b) => b, large: (b) => b * 2, huge: (b) => b * 4,
};

function fluidPipeEntries(): CatalogEntry[] {
  return FLUID_PIPES.flatMap((p) =>
    PIPE_SIZES.map((s, i): CatalogEntry => ({
      key: `${p.base}_pipe_${s.size}`,
      name: `${s.label} ${p.name} Fluid Pipe`,
      kind: 'fluidPipe',
      // GT shows a pipe's L/t times 20 as its capacity per second.
      pipeCapacity: FLUID_SIZE_CAPACITY[s.size](p.capacity) * 20,
      mID: p.start + i,
      meta: p.meta,
      group: 'Fluid pipes',
      thickness: s.thickness,
      color: p.color,
      textures: pipeTextures(s.icon),
    })),
  );
}

// GT ItemPipeBuilder: `ids` in size order, tiny to huge (materials without tiny and small start at normal).
// `huge`: its invSlotsForHugePipe, which sets every size's speed.
const ITEM_PIPES = [
  { base: 'tin', name: 'Tin', ids: [5589, 5590, 5591, 5592, 5593], meta: 7, color: '#dcdcdc', huge: 2 },
  { base: 'brass', name: 'Brass', ids: [5600, 5601, 5602, 5603, 5604], meta: 5, color: '#ffb400', huge: 4 },
  { base: 'electrum', name: 'Electrum', ids: [5610, 5611, 5612, 5613, 5614], meta: 6, color: '#ffff64', huge: 8 },
  { base: 'nickel', name: 'Nickel', ids: [5700, 5701, 5702], meta: 6, color: '#c8c8fa', huge: 4 },
  { base: 'cobalt', name: 'Cobalt', ids: [5710, 5711, 5712], meta: 7, color: '#5050fa', huge: 8 },
  { base: 'aluminium', name: 'Aluminium', ids: [5720, 5721, 5722], meta: 6, color: '#80c8f0', huge: 8 },
  { base: 'pvc', name: 'PVC', ids: [5690, 5691, 5692], meta: 5, color: '#d7e6e6', huge: 16 },
] as const;
/** GT divides invSlotsForHugePipe by this for each size. */
const ITEM_SIZE_DIV: Record<string, number> = { tiny: 16, small: 8, normal: 4, large: 2, huge: 1 };

/** Items per second: GT moves max(huge / div, 1) stacks every max(div / huge, 1) seconds. */
const itemsPerSecond = (huge: number, div: number) => (Math.max(Math.floor(huge / div), 1) * 64) / Math.max(Math.floor(div / huge), 1);

function itemPipeEntries(): CatalogEntry[] {
  return ITEM_PIPES.flatMap((p) => PIPE_SIZES.slice(PIPE_SIZES.length - p.ids.length).map((s, i): CatalogEntry => ({
    key: `${p.base}_item_pipe_${s.size}`,
    name: `${s.label} ${p.name} Item Pipe`,
    kind: 'itemPipe',
    itemCapacity: itemsPerSecond(p.huge, ITEM_SIZE_DIV[s.size]),
    mID: p.ids[i],
    meta: p.meta,
    group: 'Item pipes',
    thickness: s.thickness,
    color: p.color,
    textures: pipeTextures(s.icon),
  })));
}

// Power blocks. MV combustion generator: COMBUSTION_GENERATOR_MV; MV→LV transformer: transformer_MV_LV (tier LV).
// Both are tiered machine blocks with meta 1 (verified in the user's world save).
const POWER: CatalogEntry[] = [
  {
    key: 'combustion_generator_mv',
    name: 'MV Combustion Generator',
    kind: 'machine',
    mID: 1111,
    meta: 1,
    tier: 'MV',
    group: 'Power',
    color: '#b35a3c',
    textures: {
      top: 'blocks/iconsets/DIESEL_GENERATOR_TOP.png',
      side: 'blocks/iconsets/MACHINE_MV_SIDE.png',
      bottom: 'blocks/iconsets/MACHINE_MV_BOTTOM.png',
      front: 'blocks/iconsets/OVERLAY_ENERGY_OUT.png',
    },
  },
  {
    key: 'transformer_mv_lv',
    name: 'MV→LV Transformer',
    kind: 'machine',
    mID: 21,
    meta: 1,
    tier: 'LV',
    group: 'Power',
    color: '#5a7fb3',
    textures: {
      top: 'blocks/iconsets/MACHINE_LV_TOP.png',
      side: 'blocks/iconsets/MACHINE_LV_SIDE.png',
      bottom: 'blocks/iconsets/MACHINE_LV_BOTTOM.png',
      front: 'blocks/iconsets/OVERLAY_ENERGY_IN.png',
    },
  },
];

const casing = (tier: string) => ({
  top: `blocks/iconsets/MACHINE_${tier}_TOP.png`,
  side: `blocks/iconsets/MACHINE_${tier}_SIDE.png`,
  bottom: `blocks/iconsets/MACHINE_${tier}_BOTTOM.png`,
});

POWER.push({
  key: 'transformer_hv_mv',
  name: 'HV→MV Transformer',
  kind: 'machine',
  mID: 22,
  meta: 1,
  tier: 'MV',
  group: 'Power',
  color: '#5a7fb3',
  textures: { ...casing('MV'), front: 'blocks/iconsets/OVERLAY_ENERGY_IN.png' },
});

// Stand-ins for where things come in and go out: items in an oak drawer and out a spruce one (Storage Drawers 1x1,
// meta = wood), fluids in from glass and out into a GT Super Tank I. Power and multiblocks stay plain vanilla blocks.
const marker = (key: string, name: string, color: string, vanilla: string): CatalogEntry => ({
  key, name, kind: 'marker', mID: 0, meta: 0, group: 'Markers', color, vanilla, textures: {},
});
const drawer = (key: string, name: string, wood: string, meta: number, color: string): CatalogEntry => {
  const side = `storagedrawers/blocks/drawers_${wood}_side.png`;
  return {
    key, name, kind: 'marker', mID: 0, meta, group: 'Markers', color, vanilla: 'StorageDrawers:fullDrawers1', drawer: true,
    textures: { top: side, side, bottom: side, front: `storagedrawers/blocks/drawers_${wood}_front_1.png` },
  };
};
const glass = 'minecraft/blocks/glass.png';
const MARKERS: CatalogEntry[] = [
  drawer('marker_item_in', 'Items in (oak drawer)', 'oak', 0, '#b8945f'),
  drawer('marker_item_out', 'Items out (spruce drawer)', 'spruce', 1, '#6b4f2e'),
  {
    key: 'marker_fluid_in', name: 'Fluid in (glass)', kind: 'marker', mID: 0, meta: 0, group: 'Markers', color: '#cfe8ff',
    vanilla: 'minecraft:glass', seeThrough: true, textures: { top: glass, side: glass, bottom: glass },
  },
  // GT Super Tank I (SUPER_TANK_LV): takes fluid on every face but its front.
  {
    key: 'marker_fluid_out', name: 'Fluid out (Super Tank I)', kind: 'marker', mID: 130, meta: 1, group: 'Markers', color: '#5a7fb3',
    textures: { ...casing('LV'), topOverlay: 'blocks/iconsets/OVERLAY_QTANK.png', front: 'blocks/iconsets/OVERLAY_PIPE.png' },
  },
  marker('marker_power_in', 'Power in', '#ef5350', 'minecraft:redstone_block'),
  marker('marker_multiblock', 'Multiblock goes here', '#ab47bc', 'minecraft:bookshelf'),
];

/** Catalog entry for a recipe machine without a hand-made entry: tier casing (HV casing above HV), no front overlay. */
export function generatedEntry(m: { key: string; name: string; mID: number; tier?: string }): CatalogEntry {
  const tier = m.tier === 'LV' || m.tier === 'MV' || m.tier === 'HV' ? m.tier : m.tier === 'ULV' ? 'LV' : 'HV';
  return { key: m.key, name: m.name, kind: 'machine', mID: m.mID, meta: 1, tier, group: 'Recipe machines', color: '#7a8290', textures: casing(tier) };
}

export const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  ...machineEntries(),
  ...POWER,
  ...MARKERS,
  ...cableEntries(),
  ...fluidPipeEntries(),
  ...itemPipeEntries(),
];
