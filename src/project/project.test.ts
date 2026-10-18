import { parseProject, serializeProject, type Project } from './project';
import { BuildParseError } from '../model/buildJson';
import { emptyChain } from '../calc/chain';

const project: Project = {
  version: 2,
  build: { version: 1, name: 'line', blocks: [{ pos: [0, 0, 0], key: 'distillery_lv', facing: 3 }] },
  chain: {
    version: 1,
    nodes: [
      { id: 'a', kind: 'recipe', recipeSig: 'gt.recipe.distillery|x|y', machineMID: 531, overclock: true, position: { x: 10, y: 20 } },
      { id: 'g', kind: 'generator', fuelMap: 'gt.recipe.dieselgeneratorfuel', fuelKey: 'fluid:liquid_light_fuel', machineMID: 1111, position: { x: 0, y: 0 } },
    ],
    targets: [{ key: 'fluid:liquid_light_fuel', maximise: true }, { key: 'fluid:oil', rate: 50 }],
    limits: [{ key: 'item:cropsnh:materialLeaf@10', maxRate: 5.57 }],
    externals: ['item:IC2:itemCellEmpty@0'],
  },
};

test('round-trips a project', () => {
  expect(parseProject(serializeProject(project))).toEqual({ project, warnings: [] });
});

test('a build-only (version 1) file loads with an empty chain', () => {
  const v1 = JSON.stringify(project.build);
  expect(parseProject(v1)).toEqual({ project: { version: 2, build: project.build, chain: emptyChain() }, warnings: [] });
});

test('bad chain nodes and entries are skipped with warnings', () => {
  const text = JSON.stringify({
    ...project,
    chain: {
      ...project.chain,
      nodes: [...project.chain.nodes, { id: 'b', kind: 'recipe', recipeSig: 'x', machineMID: 'nope', position: { x: 0, y: 0 } }],
      targets: [...project.chain.targets, { key: 5 }],
      limits: [...project.chain.limits, { key: 'k', maxRate: -1 }],
    },
  });
  const { project: p, warnings } = parseProject(text);
  expect(p.chain.nodes).toHaveLength(2);
  expect(p.chain.targets).toHaveLength(2);
  expect(p.chain.limits).toHaveLength(1);
  expect(warnings).toHaveLength(3);
});

test('garbage is rejected with BuildParseError', () => {
  expect(() => parseProject('{oops')).toThrow(BuildParseError);
  expect(() => parseProject('{"version":3}')).toThrow(BuildParseError);
});
