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
const CABLES = [
  { base: 'tin', name: 'Tin', start: 1240, color: '#dcdcdc' },
  { base: 'copper', name: 'Copper', start: 1360, color: '#ff6400' },
  { base: 'annealed_copper', name: 'Annealed Copper', start: 1380, color: '#ff7814' },
] as const;

function cableEntries(): CatalogEntry[] {
  return CABLES.flatMap((c) => [
    { size: '1x', offset: 6, thickness: 0.25, insulation: 'SMALL' },
    { size: '4x', offset: 8, thickness: 0.5, insulation: 'MEDIUM' },
  ].map((s): CatalogEntry => ({
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

// GT FluidPipeBuilder: tiny = start, small +1, normal +2, large +3. Meta = 4 + tool quality.
const FLUID_PIPES = [
  { base: 'bronze', name: 'Bronze', start: 5120, meta: 6, color: '#ff8000' },
  { base: 'steel', name: 'Steel', start: 5130, meta: 7, color: '#808080' },
] as const;

const PIPE_SIZES = [
  { size: 'small', label: 'Small', offset: 1, thickness: 0.375, icon: 'pipeSmall' },
  { size: 'normal', label: 'Normal', offset: 2, thickness: 0.5, icon: 'pipeMedium' },
  { size: 'large', label: 'Large', offset: 3, thickness: 0.75, icon: 'pipeLarge' },
] as const;

function fluidPipeEntries(): CatalogEntry[] {
  return FLUID_PIPES.flatMap((p) =>
    PIPE_SIZES.map((s): CatalogEntry => ({
      key: `${p.base}_pipe_${s.size}`,
      name: `${s.label} ${p.name} Fluid Pipe`,
      kind: 'fluidPipe',
      mID: p.start + s.offset,
      meta: p.meta,
      group: 'Fluid pipes',
      thickness: s.thickness,
      color: p.color,
      textures: pipeTextures(s.icon),
    })),
  );
}

// GT ItemPipeBuilder: tiny, small, normal, ... in idList order.
const ITEM_PIPES = [
  { base: 'tin', name: 'Tin', small: 5590, normal: 5591, meta: 7, color: '#dcdcdc' },
  { base: 'electrum', name: 'Electrum', small: 5611, normal: 5612, meta: 6, color: '#ffff64' },
] as const;

function itemPipeEntries(): CatalogEntry[] {
  return ITEM_PIPES.flatMap((p) => [
    { size: 'small', label: 'Small', mID: p.small, thickness: 0.375, icon: 'pipeSmall' },
    { size: 'normal', label: 'Normal', mID: p.normal, thickness: 0.5, icon: 'pipeMedium' },
  ].map((s): CatalogEntry => ({
    key: `${p.base}_item_pipe_${s.size}`,
    name: `${s.label} ${p.name} Item Pipe`,
    kind: 'itemPipe',
    mID: s.mID,
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

export const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  ...machineEntries(),
  ...POWER,
  ...cableEntries(),
  ...fluidPipeEntries(),
  ...itemPipeEntries(),
];
