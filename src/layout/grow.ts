import { formatNumber } from '../calculator/format';
import type { Build, FaceSetting, PlacedBlock } from '../model/types';
import type { GeneratedLine } from './types';

type End = 'left' | 'right';

const shiftBlock = (b: PlacedBlock, dx: number): PlacedBlock => ({ ...b, pos: [b.pos[0] + dx, b.pos[1], b.pos[2]] });
const shiftCover = (c: FaceSetting, dx: number): FaceSetting => ({ ...c, pos: [c.pos[0] + dx, c.pos[1], c.pos[2]] });

/** The notes that depend on how many slices there are, rewritten for `g`. */
function sliceNotes(notes: string[] | undefined, g: GeneratedLine): string[] {
  const n = g.left + g.right;
  const per = g.inputsPerSlice;
  const handles = per
    ? ` · handles ${per.kind === 'fluid' ? `${formatNumber(n * per.amount)} L/s ${per.name}` : `${formatNumber(n * per.amount)} ${per.name}/s`}`
    : '';
  return (notes ?? []).map((note) => {
    if (/^\d+ slices/.test(note)) return `${n} slices${handles} · paste more slices on either end to grow it`;
    if (/^This core handles up to/.test(note) && g.coreServes !== undefined) {
      return n > g.coreServes
        ? `This core handles up to ${g.coreServes} slices — past that, build a second core`
        : `This core handles up to ${g.coreServes} slices`;
    }
    return note;
  });
}

/** One more identical slice on the left or right end of a generated modular line. */
export function addSlice(build: Build, end: End): Build {
  const g = build.generated;
  if (!g || g.style !== 'modular') return build;
  const x0 = end === 'right' ? g.rightStart + g.right * g.sliceLength : g.leftStart - g.sliceLength;
  const next: GeneratedLine = end === 'right'
    ? { ...g, right: g.right + 1, sliceCount: g.sliceCount + 1 }
    : { ...g, left: g.left + 1, leftStart: x0, sliceCount: g.sliceCount + 1 };
  return {
    ...build,
    blocks: [...build.blocks, ...g.template.map((b) => shiftBlock(b, x0))],
    covers: [...(build.covers ?? []), ...(g.templateCovers ?? []).map((c) => shiftCover(c, x0))],
    notes: sliceNotes(build.notes, next),
    generated: next,
  };
}

/** Removes the outermost slice on one end; a side with no slices is left as it is. */
export function removeSlice(build: Build, end: End): Build {
  const g = build.generated;
  if (!g || g.style !== 'modular' || (end === 'right' ? g.right : g.left) === 0) return build;
  const x0 = end === 'right' ? g.rightStart + (g.right - 1) * g.sliceLength : g.leftStart;
  const inside = (x: number) => x >= x0 && x < x0 + g.sliceLength;
  const next: GeneratedLine = end === 'right'
    ? { ...g, right: g.right - 1, sliceCount: g.sliceCount - 1 }
    : { ...g, left: g.left - 1, leftStart: g.leftStart + g.sliceLength, sliceCount: g.sliceCount - 1 };
  const covers = (build.covers ?? []).filter((c) => !inside(c.pos[0]));
  return {
    ...build,
    blocks: build.blocks.filter((b) => !inside(b.pos[0])),
    ...(covers.length ? { covers } : { covers: undefined }),
    notes: sliceNotes(build.notes, next),
    generated: next,
  };
}

/** Where to put a single exported slice in game. */
export const ALIGN_HINT =
  "Line it up so its walkway continues the line's walkway: on the east end, its west edge goes right after the last slice; on the west end, its east edge goes right before the first slice.";

/** A single slice on its own, for exporting and lining up by hand in game. */
export function sliceBuild(build: Build): Build {
  const g = build.generated!;
  return {
    version: 1,
    name: `${build.name} slice`,
    blocks: g.template,
    ...(build.machines ? { machines: build.machines } : {}),
    ...(g.templateCovers?.length ? { covers: g.templateCovers } : {}),
    notes: [ALIGN_HINT],
  };
}
