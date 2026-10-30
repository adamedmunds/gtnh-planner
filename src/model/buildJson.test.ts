import { getEntry } from '../catalog';
import { BuildParseError, parseBuild, serializeBuild } from './buildJson';
import type { Build } from './types';

const good: Build = {
  version: 1,
  name: 'line',
  blocks: [
    { pos: [0, 0, 0], key: 'distillery_lv', facing: 3 },
    { pos: [-1, 2, 5], key: 'tin_cable_1x', manualMask: { forcedOn: 1, forcedOff: 32 } },
  ],
};

test('round-trips a valid build with no warnings', () => {
  expect(parseBuild(serializeBuild(good))).toEqual({ build: good, warnings: [] });
});

test.each([
  ['not json', /valid JSON/],
  ['[]', /version 1/],
  ['{"version":2,"blocks":[]}', /version 1/],
  ['{"version":1,"blocks":"nope"}', /blocks/],
])('rejects %s', (text, msg) => {
  expect(() => parseBuild(text)).toThrow(BuildParseError);
  expect(() => parseBuild(text)).toThrow(msg);
});

test('skips blocks with bad positions or keys, with a warning each', () => {
  const { build, warnings } = parseBuild(JSON.stringify({
    version: 1,
    name: 'x',
    blocks: [
      { pos: ['1', 0, 0], key: 'distillery_lv' },
      { pos: [0, 0], key: 'distillery_lv' },
      { pos: [0, 0.5, 0], key: 'distillery_lv' },
      { pos: [0, 0, 0], key: '' },
      { pos: [1, 1, 1], key: 'distillery_lv' },
    ],
  }));
  expect(build.blocks).toEqual([{ pos: [1, 1, 1], key: 'distillery_lv' }]);
  expect(warnings).toHaveLength(4);
});

test('drops invalid facing and masks but keeps the block', () => {
  const { build, warnings } = parseBuild(JSON.stringify({
    version: 1,
    name: 'x',
    blocks: [
      { pos: [0, 0, 0], key: 'distillery_lv', facing: 7 },
      { pos: [1, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: 'a', forcedOff: 0 } },
      { pos: [2, 0, 0], key: 'tin_cable_1x', manualMask: { forcedOn: 64, forcedOff: 0 } },
    ],
  }));
  expect(build.blocks).toEqual([
    { pos: [0, 0, 0], key: 'distillery_lv' },
    { pos: [1, 0, 0], key: 'tin_cable_1x' },
    { pos: [2, 0, 0], key: 'tin_cable_1x' },
  ]);
  expect(warnings).toHaveLength(3);
});

test('missing or non-string name becomes "untitled"; unknown keys are kept for the exporter to report', () => {
  const { build } = parseBuild('{"version":1,"blocks":[{"pos":[0,0,0],"key":"future_machine"}]}');
  expect(build.name).toBe('untitled');
  expect(build.blocks[0].key).toBe('future_machine');
});

test('duplicate positions keep the last block and warn', () => {
  const { build, warnings } = parseBuild(JSON.stringify({
    version: 1,
    name: 'x',
    blocks: [
      { pos: [0, 0, 0], key: 'distillery_lv' },
      { pos: [0, 0, 0], key: 'electrolyzer_lv' },
    ],
  }));
  expect(build.blocks).toEqual([{ pos: [0, 0, 0], key: 'electrolyzer_lv' }]);
  expect(warnings).toEqual([expect.stringMatching(/0,0,0/)]);
});

test('recipe machines carried by the build round-trip and register', () => {
  const b: Build = { ...good, machines: [{ key: 'gt_1112', name: 'Turbo Combustion Generator', mID: 1112, tier: 'HV' }], notes: ['Add a pump cover'] };
  const { build, warnings } = parseBuild(serializeBuild(b));
  expect(warnings).toEqual([]);
  expect(build.machines).toEqual(b.machines);
  expect(build.notes).toEqual(['Add a pump cover']);
  expect(getEntry('gt_1112')?.name).toBe('Turbo Combustion Generator');
});

test('a multiblock controller keeps its controller look after a reload', () => {
  const b: Build = { ...good, machines: [{ key: 'gt_1126', name: 'Distillation Tower', mID: 1126, tier: 'HV', multiblock: true }] };
  const { build } = parseBuild(serializeBuild(b));
  expect(build.machines).toEqual(b.machines);
  expect(getEntry('gt_1126')?.meta).toBe(2);
});

test('a locked output hatch stays locked after a reload', () => {
  const b: Build = { ...good, blocks: [{ pos: [0, 0, 0], key: 'hatch_output_lv', role: 'lcr', facing: 3, port: { kind: 'out', keys: ['fluid:b'], locked: true } }] };
  expect(parseBuild(serializeBuild(b)).build.blocks[0].port).toEqual({ kind: 'out', keys: ['fluid:b'], locked: true });
});

test('a malformed recipe machine is skipped with a warning', () => {
  const { build, warnings } = parseBuild(JSON.stringify({ ...good, machines: [{ key: 'gt_1', mID: 'x' }] }));
  expect(build.machines).toBeUndefined();
  expect(warnings).toEqual([expect.stringMatching(/machine/i)]);
});

test('pipe networks round-trip; builds without them still load', () => {
  const b: Build = {
    ...good,
    blocks: [{ pos: [0, 0, 0], key: 'bronze_pipe_small', net: 'f:fluid:oil' }],
    networks: [{ id: 'f:fluid:oil', name: 'Oil', kind: 'fluid', icon: 'fluid:oil', flow: 557, conduit: 'bronze_pipe_small' }],
  };
  const { build } = parseBuild(serializeBuild(b));
  expect(build.blocks[0].net).toBe('f:fluid:oil');
  expect(build.networks).toEqual(b.networks);
  expect(parseBuild(serializeBuild(good)).build.networks).toBeUndefined();
});

test('round-trips a multiblock port and drops a malformed one', () => {
  const b: Build = { version: 1, name: 'mb', blocks: [{ pos: [0, 0, 0], key: 'hatch_output_lv', facing: 4, role: 'mb', port: { kind: 'out', keys: ['fluid:a'] } }] };
  expect(parseBuild(serializeBuild(b)).build).toEqual(b);
  const bad = JSON.stringify({ ...b, blocks: [{ ...b.blocks[0], port: { kind: 'sideways', keys: [] } }] });
  expect(parseBuild(bad).build.blocks[0].port).toBeUndefined();
});
